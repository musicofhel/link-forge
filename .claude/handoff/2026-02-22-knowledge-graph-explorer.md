# Knowledge Graph Explorer — Full-Screen Obsidian-Style Graph Page

**Date**: 2026-02-22
**Status**: Implemented, API tested against live Neo4j, awaiting visual QA in browser

## What Was Done

Built a dedicated full-screen knowledge graph explorer page (Obsidian/Logseq-style) accessible via `/graph` or the external-link icon on the dashboard's "Knowledge Graph" card heading.

### Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/dashboard/graph.html` | **CREATED** | 1,242 lines |
| `src/dashboard/server.ts` | Modified | 748 → 1,006 lines |
| `src/dashboard/index.html` | Modified | +2 lines (icon + JS) |

### New API Endpoints

1. **`GET /api/graph/full`** — All nodes (links, categories, technologies, tools, users) with `connectionCount` + all edges. Tags excluded from global view. Uses 7 parallel Neo4j sessions (one per query). Returns `{ nodes, edges, meta }`. Response: 5,165 nodes, 7,866 edges, 1.9MB, ~114ms.

2. **`GET /api/graph/node/:nodeId`** — 2-hop neighborhood of any node, **including tags**. Parses ID prefix (`cat:`, `tech:`, `tool:`, `user:`, raw URL for links). Returns `{ center, nodes, edges }`. LIMIT 500 neighbors. ~140ms.

### New Routes

- `GET /graph` → redirects to `/d/:guid/graph` if auth enabled, else serves graph.html
- `GET /d/:guid/graph` → auth-protected, serves graph.html

### graph.html Features

- **Canvas rendering** (not SVG) — D3 force simulation with `CanvasRenderingContext2D`
- **Quadtree hit detection** — O(log n) hover/click/drag
- **Toolbar**: back-to-dashboard link, search (Ctrl+K), filter toggle, node/edge counts, mode badge
- **Filter panel** (left slide-out): node type checkboxes, min score slider, edge type toggles, min connections slider
- **Detail panel** (right slide-out): title, type badge, score, content type, key concepts, connections by type, Focus/Open URL buttons
- **Local graph mode**: double-click or Focus → fetches 2-hop neighborhood with tags. Center node highlighted with glow ring, 1-hop full opacity, 2-hop at 60%. Breadcrumb navigation. Escape returns to global.
- **Labels**: fade in at zoom > 1.2x, high-connectivity nodes shown first, background pills
- **Adaptive simulation**: charge/distance scale with node count (>2000 nodes = weaker forces)
- **Node sizing**: base by type + sqrt(connectionCount) + forgeScore bonus
- **Node colors**: links by score tier, category=#fee75c, tech=#3498db, tool=#57f287, user=#eb459e, tag=#b07cc6
- **Edge colors**: by relationship type, highlighted on hover
- **roundRect polyfill** for older browsers
- **Zoom filter**: prevents pan when clicking a node (drag), blocks dblclick zoom (handled by app)

### Dashboard Change

External-link SVG icon next to "Knowledge Graph" heading. JS detects `/d/:guid/` path and adjusts href. Opens in new tab.

## Bugs Fixed During Testing

1. **Neo4j session concurrency**: `Promise.all` with 7 queries on one session caused "open transaction" error. Fix: separate `neo4jDriver.session()` per parallel query, `Promise.all(sessions.map(s => s.close()))` in finally.

2. **Cypher implicit grouping**: `collect(DISTINCT n) + [center]` failed Neo4j's aggregation rules. Fix: explicit `WITH center` before `collect`, then `WITH [center] + neighbors AS allNodes`.

## What Remains / Known Issues

- **Visual QA not done yet** — browser was opened but user hasn't confirmed the rendering looks correct
- **5,165 nodes is more than planned** (~3,400 expected). The extra ~1,700 come from technologies (1,280) and tools (1,184) which together exceed the plan's estimates (475 tech + 259 tools). Performance should still be fine with canvas rendering.
- **No content type filter dropdown** — plan mentioned it but the min-score slider + edge type toggles cover the main use cases
- **graph.html not copied to dist/** — resolved at runtime via `resolveGraphHtml()` fallback to `../../src/dashboard/graph.html`, same pattern as index.html
- **Bot was restarted** during testing. Currently running: `nohup npx tsx src/index.ts >> logs/bot.log 2>&1 &`

## Verification Commands

```bash
# Generate session token
node -e "require('dotenv').config(); const {createHmac,randomBytes}=require('node:crypto'); const s=process.env.DASHBOARD_SESSION_SECRET; const p=(Date.now()+7*24*60*60*1000)+':'+randomBytes(16).toString('hex'); console.log(p+'.'+createHmac('sha256',s).update(p).digest('base64url'));"

# Test full graph
curl -s -b "lf_session=$SESSION" localhost:3848/api/graph/full | jq '.meta'

# Test node neighborhood
curl -s -b "lf_session=$SESSION" "localhost:3848/api/graph/node/cat%3AAI%20Research" | jq '{center: .center.title, neighbors: (.nodes | length), edges: (.edges | length)}'

# Open in browser (WSL)
powershell.exe -c "Start-Process 'http://localhost:3848/d/d9056acf-1e39-4769-baf1-58df3fd0c2dd/graph'"
```
