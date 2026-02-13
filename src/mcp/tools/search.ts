import type { Driver } from "neo4j-driver";
import type { EmbeddingService } from "../../embeddings/index.js";
import { hybridSearch } from "../../graph/search.js";

export const forgeSearchTool = {
  name: "forge_search",
  description:
    "Search your saved links using hybrid vector + keyword search. " +
    "Returns relevant links with titles, URLs, summaries, categories, tags, and forge scores. " +
    "Use natural language queries like 'RAG pipelines with Neo4j' or 'best Python testing tools'. " +
    "Use min_forge_score to filter to high-signal, buildable resources (e.g., 0.6 for rich guides+).",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural language search query",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default: 10)",
      },
      min_forge_score: {
        type: "number",
        description: "Minimum forge score filter (0.0-1.0). Only return links at or above this score.",
      },
    },
    required: ["query"],
  },
};

export async function handleForgeSearch(
  args: { query: string; limit?: number; min_forge_score?: number },
  driver: Driver,
  embeddings: EmbeddingService,
): Promise<string> {
  const limit = args.limit ?? 10;
  const minForgeScore = args.min_forge_score ?? 0;
  const embedding = await embeddings.embed(args.query);

  const session = driver.session();
  try {
    let results = await hybridSearch(session, args.query, embedding, limit);

    if (minForgeScore > 0) {
      results = results.filter((r) => (r.link.forgeScore ?? 0) >= minForgeScore);
    }

    if (results.length === 0) {
      return minForgeScore > 0
        ? `No results found with forge score >= ${minForgeScore}. Try lowering the threshold.`
        : "No results found for your query.";
    }

    const formatted = results.map((r, i) => {
      const parts = [
        `${i + 1}. **${r.link.title}**`,
        `   URL: ${r.link.url}`,
        `   ${r.link.description}`,
      ];
      if (r.link.forgeScore != null) parts.push(`   Forge Score: ${r.link.forgeScore.toFixed(2)} | ${r.link.contentType ?? "unknown"}`);
      if (r.link.purpose) parts.push(`   Purpose: ${r.link.purpose}`);
      if (r.categoryName) parts.push(`   Category: ${r.categoryName}`);
      if (r.tags && r.tags.length > 0) parts.push(`   Tags: ${r.tags.join(", ")}`);
      parts.push(`   Score: ${r.score.toFixed(3)} (${r.matchType})`);
      return parts.join("\n");
    });

    return `Found ${results.length} results:\n\n${formatted.join("\n\n")}`;
  } finally {
    await session.close();
  }
}
