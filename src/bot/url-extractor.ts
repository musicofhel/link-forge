const URL_REGEX = /https?:\/\/[^\s<>)\]]+/gi;

const CDN_HOSTS = new Set([
  "i.imgur.com",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "tenor.com",
  "giphy.com",
  "pbs.twimg.com",
]);

export interface ExtractedUrl {
  url: string;
  comment: string;
}

function isCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return CDN_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function stripMarkdownLink(text: string): string {
  // Convert [text](url) to url
  return text.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, "$2");
}

export function extractUrls(text: string): ExtractedUrl[] {
  const normalized = stripMarkdownLink(text);
  const results: ExtractedUrl[] = [];
  const lines = normalized.split("\n");

  for (const line of lines) {
    const matches = line.match(URL_REGEX);
    if (!matches) continue;

    for (const url of matches) {
      if (isCdnUrl(url)) continue;

      // Comment is the text on this line that is not the URL, trimmed
      const comment = line.replace(url, "").trim();
      results.push({ url, comment });
    }
  }

  return results;
}
