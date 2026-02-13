import { Client, GatewayIntentBits } from "discord.js";
import type pino from "pino";
import type { QueueClient } from "../queue/index.js";
import { enqueue } from "../queue/index.js";
import { extractUrls } from "./url-extractor.js";
import { addReaction, REACTIONS } from "./reactions.js";

export interface BotConfig {
  token: string;
  channelId: string;
  guildId: string;
}

export function createBot(
  config: BotConfig,
  queueClient: QueueClient,
  logger: pino.Logger
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on("ready", () => {
    logger.info(`Bot logged in as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("messageCreate", async (message) => {
    // Ignore bots
    if (message.author.bot) return;

    // Ignore messages not in the configured channel
    if (message.channelId !== config.channelId) return;

    const extracted = extractUrls(message.content);
    if (extracted.length === 0) return;

    for (const { url, comment } of extracted) {
      try {
        enqueue(queueClient.db, {
          url,
          comment: comment || undefined,
          discordMessageId: message.id,
          discordChannelId: message.channelId,
        });
        await addReaction(message, REACTIONS.QUEUED);
      } catch (err: unknown) {
        // Handle UNIQUE constraint violation (duplicate discord_message_id)
        if (
          err instanceof Error &&
          err.message.includes("UNIQUE constraint failed")
        ) {
          await addReaction(message, REACTIONS.DUPLICATE);
        } else {
          logger.error({ err, url }, "Failed to enqueue URL");
          await addReaction(message, REACTIONS.FAILED);
        }
      }
    }
  });

  return {
    client,
    async login(): Promise<void> {
      await client.login(config.token);
    },
    async destroy(): Promise<void> {
      await client.destroy();
    },
  };
}
