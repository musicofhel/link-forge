# Session Handoff — 2026-02-22

## Summary

Major session: guild-wide Discord scraping, academic DOI fallback pipeline, emoji channel gating, and committing ~2,500 lines of previously uncommitted infrastructure code.

## What Was Done

### 1. Neo4j LIMIT Float Bug Fix
- MCP SDK passes JS numbers as floats (e.g., `10` → `10.0`), Neo4j rejects floats in LIMIT clauses
- Fixed in 3 files using `neo4j.int()`: `src/mcp/tools/recent.ts`, `src/mcp/tools/browse.ts`, `src/graph/search.ts`

### 2. Guild-Wide Discord Scraping
- Changed `src/bot/index.ts` from single-channel filter (`message.channelId !== config.channelId`) to guild-wide (`!message.guild`)
- Made `channelId` optional in `src/config/index.ts`
- Ran `scripts/backfill-server.ts` to crawl all 27 channels: 17,113 messages scanned, 563 new links enqueued

### 3. Wobblychair-Only Emoji Reactions
- Bot now scrapes ALL guild channels silently but only shows emoji reactions (⏳/✅/❌) in the wobblychair channel (`1432502241876770816`)
- Two separate code paths fixed:
  - `src/bot/index.ts` `messageCreate` handler — reactions gated on channel ID
  - `src/processor/index.ts` notifier — success/failure notifications gated on channel ID
- Ran emoji cleanup script twice to remove ~804 bot reactions from non-wobblychair channels

### 4. Academic DOI Fallback (403/401 URLs)
- `src/processor/scraper.ts`: When a DOI URL returns 403/401, the scraper now tries:
  1. **Unpaywall API** — checks for open-access full-text PDFs (~21% hit rate)
  2. **Semantic Scholar API** — title, abstract, authors, citations, TLDR
- `src/extractor/index.ts`: Added `extractTextFromBuffer()` for processing downloaded PDFs in memory
- Reset 264 failed 403/401 queue items for retry

### 5. Committed Previously Uncommitted Infrastructure
- `src/graph/client.ts` — Failover graph client (local + remote Neo4j)
- `src/graph/health.ts` — Health monitor with periodic checks
- `src/sync/*` — Full sync engine (config, engine, export, import, scheduler, types, etc.)
- `src/processor/dedup.ts` — URL deduplication logic
- `src/dashboard/index.html` — Dashboard upgrades (auth, dark theme, metadata)
- `src/index.ts` — Sync daemon integration, optional Discord bot
- Various scripts (migrate-for-sync, sync-now, sync-status, initial-seed)
- Deleted stale `src/graph/client.ts.bak`

### 6. Test Fix
- `tests/graph/search.test.ts`: Fixed assertion from parallel to sequential execution order — code intentionally runs vector then keyword search sequentially to avoid concurrent Neo4j transactions

### 7. Bot Restart Documentation
- Added "CRITICAL: Restarting the Bot" section to `.claude/CLAUDE.md`
- Must use `pkill -f "tsx src/index.ts"` — `kill <pid>` leaves tsx child processes running, causing stacked instances

## Current State

- **Neo4j**: 2,070 links, 606 categories, 14,936 tags, 475 technologies, 259 tools
- **Queue**: ~789 failed items (mostly 403 academic paywalls now handled by DOI fallback, plus some DNS/timeout failures)
- **Tests**: All passing (`npm test`)
- **Typecheck**: Clean (`npm run typecheck`)
- **Bot**: Single instance running, guild-wide scraping, wobblychair-only emojis

## Gotchas Discovered

1. **Stacked bot instances**: `kill <pid>` only kills parent tsx process. Always use `pkill -f "tsx src/index.ts"` to catch all children.
2. **Two emoji code paths**: Both `messageCreate` handler AND processor notifier add reactions — must gate both.
3. **Unpaywall title bug**: OA PDF extraction returns hash-based temp filename as title. Fixed by preferring Unpaywall's metadata title.
4. **WOBBLYCHAIR_CHANNEL scope**: Declared inside try block but referenced in catch — moved to outer function scope.

## What's Left

- Category deduplication (606 categories — many near-duplicates)
- Subcategory relationships (SUBCATEGORY_OF not yet populated)
- RELATED_TO graph edges (content similarity links)
- Retry remaining ~500 non-academic failed queue items (DNS failures, timeouts)
- Google Drive poller (untested, needs GDRIVE_ENABLED=true)
- End-to-end QC on document ingestion (file attachments, cloud links)
