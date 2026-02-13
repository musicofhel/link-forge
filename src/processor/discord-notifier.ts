import type { Client, TextChannel } from "discord.js";
import type pino from "pino";

export interface DiscordNotifier {
  notifySuccess(channelId: string, messageId: string): Promise<void>;
  notifyFailure(channelId: string, messageId: string): Promise<void>;
}

export function createDiscordNotifier(
  client: Client,
  logger: pino.Logger,
): DiscordNotifier {
  async function getMessageSafe(channelId: string, messageId: string) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return null;
      return await (channel as TextChannel).messages.fetch(messageId);
    } catch (err) {
      logger.warn({ channelId, messageId, err }, "Failed to fetch message for notification");
      return null;
    }
  }

  return {
    async notifySuccess(channelId, messageId) {
      const message = await getMessageSafe(channelId, messageId);
      if (!message) return;
      try {
        await message.reactions.cache.get("⏳")?.remove();
        await message.react("✅");
      } catch (err) {
        logger.warn({ messageId, err }, "Failed to update reaction to success");
      }
    },

    async notifyFailure(channelId, messageId) {
      const message = await getMessageSafe(channelId, messageId);
      if (!message) return;
      try {
        await message.reactions.cache.get("⏳")?.remove();
        await message.react("❌");
      } catch (err) {
        logger.warn({ messageId, err }, "Failed to update reaction to failure");
      }
    },
  };
}
