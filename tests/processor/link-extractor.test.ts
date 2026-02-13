import { describe, it, expect } from "vitest";
import { extractUrlsFromContent } from "../../src/processor/link-extractor.js";

describe("link-extractor", () => {
  const parentUrl = "https://x.com/someone/status/123";

  it("extracts URLs from tweet content", () => {
    const content = `Tweet by Letta (@Letta_AI)

Introducing Context Repositories: git-tracked files for storing agent context.

https://www.letta.com/blog/context-repositories

130 likes, 13 retweets`;

    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual(["https://www.letta.com/blog/context-repositories"]);
  });

  it("extracts multiple URLs", () => {
    const content = `Check out https://github.com/user/repo and also https://docs.example.com/guide`;

    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toHaveLength(2);
    expect(urls).toContain("https://github.com/user/repo");
    expect(urls).toContain("https://docs.example.com/guide");
  });

  it("skips the parent URL itself", () => {
    const content = `See https://x.com/someone/status/123 for the original`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual([]);
  });

  it("skips twitter/x.com links", () => {
    const content = `Quoting https://twitter.com/other/status/456 and also https://x.com/another/status/789`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual([]);
  });

  it("skips t.co shortened links", () => {
    const content = `Link: https://t.co/abc123`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual([]);
  });

  it("skips image CDN URLs", () => {
    const content = `Image: https://pbs.twimg.com/media/abc.jpg and https://i.imgur.com/xyz.png`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual([]);
  });

  it("skips direct image file URLs", () => {
    const content = `Photo at https://example.com/photo.jpg and https://example.com/video.mp4`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual([]);
  });

  it("deduplicates URLs", () => {
    const content = `https://example.com/tool mentioned twice: https://example.com/tool`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual(["https://example.com/tool"]);
  });

  it("strips trailing punctuation", () => {
    const content = `Check this out: https://example.com/tool.`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual(["https://example.com/tool"]);
  });

  it("skips bare .md filenames that match as URLs", () => {
    const content = `Check out goals.md and MEMORY.md and http://HEARTBEAT.md and http://skills.md for details`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual([]);
  });

  it("returns empty array for content with no URLs", () => {
    const content = `Just a tweet with no links at all`;
    const urls = extractUrlsFromContent(content, parentUrl);
    expect(urls).toEqual([]);
  });
});
