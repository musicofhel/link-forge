/**
 * Backfill script: fetch entire Discord channel history and enqueue all URLs.
 *
 * Usage: npx tsx scripts/backfill-channel.ts
 *
 * - Paginates through the full message history using Discord REST API
 * - Extracts URLs using the same extractUrls logic as the bot
 * - Enqueues each URL with a synthetic message ID (backfill:msgId:index)
 * - Skips URLs already in the queue or already in Neo4j
 * - The running bot processor picks them up automatically
 */

import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import BetterSqlite3 from "better-sqlite3";
import { extractUrls } from "../src/bot/url-extractor.js";
import { CREATE_QUEUE_TABLE } from "../src/queue/schema.js";
import { isUrlQueued } from "../src/queue/operations.js";

dotenv.config();

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"]!;
const CHANNEL_ID = process.env["DISCORD_CHANNEL_ID"]!;
const SQLITE_PATH = process.env["SQLITE_PATH"] ?? "./data/queue.db";
const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";

const DISCORD_API = "https://discord.com/api/v10";

interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; bot?: boolean; username: string };
  timestamp: string;
}

async function fetchMessages(
  before?: string,
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (before) params.set("before", before);

  const res = await fetch(
    `${DISCORD_API}/channels/${CHANNEL_ID}/messages?${params}`,
    { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } },
  );

  if (!res.ok) {
    throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as DiscordMessage[];
}

async function main() {
  console.log(`Backfilling channel ${CHANNEL_ID}...`);

  // Connect to Neo4j to check for existing links
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await driver.verifyConnectivity();
  console.log("Neo4j connected");

  // Open SQLite queue
  const db = new BetterSqlite3(SQLITE_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(CREATE_QUEUE_TABLE);

  // Prepare Neo4j check
  const session = driver.session();

  // Fetch all messages
  const allMessages: DiscordMessage[] = [];
  let before: string | undefined;

  while (true) {
    const batch = await fetchMessages(before);
    if (batch.length === 0) break;

    allMessages.push(...batch);
    before = batch[batch.length - 1]!.id;
    console.log(`  Fetched ${allMessages.length} messages so far (oldest: ${batch[batch.length - 1]!.timestamp})`);

    // Rate limit courtesy
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nTotal messages: ${allMessages.length}`);

  // Process oldest-first
  allMessages.reverse();

  let enqueued = 0;
  let skippedQueue = 0;
  let skippedGraph = 0;
  let skippedBot = 0;
  let skippedNoUrls = 0;

  const enqueueStmt = db.prepare(
    `INSERT OR IGNORE INTO queue (url, comment, discord_message_id, discord_channel_id)
     VALUES (@url, @comment, @discordMessageId, @discordChannelId)`,
  );

  for (const msg of allMessages) {
    // Skip bot messages
    if (msg.author.bot) {
      skippedBot++;
      continue;
    }

    const extracted = extractUrls(msg.content);
    if (extracted.length === 0) {
      skippedNoUrls++;
      continue;
    }

    for (let i = 0; i < extracted.length; i++) {
      const { url, comment } = extracted[i]!;

      // Skip if already queued
      if (isUrlQueued(db, url)) {
        skippedQueue++;
        continue;
      }

      // Skip if already in Neo4j
      const neo4jResult = await session.run(
        `MATCH (l:Link {url: $url}) RETURN count(l) > 0 AS exists`,
        { url },
      );
      const exists = neo4jResult.records[0]?.get("exists") === true;
      if (exists) {
        skippedGraph++;
        continue;
      }

      // Use synthetic ID: backfill:{msgId}:{index} to avoid UNIQUE conflicts
      const syntheticId = `backfill:${msg.id}:${i}`;

      const result = enqueueStmt.run({
        url,
        comment: comment || `Backfill from ${msg.author.username} (${msg.timestamp})`,
        discordMessageId: syntheticId,
        discordChannelId: CHANNEL_ID,
      });

      if (result.changes > 0) {
        console.log(`  + ${url}`);
        enqueued++;
      }
    }
  }

  await session.close();
  await driver.close();
  db.close();

  console.log("\n--- Backfill Summary ---");
  console.log(`  Messages scanned: ${allMessages.length}`);
  console.log(`  Bot messages skipped: ${skippedBot}`);
  console.log(`  No URLs: ${skippedNoUrls}`);
  console.log(`  Already in queue: ${skippedQueue}`);
  console.log(`  Already in graph: ${skippedGraph}`);
  console.log(`  Enqueued: ${enqueued}`);
  console.log("\nThe running bot processor will pick these up automatically.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
