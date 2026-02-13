import { describe, it, expect, vi } from "vitest";
import type { Driver, Session } from "neo4j-driver";
import type { EmbeddingService } from "../../src/embeddings/index.js";

// Mock factories
function createMockSession(records: Array<Record<string, unknown>> = []): Session {
  return {
    run: vi.fn().mockResolvedValue({
      records: records.map((rec) => ({
        get: (key: string) => rec[key],
        keys: Object.keys(rec),
      })),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Session;
}

function createMockDriver(session?: Session): Driver {
  return {
    session: vi.fn().mockReturnValue(session ?? createMockSession()),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Driver;
}

function createMockEmbeddings(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0)),
    embedBatch: vi.fn().mockResolvedValue([]),
    dimension: 384,
  };
}

describe("MCP tools", () => {
  describe("forge_recent", () => {
    it("returns formatted recent links", async () => {
      const { handleForgeRecent } = await import(
        "../../src/mcp/tools/recent.js"
      );

      const mockRecords = [
        {
          l: {
            properties: {
              title: "Test Link",
              url: "https://example.com",
              description: "A test link",
              savedAt: "2026-01-01T00:00:00Z",
            },
          },
          category: "Testing",
          tags: ["test", "example"],
        },
      ];

      const session = createMockSession(mockRecords);
      const driver = createMockDriver(session);

      const result = await handleForgeRecent({ limit: 5 }, driver);
      expect(result).toContain("Test Link");
      expect(result).toContain("https://example.com");
      expect(result).toContain("Testing");
    });

    it("returns empty message when no links", async () => {
      const { handleForgeRecent } = await import(
        "../../src/mcp/tools/recent.js"
      );

      const driver = createMockDriver(createMockSession([]));
      const result = await handleForgeRecent({}, driver);
      expect(result).toContain("No links saved yet");
    });
  });

  describe("forge_search", () => {
    it("returns formatted search results", async () => {
      const { handleForgeSearch } = await import(
        "../../src/mcp/tools/search.js"
      );

      // Create a session that returns data for both vector and keyword queries
      const linkProps = {
        url: "https://example.com/rag",
        title: "RAG Tutorial",
        description: "Learn about RAG",
        domain: "example.com",
        savedAt: "2026-01-01",
        content: "",
        embedding: [],
        discordMessageId: "123",
        forgeScore: 0.72,
        contentType: "tutorial",
        purpose: "Build RAG pipelines",
        integrationType: "guide",
        quality: "high",
      };

      const session = {
        run: vi.fn().mockImplementation((cypher: string) => {
          if (cypher.includes("db.index.vector")) {
            return Promise.resolve({
              records: [
                {
                  get: (key: string) => {
                    if (key === "node") return { properties: linkProps };
                    if (key === "score") return 0.95;
                    return null;
                  },
                },
              ],
            });
          }
          // keyword search returns empty
          return Promise.resolve({ records: [] });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Session;

      const driver = createMockDriver(session);
      const embeddings = createMockEmbeddings();

      const result = await handleForgeSearch(
        { query: "RAG pipeline" },
        driver,
        embeddings,
      );
      expect(result).toContain("RAG Tutorial");
      expect(result).toContain("Found");
    });
  });

  describe("forge_find_tools", () => {
    it("returns tools for a technology", async () => {
      const { handleForgeFindTools } = await import(
        "../../src/mcp/tools/browse.js"
      );

      // The handler calls findToolsByTechnology which runs a Cypher query
      // Mock the session to return tool nodes when USED_WITH traversal is queried
      const session = {
        run: vi.fn().mockImplementation((cypher: string) => {
          if (cypher.includes("USED_WITH")) {
            return Promise.resolve({
              records: [
                {
                  get: (_key: string) => ({
                    properties: {
                      name: "LangChain",
                      description: "LLM framework",
                      url: "https://langchain.com",
                    },
                  }),
                },
              ],
            });
          }
          return Promise.resolve({ records: [] });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Session;

      const driver = createMockDriver(session);
      const result = await handleForgeFindTools({ technology: "Python" }, driver);
      expect(result).toContain("LangChain");
    });
  });
});
