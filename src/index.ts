import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./config/logger.js";
import { QueueClient } from "./queue/index.js";
import { createBot } from "./bot/index.js";
import { createFailoverClient } from "./graph/client.js";
import { setupSchema } from "./graph/schema.js";
import { createEmbeddingService } from "./embeddings/index.js";
import { createProcessor } from "./processor/index.js";
import { createDiscordNotifier } from "./processor/discord-notifier.js";
import { createTaxonomyManager } from "./taxonomy/manager.js";
import { createDashboardServer } from "./dashboard/server.js";
import { createGDriveWatcher } from "./gdrive/watcher.js";
import type { GDriveWatcher } from "./gdrive/watcher.js";
import { createInboxWatcher } from "./inbox/watcher.js";
import type { InboxWatcher } from "./inbox/watcher.js";
import { initSync, startSyncDaemon, stopSyncDaemon } from "./sync/index.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.log.level, "link-forge");

  logger.info("Starting Link Forge...");

  // 1. Connect to Neo4j (with failover support)
  logger.info("Connecting to Neo4j...");
  const graphClient = createFailoverClient();
  await graphClient.connect();
  logger.info("Neo4j connected");

  // 2. Setup Neo4j schema
  const session = graphClient.session();
  try {
    await setupSchema(session, logger);
  } finally {
    await session.close();
  }

  // 2b. Initialize sync (if enabled)
  const syncCtx = await initSync(graphClient.getLocalDriver());
  if (syncCtx) {
    startSyncDaemon(syncCtx);
    logger.info("Sync daemon started");
  }

  // 3. Load embedding model
  const embeddings = await createEmbeddingService(logger);

  // 4. Initialize SQLite queue + uploads directory
  const queueClient = new QueueClient(config.sqlite.path);
  await mkdir("./data/uploads", { recursive: true });
  logger.info("SQLite queue initialized");

  // 5. Start dashboard server (with embeddings for RAG)
  const dashboardPort = parseInt(process.env["DASHBOARD_PORT"] ?? "3848");
  const dashboard = createDashboardServer(graphClient.driver, logger, embeddings);
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
  let notifier: ReturnType<typeof createDiscordNotifier> | null = null;
  const bot = createBot(config.discord, queueClient, logger, {
    neo4jDriver: graphClient.driver,
    embeddings,
    dashboardPort,
    dashboardUrl,
  });

  if (process.env.DISCORD_BOT_ENABLED === "false") {
    logger.info("Discord bot disabled on this node (DISCORD_BOT_ENABLED=false)");
  } else {
    await bot.login();
    logger.info("Discord bot connected");
    notifier = createDiscordNotifier(bot.client, logger);
  }

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
      workers: config.processor.workers,
    },
    logger,
  );
  processor.start();

  // 8. Start local inbox watcher
  let inboxWatcher: InboxWatcher | null = null;
  if (config.inbox.enabled) {
    inboxWatcher = createInboxWatcher(
      {
        inboxDir: config.inbox.dir,
        uploadDir: "./data/uploads",
        pollIntervalMs: config.inbox.pollIntervalMs,
        authorName: config.inbox.authorName,
      },
      queueClient,
      logger,
    );
    inboxWatcher.start();
  }

  // 9. Optionally start Google Drive watcher
  let driveWatcher: GDriveWatcher | null = null;
  if (config.gdrive.enabled && config.gdrive.serviceAccountKeyPath && config.gdrive.sharedFolderId) {
    driveWatcher = createGDriveWatcher(
      {
        serviceAccountKeyPath: config.gdrive.serviceAccountKeyPath,
        sharedFolderId: config.gdrive.sharedFolderId,
        pollIntervalMs: config.gdrive.pollIntervalMs,
        uploadDir: config.gdrive.uploadDir,
      },
      queueClient,
      graphClient.driver,
      logger,
    );
    driveWatcher.start();
  }

  // 10. Start taxonomy manager
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
    inboxWatcher?.stop();
    driveWatcher?.stop();
    dashboard.stop();
    stopSyncDaemon();

    if (process.env.DISCORD_BOT_ENABLED !== "false") {
      await bot.destroy();
      logger.info("Discord bot disconnected");
    }

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
