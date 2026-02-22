import type { Session } from "neo4j-driver";

export interface CreateChunkInput {
  id: string;
  text: string;
  index: number;
  embedding: number[];
  linkUrl: string;
}

export async function createChunk(
  session: Session,
  input: CreateChunkInput,
): Promise<void> {
  await session.run(
    `MERGE (ch:Chunk {id: $id})
     SET ch.text = $text,
         ch.index = $index,
         ch.embedding = $embedding
     WITH ch
     MATCH (l:Link {url: $linkUrl})
     MERGE (l)-[:HAS_CHUNK]->(ch)`,
    {
      id: input.id,
      text: input.text,
      index: input.index,
      embedding: input.embedding,
      linkUrl: input.linkUrl,
    },
  );
}

export async function findChunksByLink(
  session: Session,
  url: string,
): Promise<{ id: string; text: string; index: number }[]> {
  const result = await session.run(
    `MATCH (l:Link {url: $url})-[:HAS_CHUNK]->(ch:Chunk)
     RETURN ch.id AS id, ch.text AS text, ch.index AS idx
     ORDER BY ch.index`,
    { url },
  );
  return result.records.map((r) => ({
    id: r.get("id") as string,
    text: r.get("text") as string,
    index: typeof r.get("idx") === "number" ? r.get("idx") : Number(r.get("idx")),
  }));
}

export async function vectorSearchChunks(
  session: Session,
  embedding: number[],
  limit = 40,
): Promise<{
  chunkText: string;
  chunkScore: number;
  linkUrl: string;
  linkTitle: string;
  forgeScore: number;
  contentType: string;
}[]> {
  const result = await session.run(
    `CALL db.index.vector.queryNodes('chunk_embedding_idx', $limit, $embedding)
     YIELD node AS chunk, score
     MATCH (link:Link)-[:HAS_CHUNK]->(chunk)
     RETURN link.url AS linkUrl, link.title AS linkTitle,
            COALESCE(link.forgeScore, 0) AS forgeScore,
            COALESCE(link.contentType, 'reference') AS contentType,
            chunk.text AS chunkText, score AS chunkScore
     ORDER BY score DESC`,
    { embedding, limit },
  );
  return result.records.map((r) => ({
    chunkText: r.get("chunkText") as string,
    chunkScore: typeof r.get("chunkScore") === "number" ? r.get("chunkScore") : Number(r.get("chunkScore")),
    linkUrl: r.get("linkUrl") as string,
    linkTitle: r.get("linkTitle") as string,
    forgeScore: typeof r.get("forgeScore") === "number" ? r.get("forgeScore") : Number(r.get("forgeScore")),
    contentType: r.get("contentType") as string,
  }));
}

export async function deleteChunksForLink(
  session: Session,
  url: string,
): Promise<number> {
  const result = await session.run(
    `MATCH (l:Link {url: $url})-[:HAS_CHUNK]->(ch:Chunk)
     DETACH DELETE ch
     RETURN count(ch) AS deleted`,
    { url },
  );
  const val = result.records[0]?.get("deleted");
  return typeof val === "number" ? val : Number(val ?? 0);
}

export async function linkHasChunks(
  session: Session,
  url: string,
): Promise<boolean> {
  const result = await session.run(
    `MATCH (l:Link {url: $url})-[:HAS_CHUNK]->(:Chunk)
     RETURN count(*) > 0 AS hasChunks`,
    { url },
  );
  return result.records[0]?.get("hasChunks") === true;
}
