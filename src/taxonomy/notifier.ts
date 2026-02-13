import type { Client, TextChannel } from "discord.js";
import type pino from "pino";
import type { SplitProposal } from "./splitter.js";

export async function notifySplit(
  client: Client,
  channelId: string,
  categoryName: string,
  proposal: SplitProposal,
  logger: pino.Logger,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      logger.warn({ channelId }, "Cannot send split notification: channel not text-based");
      return;
    }

    const subcatList = proposal.subcategories
      .map((s) => `  • **${s.name}** (${s.linkUrls.length} links) — ${s.description}`)
      .join("\n");

    const message = [
      `📂 **Category Split: ${categoryName}**`,
      "",
      `The category "${categoryName}" was split into ${proposal.subcategories.length} subcategories:`,
      "",
      subcatList,
      "",
      `_Reason: ${proposal.reasoning}_`,
    ].join("\n");

    await (channel as TextChannel).send(message);
    logger.info({ categoryName }, "Split notification sent to Discord");
  } catch (err) {
    logger.error({ err, categoryName }, "Failed to send split notification");
  }
}
