import { unlink } from "node:fs/promises";
import type pino from "pino";
import type { QueueClient } from "../queue/index.js";
import type { EmbeddingService } from "../embeddings/index.js";
import type { DiscordNotifier } from "./discord-notifier.js";
import { scrapeUrl } from "./scraper.js";
import { extractTextFromFile } from "../extractor/index.js";
import { getCloudDownloadUrl, downloadCloudFile } from "./cloud-download.js";
import { categorizeWithClaude } from "./claude-cli.js";
import {
  dequeue,
  markCompleted,
  markFailed,
  resetStale,
  enqueueDiscovered,
} from "../queue/operations.js";
import { createLink, linkExists } from "../graph/repositories/link.repository.js";
import { createCategory } from "../graph/repositories/category.repository.js";
import { createTag } from "../graph/repositories/tag.repository.js";
import { createTool } from "../graph/repositories/tool.repository.js";
import { createTechnology } from "../graph/repositories/technology.repository.js";
import {
  categorizeLink,
  tagLink,
  linkMentionsTool,
  linkMentionsTech,
  linksTo,
  sharedBy,
} from "../graph/relationships.js";
import { createUser, getUserInterests } from "../graph/repositories/user.repository.js";
import { updateLinkCount } from "../graph/repositories/category.repository.js";
import { extractUrlsFromContent } from "./link-extractor.js";
import type { Driver } from "neo4j-driver";

export interface ProcessorOptions {
  pollIntervalMs: number;
  scrapeTimeoutMs: number;
  claudeTimeoutMs: number;
}

export interface Processor {
  start(): void;
  stop(): void;
}

export function createProcessor(
  queueClient: QueueClient,
  neo4jDriver: Driver,
  embeddings: EmbeddingService,
  notifier: DiscordNotifier | null,
  options: ProcessorOptions,
  logger: pino.Logger,
): Processor {
  let timer: ReturnType<typeof setInterval> | null = null;
  let processing = false;

  // Reset stale items on startup (older than 5 minutes)
  resetStale(queueClient.db, 5 * 60 * 1000);
  logger.info("Reset stale queue items");

  async function processOne(): Promise<boolean> {
    const item = dequeue(queueClient.db);
    if (!item) return false;

    const log = logger.child({ queueId: item.id, url: item.url });
    log.info("Processing link");

    const session = neo4jDriver.session();
    try {
      // Step 1: Extract content (file, cloud link, or URL)
      let scraped;
      let cloudFilePath: string | null = null;
      if (item.source_type === "file" && item.file_path) {
        log.debug({ fileName: item.file_name }, "Extracting text from file");
        scraped = await extractTextFromFile(item.file_path, log);
        // Use original filename as title (extractor sees hash-based path)
        if (item.file_name) {
          const cleanName = item.file_name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
          if (cleanName) scraped.title = cleanName;
        }
      } else {
        // Check if URL is a cloud storage share link (Google Drive, Dropbox)
        const cloudInfo = getCloudDownloadUrl(item.url);
        if (cloudInfo) {
          log.debug({ source: cloudInfo.source }, "Detected cloud file link, downloading...");
          const downloaded = await downloadCloudFile(
            item.url, cloudInfo.downloadUrl, "./data/uploads", log,
          );
          if (downloaded) {
            scraped = await extractTextFromFile(downloaded.filePath, log);
            cloudFilePath = downloaded.filePath;
          } else {
            // Not a supported file type — fall back to normal scraping
            log.debug("Cloud link is not a document, scraping as URL");
            scraped = await scrapeUrl(item.url, options.scrapeTimeoutMs, log);
          }
        } else {
          log.debug("Scraping URL...");
          scraped = await scrapeUrl(item.url, options.scrapeTimeoutMs, log);
        }
      }

      // Step 2: Look up user interests for personalized categorization
      let userInterests: string[] = [];
      if (item.discord_author_id) {
        userInterests = await getUserInterests(session, item.discord_author_id);
      }

      // Step 3: Categorize with Claude
      const isDocument = item.source_type === "file" || cloudFilePath !== null;
      log.debug({ isDocument, interests: userInterests.length }, "Categorizing...");
      const categorization = await categorizeWithClaude(
        scraped.title,
        scraped.description,
        scraped.content,
        item.url,
        options.claudeTimeoutMs,
        log,
        isDocument,
        userInterests,
      );

      // Step 3: Generate embedding (include key concepts for documents)
      log.debug("Embedding...");
      const conceptsStr = categorization.key_concepts.length > 0
        ? `. Key concepts: ${categorization.key_concepts.join(", ")}`
        : "";
      const textForEmbedding = `${scraped.title}. ${scraped.description}. ${categorization.summary}${conceptsStr}`;
      const embedding = await embeddings.embed(textForEmbedding);

      // Step 4: Store in Neo4j
      log.debug("Storing in graph...");

      // Documents get more stored content (10k vs 5k for URLs)
      const maxStoredContent = isDocument ? 10000 : 5000;

      // Create link node
      await createLink(session, {
        url: item.url,
        title: scraped.title,
        description: categorization.summary,
        content: scraped.content.slice(0, maxStoredContent),
        embedding,
        domain: scraped.domain,
        savedAt: new Date().toISOString(),
        discordMessageId: item.discord_message_id,
        forgeScore: categorization.forge_score,
        contentType: categorization.content_type,
        purpose: categorization.purpose,
        integrationType: categorization.integration_type,
        quality: categorization.quality,
        keyConcepts: categorization.key_concepts,
        authors: categorization.authors,
        keyTakeaways: categorization.key_takeaways,
        difficulty: categorization.difficulty,
      });

      // Create category + relationship
      await createCategory(session, categorization.category, "");
      await categorizeLink(session, item.url, categorization.category);

      // Create tags + relationships (include key_concepts as tags for discoverability)
      const allTags = [...categorization.tags, ...categorization.key_concepts];
      const uniqueTags = [...new Set(allTags.map(t => t.toLowerCase().replace(/\s+/g, "-")))];
      for (const tagName of uniqueTags) {
        await createTag(session, tagName);
        await tagLink(session, item.url, tagName);
      }

      // Create tools + relationships
      for (const tool of categorization.tools) {
        await createTool(session, tool.name, "", tool.url || "");
        await linkMentionsTool(session, item.url, tool.name);
      }

      // Create technologies + relationships
      for (const techName of categorization.technologies) {
        await createTechnology(session, techName, "");
        await linkMentionsTech(session, item.url, techName);
      }

      // Update category link count
      await updateLinkCount(session, categorization.category);

      // Create User node + SHARED_BY relationship if author info is available
      if (item.discord_author_id) {
        await createUser(session, {
          discordId: item.discord_author_id,
          username: item.discord_author_name ?? "unknown",
          displayName: item.discord_author_name ?? "unknown",
          avatarUrl: "",
        });
        await sharedBy(session, item.url, item.discord_author_id);
      }

      // Step 5: Extract embedded URLs and enqueue them
      if (scraped.domain === "x.com") {
        const discovered = extractUrlsFromContent(scraped.content, item.url);
        for (const childUrl of discovered) {
          const alreadyInGraph = await linkExists(session, childUrl);
          if (alreadyInGraph) {
            // Link already exists — just create the relationship
            await linksTo(session, item.url, childUrl);
            log.info({ childUrl }, "Linked to existing graph node");
          } else {
            const queued = enqueueDiscovered(queueClient.db, {
              url: childUrl,
              parentUrl: item.url,
              discordChannelId: item.discord_channel_id,
            });
            if (queued) {
              log.info({ childUrl }, "Enqueued embedded link from tweet");
            }
          }
        }
      }

      // Step 6: If this link was discovered from a parent, create LINKS_TO
      if (item.parent_url) {
        const parentExists = await linkExists(session, item.parent_url);
        if (parentExists) {
          await linksTo(session, item.parent_url, item.url);
          log.info({ parentUrl: item.parent_url }, "Created LINKS_TO from parent");
        }
      }

      // Mark completed
      markCompleted(queueClient.db, item.id);
      log.info(
        { category: categorization.category, tags: categorization.tags },
        "Link processed successfully",
      );

      // Clean up temp files after successful processing
      const tempFile = item.source_type === "file" ? item.file_path : cloudFilePath;
      if (tempFile) {
        try {
          await unlink(tempFile);
          log.debug({ filePath: tempFile }, "Deleted processed temp file");
        } catch {
          log.warn({ filePath: tempFile }, "Could not delete temp file");
        }
      }

      // Notify Discord (skip for auto-discovered links, backfills, and gdrive items)
      const isSynthetic =
        item.discord_message_id.startsWith("auto:") ||
        item.discord_message_id.startsWith("backfill:") ||
        item.discord_message_id.startsWith("gdrive:") ||
        item.discord_message_id.startsWith("inbox:");
      if (notifier && !isSynthetic) {
        await notifier.notifySuccess(item.discord_channel_id, item.discord_message_id);
      }

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error({ err: errorMsg }, "Failed to process link");
      markFailed(queueClient.db, item.id, errorMsg);

      const isSyntheticErr =
        item.discord_message_id.startsWith("auto:") ||
        item.discord_message_id.startsWith("backfill:") ||
        item.discord_message_id.startsWith("gdrive:") ||
        item.discord_message_id.startsWith("inbox:");
      if (notifier && !isSyntheticErr) {
        await notifier.notifyFailure(item.discord_channel_id, item.discord_message_id);
      }

      return true; // true = there was an item (even if failed)
    } finally {
      await session.close();
    }
  }

  async function poll() {
    if (processing) return;
    processing = true;
    try {
      // Process all available items in this poll cycle
      while (await processOne()) {
        // Keep processing until queue is empty
      }
    } catch (err) {
      logger.error({ err }, "Processor poll error");
    } finally {
      processing = false;
    }
  }

  return {
    start() {
      logger.info(
        { pollIntervalMs: options.pollIntervalMs },
        "Starting processor",
      );
      timer = setInterval(() => void poll(), options.pollIntervalMs);
      // Also run immediately
      void poll();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info("Processor stopped");
    },
  };
}
