import { describe, it, expect } from "vitest";
import { extractUrls } from "../../src/bot/url-extractor.js";

describe("extractUrls", () => {
  it("should extract a single URL", () => {
    const result = extractUrls("https://example.com/article");
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://example.com/article");
    expect(result[0]!.comment).toBe("");
  });

  it("should extract URL with surrounding comment text", () => {
    const result = extractUrls(
      "Check this out https://example.com/cool really interesting"
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://example.com/cool");
    expect(result[0]!.comment).toBe("Check this out  really interesting");
  });

  it("should extract comment before URL", () => {
    const result = extractUrls("Great article: https://example.com/post");
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://example.com/post");
    expect(result[0]!.comment).toBe("Great article:");
  });

  it("should extract multiple URLs from one message", () => {
    const text = `https://first.com/a
https://second.com/b
https://third.com/c`;
    const result = extractUrls(text);
    expect(result).toHaveLength(3);
    expect(result[0]!.url).toBe("https://first.com/a");
    expect(result[1]!.url).toBe("https://second.com/b");
    expect(result[2]!.url).toBe("https://third.com/c");
  });

  it("should extract multiple URLs on the same line", () => {
    const result = extractUrls(
      "https://first.com and https://second.com"
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe("https://first.com");
    expect(result[1]!.url).toBe("https://second.com");
  });

  it("should filter out imgur CDN URLs", () => {
    const result = extractUrls("https://i.imgur.com/abc123.png");
    expect(result).toHaveLength(0);
  });

  it("should filter out Discord CDN URLs", () => {
    const result = extractUrls(
      "https://cdn.discordapp.com/attachments/123/456/image.png"
    );
    expect(result).toHaveLength(0);
  });

  it("should filter CDN but keep real URLs in same message", () => {
    const text = `Here's a screenshot: https://cdn.discordapp.com/attachments/123/img.png
And the actual article: https://blog.example.com/post`;
    const result = extractUrls(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://blog.example.com/post");
    expect(result[0]!.comment).toBe("And the actual article:");
  });

  it("should handle URLs with query params", () => {
    const result = extractUrls(
      "https://example.com/search?q=test&page=2"
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://example.com/search?q=test&page=2");
  });

  it("should handle URLs with fragments", () => {
    const result = extractUrls(
      "https://example.com/docs#section-3"
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://example.com/docs#section-3");
  });

  it("should return empty array for text without URLs", () => {
    const result = extractUrls("Just some text without any links");
    expect(result).toHaveLength(0);
  });

  it("should return empty array for empty string", () => {
    const result = extractUrls("");
    expect(result).toHaveLength(0);
  });

  it("should handle markdown-wrapped URLs [text](url)", () => {
    const result = extractUrls(
      "Check out [this article](https://example.com/article)"
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://example.com/article");
  });

  it("should handle http URLs (not just https)", () => {
    const result = extractUrls("http://legacy-site.com/page");
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("http://legacy-site.com/page");
  });

  it("should filter media.discordapp.net URLs", () => {
    const result = extractUrls(
      "https://media.discordapp.net/attachments/123/456/img.png"
    );
    expect(result).toHaveLength(0);
  });

  it("should filter tenor.com URLs", () => {
    const result = extractUrls("https://tenor.com/view/funny-gif-123");
    expect(result).toHaveLength(0);
  });

  it("should filter giphy.com URLs", () => {
    const result = extractUrls("https://giphy.com/gifs/abc123");
    expect(result).toHaveLength(0);
  });

  it("should filter phantom .md URLs from tweet content", () => {
    const result = extractUrls("Define your goals in a http://goals.md file");
    expect(result).toHaveLength(0);
  });

  it("should filter phantom .yaml and .json URLs", () => {
    const result = extractUrls("edit your http://config.yaml and http://package.json");
    expect(result).toHaveLength(0);
  });

  it("should keep real .md-hosting domains like github.com", () => {
    const result = extractUrls("https://github.com/user/repo/blob/main/README.md");
    expect(result).toHaveLength(1);
  });
});
