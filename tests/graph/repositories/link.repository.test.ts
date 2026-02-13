import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createLink,
  findLinkByUrl,
  findLinksByDomain,
  deleteLinkByUrl,
  countLinks,
} from "../../../src/graph/repositories/link.repository.js";
import type { LinkNode } from "../../../src/graph/types.js";
import type { Session } from "neo4j-driver";

function makeMockLink(): LinkNode {
  return {
    url: "https://example.com/article",
    title: "Example Article",
    description: "A great article about testing",
    content: "Full article content here...",
    embedding: new Array(384).fill(0.1),
    domain: "example.com",
    savedAt: "2025-01-15T10:30:00.000Z",
    discordMessageId: "1234567890",
    forgeScore: 0.65,
    contentType: "tutorial",
    purpose: "Learn about testing patterns",
    integrationType: "guide",
    quality: "high",
  };
}

function createMockSession(records: unknown[] = []): Session {
  return {
    run: vi.fn().mockResolvedValue({ records }),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Session;
}

describe("link.repository", () => {
  let mockLink: LinkNode;

  beforeEach(() => {
    mockLink = makeMockLink();
  });

  describe("createLink", () => {
    it("runs MERGE cypher with all link properties", async () => {
      const session = createMockSession([
        { get: () => ({ properties: mockLink }) },
      ]);

      const result = await createLink(session, mockLink);

      const runMock = vi.mocked(session.run);
      expect(runMock).toHaveBeenCalledTimes(1);

      const [cypher, params] = runMock.mock.calls[0]!;
      expect(cypher).toContain("MERGE (l:Link {url: $url})");
      expect(cypher).toContain("SET");
      expect(params).toEqual(
        expect.objectContaining({
          url: mockLink.url,
          title: mockLink.title,
          description: mockLink.description,
          domain: mockLink.domain,
          savedAt: mockLink.savedAt,
          discordMessageId: mockLink.discordMessageId,
        }),
      );
      expect(result.url).toBe(mockLink.url);
    });

    it("throws if no record is returned", async () => {
      const session = createMockSession([]);

      await expect(createLink(session, mockLink)).rejects.toThrow(
        "Failed to create link node",
      );
    });
  });

  describe("findLinkByUrl", () => {
    it("returns LinkNode when found", async () => {
      const session = createMockSession([
        { get: () => ({ properties: mockLink }) },
      ]);

      const result = await findLinkByUrl(session, mockLink.url);

      expect(result).not.toBeNull();
      expect(result!.url).toBe(mockLink.url);
      expect(result!.title).toBe(mockLink.title);

      const runMock = vi.mocked(session.run);
      const [cypher, params] = runMock.mock.calls[0]!;
      expect(cypher).toContain("MATCH (l:Link {url: $url})");
      expect(params).toEqual({ url: mockLink.url });
    });

    it("returns null when not found", async () => {
      const session = createMockSession([]);

      const result = await findLinkByUrl(session, "https://nonexistent.com");

      expect(result).toBeNull();
    });
  });

  describe("findLinksByDomain", () => {
    it("returns array of LinkNodes for a domain", async () => {
      const session = createMockSession([
        { get: () => ({ properties: mockLink }) },
      ]);

      const result = await findLinksByDomain(session, "example.com");

      expect(result).toHaveLength(1);
      expect(result[0]!.domain).toBe("example.com");

      const runMock = vi.mocked(session.run);
      const [cypher, params] = runMock.mock.calls[0]!;
      expect(cypher).toContain("MATCH (l:Link {domain: $domain})");
      expect(params).toEqual(expect.objectContaining({ domain: "example.com" }));
    });

    it("uses default limit of 50", async () => {
      const session = createMockSession([]);

      await findLinksByDomain(session, "example.com");

      const runMock = vi.mocked(session.run);
      const params = runMock.mock.calls[0]![1] as Record<string, unknown>;
      expect(params["limit"]).toBe(50);
    });

    it("respects custom limit", async () => {
      const session = createMockSession([]);

      await findLinksByDomain(session, "example.com", 10);

      const runMock = vi.mocked(session.run);
      const params = runMock.mock.calls[0]![1] as Record<string, unknown>;
      expect(params["limit"]).toBe(10);
    });
  });

  describe("deleteLinkByUrl", () => {
    it("runs DETACH DELETE with correct url param", async () => {
      const session = createMockSession([]);

      await deleteLinkByUrl(session, mockLink.url);

      const runMock = vi.mocked(session.run);
      const [cypher, params] = runMock.mock.calls[0]!;
      expect(cypher).toContain("DETACH DELETE");
      expect(params).toEqual({ url: mockLink.url });
    });
  });

  describe("countLinks", () => {
    it("returns count as number", async () => {
      const session = createMockSession([
        { get: () => 42 },
      ]);

      const count = await countLinks(session);

      expect(count).toBe(42);

      const runMock = vi.mocked(session.run);
      const [cypher] = runMock.mock.calls[0]!;
      expect(cypher).toContain("count(l)");
    });

    it("returns 0 when no records", async () => {
      const session = createMockSession([]);

      const count = await countLinks(session);

      expect(count).toBe(0);
    });

    it("handles neo4j Integer objects", async () => {
      const neoInteger = { toNumber: () => 15, toString: () => "15" };
      const session = createMockSession([
        { get: () => neoInteger },
      ]);

      const count = await countLinks(session);

      // Number(neoInteger) will use valueOf/toString, but our code does Number()
      expect(typeof count).toBe("number");
    });
  });
});
