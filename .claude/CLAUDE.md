# Link Forge

Personal knowledge forager: Discord bot captures links and documents, scrapes/categorizes/embeds them into a Neo4j graph, and an MCP server exposes the collected knowledge to any Claude Code session.

## Architecture

```
Discord URLs ──────────┐
Discord Attachments ───┤
Cloud Share Links ─────┤   SQLite Queue → Processor
Local Inbox Watcher ───┤                    ├── Scraper / File Extractor
Google Drive Poller ───┘                    ├── Categorizer (claude -p CLI)
                                            └── Embedder (all-MiniLM-L6-v2)
                                                  ↓
                                            Neo4j Graph DB ← MCP Server (stdio)
                                                  ↑
                                            Dashboard (Express + D3)
```

## Input Channels

1. **Discord URLs** — paste links in channel, auto-scraped
2. **Discord Attachments** — drag & drop files (PDF/DOCX/PPTX/XLSX/EPUB/TXT/MD/HTML, 50MB limit)
3. **Cloud Share Links** — Google Drive / Dropbox share URLs pasted in Discord auto-download the file
4. **Local Inbox Watcher** — polls `INBOX_DIR` folder (e.g., Windows Desktop), processes + deletes files
5. **Google Drive Poller** — service account watches per-user subfolders (requires `GDRIVE_ENABLED=true`)

## Stack

- **Runtime**: Node.js 22, TypeScript, ESM
- **Discord**: discord.js v14
- **Queue**: better-sqlite3 (WAL mode)
- **Graph DB**: Neo4j 5 Community (Docker on port 7474/7687)
- **Embeddings**: @huggingface/transformers + all-MiniLM-L6-v2 (ONNX, CPU)
- **LLM**: Claude Code CLI (`claude -p`) — zero API cost
- **MCP**: @modelcontextprotocol/sdk (stdio transport)
- **Scraping**: fetch + @mozilla/readability + jsdom
- **File Extraction**: officeparser (PDF/DOCX/PPTX/XLSX), epub2 (EPUB)
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

## Scripts

- `npx tsx scripts/set-interests.ts "<name>" "<interests>"` — Set user interest profile
- `npx tsx scripts/reprocess-documents.ts` — Re-categorize all documents with current prompt
- `npx tsx scripts/migrate-concepts-authors.ts` — Backfill Concept/Author nodes from existing Link data
- `npx tsx scripts/generate-chunks.ts` — Backfill chunk embeddings for all existing links

## Neo4j Graph Schema

- **Nodes**: Link, Category, Tag, Technology, Tool, User, Concept, Author, Chunk
- **Relationships**: CATEGORIZED_IN, TAGGED_WITH, MENTIONS_TOOL, MENTIONS_TECH, RELATED_TO, SUBCATEGORY_OF, USED_WITH, SHARED_BY, LINKS_TO, RELATES_TO_CONCEPT, AUTHORED_BY, HAS_CHUNK
- **Vector indexes**: `link_embedding_idx` (384-dim cosine on Link.embedding), `chunk_embedding_idx` (384-dim cosine on Chunk.embedding)
- **Text indexes**: concept_name_text, author_name_text
- **Link properties**: url, title, domain, forgeScore, contentType, keyConcepts, authors, keyTakeaways, difficulty, embedding
- **Concept properties**: name (UNIQUE, lowercase normalized)
- **Author properties**: name (UNIQUE)
- **Chunk properties**: id (UNIQUE, `${linkUrl}#chunk-${index}`), text, index, embedding
- **User properties**: discordId, displayName, username, avatarUrl, interests

## Document Processing

- Documents use synthetic `file:///<hash>/<filename>` as Link node URL (preserves UNIQUE constraint)
- Separate `DOCUMENT_PROMPT` extracts: key_concepts, authors, key_takeaways, difficulty
- 12k chars sent to Claude for documents (vs 4k for URLs), 10k stored in Neo4j (vs 5k)
- User interest profiles injected into categorization prompt for personalized extraction
- Content types: tool, tutorial, pattern, analysis, reference, commentary, research-paper, book, whitepaper, report
- Cross-filesystem inbox watcher uses `copyFile` + `unlink` (not `rename`) for WSL↔NTFS

## Discord Commands

- `/forge stats` — Score distribution + content type charts
- `/forge top [count]` — Top links by forge score
- `/forge graph` — Link to interactive dashboard
- `/forge ask <question>` — RAG query against the knowledge graph
- `/forge interests <topics>` — Set your knowledge interest profile

## MCP Tools

- `forge_search` — Hybrid vector + keyword + graph search
- `forge_categories` — List category tree
- `forge_browse_category` — List links in a category
- `forge_find_tools` — Find tools for a technology
- `forge_related` — Find related links (graph + vector)
- `forge_recent` — Get N most recent additions
- `forge_concepts` — Browse concept network, list top concepts, explore by concept name
- `forge_authors` — Find papers by author, list top authors, discover co-authors

## Bot Behavior

- **Guild-wide scraping**: The bot captures links and attachments from ALL channels in the server
- **Emoji reactions only in #wobblychair** (channel ID `1432502241876770816`): Both the `messageCreate` handler and the processor notifier are gated to this channel. All other channels are scraped silently.
- **Academic DOI fallback**: When a DOI URL returns 403, the scraper tries Unpaywall (OA full-text PDF) then Semantic Scholar (title/abstract/authors/citations)

## CRITICAL: Restarting the Bot

**ALWAYS kill ALL existing bot processes before starting a new one.** The bot runs via `npx tsx src/index.ts` which spawns multiple child processes. Using `kill <pid>` on just the parent may leave orphans. Stacked instances cause duplicate processing and unwanted side effects (e.g., old instances ignoring channel restrictions).

```bash
# CORRECT — kill everything, then start fresh
pkill -f "tsx src/index.ts"; sleep 2
nohup npx tsx src/index.ts >> logs/bot.log 2>&1 &

# VERIFY only one instance is running
pgrep -f "tsx src/index.ts" -a | grep -v pgrep
```

Never use just `kill <single-pid>` — always use `pkill -f "tsx src/index.ts"` to catch all child processes.

## Conventions

- All source in `src/`, tests mirror in `tests/`
- ESM throughout (`"type": "module"` in package.json)
- Zod for all external data validation
- pino for logging (MCP server uses stderr only)
- `.githooks/pre-commit` runs `tsc --noEmit`
- SQLite in `data/` (gitignored)
- Uploaded files in `data/uploads/` (gitignored, deleted after processing)
