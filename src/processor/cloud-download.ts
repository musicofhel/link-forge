import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type pino from "pino";
import { fileHash, isSupportedFile } from "../extractor/index.js";
import { validateUrlForSSRF } from "../security/url-validator.js";
import { sanitizeFilename } from "../security/path-validator.js";

export interface CloudDownloadResult {
  filePath: string;
  fileName: string;
  hash: string;
}

/**
 * Detect if a URL is a cloud storage file-sharing link (Google Drive, Dropbox).
 * Returns a download URL if recognized, null otherwise.
 */
export function getCloudDownloadUrl(url: string): { downloadUrl: string; source: string } | null {
  // Google Drive: https://drive.google.com/file/d/{fileId}/view?usp=sharing
  const gdriveMatch = url.match(
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
  );
  if (gdriveMatch?.[1]) {
    return {
      downloadUrl: `https://drive.google.com/uc?export=download&id=${gdriveMatch[1]}`,
      source: "gdrive-link",
    };
  }

  // Google Drive: https://drive.google.com/open?id={fileId}
  const gdriveOpenMatch = url.match(
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
  );
  if (gdriveOpenMatch?.[1]) {
    return {
      downloadUrl: `https://drive.google.com/uc?export=download&id=${gdriveOpenMatch[1]}`,
      source: "gdrive-link",
    };
  }

  // Dropbox: https://www.dropbox.com/s/{id}/{filename}?dl=0
  // or: https://www.dropbox.com/scl/fi/{id}/{filename}?...
  if (url.includes("dropbox.com/s/") || url.includes("dropbox.com/scl/fi/")) {
    const dlUrl = new URL(url);
    dlUrl.searchParams.set("dl", "1");
    return { downloadUrl: dlUrl.toString(), source: "dropbox-link" };
  }

  return null;
}

/**
 * Download a file from a cloud share link, save to uploads dir.
 * Returns null if the downloaded file is not a supported type.
 */
export async function downloadCloudFile(
  url: string,
  downloadUrl: string,
  uploadDir: string,
  logger: pino.Logger,
): Promise<CloudDownloadResult | null> {
  const log = logger.child({ url });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  const MAX_CLOUD_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  try {
    await validateUrlForSSRF(downloadUrl);

    const res = await fetch(downloadUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkForge/1.0)",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      log.warn({ status: res.status }, "Cloud download failed");
      return null;
    }

    // Check content-length before downloading into memory
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_CLOUD_FILE_SIZE) {
      log.warn({ size: contentLength }, "Cloud file exceeds 50MB limit");
      return null;
    }

    // Try to get filename from Content-Disposition header
    let fileName = "download";
    const disposition = res.headers.get("content-disposition");
    if (disposition) {
      // filename*=UTF-8''encoded or filename="quoted"
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
      const extracted = utf8Match?.[1] ?? plainMatch?.[1];
      if (extracted) {
        fileName = sanitizeFilename(decodeURIComponent(extracted).trim());
      }
    }

    // Fallback: try to extract filename from original URL path
    if (fileName === "download") {
      try {
        const parsed = new URL(url);
        const segments = parsed.pathname.split("/").filter(Boolean);
        const last = segments.at(-1);
        if (last && last.includes(".")) {
          fileName = sanitizeFilename(decodeURIComponent(last));
        }
      } catch {
        // keep default
      }
    }

    if (!isSupportedFile(fileName)) {
      log.debug({ fileName }, "Cloud file is not a supported document type");
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      log.warn("Cloud download returned empty file");
      return null;
    }

    // Double-check size after download (content-length can be absent or wrong)
    if (buffer.length > MAX_CLOUD_FILE_SIZE) {
      log.warn({ size: buffer.length }, "Cloud file exceeds 50MB limit after download");
      return null;
    }

    const hash = fileHash(buffer);
    const ext = fileName.substring(fileName.lastIndexOf("."));
    await mkdir(uploadDir, { recursive: true });
    const filePath = join(uploadDir, `${hash}${ext}`);

    // Validate path stays within upload directory
    const resolvedPath = resolve(filePath);
    const resolvedUploadDir = resolve(uploadDir);
    if (!resolvedPath.startsWith(resolvedUploadDir + "/")) {
      log.error({ filePath }, "Path traversal detected in cloud download");
      return null;
    }

    await writeFile(filePath, buffer);

    log.info({ fileName, hash: hash.slice(0, 12), bytes: buffer.length }, "Cloud file downloaded");

    return { filePath, fileName, hash };
  } finally {
    clearTimeout(timeout);
  }
}
