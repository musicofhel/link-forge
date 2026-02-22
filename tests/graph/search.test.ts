import { describe, it, expect, vi } from "vitest";
import { hybridSearch } from "../../src/graph/search.js";
import type { Session } from "neo4j-driver";

function makeMockLinkProperties(url: string, title: string) {
  return {
    url,
    title,
    description: `Description for ${title}`,
    content: "Some content",
    embedding: [],
    domain: new URL(url).hostname,
    savedAt: "2025-01-15T10:00:00.000Z",
    discordMessageId: "msg-" + url,
    forgeScore: 0.5,
    contentType: "reference",
    purpose: "",
    integrationType: "reference",
    quality: "medium",
  };
}

describe("hybridSearch", () => {
  it("merges vector and keyword results, deduplicating by URL", async () => {
    const linkA = makeMockLinkProperties("https://a.com", "Link A");
    const linkB = makeMockLinkProperties("https://b.com", "Link B");
    const linkC = makeMockLinkProperties("https://c.com", "Link C");

    // linkA appears in both vector and keyword results
    const vectorRecords = [
      {
        get: (key: string) => {
          if (key === "node") return { properties: linkA };
          if (key === "score") return 0.9;
          return null;
        },
      },
      {
        get: (key: string) => {
          if (key === "node") return { properties: linkB };
          if (key === "score") return 0.7;
          return null;
        },
      },
    ];

    const keywordRecords = [
      {
        get: (key: string) => {
          if (key === "l") return { properties: linkA };
          if (key === "categoryName") return "Web Dev";
          if (key === "tags") return ["typescript"];
          return null;
        },
      },
      {
        get: (key: string) => {
          if (key === "l") return { properties: linkC };
          if (key === "categoryName") return null;
          if (key === "tags") return [];
          return null;
        },
      },
    ];

    let callCount = 0;
    const session = {
      run: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ records: vectorRecords });
        }
        return Promise.resolve({ records: keywordRecords });
      }),
    } as unknown as Session;

    const embedding = new Array(384).fill(0.1);
    const results = await hybridSearch(session, "test query", embedding, 10);

    // Should have 3 unique results (A, B, C)
    expect(results).toHaveLength(3);

    // All URLs should be unique
    const urls = results.map((r) => r.link.url);
    expect(new Set(urls).size).toBe(3);

    // Link A: combined search score = (0.9 + 1.0) / 2 = 0.95
    // After forge boost: 0.95 * 0.7 + 0.5 * 0.3 = 0.815
    const linkAResult = results.find((r) => r.link.url === "https://a.com");
    expect(linkAResult).toBeDefined();
    expect(linkAResult!.score).toBeCloseTo(0.815, 2);

    // Link A should have category from keyword search
    expect(linkAResult!.categoryName).toBe("Web Dev");
    expect(linkAResult!.tags).toContain("typescript");
  });

  it("returns results sorted by score descending", async () => {
    const linkHigh = makeMockLinkProperties("https://high.com", "High Score");
    const linkLow = makeMockLinkProperties("https://low.com", "Low Score");

    const vectorRecords = [
      {
        get: (key: string) => {
          if (key === "node") return { properties: linkHigh };
          if (key === "score") return 0.95;
          return null;
        },
      },
      {
        get: (key: string) => {
          if (key === "node") return { properties: linkLow };
          if (key === "score") return 0.3;
          return null;
        },
      },
    ];

    let callCount = 0;
    const session = {
      run: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ records: vectorRecords });
        }
        return Promise.resolve({ records: [] });
      }),
    } as unknown as Session;

    const results = await hybridSearch(session, "test", new Array(384).fill(0), 10);

    expect(results).toHaveLength(2);
    expect(results[0]!.link.url).toBe("https://high.com");
    expect(results[1]!.link.url).toBe("https://low.com");
  });

  it("respects the limit parameter", async () => {
    const links = Array.from({ length: 5 }, (_, i) =>
      makeMockLinkProperties(`https://link${i}.com`, `Link ${i}`),
    );

    const vectorRecords = links.map((link, i) => ({
      get: (key: string) => {
        if (key === "node") return { properties: link };
        if (key === "score") return 1 - i * 0.1;
        return null;
      },
    }));

    let callCount = 0;
    const session = {
      run: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ records: vectorRecords });
        }
        return Promise.resolve({ records: [] });
      }),
    } as unknown as Session;

    const results = await hybridSearch(session, "test", new Array(384).fill(0), 3);

    expect(results).toHaveLength(3);
  });

  it("handles empty results from both searches", async () => {
    const session = {
      run: vi.fn().mockResolvedValue({ records: [] }),
    } as unknown as Session;

    const results = await hybridSearch(session, "nonexistent", new Array(384).fill(0));

    expect(results).toHaveLength(0);
  });

  it("runs vector and keyword searches sequentially on the same session", async () => {
    const callOrder: string[] = [];

    const session = {
      run: vi.fn().mockImplementation((cypher: string) => {
        if (cypher.includes("db.index.vector")) {
          callOrder.push("vector-start");
          return new Promise((resolve) => {
            setTimeout(() => {
              callOrder.push("vector-end");
              resolve({ records: [] });
            }, 10);
          });
        }
        callOrder.push("keyword-start");
        return new Promise((resolve) => {
          setTimeout(() => {
            callOrder.push("keyword-end");
            resolve({ records: [] });
          }, 10);
        });
      }),
    } as unknown as Session;

    await hybridSearch(session, "test", new Array(384).fill(0));

    // Sequential: vector completes before keyword starts (avoids concurrent transactions)
    expect(callOrder).toEqual(["vector-start", "vector-end", "keyword-start", "keyword-end"]);
  });

  it("preserves keyword matchType for keyword-only results", async () => {
    const link = makeMockLinkProperties("https://keyword-only.com", "Keyword");

    const keywordRecords = [
      {
        get: (key: string) => {
          if (key === "l") return { properties: link };
          if (key === "categoryName") return "Tools";
          if (key === "tags") return ["cli"];
          return null;
        },
      },
    ];

    let callCount = 0;
    const session = {
      run: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ records: [] });
        }
        return Promise.resolve({ records: keywordRecords });
      }),
    } as unknown as Session;

    const results = await hybridSearch(session, "keyword", new Array(384).fill(0));

    expect(results).toHaveLength(1);
    expect(results[0]!.matchType).toBe("keyword");
    expect(results[0]!.categoryName).toBe("Tools");
  });
});
