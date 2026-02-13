# Session Handoff — 2026-02-13 — Dashboard + User Nodes + Tabbed UI

## Completed This Session
- Interactive web dashboard on Express port 3848 with D3.js force graph, Chart.js stats, sortable link table (6c9c5ab)
- Server-side PNG chart generation via chartjs-node-canvas for Discord embeds (scores, types, categories)
- Discord slash commands: `/forge stats`, `/forge top [n]`, `/forge graph` — registered to guild (6c9c5ab)
- Ngrok v3.36.1 installed, tunnel auto-detected at startup via localhost:4040 API (1231108)
- User nodes in Neo4j: `wobblychair` (198 links), `Bortles` (1 link) with SHARED_BY relationships (0f7a64b)
- Backfill script `scripts/backfill-users.ts` — re-fetches Discord history and attaches authors to existing links
- Bot now captures `discord_author_id` + `discord_author_name` on enqueue; processor creates User + SHARED_BY
- SQLite queue migrated with `discord_author_id` and `discord_author_name` columns
- Per-user tabbed dashboard: folder-style tabs with avatars + link counts, all data filters by user (ff1a6df)
- `/api/users` endpoint, `?user=discordId` filter on `/api/stats`, `/api/graph`, `/api/links`
- Graph shows User nodes (green, labeled) with dashed SHARED_BY edges in "All" view

## Remaining Work
- **Task #5 — Overlap/intersection analysis**: Category overlap between users in "All" tab (Venn/matrix)
- **Purge 6 junk items** (score < 0.10) from before threshold was added
- **ralph-loop URL** may have failed (check queue)
- **claude.ai artifact** (ID 60) auth-gated — save manually if valuable
- **.github/workflows** — push when GitHub token gets workflow scope

## Known Bugs / Blockers
- **Neo4j sessions can't run parallel queries**: All `Promise.all` with `session.run()` replaced with sequential calls. This is a fundamental limitation of the neo4j-driver — each session is single-threaded.
- **ngrok free tier**: URL changes on restart (`unniched-ethan-nonequilateral.ngrok-free.dev` currently). Shows interstitial "Visit Site" page on first load.
- **tmux session restart race**: `pkill -f "tsx src/index.ts"` + immediate `tmux send-keys` sometimes sends the command before the old process fully dies. Need explicit sleep or check that the shell prompt is back.
- **chartjs-node-canvas native bindings**: Works on WSL Ubuntu 24.04 with Node 22 — may need `apt install` for canvas deps on other systems.

## Approaches Tried & Failed
- `Promise.all` for parallel Neo4j queries on same session → "open transaction" error. Fixed by running sequentially.
- Neo4j integer types: `parseInt()` returns JS number but Neo4j LIMIT/SKIP need `neo4j.int()` — otherwise "not a valid value" error.
- `pkill` exit code 144 is normal (SIGTERM'd itself since tsx is a child).

## Key Files Modified
- `src/dashboard/server.ts` (NEW) — Express server, 7 API routes, per-user filtering via Cypher template
- `src/dashboard/charts.ts` (NEW) — chartjs-node-canvas PNG generation (3 chart types, Discord dark theme)
- `src/dashboard/index.html` (NEW) — Single-page dashboard: folder tabs, D3 force graph, Chart.js, link table
- `src/bot/index.ts` — Slash command registration + interactionCreate handler + author capture on enqueue
- `src/index.ts` — Starts dashboard server + ngrok auto-detection
- `src/graph/types.ts` — Added UserNode interface
- `src/graph/schema.ts` — Added User uniqueness constraint
- `src/graph/relationships.ts` — Added sharedBy() function
- `src/graph/repositories/user.repository.ts` (NEW) — createUser, findAllUsers
- `src/queue/schema.ts` — Author column migrations
- `src/queue/client.ts` — Runs author migrations on startup
- `src/queue/operations.ts` — EnqueueItem/QueueRow extended with author fields
- `src/processor/index.ts` — Creates User + SHARED_BY during link processing
- `scripts/backfill-users.ts` (NEW) — Discord history → User node backfill
- `tests/graph/schema.test.ts` — DDL count 8→9 for User constraint
