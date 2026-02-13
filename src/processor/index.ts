import type pino from "pino";
import type { QueueClient } from "../queue/index.js";
import type { EmbeddingService } from "../embeddings/index.js";
import type { DiscordNotifier } from "./discord-notifier.js";
import { scrapeUrl } from "./scraper.js";
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
} from "../graph/relationships.js";
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
      // Step 1: Scrape
      log.debug("Scraping...");
      const scraped = await scrapeUrl(item.url, options.scrapeTimeoutMs, log);

      // Step 2: Categorize with Claude
      log.debug("Categorizing...");
      const categorization = await categorizeWithClaude(
        scraped.title,
        scraped.description,
        scraped.content,
        item.url,
        options.claudeTimeoutMs,
        log,
      );

      // Step 3: Check minimum forge_score threshold
      if (categorization.forge_score < 0.10) {
        log.warn(
          { forgeScore: categorization.forge_score, title: scraped.title },
          "Skipping low-relevance link (forge_score < 0.10)",
        );
        markCompleted(queueClient.db, item.id);
        return true;
      }

      // Step 4: Generate embedding
      log.debug("Embedding...");
      const textForEmbedding = `${scraped.title}. ${scraped.description}. ${categorization.summary}`;
      const embedding = await embeddings.embed(textForEmbedding);

      // Step 5: Store in Neo4j
      log.debug("Storing in graph...");

      // Create link node
      await createLink(session, {
        url: item.url,
        title: scraped.title,
        description: categorization.summary,
        content: scraped.content.slice(0, 5000),
        embedding,
        domain: scraped.domain,
        savedAt: new Date().toISOString(),
        discordMessageId: item.discord_message_id,
        forgeScore: categorization.forge_score,
        contentType: categorization.content_type,
        purpose: categorization.purpose,
        integrationType: categorization.integration_type,
        quality: categorization.quality,
      });

      // Create category + relationship
      await createCategory(session, categorization.category, "");
      await categorizeLink(session, item.url, categorization.category);

      // Create tags + relationships
      for (const tagName of categorization.tags) {
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

      // Notify Discord (skip for auto-discovered links with synthetic IDs)
      const isAutoDiscovered = item.discord_message_id.startsWith("auto:") || item.discord_message_id.startsWith("backfill:");
      if (notifier && !isAutoDiscovered) {
        await notifier.notifySuccess(item.discord_channel_id, item.discord_message_id);
      }

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error({ err: errorMsg }, "Failed to process link");
      markFailed(queueClient.db, item.id, errorMsg);

      const isAutoDiscovered = item.discord_message_id.startsWith("auto:") || item.discord_message_id.startsWith("backfill:");
      if (notifier && !isAutoDiscovered) {
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
