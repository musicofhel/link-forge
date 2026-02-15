# Link Forge

Personal knowledge forager — drop links and documents into a Discord channel, an agent scrapes/categorizes/embeds them into a Neo4j graph database, and an MCP server lets any Claude Code session query the collected knowledge.

> **Note**: See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for untested features and QC warnings.

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

### Available Tools

| Tool | Description |
|------|-------------|
| `forge_search` | Hybrid vector + keyword + graph search |
| `forge_categories` | List category tree |
| `forge_browse_category` | List links in a category |
| `forge_find_tools` | Find tools for a technology |
| `forge_related` | Find related links |
| `forge_recent` | Get recent additions |

## Dashboard

The dashboard provides an interactive D3 visualization of your knowledge graph plus a RAG chat panel.

```bash
# Access (if DASHBOARD_API_KEY is set in .env):
http://localhost:3848/dashboard?key=YOUR_API_KEY
```

## Architecture

```
Discord URLs ──────────┐
Discord Attachments ───┤
Cloud Share Links ─────┤   SQLite Queue → Processor → Neo4j Graph ← MCP Server ← Claude Code
Local Inbox Watcher ───┤                                  ↑
Google Drive Poller ───┘                            Dashboard (D3)
```

- **Scraping**: fetch + @mozilla/readability
- **File extraction**: officeparser (PDF/DOCX/PPTX/XLSX), epub2 (EPUB)
- **Categorization**: Claude Code CLI (`claude -p`) with user interest profiles
- **Embeddings**: all-MiniLM-L6-v2 (384-dim, runs on CPU)
- **Search**: Hybrid vector + keyword + graph traversal
- **Security**: SSRF protection, rate limiting, API key auth, path traversal guards

## Development

```bash
npm test            # Run tests
npm run typecheck   # TypeScript check
npm run lint        # ESLint
npm run build       # Compile
```

## License

MIT
