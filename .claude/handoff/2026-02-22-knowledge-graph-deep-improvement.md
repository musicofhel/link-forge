# Knowledge Graph Deep Improvement — Concept/Author Nodes + Chunk Embeddings + Enhanced RAG

**Date**: 2026-02-22
**Status**: Complete — all phases implemented and verified

## What Was Done

5-phase improvement to the Link Forge knowledge graph: richer ontology, chunk-level embeddings, improved RAG retrieval, new MCP tools, and dashboard integration.

### Files Created (8)

| File | Purpose |
|------|---------|
| `src/graph/repositories/concept.repository.ts` | CRUD for Concept nodes + RELATES_TO_CONCEPT edges |
| `src/graph/repositories/author.repository.ts` | CRUD for Author nodes + AUTHORED_BY edges |
| `src/graph/repositories/chunk.repository.ts` | CRUD for Chunk nodes + HAS_CHUNK edges + vector search |
| `src/embeddings/chunker.ts` | Text chunking (500 chars, 50 overlap, sentence boundaries) |
| `src/mcp/tools/concepts.ts` | forge_concepts MCP tool handler |
| `src/mcp/tools/authors.ts` | forge_authors MCP tool handler |
| `scripts/migrate-concepts-authors.ts` | Backfill Concept/Author nodes from existing Link data |
| `scripts/generate-chunks.ts` | Backfill chunk embeddings for all existing links |

### Files Modified (10)

| File | Changes |
|------|---------|
| `src/graph/types.ts` | Added ConceptNode, AuthorNode, ChunkNode interfaces |
| `src/graph/schema.ts` | Added Concept/Author/Chunk constraints + text indexes + chunk vector index |
| `src/graph/index.ts` | Re-exports new repositories |
| `src/processor/index.ts` | Creates Concept/Author/Chunk nodes during link processing |
| `src/rag/query.ts` | Two-stage vector search (chunk + doc), grouped chunks, concept expansion |
| `src/mcp/index.ts` | Registered forge_concepts and forge_authors tools |
| `src/mcp/tools/index.ts` | Re-exports new tool handlers |
| `src/dashboard/server.ts` | Concept/Author nodes in graph API, stats API, link detail API |
| `src/dashboard/graph.html` | Concept (teal) + Author (amber) node colors, legend, filter checkboxes |
| `src/dashboard/index.html` | Concept + Author count stat pills |
| `src/dashboard/link.html` | Concept + Author pills on link detail page |

### New Neo4j Schema

**Nodes**: Concept (name UNIQUE), Author (name UNIQUE), Chunk (id UNIQUE)
**Edges**: RELATES_TO_CONCEPT, AUTHORED_BY, HAS_CHUNK
**Indexes**: concept_name_text, author_name_text, chunk_embedding_idx (384-dim cosine)

### Migration Results

- **5,006** Concept nodes created (from ~572 links with keyConcepts)
- **2,102** Author nodes created (from ~566 links with authors)
- **7,809** new relationship edges
- Chunk generation: ~1,950 links to process, running at ~5.7 links/sec

### RAG Enhancement

- Chunk-level vector search (top 40 chunks) + document-level search (top 20)
- Grouped: best 3 chunks per link, merged with doc results, top 15 combined
- Concept-aware expansion: follows RELATES_TO_CONCEPT edges to find related links
- Context prompt includes chunk excerpts for Claude to cite
- Graceful fallback if chunk index doesn't exist yet

### New MCP Tools

- `forge_concepts`: Browse concept network, list top concepts, explore by concept name
- `forge_authors`: Find papers by author, list top authors, discover co-authors

### Dashboard Changes

- Graph: Concept nodes (teal #2dd4bf) + Author nodes (amber #fbbf24)
- Graph: Top 200 concepts + top 100 authors by mention count
- Stats: Concept + Author counts in dashboard pills
- Link detail: Concept + Author pills with graph-relationship data

## Verification

```bash
# Schema
npm run db:setup  # passes

# Stats API
curl -s -b "lf_session=$SESSION" localhost:3848/api/stats | jq '.counts'
# concepts: 5006, authors: 2102

# Graph API
curl -s -b "lf_session=$SESSION" localhost:3848/api/graph/full | jq '.meta'
# totalConcepts: 5006, totalAuthors: 2102

# MCP tools (via Claude Code)
forge_concepts
forge_authors

# Typecheck
npm run typecheck  # passes clean
```

## Final Graph State

| Node Type | Count |
|-----------|-------|
| Chunk | 23,311 |
| Tag | 15,030 |
| Concept | 5,006 |
| Author | 2,102 |
| Link | 2,098 |
| Technology | 1,289 |
| Tool | 1,207 |
| Category | 611 |
| User | 14 |

- **23,311 chunks** across 1,580 links (avg 11.9 chunks/link)
- Chunk generation took ~23 minutes (1,950 links processed)
- `chunk_embedding_idx` VECTOR index active
- RAG queries now use chunk-level search automatically
- New links processed by the bot automatically create Concept/Author/Chunk nodes
