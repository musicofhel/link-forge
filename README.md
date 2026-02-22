# Link Forge

Personal knowledge forager — a Discord bot captures links and documents from the entire guild, scrapes/categorizes/embeds them into a Neo4j knowledge graph, and an MCP server lets any Claude Code session query the collected knowledge. Includes an interactive D3 dashboard and RAG-powered Q&A.

> **Note**: See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for untested features and QC warnings.

## Features

- **5 input channels**: Discord URLs, Discord file attachments, cloud share links (GDrive/Dropbox), local inbox watcher, Google Drive poller
- **Intelligent processing**: Web scraping (readability), file extraction (PDF/DOCX/PPTX/XLSX/EPUB), Claude-powered categorization with user interest profiles
- **Knowledge graph**: 9 node types, 12 relationship types, vector + text indexes in Neo4j
- **Embeddings**: all-MiniLM-L6-v2 (384-dim, CPU) for links and content chunks
- **RAG engine**: Chunk-level + document-level vector search, concept-aware graph expansion, Claude CLI synthesis
- **MCP server**: 8 tools for querying the graph from any Claude Code session
- **Discord bot**: `/forge` slash command with stats, top links, graph, Q&A, and interest profiles
- **Dashboard**: Interactive D3 graph visualization, link explorer, RAG chat panel

## Quick Start

```bash
# 1. Start Neo4j
docker compose up -d

# 2. Install deps
npm install

# 3. Set up .env (copy and fill in Discord credentials)
cp .env.example .env

# 4. Set up Neo4j schema
npm run db:setup

# 5. Run
npm run dev
```

## MCP Server

Add to any project's `.mcp.json` to query your link library from Claude Code:

```json
{
  "mcpServers": {
    "link-forge": {
      "command": "node",
      "args": ["/home/musicofhel/link-forge/dist/mcp/index.js"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "link_forge_dev"
      }
    }
  }
}
```

> **Note**: Run `npm run build` first — the MCP server runs from `dist/`.

### Available Tools

| Tool | Description |
|------|-------------|
| `forge_search` | Hybrid vector + keyword search with natural language queries |
| `forge_categories` | List all categories as a tree with link counts |
| `forge_browse_category` | List links in a specific category |
| `forge_find_tools` | Find tools for a technology or framework |
| `forge_related` | Find related links by URL (graph + vector similarity) |
| `forge_recent` | Get most recently saved links |
| `forge_concepts` | Browse concept network — list top concepts or explore by name |
| `forge_authors` | Find papers by author or list top authors with co-authors |

See [docs/mcp-tools.md](docs/mcp-tools.md) for full parameter reference.

## Discord Commands

All commands use the `/forge` slash command prefix:

| Subcommand | Description |
|------------|-------------|
| `/forge stats` | Score distribution + content type charts (PNG embed) |
| `/forge top [count]` | Top N links by forge score (default: 10, max: 25) |
| `/forge graph` | Link to interactive dashboard with node/edge counts |
| `/forge ask <question>` | RAG query against the knowledge graph |
| `/forge interests <topics>` | Set your knowledge interest profile (comma-separated) |

## Dashboard

The dashboard provides an interactive D3 graph visualization, link explorer, and RAG chat panel.

**Authentication** (requires all 3 env vars in `.env`):
- `DASHBOARD_GUID` — random UUID that becomes the URL path
- `DASHBOARD_PASSWORD_HASH` — bcrypt hash of your password
- `DASHBOARD_SESSION_SECRET` — random string for signing session cookies

```bash
# Generate a password hash:
node -e "console.log(require('bcryptjs').hashSync('yourpass', 12))"

# Access the dashboard:
http://localhost:3848/d/<your-guid>
# Login page will prompt for password
```

Sessions last 7 days. Rate limited to 10 login attempts per 15 minutes.

## Architecture

```
Discord URLs ──────────┐
Discord Attachments ───┤
Cloud Share Links ─────┤   SQLite Queue → Processor
Local Inbox Watcher ───┤                    ├── Scraper (@mozilla/readability)
Google Drive Poller ───┘                    ├── File Extractor (officeparser, epub2)
                                            ├── Categorizer (Claude CLI + interests)
                                            └── Embedder (all-MiniLM-L6-v2)
                                                  ↓
                                            Neo4j Graph DB
                                            ├── Links + Chunks (384-dim embeddings)
                                            ├── Concepts + Authors (extracted entities)
                                            └── Categories, Tags, Tools, Technologies
                                                  ↑
                                            MCP Server (stdio) → Claude Code
                                            Dashboard (Express + D3)
```

- **Scraping**: fetch + @mozilla/readability + academic DOI fallback (Unpaywall OA PDFs, Semantic Scholar)
- **File extraction**: officeparser (PDF/DOCX/PPTX/XLSX), epub2 (EPUB)
- **Categorization**: Claude Code CLI (`claude -p`) with user interest profiles
- **Embeddings**: all-MiniLM-L6-v2 (384-dim, ONNX, runs on CPU)
- **Chunk embeddings**: Content split into chunks with individual 384-dim vectors for fine-grained RAG
- **Search**: Hybrid vector (chunk + doc level) + keyword + graph traversal + concept expansion
- **Graph**: Failover client (local + remote Neo4j), health monitor, sync engine
- **Security**: SSRF protection, rate limiting, password auth, path traversal guards
- **Bot behavior**: Guild-wide scraping, emoji reactions only in wobblychair channel

## Graph Schema

9 node types and 12 relationship types. See [docs/graph-schema.md](docs/graph-schema.md) for full reference.

**Nodes**: Link, Category, Tag, Technology, Tool, Concept, Author, Chunk, User

**Key relationships**:
- `Link -[:CATEGORIZED_IN]-> Category`
- `Link -[:RELATES_TO_CONCEPT]-> Concept`
- `Link -[:AUTHORED_BY]-> Author`
- `Link -[:HAS_CHUNK]-> Chunk`
- `Link -[:TAGGED_WITH]-> Tag`
- `Link -[:MENTIONS_TOOL]-> Tool`
- `Link -[:MENTIONS_TECH]-> Technology`
- `Link -[:RELATED_TO]- Link`
- `Link -[:SHARED_BY]-> User`

**Indexes**: 9 unique constraints, 4 text indexes, 2 vector indexes (384-dim cosine).

## Scripts

All scripts run via `npx tsx scripts/<name>.ts`:

| Script | Purpose |
|--------|---------|
| `initial-seed.sh` | One-time setup: schema, categories, seed data |
| `backfill-channel.ts` | Bulk reprocess Discord channel messages |
| `backfill-server.ts` | Bulk reprocess all server messages |
| `backfill-users.ts` | Reprocess user profiles |
| `batch-enqueue-papers.ts` | Queue academic papers (arXiv/Semantic Scholar) |
| `generate-chunks.ts` | Backfill chunk embeddings for all existing links |
| `migrate-concepts-authors.ts` | Backfill Concept/Author nodes from existing Link data |
| `migrate-for-sync.ts` | Prepare for multi-instance sync |
| `parallel-drain.ts` | Process queue with 4 parallel workers |
| `reprocess.ts` | Re-categorize a single link |
| `reprocess-documents.ts` | Re-categorize all documents with current prompt |
| `reprocess-urls.ts` | Re-categorize all URLs |
| `search-papers.ts` | Search academic papers + queue them |
| `set-interests.ts` | Set user interest profile (`"<name>" "<interests>"`) |
| `sync-now.ts` | Trigger immediate sync (multi-instance) |
| `sync-status.ts` | Check sync engine status |

## Development

```bash
npm run dev          # Start all components (tsx watch)
npm run build        # Compile TypeScript
npm start            # Run compiled (production)
npm run mcp          # Start MCP server only
npm run db:setup     # Create Neo4j schema + indexes
npm test             # Run tests (Vitest)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
```

**Conventions**: ESM throughout, Zod for validation, pino for logging, `.githooks/pre-commit` runs `tsc --noEmit`, SQLite queue in `data/` (gitignored).

## Configuration

Copy [`.env.example`](.env.example) and fill in your values. Sections:

- **Discord**: Bot token, guild ID, optional notification channel
- **Neo4j**: Connection URI, credentials
- **Processing**: Poll intervals, scrape/Claude timeouts
- **Taxonomy**: Auto-split threshold for oversized categories
- **Inbox**: Local file watcher config
- **Google Drive**: Optional service account poller
- **Dashboard**: GUID, password hash, session secret, CORS
- **Logging**: Log level

## License

MIT — see [LICENSE](LICENSE).
