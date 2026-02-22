# Changelog

All notable changes to Link Forge are documented in this file.

## [Unreleased]

### Knowledge Graph Deep Improvement (Feb 22, 2026)

#### Added
- **Concept nodes**: Extracted key concepts from links, stored as `Concept` nodes with `RELATES_TO_CONCEPT` relationships and `mentionCount` tracking
- **Author nodes**: Extracted authors from documents/papers, stored as `Author` nodes with `AUTHORED_BY` relationships and `mentionCount` tracking
- **Chunk nodes**: Content split into text chunks with individual 384-dim embeddings for fine-grained RAG retrieval (`HAS_CHUNK` relationship)
- **`forge_concepts` MCP tool**: Browse concept network, list top concepts, explore links by concept with co-occurring concepts
- **`forge_authors` MCP tool**: Find papers by author, list top authors, discover co-authors via shared publications
- **Concept-aware RAG expansion**: RAG queries now traverse `RELATES_TO_CONCEPT` edges to discover related links beyond vector similarity
- **Chunk-level RAG retrieval**: RAG engine searches both chunk embeddings (passage-level) and document embeddings, merging results for better answer grounding
- **Dashboard concept/author visualization**: D3 dashboard updated with concept and author node rendering
- **`concept_name_text` index**: Full-text index on Concept.name for fast text search
- **`author_name_text` index**: Full-text index on Author.name for fast text search
- **`chunk_embedding_idx` vector index**: 384-dim cosine vector index on Chunk.embedding
- **`concept_name_unique` constraint**: Unique constraint on Concept.name (lowercase normalized)
- **`author_name_unique` constraint**: Unique constraint on Author.name
- **`chunk_id_unique` constraint**: Unique constraint on Chunk.id
- `scripts/migrate-concepts-authors.ts` — Backfill Concept/Author nodes from existing Link keyConcepts/authors arrays
- `scripts/generate-chunks.ts` — Backfill chunk embeddings for all existing links

#### Changed
- RAG query pipeline now uses two-phase search: chunk-level vector search (top 40) + document-level vector search (top 20), merged and deduped to top 15 results
- RAG context includes key passage excerpts from chunk matches, improving answer specificity
- Dashboard auth switched from API key query parameter to GUID-based URL + password login with session cookies

## [1.0.0] — 2026-02-15

### Initial Release

- Discord bot with guild-wide link/attachment/cloud-link scraping
- 5 input channels: Discord URLs, Discord attachments, cloud share links, local inbox watcher, Google Drive poller
- SQLite queue (better-sqlite3, WAL mode) with parallel processing
- Web scraping with @mozilla/readability + academic DOI fallback (Unpaywall, Semantic Scholar)
- File extraction: officeparser (PDF/DOCX/PPTX/XLSX), epub2 (EPUB)
- Claude Code CLI categorization with user interest profiles
- all-MiniLM-L6-v2 embeddings (384-dim, ONNX, CPU)
- Neo4j 5 graph with 6 node types (Link, Category, Tag, Technology, Tool, User) and 9 relationship types
- 6 MCP tools: forge_search, forge_categories, forge_browse_category, forge_find_tools, forge_related, forge_recent
- `/forge` Discord slash command: stats, top, graph, ask, interests
- Interactive D3 dashboard with graph visualization and RAG chat
- SSRF protection, rate limiting, path traversal guards
- Taxonomy auto-split for oversized categories
- Failover Neo4j client + health monitor + sync engine
- 16 utility scripts for backfilling, reprocessing, and migration
