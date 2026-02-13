import type { Message } from "discord.js";

export const REACTIONS = {
  QUEUED: "\u23F3",       // hourglass
  PROCESSING: "\u2699\uFE0F", // gear
  SUCCESS: "\u2705",      // check mark
  FAILED: "\u274C",       // cross mark
  DUPLICATE: "\u267B\uFE0F", // recycle
} as const;

export async function addReaction(
  message: Message,
  emoji: string
): Promise<void> {
  try {
    await message.react(emoji);
  } catch {
    // Silently ignore reaction failures (permissions, deleted message, etc.)
  }
}

export async function removeReaction(
  message: Message,
  emoji: string
): Promise<void> {
  try {
    const botUser = message.client.user;
    if (!botUser) return;
    await message.reactions.cache.get(emoji)?.users.remove(botUser.id);
  } catch {
    // Silently ignore removal failures
  }
}

export async function replaceReaction(
  message: Message,
  oldEmoji: string,
  newEmoji: string
): Promise<void> {
  await removeReaction(message, oldEmoji);
  await addReaction(message, newEmoji);
}
