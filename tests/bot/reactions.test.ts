import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  REACTIONS,
  addReaction,
  removeReaction,
  replaceReaction,
} from "../../src/bot/reactions.js";
import type { Message } from "discord.js";

function createMockMessage(
  overrides: Partial<{
    react: ReturnType<typeof vi.fn>;
    reactionsCache: Map<string, { users: { remove: ReturnType<typeof vi.fn> } }>;
    clientUserId: string;
  }> = {}
): Message {
  const reactFn = overrides.react ?? vi.fn().mockResolvedValue(undefined);
  const reactionsCache =
    overrides.reactionsCache ??
    new Map<string, { users: { remove: ReturnType<typeof vi.fn> } }>();
  const clientUserId = overrides.clientUserId ?? "bot-user-123";

  return {
    react: reactFn,
    reactions: {
      cache: reactionsCache,
    },
    client: {
      user: { id: clientUserId },
    },
  } as unknown as Message;
}

describe("REACTIONS", () => {
  it("should have all expected reaction constants", () => {
    expect(REACTIONS.QUEUED).toBeDefined();
    expect(REACTIONS.PROCESSING).toBeDefined();
    expect(REACTIONS.SUCCESS).toBeDefined();
    expect(REACTIONS.FAILED).toBeDefined();
    expect(REACTIONS.DUPLICATE).toBeDefined();
  });
});

describe("addReaction", () => {
  it("should call message.react with the emoji", async () => {
    const reactFn = vi.fn().mockResolvedValue(undefined);
    const message = createMockMessage({ react: reactFn });

    await addReaction(message, REACTIONS.QUEUED);

    expect(reactFn).toHaveBeenCalledWith(REACTIONS.QUEUED);
  });

  it("should not throw when reaction fails", async () => {
    const reactFn = vi.fn().mockRejectedValue(new Error("Missing permissions"));
    const message = createMockMessage({ react: reactFn });

    // Should not throw
    await expect(addReaction(message, REACTIONS.QUEUED)).resolves.toBeUndefined();
  });
});

describe("removeReaction", () => {
  it("should remove the bot's reaction", async () => {
    const removeFn = vi.fn().mockResolvedValue(undefined);
    const reactionsCache = new Map([
      [REACTIONS.QUEUED, { users: { remove: removeFn } }],
    ]);
    const message = createMockMessage({
      reactionsCache: reactionsCache as Map<
        string,
        { users: { remove: ReturnType<typeof vi.fn> } }
      >,
      clientUserId: "bot-123",
    });

    await removeReaction(message, REACTIONS.QUEUED);

    expect(removeFn).toHaveBeenCalledWith("bot-123");
  });

  it("should not throw when the reaction is not in cache", async () => {
    const message = createMockMessage({
      reactionsCache: new Map(),
    });

    await expect(
      removeReaction(message, REACTIONS.QUEUED)
    ).resolves.toBeUndefined();
  });

  it("should not throw when removal fails", async () => {
    const removeFn = vi.fn().mockRejectedValue(new Error("Unknown"));
    const reactionsCache = new Map([
      [REACTIONS.QUEUED, { users: { remove: removeFn } }],
    ]);
    const message = createMockMessage({
      reactionsCache: reactionsCache as Map<
        string,
        { users: { remove: ReturnType<typeof vi.fn> } }
      >,
    });

    await expect(
      removeReaction(message, REACTIONS.QUEUED)
    ).resolves.toBeUndefined();
  });

  it("should do nothing when client.user is null", async () => {
    const message = {
      react: vi.fn(),
      reactions: { cache: new Map() },
      client: { user: null },
    } as unknown as Message;

    await expect(
      removeReaction(message, REACTIONS.QUEUED)
    ).resolves.toBeUndefined();
  });
});

describe("replaceReaction", () => {
  let removeFn: ReturnType<typeof vi.fn>;
  let reactFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    removeFn = vi.fn().mockResolvedValue(undefined);
    reactFn = vi.fn().mockResolvedValue(undefined);
  });

  it("should remove the old emoji and add the new one", async () => {
    const reactionsCache = new Map([
      [REACTIONS.QUEUED, { users: { remove: removeFn } }],
    ]);
    const message = createMockMessage({
      react: reactFn,
      reactionsCache: reactionsCache as Map<
        string,
        { users: { remove: ReturnType<typeof vi.fn> } }
      >,
    });

    await replaceReaction(message, REACTIONS.QUEUED, REACTIONS.SUCCESS);

    expect(removeFn).toHaveBeenCalled();
    expect(reactFn).toHaveBeenCalledWith(REACTIONS.SUCCESS);
  });
});
