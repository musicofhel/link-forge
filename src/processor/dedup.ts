/**
 * Link Forge - Processing Queue Deduplication
 */

import type { Driver } from "neo4j-driver";
import { logSync } from "../sync/logger.js";

export interface DedupResult {
  shouldProcess: boolean;
  reason: "not-found" | "exists-no-content" | "exists-with-content";
  existingTitle?: string;
}

export async function shouldProcessUrl(driver: Driver, url: string): Promise<DedupResult> {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (l:Link {url: $url})
       RETURN l.title AS title, l.content IS NOT NULL AS hasContent
       LIMIT 1`,
      { url }
    );

    if (result.records.length === 0) {
      return { shouldProcess: true, reason: "not-found" };
    }

    const hasContent = result.records[0]!.get("hasContent") as boolean;
    const title = result.records[0]!.get("title") as string | null;

    if (hasContent) {
      logSync("DEBUG", "processor:dedup", `Skipping (exists with content): ${url}`);
      return { shouldProcess: false, reason: "exists-with-content", existingTitle: title || undefined };
    }

    logSync("DEBUG", "processor:dedup", `Exists without content, will re-process: ${url}`);
    return { shouldProcess: true, reason: "exists-no-content" };
  } finally {
    await session.close();
  }
}

export async function batchCheckUrls(driver: Driver, urls: string[]): Promise<Map<string, DedupResult>> {
  const results = new Map<string, DedupResult>();
  if (urls.length === 0) return results;

  const session = driver.session();
  try {
    const queryResult = await session.run(
      `UNWIND $urls AS url
       OPTIONAL MATCH (l:Link {url: url})
       RETURN url, l.title AS title, l.content IS NOT NULL AS hasContent, l IS NOT NULL AS exists`,
      { urls }
    );

    for (const record of queryResult.records) {
      const url = record.get("url") as string;
      const exists = record.get("exists") as boolean;
      const hasContent = record.get("hasContent") as boolean;
      const title = record.get("title") as string | null;

      if (!exists) { results.set(url, { shouldProcess: true, reason: "not-found" }); }
      else if (hasContent) { results.set(url, { shouldProcess: false, reason: "exists-with-content", existingTitle: title || undefined }); }
      else { results.set(url, { shouldProcess: true, reason: "exists-no-content" }); }
    }
  } finally {
    await session.close();
  }
  return results;
}
