import type { Session } from "neo4j-driver";
import type { LinkNode, SearchResult } from "./types.js";

async function vectorSearch(
  session: Session,
  embedding: number[],
  limit: number,
): Promise<SearchResult[]> {
  const result = await session.run(
    `CALL db.index.vector.queryNodes('link_embedding_idx', $limit, $embedding)
     YIELD node, score
     RETURN node, score`,
    { limit, embedding },
  );

  return result.records.map((record) => ({
    link: record.get("node").properties as LinkNode,
    score: record.get("score") as number,
    matchType: "vector" as const,
  }));
}

async function keywordSearch(
  session: Session,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const result = await session.run(
    `MATCH (l:Link)
     WHERE l.title CONTAINS $query OR l.description CONTAINS $query
     OPTIONAL MATCH (l)-[:CATEGORIZED_IN]->(c:Category)
     OPTIONAL MATCH (l)-[:TAGGED_WITH]->(t:Tag)
     RETURN l, c.name AS categoryName, collect(t.name) AS tags
     LIMIT $limit`,
    { query, limit },
  );

  return result.records.map((record) => ({
    link: record.get("l").properties as LinkNode,
    score: 1.0,
    matchType: "keyword" as const,
    categoryName: (record.get("categoryName") as string | null) ?? undefined,
    tags: record.get("tags") as string[],
  }));
}

export async function hybridSearch(
  session: Session,
  query: string,
  embedding: number[],
  limit = 10,
): Promise<SearchResult[]> {
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(session, embedding, limit),
    keywordSearch(session, query, limit),
  ]);

  // Merge and deduplicate by URL
  const mergedMap = new Map<string, SearchResult>();

  for (const result of vectorResults) {
    mergedMap.set(result.link.url, result);
  }

  for (const result of keywordResults) {
    const existing = mergedMap.get(result.link.url);
    if (existing) {
      // Combine scores: average the vector score and keyword score
      existing.score = (existing.score + result.score) / 2;
      // Preserve category and tags from keyword search
      existing.categoryName = existing.categoryName ?? result.categoryName;
      existing.tags = existing.tags ?? result.tags;
    } else {
      mergedMap.set(result.link.url, result);
    }
  }

  const merged = Array.from(mergedMap.values());

  // Boost search score by forge_score: 70% search relevance + 30% build-usefulness
  for (const result of merged) {
    const forgeScore = result.link.forgeScore ?? 0;
    result.score = result.score * 0.7 + forgeScore * 0.3;
  }

  merged.sort((a, b) => b.score - a.score);

  return merged.slice(0, limit);
}
