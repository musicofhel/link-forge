/**
 * Parallel queue drainer — runs N concurrent workers to speed up processing.
 *
 * Usage: npx tsx scripts/parallel-drain.ts [concurrency]
 *   Default concurrency: 3
 *
 * Each worker dequeues one item at a time, processes it (scrape + categorize + embed),
 * and moves to the next. SQLite WAL mode handles concurrent access.
 */

import dotenv from "dotenv";
import Database from "better-sqlite3";
import neo4j from "neo4j-driver";
import pino from "pino";
import { createEmbeddingService } from "../src/embeddings/index.js";
import { dequeue, markCompleted, markFailed, enqueueDiscovered } from "../src/queue/operations.js";
import { scrapeUrl } from "../src/processor/scraper.js";
import { categorizeWithClaude } from "../src/processor/claude-cli.js";
import { createLink, linkExists } from "../src/graph/repositories/link.repository.js";
import { createCategory, updateLinkCount } from "../src/graph/repositories/category.repository.js";
import { createTag } from "../src/graph/repositories/tag.repository.js";
import { createTool } from "../src/graph/repositories/tool.repository.js";
import { createTechnology } from "../src/graph/repositories/technology.repository.js";
import { categorizeLink, tagLink, linkMentionsTool, linkMentionsTech, linksTo, sharedBy } from "../src/graph/relationships.js";
import { createUser } from "../src/graph/repositories/user.repository.js";
import { extractUrlsFromContent } from "../src/processor/link-extractor.js";

dotenv.config();

const CONCURRENCY = parseInt(process.argv[2] || "3", 10);
const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";
const SQLITE_PATH = process.env["SQLITE_PATH"] ?? "./data/queue.db";
const SCRAPE_TIMEOUT = 15000;
const CLAUDE_TIMEOUT = 60000;

async function main() {
  const logger = pino({ level: "info" });
  logger.info({ concurrency: CONCURRENCY }, "Starting parallel drain");

  // Shared resources
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await driver.verifyConnectivity();

  const embeddings = await createEmbeddingService(logger);

  // Each worker gets its own SQLite connection (WAL supports this)
  const dbs = Array.from({ length: CONCURRENCY }, () => {
    const db = new Database(SQLITE_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    return db;
  });

  let totalProcessed = 0;
  let totalFailed = 0;
  let running = true;

  async function worker(id: number) {
    const db = dbs[id]!;
    const wlog = logger.child({ worker: id });

    while (running) {
      const item = dequeue(db);
      if (!item) {
        // No more items — this worker is done
        wlog.info("Queue empty, worker exiting");
        break;
      }

      const session = driver.session();
      try {
        // Scrape
        const scraped = await scrapeUrl(item.url, SCRAPE_TIMEOUT, wlog);

        // Categorize
        const cat = await categorizeWithClaude(
          scraped.title, scraped.description, scraped.content,
          item.url, CLAUDE_TIMEOUT, wlog,
        );

        // Skip junk
        if (cat.forge_score < 0.10) {
          markCompleted(db, item.id);
          totalProcessed++;
          continue;
        }

        // Embed
        const text = `${scraped.title}. ${scraped.description}. ${cat.summary}`;
        const embedding = await embeddings.embed(text);

        // Store in Neo4j
        await createLink(session, {
          url: item.url, title: scraped.title, description: cat.summary,
          content: scraped.content.slice(0, 5000), embedding, domain: scraped.domain,
          savedAt: new Date().toISOString(), discordMessageId: item.discord_message_id,
          forgeScore: cat.forge_score, contentType: cat.content_type,
          purpose: cat.purpose, integrationType: cat.integration_type, quality: cat.quality,
        });

        await createCategory(session, cat.category, "");
        await categorizeLink(session, item.url, cat.category);

        for (const t of cat.tags) {
          await createTag(session, t);
          await tagLink(session, item.url, t);
        }
        for (const tool of cat.tools) {
          await createTool(session, tool.name, "", tool.url || "");
          await linkMentionsTool(session, item.url, tool.name);
        }
        for (const t of cat.technologies) {
          await createTechnology(session, t, "");
          await linkMentionsTech(session, item.url, t);
        }

        await updateLinkCount(session, cat.category);

        if (item.discord_author_id) {
          await createUser(session, {
            discordId: item.discord_author_id,
            username: item.discord_author_name ?? "unknown",
            displayName: item.discord_author_name ?? "unknown",
            avatarUrl: "",
          });
          await sharedBy(session, item.url, item.discord_author_id);
        }

        if (scraped.domain === "x.com") {
          const discovered = extractUrlsFromContent(scraped.content, item.url);
          for (const childUrl of discovered) {
            const exists = await linkExists(session, childUrl);
            if (exists) {
              await linksTo(session, item.url, childUrl);
            } else {
              enqueueDiscovered(db, { url: childUrl, parentUrl: item.url, discordChannelId: item.discord_channel_id });
            }
          }
        }

        if (item.parent_url) {
          const parentExists = await linkExists(session, item.parent_url);
          if (parentExists) await linksTo(session, item.parent_url, item.url);
        }

        markCompleted(db, item.id);
        totalProcessed++;

        if (totalProcessed % 10 === 0) {
          const pending = (db.prepare("SELECT count(*) as c FROM queue WHERE status='pending'").get() as { c: number }).c;
          logger.info({ processed: totalProcessed, failed: totalFailed, pending }, "Progress");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        wlog.error({ url: item.url, err: msg }, "Failed");
        markFailed(db, item.id, msg);
        totalFailed++;
      } finally {
        await session.close();
      }
    }
  }

  // Launch workers
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
  await Promise.all(workers);

  // Cleanup
  for (const db of dbs) db.close();
  await driver.close();

  logger.info({ totalProcessed, totalFailed }, "Parallel drain complete");
}

main().catch((err) => {
  console.error("Parallel drain failed:", err);
  process.exit(1);
});
