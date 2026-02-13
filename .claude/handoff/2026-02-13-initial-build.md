# Link Forge — Initial Build Handoff (Feb 13, 2026)

## What Was Built

Complete implementation of Link Forge — personal knowledge forager with Discord bot, Neo4j graph DB, and MCP server. All 7 phases from the plan implemented in one session.

## Current State

- **96/96 tests passing**, 0 TypeScript errors, build succeeds
- **Bot running** as `Link Forge#7316` in Discord
- **3 links processed** so far: 1 GitHub repo, 1 broken X link (pre-fix), 1 X article (working)
- **Neo4j** running in Docker (`link-forge-neo4j`) on ports 7474/7687

## File Counts

- 36 source files in `src/`
- 13 test files + 2 fixtures in `tests/`
- 68 total project files

## Key Fix: Twitter/X Scraping

X blocks direct scraping. Added 3-tier fallback in `src/processor/scraper.ts`:

1. **FxTwitter API** (`api.fxtwitter.com`) — returns structured JSON with tweet text, author, engagement stats
2. **Twitter oEmbed API** (`publish.twitter.com/oembed`) — fallback, returns HTML
3. **Graceful degradation** — saves with minimal metadata if both fail

**Twitter Articles** (long-form posts) have content in `tweet.article.content.blocks[]` (Draft.js format), NOT in `tweet.text`. This was discovered and fixed during testing.

Also handles: media-only tweets (pulls alt text), quote tweets, empty text tweets.

## Known Issues / Next Steps

- **discord.js deprecation warning**: `ready` event renamed to `clientReady` in v15 — cosmetic, not breaking
- **Duplicate X link from first test**: Old broken entry was deleted from both Neo4j and SQLite, re-processed with the fix
- **Two bot instances**: Be careful not to `npm run dev` from multiple places — kill stale instances first
- **Bot token exposed** in chat — user should regenerate at discord.com/developers
- **More scraping edge cases**: User plans to keep dropping links and fixing failures iteratively
  - Image/video-only tweets with no alt text → get "(media post)" placeholder
  - Twitter Spaces, polls, etc. → untested
  - Other walled gardens (LinkedIn, Medium paywalled) → not handled yet

## Architecture Quick Reference

```
Discord #link-drop → Bot (discord.js) → SQLite Queue (WAL) → Processor
                                                                 ├── Scraper (fetch + Readability, FxTwitter for X)
                                                                 ├── Categorizer (claude -p CLI)
                                                                 └── Embedder (all-MiniLM-L6-v2, 384-dim)
                                                                       ↓
                                                                 Neo4j Graph DB
                                                                       ↑
                                                                 MCP Server (stdio, 6 tools)
```

## Commands

```bash
cd ~/link-forge
docker compose up -d          # Start Neo4j
npm run dev                   # Start bot + processor + taxonomy
npm run mcp                   # Start MCP server only
npm test                      # 96 tests
npm run typecheck             # tsc --noEmit
npm run db:setup              # Create Neo4j schema
```

## Query the graph

```bash
cd ~/link-forge && node -e "
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'link_forge_dev'));
const session = driver.session();
session.run('MATCH (l:Link) OPTIONAL MATCH (l)-[:CATEGORIZED_IN]->(c:Category) RETURN l.title, l.url, c.name ORDER BY l.savedAt DESC')
  .then(r => { r.records.forEach(rec => console.log(rec.get('c.name'), '|', rec.get('l.title'))); })
  .then(() => session.close())
  .then(() => driver.close());
"
```

## .env Location

`~/link-forge/.env` — has Discord token, channel ID, guild ID, Neo4j creds. Token may need regeneration.
