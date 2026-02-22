import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type pino from "pino";
import { validateUrlForSSRF } from "../security/url-validator.js";

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
    await validateUrlForSSRF(url);

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
      // DOI/academic URLs: try Unpaywall + Semantic Scholar before giving up
      if (response.status === 403 || response.status === 401) {
        const doi = extractDoi(url);
        if (doi) {
          const academic = await scrapeAcademicDoi(doi, url, timeoutMs, logger);
          if (academic) return academic;
        }
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const parsed = new URL(url);
    const domain = parsed.hostname;

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article) {
      const text = article.textContent ?? "";
      return {
        title: article.title || extractTitleFromHtml(dom) || domain,
        description:
          article.excerpt || text.slice(0, 300).trim(),
        content: text.trim(),
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

// --- Academic DOI fallback ---

function extractDoi(url: string): string | null {
  // Direct doi.org links
  const doiOrg = url.match(/^https?:\/\/(dx\.)?doi\.org\/(.+)$/);
  if (doiOrg) return decodeURIComponent(doiOrg[2]!);

  // Publisher URLs with /doi/ in path (Wiley, ACM, etc.)
  const pubDoi = url.match(/\/doi\/(?:abs|full|pdf|pdfdirect)?\/?(10\..+)$/);
  if (pubDoi) return decodeURIComponent(pubDoi[1]!);

  // ScienceDirect pii → not a DOI but we can try CrossRef
  // For now, skip non-DOI academic URLs
  return null;
}

interface S2Paper {
  title?: string;
  abstract?: string;
  year?: number;
  citationCount?: number;
  authors?: Array<{ name: string }>;
  fieldsOfStudy?: string[];
  tldr?: { text: string };
  openAccessPdf?: { url: string };
  externalIds?: { DOI?: string; ArXiv?: string };
}

async function scrapeAcademicDoi(
  doi: string,
  originalUrl: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<ScrapedContent | null> {
  logger.debug({ doi }, "Trying academic DOI fallback");

  // Strategy 1: Unpaywall — check for OA full-text PDF
  try {
    const upRes = await fetch(
      `https://api.unpaywall.org/v2/${doi}?email=wobblyagent@gmail.com`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (upRes.ok) {
      const data = (await upRes.json()) as Record<string, unknown>;
      const oa = data.best_oa_location as Record<string, unknown> | null;
      const pdfUrl = (oa?.url_for_pdf || oa?.url) as string | undefined;

      if (data.is_oa && pdfUrl) {
        logger.info({ doi, pdfUrl }, "Unpaywall found OA PDF");
        // Try to fetch the PDF and extract text
        try {
          const { extractTextFromBuffer } = await import("../extractor/index.js");
          const pdfRes = await fetch(pdfUrl, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: { Accept: "application/pdf,*/*" },
            redirect: "follow",
          });
          if (pdfRes.ok) {
            const contentType = pdfRes.headers.get("content-type") || "";
            if (contentType.includes("pdf")) {
              const buffer = Buffer.from(await pdfRes.arrayBuffer());
              const extracted = await extractTextFromBuffer(buffer, "paper.pdf", logger);
              if (extracted.content.length > 100) {
                return {
                  title: String(data.title || extracted.title || doi),
                  description: extracted.description || String(data.title || ""),
                  content: extracted.content,
                  domain: new URL(originalUrl).hostname,
                };
              }
            }
          }
        } catch (err) {
          logger.debug({ doi, err: (err as Error).message }, "OA PDF download/extract failed");
        }
      }
    }
  } catch (err) {
    logger.debug({ doi, err: (err as Error).message }, "Unpaywall lookup failed");
  }

  // Strategy 2: Semantic Scholar — title, abstract, authors, TLDR
  try {
    const s2Res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=title,abstract,year,citationCount,authors,fieldsOfStudy,tldr,openAccessPdf`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (s2Res.ok) {
      const paper = (await s2Res.json()) as S2Paper;
      if (paper.title && paper.abstract) {
        const authors = paper.authors?.map((a) => a.name).join(", ") || "Unknown";
        const fields = paper.fieldsOfStudy?.join(", ") || "";
        const tldr = paper.tldr?.text || "";

        const contentParts = [
          `Title: ${paper.title}`,
          `Authors: ${authors}`,
          `Year: ${paper.year || "Unknown"}`,
          `Citations: ${paper.citationCount || 0}`,
          fields ? `Fields: ${fields}` : "",
          `\nAbstract:\n${paper.abstract}`,
          tldr ? `\nTL;DR: ${tldr}` : "",
        ].filter(Boolean);

        logger.info({ doi, title: paper.title }, "Semantic Scholar metadata extracted");
        return {
          title: paper.title,
          description: paper.abstract.slice(0, 300),
          content: contentParts.join("\n"),
          domain: new URL(originalUrl).hostname,
        };
      }
    }
  } catch (err) {
    logger.debug({ doi, err: (err as Error).message }, "Semantic Scholar lookup failed");
  }

  logger.debug({ doi }, "All academic fallbacks failed");
  return null;
}
