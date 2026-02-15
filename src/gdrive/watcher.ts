import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type pino from "pino";
import type { Driver } from "neo4j-driver";
import type { QueueClient } from "../queue/index.js";
import { enqueueFile } from "../queue/operations.js";
import { isSupportedFile, fileHash } from "../extractor/index.js";
import { resolveUserByDisplayName } from "./user-resolver.js";

export interface GDriveWatcherConfig {
  serviceAccountKeyPath: string;
  sharedFolderId: string;
  pollIntervalMs: number;
  uploadDir: string;
}

export interface GDriveWatcher {
  start(): void;
  stop(): void;
}

export function createGDriveWatcher(
  config: GDriveWatcherConfig,
  queueClient: QueueClient,
  neo4jDriver: Driver,
  logger: pino.Logger,
): GDriveWatcher {
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;

  const auth = new google.auth.GoogleAuth({
    keyFile: config.serviceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  async function listSubfolders(): Promise<drive_v3.Schema$File[]> {
    const res = await drive.files.list({
      q: `'${config.sharedFolderId}' in parents AND mimeType = 'application/vnd.google-apps.folder' AND trashed = false`,
      fields: "files(id, name)",
      pageSize: 100,
    });
    return res.data.files ?? [];
  }

  async function listFilesInFolder(folderId: string): Promise<drive_v3.Schema$File[]> {
    const res = await drive.files.list({
      q: `'${folderId}' in parents AND mimeType != 'application/vnd.google-apps.folder' AND trashed = false`,
      fields: "files(id, name, size)",
      pageSize: 100,
    });
    return res.data.files ?? [];
  }

  async function downloadFile(fileId: string): Promise<Buffer> {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  async function deleteFile(fileId: string): Promise<void> {
    await drive.files.delete({ fileId });
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;

    try {
      const subfolders = await listSubfolders();
      logger.debug({ count: subfolders.length }, "GDrive: scanning subfolders");

      for (const folder of subfolders) {
        if (!folder.id || !folder.name) continue;

        const userName = folder.name;
        const files = await listFilesInFolder(folder.id);

        for (const file of files) {
          if (!file.id || !file.name) continue;
          if (!isSupportedFile(file.name)) {
            logger.debug({ file: file.name, folder: userName }, "GDrive: skipping unsupported file type");
            continue;
          }

          const fileSize = Number(file.size ?? 0);
          if (fileSize > 50 * 1024 * 1024) {
            logger.warn({ file: file.name, size: fileSize }, "GDrive: file exceeds 50MB limit");
            continue;
          }

          const log = logger.child({ file: file.name, folder: userName });

          try {
            // Download
            const buffer = await downloadFile(file.id);
            const hash = fileHash(buffer);

            // Save locally
            await mkdir(config.uploadDir, { recursive: true });
            const ext = file.name.substring(file.name.lastIndexOf("."));
            const localPath = join(config.uploadDir, `${hash}${ext}`);
            await writeFile(localPath, buffer);

            // Resolve user identity
            const session = neo4jDriver.session();
            let resolvedUser;
            try {
              resolvedUser = await resolveUserByDisplayName(session, userName);
            } finally {
              await session.close();
            }

            // Enqueue
            const queued = enqueueFile(queueClient.db, {
              fileName: file.name,
              filePath: localPath,
              fileHash: hash,
              discordChannelId: "gdrive",
              discordAuthorId: resolvedUser.discordId,
              discordAuthorName: resolvedUser.displayName,
              sourcePrefix: "gdrive",
            });

            if (queued) {
              // Delete from Drive after successful enqueue
              await deleteFile(file.id);
              log.info({ hash: hash.slice(0, 12) }, "GDrive: file enqueued and deleted from Drive");
            } else {
              // Already processed (content-hash dedup) — still delete from Drive
              await deleteFile(file.id);
              log.info("GDrive: duplicate file deleted from Drive");
            }
          } catch (err) {
            log.error(
              { err: err instanceof Error ? err.message : err },
              "GDrive: failed to process file",
            );
          }
        }
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        "GDrive: poll cycle failed",
      );
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      logger.info(
        { pollIntervalMs: config.pollIntervalMs, folderId: config.sharedFolderId },
        "Starting Google Drive watcher",
      );
      timer = setInterval(() => void poll(), config.pollIntervalMs);
      // Run immediately on start
      void poll();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info("Google Drive watcher stopped");
    },
  };
}
