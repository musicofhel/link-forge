import { loadConfig } from "./config/index.js";
import { createLogger } from "./config/logger.js";
import { QueueClient } from "./queue/index.js";
import { createBot } from "./bot/index.js";
import { createGraphClient } from "./graph/client.js";
import { setupSchema } from "./graph/schema.js";
import { createEmbeddingService } from "./embeddings/index.js";
import { createProcessor } from "./processor/index.js";
import { createDiscordNotifier } from "./processor/discord-notifier.js";
import { createTaxonomyManager } from "./taxonomy/manager.js";
import { createDashboardServer } from "./dashboard/server.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.log.level, "link-forge");

  logger.info("Starting Link Forge...");

  // 1. Connect to Neo4j
  logger.info("Connecting to Neo4j...");
  const graphClient = await createGraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    logger,
  );

  // 2. Setup Neo4j schema
  const session = graphClient.session();
  try {
    await setupSchema(session, logger);
  } finally {
    await session.close();
  }

  // 3. Load embedding model
  const embeddings = await createEmbeddingService(logger);

  // 4. Initialize SQLite queue
  const queueClient = new QueueClient(config.sqlite.path);
  logger.info("SQLite queue initialized");

  // 5. Start dashboard server
  const dashboardPort = parseInt(process.env["DASHBOARD_PORT"] ?? "3848");
  const dashboard = createDashboardServer(graphClient.driver, logger);
  dashboard.start(dashboardPort);

  // 6. Detect ngrok public URL if running
  let dashboardUrl: string | undefined = process.env["DASHBOARD_URL"];
  if (!dashboardUrl) {
    try {
      const ngrokRes = await fetch("http://localhost:4040/api/tunnels");
      const ngrokData = await ngrokRes.json() as { tunnels: Array<{ public_url: string }> };
      if (ngrokData.tunnels[0]) {
        dashboardUrl = ngrokData.tunnels[0].public_url;
        logger.info({ dashboardUrl }, "Detected ngrok tunnel");
      }
    } catch {
      // ngrok not running — use localhost
    }
  }

  // 7. Start Discord bot (with slash command deps)
  const bot = createBot(config.discord, queueClient, logger, {
    neo4jDriver: graphClient.driver,
    dashboardPort,
    dashboardUrl,
  });
  await bot.login();
  logger.info("Discord bot connected");

  // 6. Create notifier
  const notifier = createDiscordNotifier(bot.client, logger);

  // 7. Start processor
  const processor = createProcessor(
    queueClient,
    graphClient.driver,
    embeddings,
    notifier,
    {
      pollIntervalMs: config.processor.pollIntervalMs,
      scrapeTimeoutMs: config.processor.scrapeTimeoutMs,
      claudeTimeoutMs: config.processor.claudeTimeoutMs,
    },
    logger,
  );
  processor.start();

  // 8. Start taxonomy manager
  const taxonomy = createTaxonomyManager(
    graphClient.driver,
    bot.client,
    config.discord.channelId,
    config.taxonomy.splitThreshold,
    config.taxonomy.checkIntervalMs,
    config.processor.claudeTimeoutMs,
    logger,
  );
  taxonomy.start();

  logger.info("Link Forge is running!");

  // Graceful shutdown
  async function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down...");

    processor.stop();
    taxonomy.stop();
    dashboard.stop();

    await bot.destroy();
    logger.info("Discord bot disconnected");

    queueClient.close();
    logger.info("SQLite closed");

    await graphClient.close();
    logger.info("Neo4j disconnected");

    logger.info("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
