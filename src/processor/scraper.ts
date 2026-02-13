import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type pino from "pino";

export interface ScrapedContent {
  title: string;
  description: string;
  content: string;
  domain: string;
}

const TWITTER_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.twitter.com",
  "mobile.x.com",
]);

function isTwitterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return TWITTER_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function extractTweetPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Matches /user/status/1234 or /i/status/1234
    const match = parsed.pathname.match(
      /\/([^/]+)\/status\/(\d+)/,
    );
    if (match) {
      return `/${match[1]}/status/${match[2]}`;
    }
    return null;
  } catch {
    return null;
  }
}

interface FxTweetArticle {
  title: string;
  preview_text: string;
  content?: {
    blocks: Array<{ text: string; type: string }>;
  };
}

interface FxTweetResponse {
  code: number;
  tweet?: {
    text: string;
    author: {
      name: string;
      screen_name: string;
    };
    created_at: string;
    replies: number;
    retweets: number;
    likes: number;
    views?: number;
    bookmarks?: number;
    media?: {
      photos?: Array<{ url: string; alt_text?: string }>;
      videos?: Array<{ url: string }>;
    };
    quote?: {
      text: string;
      author: {
        name: string;
        screen_name: string;
      };
    };
    article?: FxTweetArticle;
  };
}

interface OEmbedResponse {
  author_name: string;
  author_url: string;
  html: string;
}

async function scrapeTwitter(
  url: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<ScrapedContent> {
  const tweetPath = extractTweetPath(url);
  if (!tweetPath) {
    throw new Error(`Could not extract tweet path from: ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Strategy 1: FxTwitter API (returns structured JSON)
    logger.debug({ url }, "Trying FxTwitter API");
    try {
      const fxUrl = `https://api.fxtwitter.com${tweetPath}`;
      const fxRes = await fetch(fxUrl, {
        signal: controller.signal,
        headers: { "User-Agent": "LinkForge/1.0" },
      });

      if (fxRes.ok) {
        const data = (await fxRes.json()) as FxTweetResponse;
        if (data.tweet) {
          const tweet = data.tweet;
          const author = `${tweet.author.name} (@${tweet.author.screen_name})`;

          // Twitter Articles (long-form posts) have content in article.content.blocks
          if (tweet.article) {
            const articleText = tweet.article.content?.blocks
              ?.map((b) => b.text)
              .filter((t) => t.length > 0)
              .join("\n\n") || tweet.article.preview_text;

            const title = tweet.article.title || `${author}: Article`;

            logger.debug({ url, author: tweet.author.screen_name, type: "article" }, "FxTwitter article extracted");
            return {
              title,
              description: tweet.article.preview_text || articleText.slice(0, 300),
              content: `Article by ${author}\n\n${articleText}\n\n${tweet.likes} likes, ${tweet.retweets} retweets, ${tweet.replies} replies`,
              domain: "x.com",
            };
          }

          // Regular tweet — use text, falling back to media alt text
          let tweetText = tweet.text;
          if (!tweetText && tweet.media?.photos) {
            const altTexts = tweet.media.photos
              .map((p) => p.alt_text)
              .filter(Boolean);
            if (altTexts.length > 0) {
              tweetText = `[Image: ${altTexts.join("; ")}]`;
            }
          }

          if (!tweetText && tweet.quote?.text) {
            tweetText = `[Quoting @${tweet.quote.author.screen_name}]: ${tweet.quote.text}`;
          }

          const displayText = tweetText || "(media post)";
          const title = `${author}: "${displayText.slice(0, 80)}${displayText.length > 80 ? "..." : ""}"`;

          let content = `Tweet by ${author}\n\n${displayText}`;
          if (tweet.quote) {
            content += `\n\nQuoting ${tweet.quote.author.name} (@${tweet.quote.author.screen_name}):\n${tweet.quote.text}`;
          }
          content += `\n\n${tweet.likes} likes, ${tweet.retweets} retweets, ${tweet.replies} replies`;
          if (tweet.views) content += `, ${tweet.views} views`;

          logger.debug({ url, author: tweet.author.screen_name, type: "tweet" }, "FxTwitter succeeded");
          return {
            title,
            description: displayText.slice(0, 300),
            content,
            domain: "x.com",
          };
        }
      }
      logger.debug({ url, status: fxRes.status }, "FxTwitter returned no tweet data");
    } catch (err) {
      logger.debug({ url, err: err instanceof Error ? err.message : err }, "FxTwitter failed");
    }

    // Strategy 2: Twitter oEmbed API (public, no auth needed)
    logger.debug({ url }, "Trying Twitter oEmbed");
    try {
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
      const oeRes = await fetch(oembedUrl, {
        signal: controller.signal,
        headers: { "User-Agent": "LinkForge/1.0" },
      });

      if (oeRes.ok) {
        const data = (await oeRes.json()) as OEmbedResponse;
        // oEmbed returns HTML with the tweet text — extract it
        const dom = new JSDOM(data.html);
        const text =
          dom.window.document.body?.textContent?.trim() || "";

        if (text.length > 0) {
          const author = data.author_name;
          const title = `${author}: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;

          logger.debug({ url, author }, "oEmbed succeeded");
          return {
            title,
            description: text.slice(0, 300),
            content: `Tweet by ${author} (${data.author_url})\n\n${text}`,
            domain: "x.com",
          };
        }
      }
      logger.debug({ url, status: oeRes.status }, "oEmbed returned no data");
    } catch (err) {
      logger.debug({ url, err: err instanceof Error ? err.message : err }, "oEmbed failed");
    }

    // Strategy 3: Last resort — return what we know from the URL itself
    logger.warn({ url }, "All Twitter scraping strategies failed");
    return {
      title: `Tweet: ${url}`,
      description: "Twitter/X post — could not extract content",
      content: `Twitter/X post at ${url}. Content extraction failed — the post may be private, deleted, or behind a login wall.`,
      domain: "x.com",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function scrapeUrl(
  url: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<ScrapedContent> {
  logger.debug({ url }, "Scraping URL");

  // Route Twitter/X URLs through specialized scraper
  if (isTwitterUrl(url)) {
    return scrapeTwitter(url, timeoutMs, logger);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LinkForge/1.0; +https://github.com/link-forge)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const parsed = new URL(url);
    const domain = parsed.hostname;

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article) {
      return {
        title: article.title || extractTitleFromHtml(dom) || domain,
        description:
          article.excerpt || article.textContent.slice(0, 300).trim(),
        content: article.textContent.trim(),
        domain,
      };
    }

    // Fallback: extract what we can from raw HTML
    return {
      title: extractTitleFromHtml(dom) || domain,
      description: extractMetaDescription(dom) || "",
      content: extractBodyText(dom),
      domain,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractTitleFromHtml(dom: JSDOM): string {
  return dom.window.document.title || "";
}

function extractMetaDescription(dom: JSDOM): string {
  const meta = dom.window.document.querySelector(
    'meta[name="description"], meta[property="og:description"]',
  );
  return meta?.getAttribute("content") || "";
}

function extractBodyText(dom: JSDOM): string {
  const body = dom.window.document.body;
  if (!body) return "";
  for (const el of body.querySelectorAll("script, style, nav, footer, header")) {
    el.remove();
  }
  return (body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 10000);
}
