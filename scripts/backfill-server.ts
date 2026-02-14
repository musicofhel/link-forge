/**
 * Full-server backfill: scan ALL text channels in the Discord guild.
 *
 * Usage: npx tsx scripts/backfill-server.ts
 *
 * For each message containing URLs:
 *   - If link exists in Neo4j: creates User node + SHARED_BY relationship
 *   - If link is new: enqueues it into SQLite for processing (with author info)
 *
 * Idempotent — safe to run multiple times.
 */

import dotenv from "dotenv";
import Database from "better-sqlite3";
import neo4j from "neo4j-driver";
import { extractUrls } from "../src/bot/url-extractor.js";
import { enqueue, isUrlQueued } from "../src/queue/operations.js";
import { CREATE_QUEUE_TABLE, MIGRATE_ADD_PARENT_URL, MIGRATE_ADD_AUTHOR, MIGRATE_ADD_AUTHOR_NAME } from "../src/queue/schema.js";

dotenv.config();

const DISCORD_TOKEN = process.env["DISCORD_TOKEN"]!;
const GUILD_ID = process.env["DISCORD_GUILD_ID"]!;
const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";
const SQLITE_PATH = process.env["SQLITE_PATH"] ?? "./data/queue.db";

const DISCORD_API = "https://discord.com/api/v10";
const RATE_LIMIT_DELAY = 600; // ms between API calls

interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0 = text, 2 = voice, 4 = category, 5 = announcement, 15 = forum
  parent_id?: string;
}

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

async function discordFetch(path: string): Promise<Response> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
  });

  // Handle rate limiting
  if (res.status === 429) {
    const body = await res.json() as { retry_after: number };
    const wait = (body.retry_after || 1) * 1000;
    console.log(`    Rate limited, waiting ${wait}ms...`);
    await new Promise((r) => setTimeout(r, wait));
    return discordFetch(path);
  }

  return res;
}

async function listTextChannels(): Promise<DiscordChannel[]> {
  const res = await discordFetch(`/guilds/${GUILD_ID}/channels`);
  if (!res.ok) {
    throw new Error(`Failed to list channels: ${res.status} ${await res.text()}`);
  }
  const all = (await res.json()) as DiscordChannel[];
  // text (0), announcement (5), and forum threads will be separate
  return all.filter((c) => c.type === 0 || c.type === 5);
}

async function fetchMessages(channelId: string, before?: string): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (before) params.set("before", before);

  const res = await discordFetch(`/channels/${channelId}/messages?${params}`);

  if (res.status === 403) {
    // Bot doesn't have access to this channel
    return [];
  }
  if (!res.ok) {
    console.warn(`    Warning: ${res.status} fetching messages from ${channelId}`);
    return [];
  }

  return (await res.json()) as DiscordMessage[];
}

function avatarUrl(author: DiscordMessage["author"]): string {
  if (!author.avatar) return "";
  return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png`;
}

async function main() {
  console.log(`\n=== Full Server Backfill ===`);
  console.log(`Guild: ${GUILD_ID}\n`);

  // Connect Neo4j
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await driver.verifyConnectivity();
  console.log("Neo4j connected");

  // Ensure User constraint
  const setupSession = driver.session();
  await setupSession.run(
    "CREATE CONSTRAINT user_discord_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.discordId IS UNIQUE",
  );
  await setupSession.close();

  // Open SQLite queue
  const db = new Database(SQLITE_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(CREATE_QUEUE_TABLE);
  // Run migrations safely
  const columns = db.pragma("table_info(queue)") as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));
  if (!colNames.has("parent_url")) db.exec(MIGRATE_ADD_PARENT_URL);
  if (!colNames.has("discord_author_id")) db.exec(MIGRATE_ADD_AUTHOR);
  if (!colNames.has("discord_author_name")) db.exec(MIGRATE_ADD_AUTHOR_NAME);

  // Get all text channels
  const channels = await listTextChannels();
  console.log(`Found ${channels.length} text channels\n`);

  // Stats
  let totalMessages = 0;
  let totalUrlMessages = 0;
  let usersCreated = 0;
  let relationsCreated = 0;
  let newLinksEnqueued = 0;
  let skippedAlreadyQueued = 0;
  let skippedBot = 0;
  let channelsScanned = 0;
  let channelsSkipped = 0;
  const seenUsers = new Map<string, string>(); // discordId -> displayName

  for (const channel of channels) {
    console.log(`#${channel.name} (${channel.id})`);

    const messages: DiscordMessage[] = [];
    let before: string | undefined;
    let forbidden = false;

    while (true) {
      const batch = await fetchMessages(channel.id, before);
      if (batch.length === 0) {
        if (messages.length === 0 && !forbidden) {
          // Could be empty or no access
        }
        break;
      }
      if (batch.length === 0 && messages.length === 0) {
        forbidden = true;
        break;
      }
      messages.push(...batch);
      before = batch[batch.length - 1]!.id;

      if (messages.length % 500 === 0) {
        process.stdout.write(`  ${messages.length} msgs...`);
      }
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY));
    }

    if (messages.length === 0) {
      console.log("  (empty or no access)");
      channelsSkipped++;
      continue;
    }

    console.log(`  ${messages.length} messages`);
    totalMessages += messages.length;
    channelsScanned++;

    // Process messages oldest-first
    messages.reverse();

    const session = driver.session();

    for (const msg of messages) {
      if (msg.author.bot) {
        skippedBot++;
        continue;
      }

      const extracted = extractUrls(msg.content);
      if (extracted.length === 0) continue;
      totalUrlMessages++;

      for (const { url, comment } of extracted) {
        // Create/update User node if not seen yet
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
          seenUsers.set(msg.author.id, msg.author.global_name ?? msg.author.username);
          usersCreated++;
          console.log(`  + User: ${msg.author.global_name ?? msg.author.username} (${msg.author.id})`);
        }

        // Check if link exists in Neo4j
        const existsResult = await session.run(
          "MATCH (l:Link {url: $url}) RETURN count(l) > 0 AS exists",
          { url },
        );
        const exists = existsResult.records[0]?.get("exists") === true;

        if (exists) {
          // Link exists — just create the SHARED_BY relationship
          await session.run(
            `MATCH (l:Link {url: $url})
             MATCH (u:User {discordId: $discordId})
             MERGE (l)-[:SHARED_BY]->(u)`,
            { url, discordId: msg.author.id },
          );
          relationsCreated++;
        } else {
          // New link — enqueue for processing
          if (isUrlQueued(db, url)) {
            skippedAlreadyQueued++;
          } else {
            try {
              enqueue(db, {
                url,
                comment: comment || undefined,
                discordMessageId: msg.id,
                discordChannelId: channel.id,
                discordAuthorId: msg.author.id,
                discordAuthorName: msg.author.global_name ?? msg.author.username,
              });
              newLinksEnqueued++;
            } catch (err: unknown) {
              // UNIQUE constraint on discord_message_id — same message has multiple URLs,
              // or message was already queued from another run
              const msg2 = err instanceof Error ? err.message : String(err);
              if (msg2.includes("UNIQUE constraint")) {
                skippedAlreadyQueued++;
              } else {
                throw err;
              }
            }
          }
        }
      }
    }

    await session.close();
  }

  await driver.close();
  db.close();

  console.log("\n========================================");
  console.log("  Full Server Backfill Summary");
  console.log("========================================");
  console.log(`  Channels scanned:    ${channelsScanned}`);
  console.log(`  Channels skipped:    ${channelsSkipped}`);
  console.log(`  Messages scanned:    ${totalMessages}`);
  console.log(`  Messages with URLs:  ${totalUrlMessages}`);
  console.log(`  Bot messages:        ${skippedBot}`);
  console.log(`  ────────────────────────────────`);
  console.log(`  Users created:       ${usersCreated}`);
  console.log(`  SHARED_BY relations: ${relationsCreated}`);
  console.log(`  New links enqueued:  ${newLinksEnqueued}`);
  console.log(`  Already queued:      ${skippedAlreadyQueued}`);
  console.log(`  ────────────────────────────────`);
  console.log(`  All users found:`);
  for (const [id, name] of seenUsers) {
    console.log(`    ${name} (${id})`);
  }
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("Server backfill failed:", err);
  process.exit(1);
});
