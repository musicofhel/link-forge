import { readdir, copyFile, unlink, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pino from "pino";
import type { QueueClient } from "../queue/index.js";
import { enqueueFile } from "../queue/operations.js";
import { isSupportedFile, fileHash } from "../extractor/index.js";

export interface InboxWatcherConfig {
  /** Directory to watch for incoming files. */
  inboxDir: string;
  /** Directory to store files for processing. */
  uploadDir: string;
  /** How often to check for new files (ms). */
  pollIntervalMs: number;
  /** Identity to attribute local files to. */
  authorName: string;
}

export interface InboxWatcher {
  start(): void;
  stop(): void;
}

export function createInboxWatcher(
  config: InboxWatcherConfig,
  queueClient: QueueClient,
  logger: pino.Logger,
): InboxWatcher {
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;

    try {
      await mkdir(config.inboxDir, { recursive: true });
      await mkdir(config.uploadDir, { recursive: true });

      const entries = await readdir(config.inboxDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!isSupportedFile(entry.name)) continue;

        const srcPath = join(config.inboxDir, entry.name);
        const log = logger.child({ file: entry.name });

        try {
          // Read and hash
          const buffer = readFileSync(srcPath);
          const hash = fileHash(buffer);

          // Copy to uploads dir then delete original (rename fails across filesystems)
          const ext = entry.name.substring(entry.name.lastIndexOf("."));
          const destPath = join(config.uploadDir, `${hash}${ext}`);
          await copyFile(srcPath, destPath);
          await unlink(srcPath);

          // Enqueue
          const queued = enqueueFile(queueClient.db, {
            fileName: entry.name,
            filePath: destPath,
            fileHash: hash,
            discordChannelId: "local-inbox",
            discordAuthorName: config.authorName,
            sourcePrefix: "inbox",
          });

          if (queued) {
            log.info({ hash: hash.slice(0, 12) }, "Inbox: file enqueued");
          } else {
            log.info("Inbox: duplicate file (already processed)");
          }
        } catch (err) {
          log.error(
            { err: err instanceof Error ? err.message : err },
            "Inbox: failed to process file",
          );
        }
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        "Inbox: poll cycle failed",
      );
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      logger.info(
        { inboxDir: config.inboxDir, pollIntervalMs: config.pollIntervalMs },
        "Starting inbox watcher",
      );
      timer = setInterval(() => void poll(), config.pollIntervalMs);
      void poll();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info("Inbox watcher stopped");
    },
  };
}
