# Neo4j Graph Schema Reference

Link Forge uses Neo4j 5 Community Edition as its knowledge graph database. This document covers all node types, relationships, indexes, and common queries.

## Topology

```
                    ┌──────────┐
                    │   User   │
                    └────┬─────┘
                         │ SHARED_BY
                         ▼
┌──────────┐  CATEGORIZED_IN  ┌──────────┐  SUBCATEGORY_OF  ┌──────────┐
│ Category │◄─────────────────│   Link   │                  │ Category │
└──────────┘                  └────┬─────┘                  └──────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │              │         │         │              │
     TAGGED_WITH   MENTIONS_TOOL   │   MENTIONS_TECH   RELATED_TO
          │              │         │         │              │
          ▼              ▼         │         ▼              ▼
     ┌─────────┐   ┌──────────┐   │   ┌────────────┐  ┌──────────┐
     │   Tag   │   │   Tool   │   │   │ Technology │  │   Link   │
     └─────────┘   └────┬─────┘   │   └────────────┘  └──────────┘
                        │         │
                   USED_WITH      ├── RELATES_TO_CONCEPT ──▶ ┌─────────┐
                        │         │                          │ Concept │
                        ▼         ├── AUTHORED_BY ──────────▶┌─────────┐
                  ┌────────────┐  │                          │ Author  │
                  │ Technology │  │                          └─────────┘
                  └────────────┘  │
                                  └── HAS_CHUNK ───────────▶ ┌─────────┐
                                                             │  Chunk  │
                                                             └─────────┘
```

## Node Types (9)

### Link

The core node. Represents a URL, document, or academic paper.

| Property | Type | Description |
|----------|------|-------------|
| `url` | string | **UNIQUE**. URL or synthetic `file:///<hash>/<filename>` for documents |
| `title` | string | Page/document title |
| `description` | string | AI-generated summary |
| `content` | string | Extracted text content (5k chars for URLs, 10k for documents) |
| `embedding` | float[384] | all-MiniLM-L6-v2 vector embedding |
| `domain` | string | URL domain (e.g., `github.com`) |
| `savedAt` | string | ISO timestamp |
| `discordMessageId` | string | Source Discord message ID |
| `forgeScore` | float | 0.0–1.0 quality/utility score |
| `contentType` | string | One of: tool, tutorial, pattern, analysis, reference, commentary, research-paper, book, whitepaper, report |
| `purpose` | string | What you'd use this link for |
| `integrationType` | string | One of: cli, library, api, skill, saas, pattern, guide, reference |
| `quality` | string | Quality assessment |
| `keyConcepts` | string[] | Extracted key concepts (documents) |
| `authors` | string[] | Extracted authors (documents/papers) |
| `keyTakeaways` | string[] | Key takeaways (documents) |
| `difficulty` | string | Difficulty level (documents) |

### Category

Hierarchical topic categories. Auto-split when they exceed 20 links.

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | **UNIQUE**. Category name |
| `description` | string | Category description |
| `linkCount` | integer | Number of links in this category |

### Tag

Free-form tags for links.

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | **UNIQUE**. Tag name |

### Technology

Technologies mentioned in links.

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | **UNIQUE**. Technology name |
| `description` | string | Technology description |

### Tool

Specific tools, libraries, or packages mentioned in links.

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | **UNIQUE**. Tool name |
| `description` | string | Tool description |
| `url` | string | Tool homepage/repo URL |

### Concept

Key concepts extracted from links during categorization. Names are lowercase-normalized.

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | **UNIQUE**. Concept name (lowercase) |
| `mentionCount` | integer | Number of links mentioning this concept |

### Author

Authors extracted from documents and academic papers.

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | **UNIQUE**. Author name |
| `mentionCount` | integer | Number of publications by this author |

### Chunk

Text chunks from link content, each with its own embedding for fine-grained RAG retrieval.

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | **UNIQUE**. Format: `${linkUrl}#chunk-${index}` |
| `text` | string | Chunk text content |
| `index` | integer | Position within the parent link's content |
| `embedding` | float[384] | all-MiniLM-L6-v2 vector embedding |

### User

Discord community members who share links.

| Property | Type | Description |
|----------|------|-------------|
| `discordId` | string | **UNIQUE**. Discord user ID |
| `username` | string | Discord username |
| `displayName` | string | Display name |
| `avatarUrl` | string | Avatar URL |
| `interests` | string[] | User-set knowledge interest topics |

## Relationship Types (12)

| Relationship | Source | Target | Properties | Description |
|---|---|---|---|---|
| `CATEGORIZED_IN` | Link | Category | — | Link belongs to this category |
| `TAGGED_WITH` | Link | Tag | — | Link has this tag |
| `MENTIONS_TOOL` | Link | Tool | — | Link mentions/discusses this tool |
| `MENTIONS_TECH` | Link | Technology | — | Link mentions this technology |
| `RELATED_TO` | Link | Link | `score` (float) | Two links are semantically related |
| `SUBCATEGORY_OF` | Category | Category | — | Category hierarchy (child → parent) |
| `USED_WITH` | Tool | Technology | — | Tool is typically used with this tech |
| `SHARED_BY` | Link | User | — | User who shared this link in Discord |
| `LINKS_TO` | Link | Link | — | Link explicitly references another URL |
| `RELATES_TO_CONCEPT` | Link | Concept | — | Link discusses this key concept |
| `AUTHORED_BY` | Link | Author | — | Document/paper authored by this person |
| `HAS_CHUNK` | Link | Chunk | — | Link's content split into this chunk |

## Indexes

### Unique Constraints (9)

```cypher
CREATE CONSTRAINT link_url_unique IF NOT EXISTS FOR (l:Link) REQUIRE l.url IS UNIQUE
CREATE CONSTRAINT category_name_unique IF NOT EXISTS FOR (c:Category) REQUIRE c.name IS UNIQUE
CREATE CONSTRAINT tag_name_unique IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE
CREATE CONSTRAINT technology_name_unique IF NOT EXISTS FOR (tech:Technology) REQUIRE tech.name IS UNIQUE
CREATE CONSTRAINT tool_name_unique IF NOT EXISTS FOR (tool:Tool) REQUIRE tool.name IS UNIQUE
CREATE CONSTRAINT user_discord_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.discordId IS UNIQUE
CREATE CONSTRAINT concept_name_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.name IS UNIQUE
CREATE CONSTRAINT author_name_unique IF NOT EXISTS FOR (a:Author) REQUIRE a.name IS UNIQUE
CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS FOR (ch:Chunk) REQUIRE ch.id IS UNIQUE
```

### Text Indexes (4)

```cypher
CREATE INDEX link_title_idx IF NOT EXISTS FOR (l:Link) ON (l.title)
CREATE INDEX link_description_idx IF NOT EXISTS FOR (l:Link) ON (l.description)
CREATE TEXT INDEX concept_name_text IF NOT EXISTS FOR (c:Concept) ON (c.name)
CREATE TEXT INDEX author_name_text IF NOT EXISTS FOR (a:Author) ON (a.name)
```

### Vector Indexes (2)

Both use 384 dimensions with cosine similarity (all-MiniLM-L6-v2 model).

```cypher
CREATE VECTOR INDEX link_embedding_idx IF NOT EXISTS
FOR (l:Link) ON (l.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}}

CREATE VECTOR INDEX chunk_embedding_idx IF NOT EXISTS
FOR (ch:Chunk) ON (ch.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}}
```

## Example Queries

### Find links about a concept

```cypher
MATCH (c:Concept {name: 'reinforcement learning'})<-[:RELATES_TO_CONCEPT]-(l:Link)
RETURN l.title, l.url, l.forgeScore
ORDER BY l.forgeScore DESC
```

### Search chunks by vector similarity

```cypher
CALL db.index.vector.queryNodes('chunk_embedding_idx', 10, $embedding)
YIELD node AS chunk, score
MATCH (link:Link)-[:HAS_CHUNK]->(chunk)
RETURN link.title, link.url, chunk.text, score
ORDER BY score DESC
```

### Find co-authors

```cypher
MATCH (a:Author {name: 'Yann LeCun'})<-[:AUTHORED_BY]-(l:Link)-[:AUTHORED_BY]->(coauthor:Author)
WHERE coauthor.name <> a.name
RETURN coauthor.name, count(l) AS sharedPapers
ORDER BY sharedPapers DESC
```

### Links shared by a user in a category

```cypher
MATCH (u:User {displayName: 'aaron'})<-[:SHARED_BY]-(l:Link)-[:CATEGORIZED_IN]->(c:Category {name: 'Machine Learning'})
RETURN l.title, l.url, l.forgeScore
ORDER BY l.savedAt DESC
```

### Top concepts with link counts

```cypher
MATCH (c:Concept)<-[:RELATES_TO_CONCEPT]-(l:Link)
RETURN c.name, count(l) AS linkCount
ORDER BY linkCount DESC
LIMIT 20
```

### Concept co-occurrence (concepts that appear together)

```cypher
MATCH (c1:Concept)<-[:RELATES_TO_CONCEPT]-(l:Link)-[:RELATES_TO_CONCEPT]->(c2:Concept)
WHERE c1.name < c2.name
RETURN c1.name, c2.name, count(l) AS coOccurrences
ORDER BY coOccurrences DESC
LIMIT 20
```

### Full graph stats

```cypher
CALL {
  MATCH (l:Link) RETURN 'Links' AS label, count(l) AS count
  UNION ALL
  MATCH (c:Category) RETURN 'Categories' AS label, count(c) AS count
  UNION ALL
  MATCH (c:Concept) RETURN 'Concepts' AS label, count(c) AS count
  UNION ALL
  MATCH (a:Author) RETURN 'Authors' AS label, count(a) AS count
  UNION ALL
  MATCH (ch:Chunk) RETURN 'Chunks' AS label, count(ch) AS count
  UNION ALL
  MATCH (u:User) RETURN 'Users' AS label, count(u) AS count
}
RETURN label, count ORDER BY count DESC
```
