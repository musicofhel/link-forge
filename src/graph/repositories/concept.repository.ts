import type { Session } from "neo4j-driver";
import type { ConceptNode } from "../types.js";

export async function createConcept(
  session: Session,
  name: string,
): Promise<ConceptNode> {
  const normalized = name.toLowerCase().trim();
  const result = await session.run(
    `MERGE (c:Concept {name: $name}) RETURN c`,
    { name: normalized },
  );

  const record = result.records[0];
  if (!record) {
    throw new Error("Failed to create concept node");
  }
  return record.get("c").properties as ConceptNode;
}

export async function linkRelatesToConcept(
  session: Session,
  linkUrl: string,
  conceptName: string,
): Promise<void> {
  const normalized = conceptName.toLowerCase().trim();
  await session.run(
    `MATCH (l:Link {url: $linkUrl})
     MATCH (c:Concept {name: $conceptName})
     MERGE (l)-[:RELATES_TO_CONCEPT]->(c)`,
    { linkUrl, conceptName: normalized },
  );
}

export async function findConceptsByLink(
  session: Session,
  url: string,
): Promise<ConceptNode[]> {
  const result = await session.run(
    `MATCH (l:Link {url: $url})-[:RELATES_TO_CONCEPT]->(c:Concept)
     RETURN c ORDER BY c.name`,
    { url },
  );
  return result.records.map((r) => r.get("c").properties as ConceptNode);
}

export async function findLinksByConcept(
  session: Session,
  conceptName: string,
  limit = 20,
): Promise<{ url: string; title: string; forgeScore: number; contentType: string }[]> {
  const normalized = conceptName.toLowerCase().trim();
  const result = await session.run(
    `MATCH (l:Link)-[:RELATES_TO_CONCEPT]->(c:Concept {name: $conceptName})
     RETURN l.url AS url, l.title AS title,
            COALESCE(l.forgeScore, 0) AS forgeScore,
            COALESCE(l.contentType, 'reference') AS contentType
     ORDER BY l.forgeScore DESC
     LIMIT $limit`,
    { conceptName: normalized, limit },
  );
  return result.records.map((r) => ({
    url: r.get("url") as string,
    title: r.get("title") as string,
    forgeScore: typeof r.get("forgeScore") === "number" ? r.get("forgeScore") : Number(r.get("forgeScore")),
    contentType: r.get("contentType") as string,
  }));
}

export async function listTopConcepts(
  session: Session,
  limit = 30,
): Promise<{ name: string; mentionCount: number }[]> {
  const result = await session.run(
    `MATCH (c:Concept)<-[r:RELATES_TO_CONCEPT]-()
     WITH c, count(r) AS mentions
     ORDER BY mentions DESC
     LIMIT $limit
     RETURN c.name AS name, mentions AS mentionCount`,
    { limit },
  );
  return result.records.map((r) => ({
    name: r.get("name") as string,
    mentionCount: typeof r.get("mentionCount") === "number" ? r.get("mentionCount") : Number(r.get("mentionCount")),
  }));
}

export async function findRelatedConcepts(
  session: Session,
  conceptName: string,
  limit = 10,
): Promise<{ name: string; coOccurrences: number }[]> {
  const normalized = conceptName.toLowerCase().trim();
  const result = await session.run(
    `MATCH (c:Concept {name: $conceptName})<-[:RELATES_TO_CONCEPT]-(l:Link)-[:RELATES_TO_CONCEPT]->(other:Concept)
     WHERE other.name <> $conceptName
     WITH other, count(l) AS coOccurrences
     ORDER BY coOccurrences DESC
     LIMIT $limit
     RETURN other.name AS name, coOccurrences`,
    { conceptName: normalized, limit },
  );
  return result.records.map((r) => ({
    name: r.get("name") as string,
    coOccurrences: typeof r.get("coOccurrences") === "number" ? r.get("coOccurrences") : Number(r.get("coOccurrences")),
  }));
}
