import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { parseOffice } from "officeparser";
import type pino from "pino";
import type { ScrapedContent } from "../processor/scraper.js";
import { extractEpubText } from "./epub.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".epub",
  ".txt",
  ".md",
  ".html",
  ".htm",
]);

/** Check if a filename has a supported document extension. */
export function isSupportedFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/** Compute SHA-256 hex hash of a buffer for dedup and identity. */
export function fileHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Extract text content from a local file, returning the same ScrapedContent
 *  interface used by scrapeUrl() so the downstream pipeline is unchanged. */
export async function extractTextFromFile(
  filePath: string,
  logger: pino.Logger,
): Promise<ScrapedContent> {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath);
  const log = logger.child({ file: name, ext });

  log.debug("Extracting text from file");

  switch (ext) {
    case ".pdf":
    case ".docx":
    case ".pptx":
    case ".xlsx": {
      const ast = await parseOffice(filePath);
      const text = ast.toText();
      const title = titleFromFilename(name);
      return {
        title,
        description: text.slice(0, 300).trim(),
        content: text.trim(),
        domain: "local-file",
      };
    }

    case ".epub": {
      const { title, text } = await extractEpubText(filePath, log);
      return {
        title,
        description: text.slice(0, 300).trim(),
        content: text,
        domain: "local-file",
      };
    }

    case ".txt":
    case ".md": {
      const raw = await readFile(filePath, "utf-8");
      const title = titleFromFilename(name);
      return {
        title,
        description: raw.slice(0, 300).trim(),
        content: raw,
        domain: "local-file",
      };
    }

    case ".html":
    case ".htm": {
      const raw = await readFile(filePath, "utf-8");
      const dom = new JSDOM(raw);
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article) {
        return {
          title: article.title || titleFromFilename(name),
          description: article.excerpt || article.textContent.slice(0, 300).trim(),
          content: article.textContent.trim(),
          domain: "local-file",
        };
      }
      // Fallback: strip tags
      const bodyText = dom.window.document.body?.textContent?.trim() || "";
      return {
        title: dom.window.document.title || titleFromFilename(name),
        description: bodyText.slice(0, 300),
        content: bodyText,
        domain: "local-file",
      };
    }

    default:
      throw new Error(`Unsupported file extension: ${ext}`);
  }
}

/** Derive a human-readable title from a filename (strip extension, replace separators). */
function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
