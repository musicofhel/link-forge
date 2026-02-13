/**
 * Backfill User nodes: re-fetch Discord channel history and attach authors to existing links.
 *
 * Usage: npx tsx scripts/backfill-users.ts
 *
 * - Paginates through the full message history using Discord REST API
 * - For each message with URLs, creates a User node and SHARED_BY relationship
 * - Skips links that don't exist in Neo4j
 * - Idempotent — safe to run multiple times (MERGE on User + MERGE on SHARED_BY)
 */

import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import { extractUrls } from "../src/bot/url-extractor.js";

dotenv.config();

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"]!;
const CHANNEL_ID = process.env["DISCORD_CHANNEL_ID"]!;
const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";

const DISCORD_API = "https://discord.com/api/v10";

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    bot?: boolean;
    username: string;
    global_name?: string;
    avatar?: string;
  };
  timestamp: string;
}

async function fetchMessages(before?: string): Promise<DiscordMessage[]> {
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

function avatarUrl(author: DiscordMessage["author"]): string {
  if (!author.avatar) return "";
  return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png`;
}

async function main() {
  console.log(`Backfilling users from channel ${CHANNEL_ID}...`);

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await driver.verifyConnectivity();
  console.log("Neo4j connected");

  // Ensure User constraint exists
  const setupSession = driver.session();
  await setupSession.run(
    "CREATE CONSTRAINT user_discord_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.discordId IS UNIQUE",
  );
  await setupSession.close();

  const session = driver.session();

  // Fetch all messages
  const allMessages: DiscordMessage[] = [];
  let before: string | undefined;

  while (true) {
    const batch = await fetchMessages(before);
    if (batch.length === 0) break;
    allMessages.push(...batch);
    before = batch[batch.length - 1]!.id;
    console.log(`  Fetched ${allMessages.length} messages so far`);
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nTotal messages: ${allMessages.length}`);
  allMessages.reverse(); // oldest first

  let usersCreated = 0;
  let relationsCreated = 0;
  let skippedNotInGraph = 0;
  let skippedBot = 0;
  const seenUsers = new Set<string>();

  for (const msg of allMessages) {
    if (msg.author.bot) {
      skippedBot++;
      continue;
    }

    const extracted = extractUrls(msg.content);
    if (extracted.length === 0) continue;

    for (const { url } of extracted) {
      // Check if link exists in graph
      const existsResult = await session.run(
        "MATCH (l:Link {url: $url}) RETURN count(l) > 0 AS exists",
        { url },
      );
      const exists = existsResult.records[0]?.get("exists") === true;
      if (!exists) {
        skippedNotInGraph++;
        continue;
      }

      // Create/update User node
      if (!seenUsers.has(msg.author.id)) {
        await session.run(
          `MERGE (u:User {discordId: $discordId})
           SET u.username = $username,
               u.displayName = $displayName,
               u.avatarUrl = $avatarUrl`,
          {
            discordId: msg.author.id,
            username: msg.author.username,
            displayName: msg.author.global_name ?? msg.author.username,
            avatarUrl: avatarUrl(msg.author),
          },
        );
        seenUsers.add(msg.author.id);
        usersCreated++;
        console.log(`  + User: ${msg.author.global_name ?? msg.author.username} (${msg.author.id})`);
      }

      // Create SHARED_BY relationship
      await session.run(
        `MATCH (l:Link {url: $url})
         MATCH (u:User {discordId: $discordId})
         MERGE (l)-[:SHARED_BY]->(u)`,
        { url, discordId: msg.author.id },
      );
      relationsCreated++;
    }
  }

  await session.close();
  await driver.close();

  console.log("\n--- User Backfill Summary ---");
  console.log(`  Messages scanned: ${allMessages.length}`);
  console.log(`  Bot messages skipped: ${skippedBot}`);
  console.log(`  Users created: ${usersCreated}`);
  console.log(`  SHARED_BY relations: ${relationsCreated}`);
  console.log(`  Links not in graph (skipped): ${skippedNotInGraph}`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
