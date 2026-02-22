# Knowledge Graph Explorer — Mega Drawer

**Date**: 2026-02-22
**Status**: Implemented, typecheck passes, API verified, bot restarted, awaiting visual QA

## What Was Done

Replaced the basic 280px filter panel in the graph explorer (`/graph`) with a rich 340px "Explorer Drawer" containing 5 collapsible sections, a presets bar, and an active filters bar.

### Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/dashboard/server.ts` | Modified | Expanded `/api/graph/full` — links now return quality, integrationType, difficulty, savedAt; users return avatarUrl, interests |
| `src/dashboard/graph.html` | Modified | 1,243 → 2,372 lines. Full drawer rewrite with all features below |

### Drawer Structure

```
Explorer Drawer (340px, left slide-in)
│
├── [Presets Bar] — scrollable row of one-click presets
│   High Quality, Recent 30d, Tutorials, Tools, Hub Nodes, Research, [per-user], Reset All
│
├── [1] FILTERS (default: open)
│   ├── Node Types (checkboxes + live count badges)
│   ├── Forge Score (dual min/max range slider)
│   ├── Content Type (10 chip toggles: tool, tutorial, pattern, analysis, reference, etc.)
│   ├── Quality (3 toggle buttons: High / Medium / Low)
│   ├── Difficulty (4 toggle buttons: Beginner / Intermediate / Advanced / Academic)
│   ├── Domain (searchable chip list, top 25 domains with counts)
│   ├── Date Range (two date inputs: from / to)
│   ├── Shared By (user avatar chips, toggleable per user)
│   ├── Min Connections (slider)
│   └── Edge Types (collapsed <details>, 9 checkboxes)
│
├── [2] VISUAL CONTROLS (default: closed)
│   ├── Color by (dropdown: Score Tier / Content Type / Quality / Difficulty / Domain / User / Recency)
│   ├── Size by (dropdown: Connections+Score / Connections Only / Score Only / Fixed)
│   ├── Labels (dropdown: Auto / Always / Never / Hubs Only)
│   └── Edge Opacity (slider: 2%–80%)
│
├── [3] GRAPH TOOLS (default: closed)
│   ├── Path Finder (two text inputs → client-side BFS, max 8 hops, yellow highlight)
│   ├── Cluster Detection (label propagation, max 20 iterations, clickable cluster list)
│   ├── Isolate Selected (1-hop neighborhood of clicked node)
│   └── Export (JSON / CSV / PNG buttons)
│
├── [4] LAYOUT (default: closed)
│   ├── Charge Strength slider (-150 to -5)
│   ├── Link Distance slider (10 to 200)
│   ├── Collision Padding slider (0 to 10)
│   └── Buttons: Reheat / Zoom to Fit / Pin All / Unpin All
│
└── [Active Filters Bar] — sticky bottom, removable chips + "Clear All"
```

### Visual Control Modes

**Color By** (7 modes for link nodes, non-link nodes keep static colors):
- Score Tier (default): 6-tier color scale
- Content Type: 10 distinct colors
- Quality: green/yellow/red
- Difficulty: green → red gradient
- Domain: deterministic hue from domain string hash
- User: palette based on who shared via SHARED_BY edges
- Recency: blue (old) → green (recent) based on savedAt

**Size By** (4 modes):
- Connections + Score (default)
- Connections Only
- Score Only
- Fixed (all links = 4px)

**Labels** (4 modes):
- Auto (zoom-adaptive, existing behavior)
- Always
- Never
- Hubs Only (5+ connections)

### Dynamic Legend

Bottom-right legend rebuilds dynamically when color-by mode changes. Shows the active color scheme categories. Cluster mode shows "Colored by community" label.

### Keyboard Shortcuts

- **F**: Toggle drawer open/close
- **R**: Reset all filters
- **Z**: Zoom to fit
- **Esc**: Dismiss path highlight → detail panel → drawer → search (in priority order)
- **Ctrl+K**: Focus search

### Technical Details

- Presets: `resetFilters(quiet)` → set specific state → `applyFilters()`
- Path Finder: Client-side BFS on visible graph adjacency, bidirectional edges, max 8 hops
- Cluster Detection: Label propagation (20 iterations, random node order), assigns `_cluster` property, overrides `nodeColor()`
- Layout: Manual adjustments set `manualLayout=true`, bypassing auto charge/distance calculations until reset
- Active Filters Bar: Rebuilds on every `applyFilters()`, each chip has individual clear callback
- Derived data (`buildDerivedData()`): Computes domainCounts, sharedByMap, userNodes list, contentTypes set, dateRange on initial load

## Verification

```bash
# Typecheck
npm run typecheck  # passes clean

# API test
curl -s -b "lf_session=$SESSION" localhost:3848/api/graph/full | jq '.nodes[0] | keys'
# → ["connectionCount","contentType","difficulty","domain","forgeScore","id","integrationType","nodeType","quality","savedAt","title"]

# Open in browser
powershell.exe -c "Start-Process 'http://localhost:3848/d/d9056acf-1e39-4769-baf1-58df3fd0c2dd/graph'"
```

## What Remains

- **Visual QA in browser**: Not yet opened/confirmed visually
- Bot is running: `nohup npx tsx src/index.ts >> logs/bot.log 2>&1 &`
