/**
 * Extracts follow-worthy URLs from scraped content (primarily tweets).
 * Filters out images, CDN links, social media self-links, and the parent URL itself.
 */

const URL_REGEX = /https?:\/\/[^\s<>)\],]+/gi;

const SKIP_HOSTS = new Set([
  // Social media (already captured as the parent)
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "t.co",
  // Image/media CDNs
  "pbs.twimg.com",
  "video.twimg.com",
  "abs.twimg.com",
  "i.imgur.com",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "tenor.com",
  "giphy.com",
]);

const SKIP_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".mp4",
  ".webm",
  ".mov",
]);

function shouldSkipUrl(url: string, parentUrl: string): boolean {
  if (url === parentUrl) return true;

  try {
    const parsed = new URL(url);

    if (SKIP_HOSTS.has(parsed.hostname)) return true;

    // Skip bare TLD-less hostnames (e.g., "goals.md", "MEMORY.md" matched as http://goals.md)
    // Real domains have at least one dot separating a name from a TLD
    if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".md") || parsed.hostname.endsWith(".txt")) return true;

    // Skip direct image/video files
    const pathname = parsed.pathname.toLowerCase();
    for (const ext of SKIP_EXTENSIONS) {
      if (pathname.endsWith(ext)) return true;
    }

    return false;
  } catch {
    return true; // Skip malformed URLs
  }
}

export function extractUrlsFromContent(
  content: string,
  parentUrl: string,
): string[] {
  const matches = content.match(URL_REGEX);
  if (!matches) return [];

  const seen = new Set<string>();
  const results: string[] = [];

  for (const rawUrl of matches) {
    // Strip trailing punctuation that might have been captured
    let url = rawUrl.replace(/[.,;:!?)]+$/, "");

    // Normalize http:// to https:// for well-known hosts
    if (url.startsWith("http://github.com") || url.startsWith("http://www.github.com")) {
      url = url.replace("http://", "https://");
    }

    if (shouldSkipUrl(url, parentUrl)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push(url);
  }

  return results;
}
