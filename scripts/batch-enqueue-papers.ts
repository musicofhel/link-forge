#!/usr/bin/env npx tsx
/**
 * Batch-enqueue paper URLs into link-forge's processing queue.
 * Reads a JSON file of papers (from search_papers.py output) and enqueues each URL.
 *
 * Usage: npx tsx scripts/batch-enqueue-papers.ts <papers.json>
 */

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { resolve } from "path";

interface Paper {
  category: string;
  query: string;
  title: string;
  url: string;
  eprint_url: string;
  pub_url: string;
  year: string;
  abstract: string;
  num_citations: number;
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: npx tsx scripts/batch-enqueue-papers.ts <papers.json>");
  process.exit(1);
}

const papers: Paper[] = JSON.parse(readFileSync(resolve(inputFile), "utf-8"));
console.log(`Loaded ${papers.length} papers from ${inputFile}`);

// Deduplicate by URL
const seen = new Set<string>();
const unique: Paper[] = [];
for (const p of papers) {
  const normUrl = p.url.replace(/\/$/, "").toLowerCase();
  if (!seen.has(normUrl)) {
    seen.add(normUrl);
    unique.push(p);
  }
}
console.log(`${unique.length} unique URLs after dedup`);

const dbPath = resolve(import.meta.dirname, "../data/queue.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const stmt = db.prepare(`
  INSERT OR IGNORE INTO queue (url, comment, discord_message_id, discord_channel_id, discord_author_name)
  VALUES (@url, @comment, @messageId, @channelId, @authorName)
`);

let enqueued = 0;
let skipped = 0;

for (let i = 0; i < unique.length; i++) {
  const p = unique[i];
  const comment = `[${p.category}] ${p.title} (${p.year}) — ${p.abstract.slice(0, 150)}`;
  const messageId = `batch:wavecast-${String(i).padStart(4, "0")}`;

  try {
    const result = stmt.run({
      url: p.url,
      comment,
      messageId,
      channelId: "batch-wavecast-papers",
      authorName: "wavecast-search",
    });
    if (result.changes > 0) {
      enqueued++;
      console.log(`  + ${p.url}`);
      console.log(`    ${p.title} (${p.year})`);
    } else {
      skipped++;
      console.log(`  ~ SKIP (already queued): ${p.url}`);
    }
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      skipped++;
      console.log(`  ~ SKIP (duplicate ID): ${p.url}`);
    } else {
      console.error(`  ! ERROR: ${err.message} — ${p.url}`);
    }
  }
}

db.close();
console.log(`\nDone: ${enqueued} enqueued, ${skipped} skipped`);
console.log("Run 'npm run dev' in link-forge to process the queue.");
