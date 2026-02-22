# MCP Tools Reference

Link Forge exposes 8 tools via the Model Context Protocol (MCP) using stdio transport. All tools return formatted Markdown text.

## Setup

Add to your project's `.mcp.json`:

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

> **Important**: Run `npm run build` first — the MCP server runs from compiled JS in `dist/`.

## Tools

### `forge_search`

Hybrid vector + keyword search using natural language queries.

**Parameters**:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | yes | — | Natural language search query |
| `limit` | number | no | 10 | Maximum results to return |

**Example call**:
```
forge_search({ query: "reinforcement learning frameworks", limit: 5 })
```

**Response shape**: Markdown list of matching links with titles, URLs, forge scores, content types, categories, and tags.

---

### `forge_categories`

List all categories as a tree with link counts. Shows parent-child hierarchy via SUBCATEGORY_OF relationships.

**Parameters**: None.

**Example call**:
```
forge_categories()
```

**Response shape**: Markdown tree of categories with link counts. Subcategories are indented under parents.

---

### `forge_browse_category`

List all links saved under a specific category, sorted by forge score then save date.

**Parameters**:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `category` | string | yes | — | Category name to browse |
| `limit` | number | no | 20 | Maximum results |

**Example call**:
```
forge_browse_category({ category: "Machine Learning", limit: 10 })
```

**Response shape**: Markdown list of links with titles, URLs, forge scores, and save dates.

---

### `forge_find_tools`

Find tools saved for a specific technology or framework. Falls back to listing all tools if none match the given technology.

**Parameters**:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `technology` | string | yes | — | Technology name to search tools for |

**Example call**:
```
forge_find_tools({ technology: "Python" })
```

**Response shape**: Markdown list of tools with names, descriptions, and URLs.

---

### `forge_related`

Find links related to a specific link by URL. Uses both graph relationships (RELATED_TO edges, shared categories) and vector similarity.

**Parameters**:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `url` | string | yes | — | URL of the link to find related content for |
| `limit` | number | no | 5 | Maximum results |

**Example call**:
```
forge_related({ url: "https://github.com/example/repo", limit: 3 })
```

**Response shape**: Markdown list of related links with titles, URLs, and relationship type (graph or vector).

---

### `forge_recent`

Get the most recently saved links with titles, URLs, categories, and save dates.

**Parameters**:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `limit` | number | no | 10 | Number of recent links (max: 50) |

**Example call**:
```
forge_recent({ limit: 15 })
```

**Response shape**: Markdown list of links ordered by save date descending, with categories and tags.

---

### `forge_concepts`

Browse the concept network. Two modes:

- **Without `concept`**: Lists top concepts by mention count
- **With `concept`**: Shows links for that concept + co-occurring concepts

**Parameters**:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `concept` | string | no | — | Concept to explore (omit to list top concepts) |
| `limit` | number | no | 15 | Maximum results |

**Example calls**:
```
// List top concepts
forge_concepts()

// Explore a specific concept
forge_concepts({ concept: "transformer architecture", limit: 10 })
```

**Response shape**:
- Without concept: Ranked list of concepts with mention counts
- With concept: Links related to the concept + list of co-occurring concepts

---

### `forge_authors`

Find papers by author or list top authors. Two modes:

- **Without `author`**: Lists top authors by mention count
- **With `author`**: Shows their publications + co-authors

**Parameters**:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `author` | string | no | — | Author name to search (omit to list top authors) |
| `limit` | number | no | 15 | Maximum results |

**Example calls**:
```
// List top authors
forge_authors()

// Find papers by author
forge_authors({ author: "Yann LeCun", limit: 10 })
```

**Response shape**:
- Without author: Ranked list of authors with mention counts
- With author: List of publications + co-authors discovered via shared papers
