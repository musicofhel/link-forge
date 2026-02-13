import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads config with all required env vars", async () => {
    process.env["DISCORD_TOKEN"] = "test-token";
    process.env["DISCORD_CHANNEL_ID"] = "123456";
    process.env["DISCORD_GUILD_ID"] = "789012";
    process.env["NEO4J_URI"] = "bolt://localhost:7687";
    process.env["NEO4J_USER"] = "neo4j";
    process.env["NEO4J_PASSWORD"] = "testpass";

    const { loadConfig } = await import("../../src/config/index.js");
    const config = loadConfig();

    expect(config.discord.token).toBe("test-token");
    expect(config.discord.channelId).toBe("123456");
    expect(config.neo4j.uri).toBe("bolt://localhost:7687");
    expect(config.processor.pollIntervalMs).toBe(5000);
    expect(config.taxonomy.splitThreshold).toBe(20);
  });

  it("applies defaults for optional fields", async () => {
    process.env["DISCORD_TOKEN"] = "test-token";
    process.env["DISCORD_CHANNEL_ID"] = "123456";
    process.env["DISCORD_GUILD_ID"] = "789012";

    const { loadConfig } = await import("../../src/config/index.js");
    const config = loadConfig();

    expect(config.neo4j.uri).toBe("bolt://localhost:7687");
    expect(config.neo4j.user).toBe("neo4j");
    expect(config.sqlite.path).toBe("./data/queue.db");
    expect(config.log.level).toBe("info");
  });

  it("throws on missing required discord token", async () => {
    // Set to empty string (not delete) — dotenv won't overwrite existing vars,
    // and .min(1) rejects empty strings
    process.env["DISCORD_TOKEN"] = "";
    process.env["DISCORD_CHANNEL_ID"] = "123456";
    process.env["DISCORD_GUILD_ID"] = "789012";

    const { loadConfig } = await import("../../src/config/index.js");
    expect(() => loadConfig()).toThrow();
  });

  it("loads MCP config without discord vars", async () => {
    process.env["NEO4J_URI"] = "bolt://remote:7687";
    process.env["NEO4J_PASSWORD"] = "secret";

    const { loadMcpConfig } = await import("../../src/config/index.js");
    const config = loadMcpConfig();

    expect(config.neo4j.uri).toBe("bolt://remote:7687");
    expect(config.neo4j.password).toBe("secret");
  });

  it("coerces numeric env vars", async () => {
    process.env["DISCORD_TOKEN"] = "test-token";
    process.env["DISCORD_CHANNEL_ID"] = "123456";
    process.env["DISCORD_GUILD_ID"] = "789012";
    process.env["PROCESSOR_POLL_INTERVAL_MS"] = "10000";
    process.env["TAXONOMY_SPLIT_THRESHOLD"] = "50";

    const { loadConfig } = await import("../../src/config/index.js");
    const config = loadConfig();

    expect(config.processor.pollIntervalMs).toBe(10000);
    expect(config.taxonomy.splitThreshold).toBe(50);
  });
});
