# Session Handoff — 2026-02-13 — Overlap Analysis + Dashboard Redesign + Full Server Scan

## Completed This Session
- User overlap/intersection analysis API (`/api/overlap`) with Jaccard similarity, per-user profiles, shared categories (ace8ee2)
- Dashboard redesign: table pagination (25/page), search, favicons, sort arrows, row hover, graph view balance, SVG logo, fade-in animations, XSS escaping (bb8b6e1)
- Graph default changed from "All Edges" to "LINKS_TO" — SHARED_BY dimmed to 0.06 opacity, 4 view toggles with smooth transitions
- Full server backfill script `scripts/backfill-server.ts` — scans ALL 28 text channels in the Discord guild
- **13 users discovered**: Acelogic_, Bortles, glacier, an Airdrop, wobblychair, Gu✝s, Kawaii Kitten, Suepaphly, Mouthwash, 时个中来说, artvandelay, BitcoinMarty, Joe Datti
- 14,503 messages scanned, 1,349 new links enqueued for processing, 207 SHARED_BY relations created
- Repo made public: https://github.com/musicofhel/link-forge
- Playwright installed as dev dep for visual testing

## Remaining Work
- **~1,658 links in queue** processing at ~10s each (~4.5 hours). Bot is running in tmux `link-forge` and chewing through them. Check with `sqlite3 data/queue.db "SELECT status, count(*) FROM queue GROUP BY status;"`
- **Purge junk items** (score < 0.10) from before threshold was added
- **Dashboard after queue drains**: Re-screenshot with Playwright to verify all 13 user tabs populated with real data
- **ralph-loop URL** may have failed (check queue)
- **claude.ai artifact** (ID 60) auth-gated — save manually if valuable
- **.github/workflows** — push when GitHub token gets workflow scope
- **Queue failures**: 24 items failed so far — check `sqlite3 data/queue.db "SELECT url, error FROM queue WHERE status='failed' LIMIT 10;"`

## Known Bugs / Blockers
- **UNIQUE constraint on discord_message_id**: Messages with multiple URLs can only enqueue the first URL. The backfill-server script catches and skips these — but some links from multi-URL messages will be missed. Consider removing the UNIQUE constraint or using synthetic IDs for additional URLs.
- **Neo4j sessions single-threaded**: All `session.run()` calls must be sequential (no Promise.all). This makes the backfill slow.
- **ngrok free tier**: URL changes on restart. Current: `unniched-ethan-nonequilateral.ngrok-free.dev`
- **Processor bottleneck**: Claude CLI (`claude -p`) takes 5-8s per link for categorization. No parallelism.

## Approaches Tried & Failed
- `Promise.all` for parallel Neo4j queries — "open transaction" error. Must run sequentially.
- `parseInt()` for Neo4j LIMIT/SKIP — returns JS float, need `neo4j.int()`.
- Queue `enqueue()` without UNIQUE constraint handling — crashes on messages with multiple URLs sharing the same discord_message_id. Fixed with try/catch.
- `pkill` + immediate `tmux send-keys` — race condition, old process not dead yet.

## Key Files Modified
- `src/dashboard/index.html` — Full redesign: pagination, search, graph balance, SVG icons, XSS safety
- `src/dashboard/server.ts` — Added `/api/overlap` endpoint (Jaccard, profiles, shared categories)
- `scripts/backfill-server.ts` (NEW) — Full-guild scan: lists all text channels, fetches history, creates Users, enqueues new links
- `package.json` — Added playwright dev dependency
