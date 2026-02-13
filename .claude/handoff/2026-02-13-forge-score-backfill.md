# 2026-02-13 — Forge Score + Channel Backfill + Audit Fixes

## What happened
- Implemented forge_score (0.0-1.0 build-usefulness signal) + content_type, purpose, integration_type fields
- Backfilled 267 messages from Discord channel `1432502241876770816` → 208 URLs enqueued
- Full audit of 9 failed items + forge score calibration by Opus agent
- Improved categorization prompt with tweet-vs-tool disambiguation
- Re-scored all 108 existing items with improved prompt
- Bot moved from test server to friend's server (guild `1432501220530196601`)

## Graph state
- 219 Link nodes, 74 categories, 884 tags, 317 tools, 243 technologies
- 13 LINKS_TO edges (tweet → embedded URL extraction working)
- Score distribution: 62 artifacts (0.85+), 26 guides, 13 analysis, 82 pointers, 30 commentary, 6 junk
- 4 items auto-filtered below 0.10 threshold

## Queue state
- 230 completed, 22 failed (Cloudflare/dead links/phantom URLs), processing done
- Failed items triaged: 4 phantom .md URLs (bug fixed), 2 irrelevant (belts), 2 auth-gated, 1 wrong URL

## Key fixes
- Prompt: "Score the PAGE you are reading, not the thing it mentions" — tweets about tools now score 0.25-0.44
- URL extractor: filters phantom `.md/.yaml/.json` hostnames from tweet text
- Processor: auto-skips items with forge_score < 0.10
- Notification: backfill: prefix skips Discord reactions like auto: prefix

## Files changed (commit 6b2823f)
- `src/processor/claude-cli.ts` — prompt overhaul + schema
- `src/processor/index.ts` — forge_score threshold, backfill notification skip
- `src/bot/url-extractor.ts` — phantom URL guard
- `src/graph/types.ts` — LinkNode extended with 5 new fields
- `src/graph/repositories/link.repository.ts` — createLink + updateLinkMetadata
- `src/graph/search.ts` — forge_score boost (70% search + 30% forge)
- `src/mcp/tools/search.ts` — min_forge_score filter, enriched output
- `src/mcp/tools/browse.ts` — sort by forgeScore, show score in output
- `scripts/reprocess.ts` — bulk re-categorization
- `scripts/backfill-channel.ts` — Discord channel history backfill

## Known issues
- ralph-loop URL enqueued but may fail (repo might be private/removed)
- claude.ai artifact (ID 60) auth-gated — save manually if valuable
- 6 junk items still in graph (score < 0.10) from before threshold was added

## Next
- Visualization of graph data
- User nodes (Discord author → SHARED_BY relationship) — data already in backfill messages
