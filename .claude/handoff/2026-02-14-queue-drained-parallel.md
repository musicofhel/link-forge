# Session Handoff — 2026-02-14 — Queue Drained + Parallel Worker

## Completed This Session
- Overlap analysis API + dashboard redesign from previous session (ace8ee2, bb8b6e1)
- Full server backfill: 28 channels, 14,503 messages, 13 users discovered (f9f58f9)
- Parallel drain script `scripts/parallel-drain.ts` — 3 concurrent workers to speed up processing
- **Queue fully drained**: 1,890 completed, 107 failed (403/404/429 dead URLs)
- **564 links in graph** across 13 users: wobblychair(302), Bortles(94), Acelogic_(49), glacier(35), 时个中来说(30), Gu✝s(16), an Airdrop(15), Mouthwash(8), Suepaphly(7), Kawaii Kitten(6), artvandelay(1), BitcoinMarty(1), Joe Datti(0)
- Repo is public: https://github.com/musicofhel/link-forge
- Bot still running in tmux `link-forge` on port 3848, ngrok active

## Remaining Work
- **Purge junk items** (score < 0.10) from before threshold was added
- **107 failed queue items** — mostly dead URLs (403/404/429/500). Review with `sqlite3 data/queue.db "SELECT url, error FROM queue WHERE status='failed';"`
- **Joe Datti has 0 links** — their URLs may all have failed or been below forge score threshold
- **UNIQUE constraint on discord_message_id** still limits multi-URL messages to first URL only
- **Dashboard Playwright screenshots** — re-verify now that all 13 users have real data
- **.github/workflows** — push when GitHub token gets workflow scope
- **claude.ai artifact** (ID 60) auth-gated — save manually if valuable

## Known Bugs / Blockers
- **UNIQUE constraint on discord_message_id**: Messages with multiple URLs can only enqueue the first. backfill-server.ts catches and skips. Some links from multi-URL messages are missed.
- **Neo4j sessions single-threaded**: All `session.run()` must be sequential.
- **ngrok free tier**: URL changes on restart. Current: `unniched-ethan-nonequilateral.ngrok-free.dev`
- **Parallel drain + bot processor**: Both can run simultaneously — SQLite WAL + atomic dequeue prevents conflicts. But embedding model loads twice (once per process), using ~500MB extra RAM.

## Approaches Tried & Failed
- `loadEmbeddingModel` export — doesn't exist. Correct export is `createEmbeddingService` from `src/embeddings/index.js`.
- First parallel-drain run failed on wrong import, second run succeeded.
- `enqueue()` without UNIQUE constraint handling — crashes on multi-URL messages. Fixed with try/catch in backfill-server.ts.

## Key Files Modified
- `scripts/parallel-drain.ts` (NEW) — 3-worker concurrent queue processor, shares SQLite via WAL
- `scripts/backfill-server.ts` (NEW, prev session) — full-guild Discord scan
- `src/dashboard/index.html` — redesigned dashboard (prev session)
- `src/dashboard/server.ts` — `/api/overlap` endpoint (prev session)
