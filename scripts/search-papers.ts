#!/usr/bin/env npx tsx
/**
 * Search free academic APIs for papers and enqueue them into link-forge.
 *
 * Usage:
 *   npx tsx scripts/search-papers.ts "transformer attention" "CBDC digital currency"
 *   npx tsx scripts/search-papers.ts --file keywords.txt
 *   npx tsx scripts/search-papers.ts --max 20 --download --source arxiv,openalex "deep RL"
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import Database from "better-sqlite3";
import { enqueue, enqueueFile, isUrlQueued } from "../src/queue/operations.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceName = "arxiv" | "semantic-scholar" | "openalex";

interface SearchResult {
  source: SourceName;
  sourceId: string;
  title: string;
  authors: string[];
  year: number;
  abstract: string;
  url: string;
  pdfUrl?: string;
  citationCount?: number;
  keywords: string;
}

interface CliArgs {
  keywords: string[];
  max: number;
  download: boolean;
  sources: SourceName[];
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let max = 10;
  let download = false;
  let sources: SourceName[] = ["arxiv", "semantic-scholar", "openalex"];
  const keywords: string[] = [];
  let fileKeywords: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--max":
        max = parseInt(args[++i], 10);
        if (isNaN(max) || max < 1) {
          console.error("--max must be a positive integer");
          process.exit(1);
        }
        break;
      case "--download":
        download = true;
        break;
      case "--file": {
        const filePath = args[++i];
        if (!filePath || !existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        fileKeywords = readFileSync(filePath, "utf-8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
        break;
      }
      case "--source":
        sources = args[++i].split(",").map((s) => s.trim()) as SourceName[];
        break;
      default:
        keywords.push(args[i]);
    }
  }

  const allKeywords = [...keywords, ...fileKeywords];
  if (allKeywords.length === 0) {
    console.error(
      "Usage: npx tsx scripts/search-papers.ts [--max N] [--download] [--file FILE] [--source arxiv,semantic-scholar,openalex] <keyword>..."
    );
    process.exit(1);
  }

  return { keywords: allKeywords, max, download, sources };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const lastCallPerSource: Record<string, number> = {};

async function rateLimit(source: string, delayMs = 3000): Promise<void> {
  const last = lastCallPerSource[source] ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < delayMs) {
    await new Promise((r) => setTimeout(r, delayMs - elapsed));
  }
  lastCallPerSource[source] = Date.now();
}

// ---------------------------------------------------------------------------
// arXiv search
// ---------------------------------------------------------------------------

async function searchArxiv(
  keyword: string,
  max: number
): Promise<SearchResult[]> {
  await rateLimit("arxiv");
  const params = new URLSearchParams({
    search_query: `all:${keyword}`,
    max_results: String(max),
    sortBy: "relevance",
  });
  const url = `http://export.arxiv.org/api/query?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  arXiv API error: ${res.status} ${res.statusText}`);
    return [];
  }

  const xml = await res.text();
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  const doc = dom.window.document;
  const entries = doc.querySelectorAll("entry");
  const results: SearchResult[] = [];

  for (const entry of entries) {
    const id = entry.querySelector("id")?.textContent?.trim() ?? "";
    const title = (entry.querySelector("title")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const summary = (entry.querySelector("summary")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const published = entry.querySelector("published")?.textContent ?? "";
    const year = published ? new Date(published).getFullYear() : 0;

    const authors: string[] = [];
    for (const a of entry.querySelectorAll("author name")) {
      const name = a.textContent?.trim();
      if (name) authors.push(name);
    }

    // arXiv ID from the full URL (e.g., http://arxiv.org/abs/2301.12345v1)
    const arxivId = id.replace(/.*\/abs\//, "").replace(/v\d+$/, "");
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}`;

    results.push({
      source: "arxiv",
      sourceId: arxivId,
      title,
      authors,
      year,
      abstract: summary,
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl,
      keywords: keyword,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Semantic Scholar search
// ---------------------------------------------------------------------------

async function searchSemanticScholar(
  keyword: string,
  max: number
): Promise<SearchResult[]> {
  await rateLimit("semantic-scholar");
  const params = new URLSearchParams({
    query: keyword,
    limit: String(Math.min(max, 100)),
    fields:
      "paperId,title,year,authors,abstract,openAccessPdf,citationCount,externalIds",
  });
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `  Semantic Scholar API error: ${res.status} ${res.statusText}`
    );
    return [];
  }

  const json = (await res.json()) as {
    data?: Array<{
      paperId: string;
      title: string;
      year: number | null;
      authors: Array<{ name: string }>;
      abstract: string | null;
      openAccessPdf: { url: string } | null;
      citationCount: number;
      externalIds?: { ArXiv?: string; DOI?: string };
    }>;
  };

  if (!json.data) return [];

  return json.data
    .filter((p) => p.title && p.abstract)
    .map((p) => {
      const arxivId = p.externalIds?.ArXiv;
      const doi = p.externalIds?.DOI;
      let paperUrl: string;
      if (arxivId) {
        paperUrl = `https://arxiv.org/abs/${arxivId}`;
      } else if (doi) {
        paperUrl = `https://doi.org/${doi}`;
      } else {
        paperUrl = `https://www.semanticscholar.org/paper/${p.paperId}`;
      }

      return {
        source: "semantic-scholar" as const,
        sourceId: p.paperId,
        title: p.title,
        authors: p.authors.map((a) => a.name),
        year: p.year ?? 0,
        abstract: p.abstract!,
        url: paperUrl,
        pdfUrl: p.openAccessPdf?.url ?? undefined,
        citationCount: p.citationCount,
        keywords: keyword,
      };
    });
}

// ---------------------------------------------------------------------------
// OpenAlex search
// ---------------------------------------------------------------------------

function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null | undefined
): string {
  if (!invertedIndex) return "";
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, w]) => w).join(" ");
}

async function searchOpenAlex(
  keyword: string,
  max: number
): Promise<SearchResult[]> {
  await rateLimit("openalex");
  const params = new URLSearchParams({
    search: keyword,
    "per-page": String(Math.min(max, 200)),
    select:
      "id,title,authorships,publication_year,abstract_inverted_index,cited_by_count,open_access,primary_location",
    mailto: "link-forge@example.com",
  });
  const url = `https://api.openalex.org/works?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  OpenAlex API error: ${res.status} ${res.statusText}`);
    return [];
  }

  const json = (await res.json()) as {
    results?: Array<{
      id: string;
      title: string;
      authorships: Array<{
        author: { display_name: string };
      }>;
      publication_year: number | null;
      abstract_inverted_index: Record<string, number[]> | null;
      cited_by_count: number;
      open_access: { oa_url: string | null } | null;
      primary_location?: {
        landing_page_url?: string | null;
        pdf_url?: string | null;
      } | null;
    }>;
  };

  if (!json.results) return [];

  return json.results
    .filter((w) => w.title)
    .map((w) => {
      const abstract = reconstructAbstract(w.abstract_inverted_index);
      const oaUrl =
        w.open_access?.oa_url ??
        w.primary_location?.landing_page_url ??
        w.id;
      const pdfUrl =
        w.primary_location?.pdf_url ?? undefined;

      return {
        source: "openalex" as const,
        sourceId: w.id.replace("https://openalex.org/", ""),
        title: w.title,
        authors: w.authorships.map((a) => a.author.display_name),
        year: w.publication_year ?? 0,
        abstract,
        url: oaUrl,
        pdfUrl,
        citationCount: w.cited_by_count,
        keywords: keyword,
      };
    });
}

// ---------------------------------------------------------------------------
// Search dispatcher
// ---------------------------------------------------------------------------

const SEARCH_FNS: Record<
  SourceName,
  (keyword: string, max: number) => Promise<SearchResult[]>
> = {
  arxiv: searchArxiv,
  "semantic-scholar": searchSemanticScholar,
  openalex: searchOpenAlex,
};

async function searchAll(
  keyword: string,
  max: number,
  sources: SourceName[]
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  for (const source of sources) {
    const fn = SEARCH_FNS[source];
    if (!fn) {
      console.error(`  Unknown source: ${source}`);
      continue;
    }
    try {
      console.log(`  Searching ${source} for "${keyword}"...`);
      const found = await fn(keyword, max);
      console.log(`    Found ${found.length} results`);
      results.push(...found);
    } catch (err: any) {
      console.error(`    ${source} failed: ${err.message}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "").toLowerCase();
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const byUrl = new Map<string, SearchResult>();
  const byTitle = new Map<string, SearchResult>();

  for (const r of results) {
    const normUrl = normalizeUrl(r.url);
    const normTitle = normalizeTitle(r.title);

    const existingByUrl = byUrl.get(normUrl);
    const existingByTitle = byTitle.get(normTitle);
    const existing = existingByUrl ?? existingByTitle;

    if (existing) {
      // Prefer results with pdfUrl and higher citation count
      const existingScore =
        (existing.pdfUrl ? 1000 : 0) + (existing.citationCount ?? 0);
      const newScore = (r.pdfUrl ? 1000 : 0) + (r.citationCount ?? 0);
      if (newScore > existingScore) {
        // Replace: remove old from maps, add new
        const oldNormUrl = normalizeUrl(existing.url);
        const oldNormTitle = normalizeTitle(existing.title);
        byUrl.delete(oldNormUrl);
        byTitle.delete(oldNormTitle);
        byUrl.set(normUrl, r);
        byTitle.set(normTitle, r);
      }
    } else {
      byUrl.set(normUrl, r);
      byTitle.set(normTitle, r);
    }
  }

  return [...byUrl.values()];
}

// ---------------------------------------------------------------------------
// PDF download
// ---------------------------------------------------------------------------

async function downloadPdf(
  pdfUrl: string,
  uploadDir: string
): Promise<{ filePath: string; hash: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(pdfUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "link-forge/1.0 (academic-paper-search)" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`    Download failed (${res.status}): ${pdfUrl}`);
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    // Some URLs redirect to HTML pages instead of actual PDFs
    if (contentType.includes("text/html")) {
      console.error(`    Not a PDF (got HTML): ${pdfUrl}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    // 50MB limit
    if (buffer.length > 50 * 1024 * 1024) {
      console.error(`    PDF too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB): ${pdfUrl}`);
      return null;
    }

    const hash = createHash("sha256").update(buffer).digest("hex");
    const filePath = resolve(uploadDir, `${hash}.pdf`);

    if (existsSync(filePath)) {
      return { filePath, hash }; // already downloaded
    }

    writeFileSync(filePath, buffer);
    return { filePath, hash };
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error(`    Download timed out: ${pdfUrl}`);
    } else {
      console.error(`    Download error: ${err.message}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  console.log(
    `\nSearching for ${args.keywords.length} keyword(s) across ${args.sources.join(", ")}`
  );
  console.log(`Max results per keyword per source: ${args.max}`);
  if (args.download) console.log("PDF download enabled\n");
  else console.log("URL-only mode (use --download to fetch PDFs)\n");

  // Search phase
  const allResults: SearchResult[] = [];
  for (const keyword of args.keywords) {
    console.log(`\n[Keyword] "${keyword}"`);
    const results = await searchAll(keyword, args.max, args.sources);
    allResults.push(...results);
  }

  const totalFound = allResults.length;
  console.log(`\nTotal results found: ${totalFound}`);

  // Dedup phase
  const unique = deduplicateResults(allResults);
  const dedupCount = totalFound - unique.length;
  console.log(
    `After dedup: ${unique.length} unique (${dedupCount} duplicates removed)`
  );

  // Check queue for already-enqueued URLs
  const dbPath = resolve(import.meta.dirname, "../data/queue.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const toEnqueue = unique.filter((r) => !isUrlQueued(db, r.url));
  const alreadyQueued = unique.length - toEnqueue.length;
  if (alreadyQueued > 0) {
    console.log(`Skipping ${alreadyQueued} papers already in queue`);
  }

  if (toEnqueue.length === 0) {
    console.log("\nNothing new to enqueue.");
    db.close();
    return;
  }

  console.log(`\nEnqueueing ${toEnqueue.length} papers...`);

  // Download + enqueue phase
  const uploadDir = resolve(import.meta.dirname, "../data/uploads");
  if (args.download) {
    mkdirSync(uploadDir, { recursive: true });
  }

  let enqueuedAsDoc = 0;
  let enqueuedAsUrl = 0;
  let downloadFailed = 0;
  let downloadSucceeded = 0;

  for (const paper of toEnqueue) {
    const comment = `[${paper.source}] ${paper.title} (${paper.year}) — ${paper.abstract.slice(0, 200)}`;
    const idHash = createHash("sha256")
      .update(paper.url)
      .digest("hex")
      .slice(0, 16);

    // Try PDF download if enabled and pdfUrl available
    if (args.download && paper.pdfUrl) {
      console.log(`  Downloading: ${paper.title.slice(0, 60)}...`);
      const result = await downloadPdf(paper.pdfUrl, uploadDir);

      if (result) {
        downloadSucceeded++;
        const enqueueResult = enqueueFile(db, {
          fileName: `${sanitizeFilename(paper.title)}.pdf`,
          filePath: result.filePath,
          fileHash: result.hash,
          discordChannelId: "paper-search",
          discordAuthorName: "paper-search",
          sourcePrefix: "paper",
        });
        if (enqueueResult !== null) {
          enqueuedAsDoc++;
          console.log(`    + Enqueued as document: ${paper.title.slice(0, 60)}`);
        } else {
          console.log(`    ~ Already queued (by hash): ${paper.title.slice(0, 60)}`);
        }
        continue;
      } else {
        downloadFailed++;
        // Fall through to URL enqueue
      }
    }

    // Enqueue as URL
    try {
      enqueue(db, {
        url: paper.url,
        comment,
        discordMessageId: `paper:${paper.source}:${idHash}`,
        discordChannelId: "paper-search",
        discordAuthorName: "paper-search",
      });
      enqueuedAsUrl++;
      console.log(`  + ${paper.url}`);
      console.log(`    ${paper.title} (${paper.year})`);
    } catch (err: any) {
      if (err.message?.includes("UNIQUE")) {
        console.log(`  ~ SKIP (duplicate): ${paper.url}`);
      } else {
        console.error(`  ! ERROR: ${err.message}`);
      }
    }
  }

  db.close();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(
    `Searched ${args.keywords.length} keyword(s) across ${args.sources.length} source(s)`
  );
  console.log(
    `Found ${totalFound} papers (${unique.length} unique after dedup, ${alreadyQueued} already in queue)`
  );
  if (args.download) {
    console.log(
      `Downloaded ${downloadSucceeded} PDFs (${downloadFailed} failed)`
    );
  }
  console.log(
    `Enqueued ${enqueuedAsDoc + enqueuedAsUrl} papers` +
      (args.download
        ? ` (${enqueuedAsDoc} as documents, ${enqueuedAsUrl} as URLs)`
        : "")
  );
  console.log("Run 'npm run dev' to process the queue.");
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
