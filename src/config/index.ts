import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const configSchema = z.object({
  discord: z.object({
    token: z.string().min(1, "DISCORD_TOKEN is required"),
    channelId: z.string().min(1, "DISCORD_CHANNEL_ID is required"),
    guildId: z.string().min(1, "DISCORD_GUILD_ID is required"),
  }),
  neo4j: z.object({
    uri: z.string().default("bolt://localhost:7687"),
    user: z.string().default("neo4j"),
    password: z.string().default("link_forge_dev"),
  }),
  sqlite: z.object({
    path: z.string().default("./data/queue.db"),
  }),
  processor: z.object({
    pollIntervalMs: z.coerce.number().positive().default(5000),
    scrapeTimeoutMs: z.coerce.number().positive().default(15000),
    claudeTimeoutMs: z.coerce.number().positive().default(60000),
  }),
  taxonomy: z.object({
    checkIntervalMs: z.coerce.number().positive().default(3600000),
    splitThreshold: z.coerce.number().positive().default(20),
  }),
  log: z.object({
    level: z.string().default("info"),
  }),
});

export type Config = z.infer<typeof configSchema>;

function buildRawConfig(): Record<string, unknown> {
  return {
    discord: {
      token: process.env["DISCORD_TOKEN"] ?? "",
      channelId: process.env["DISCORD_CHANNEL_ID"] ?? "",
      guildId: process.env["DISCORD_GUILD_ID"] ?? "",
    },
    neo4j: {
      uri: process.env["NEO4J_URI"],
      user: process.env["NEO4J_USER"],
      password: process.env["NEO4J_PASSWORD"],
    },
    sqlite: {
      path: process.env["SQLITE_PATH"],
    },
    processor: {
      pollIntervalMs: process.env["PROCESSOR_POLL_INTERVAL_MS"],
      scrapeTimeoutMs: process.env["SCRAPE_TIMEOUT_MS"],
      claudeTimeoutMs: process.env["CLAUDE_TIMEOUT_MS"],
    },
    taxonomy: {
      checkIntervalMs: process.env["TAXONOMY_CHECK_INTERVAL_MS"],
      splitThreshold: process.env["TAXONOMY_SPLIT_THRESHOLD"],
    },
    log: {
      level: process.env["LOG_LEVEL"],
    },
  };
}

export function loadConfig(): Config {
  const raw = buildRawConfig();
  return configSchema.parse(raw);
}

export function loadMcpConfig(): Pick<Config, "neo4j" | "log"> {
  const mcpSchema = configSchema.pick({ neo4j: true, log: true });
  const raw = buildRawConfig();
  return mcpSchema.parse(raw);
}
