import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

const logger = pino({ level: "silent" });

// We test scrapeUrl by mocking global fetch
describe("scraper", () => {
  const sampleHtml = readFileSync(
    join(import.meta.dirname, "../fixtures/sample-article.html"),
    "utf-8",
  );

  it("extracts article content with Readability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(sampleHtml),
      }),
    );

    const { scrapeUrl } = await import("../../src/processor/scraper.js");
    const result = await scrapeUrl("https://example.com/article", 10000, logger);

    expect(result.title).toContain("RAG Pipelines");
    expect(result.domain).toBe("example.com");
    expect(result.content).toContain("Retrieval-Augmented Generation");
    expect(result.description.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("throws on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }),
    );

    const { scrapeUrl } = await import("../../src/processor/scraper.js");
    await expect(
      scrapeUrl("https://example.com/missing", 10000, logger),
    ).rejects.toThrow("HTTP 404");

    vi.unstubAllGlobals();
  });

  it("extracts meta description as fallback", async () => {
    const minimalHtml = `<!DOCTYPE html><html><head>
      <title>Simple Page</title>
      <meta name="description" content="A simple test page">
    </head><body><p>Short content</p></body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(minimalHtml),
      }),
    );

    const { scrapeUrl } = await import("../../src/processor/scraper.js");
    const result = await scrapeUrl("https://example.com/simple", 10000, logger);

    expect(result.title).toBe("Simple Page");
    expect(result.domain).toBe("example.com");

    vi.unstubAllGlobals();
  });

  it("routes Twitter/X URLs through FxTwitter API", async () => {
    const fxResponse = {
      code: 200,
      tweet: {
        text: "Just released v2.0 of our RAG framework. Now supports Neo4j graph retrieval!",
        author: { name: "AI Dev", screen_name: "aidev" },
        created_at: "2026-01-15T10:00:00Z",
        replies: 42,
        retweets: 128,
        likes: 512,
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fxResponse),
      }),
    );

    const { scrapeUrl } = await import("../../src/processor/scraper.js");
    const result = await scrapeUrl(
      "https://x.com/aidev/status/1234567890",
      10000,
      logger,
    );

    expect(result.domain).toBe("x.com");
    expect(result.title).toContain("AI Dev");
    expect(result.title).toContain("@aidev");
    expect(result.content).toContain("RAG framework");
    expect(result.content).toContain("512 likes");

    vi.unstubAllGlobals();
  });

  it("falls back to oEmbed when FxTwitter fails", async () => {
    const oembedResponse = {
      author_name: "AI Dev",
      author_url: "https://twitter.com/aidev",
      html: '<blockquote><p>Great thread on vector databases</p></blockquote>',
    };

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // FxTwitter fails
          return Promise.resolve({ ok: false, status: 500 });
        }
        // oEmbed succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(oembedResponse),
        });
      }),
    );

    const { scrapeUrl } = await import("../../src/processor/scraper.js");
    const result = await scrapeUrl(
      "https://x.com/aidev/status/9876543210",
      10000,
      logger,
    );

    expect(result.domain).toBe("x.com");
    expect(result.content).toContain("vector databases");
    expect(result.title).toContain("AI Dev");

    vi.unstubAllGlobals();
  });
});
