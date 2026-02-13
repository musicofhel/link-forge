# Link Forge

Personal knowledge forager: Discord bot captures links, scrapes/categorizes/embeds them into a Neo4j graph, and an MCP server exposes the collected knowledge to any Claude Code session.

## Architecture

```
Discord Channel → Bot (discord.js) → SQLite Queue → Processor
                                                        ├── Scraper (fetch + Readability)
                                                        ├── Categorizer (claude -p CLI)
                                                        └── Embedder (all-MiniLM-L6-v2)
                                                              ↓
                                                        Neo4j Graph DB
                                                              ↑
                                                        MCP Server (stdio)
```

## Stack

- **Runtime**: Node.js 22, TypeScript, ESM
- **Discord**: discord.js v14
- **Queue**: better-sqlite3 (WAL mode)
- **Graph DB**: Neo4j 5 Community (Docker on port 7474/7687)
- **Embeddings**: @huggingface/transformers + all-MiniLM-L6-v2 (ONNX, CPU)
- **LLM**: Claude Code CLI (`claude -p`) — zero API cost
- **MCP**: @modelcontextprotocol/sdk (stdio transport)
- **Scraping**: fetch + @mozilla/readability + jsdom
- **Config**: zod + dotenv
- **Testing**: Vitest

## Key Commands

```bash
npm run dev          # Start all components (tsx)
npm run build        # Compile TypeScript
npm start            # Run compiled (production)
npm run mcp          # Start MCP server only
npm run db:setup     # Create Neo4j schema + indexes
npm test             # Run tests
npm run typecheck    # tsc --noEmit
```

## Neo4j Graph Schema

- **Nodes**: Link, Category, Tag, Technology, Tool
- **Relationships**: CATEGORIZED_IN, TAGGED_WITH, MENTIONS_TOOL, MENTIONS_TECH, RELATED_TO, SUBCATEGORY_OF, USED_WITH
- **Vector index**: 384-dim cosine on Link.embedding

## MCP Tools

- `forge_search` — Hybrid vector + keyword + graph search
- `forge_categories` — List category tree
- `forge_browse_category` — List links in a category
- `forge_find_tools` — Find tools for a technology
- `forge_related` — Find related links (graph + vector)
- `forge_recent` — Get N most recent additions

## Conventions

- All source in `src/`, tests mirror in `tests/`
- ESM throughout (`"type": "module"` in package.json)
- Zod for all external data validation
- pino for logging (MCP server uses stderr only)
- `.githooks/pre-commit` runs `tsc --noEmit`
- SQLite in `data/` (gitignored)
