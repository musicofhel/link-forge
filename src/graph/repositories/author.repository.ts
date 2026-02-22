import type { Session } from "neo4j-driver";
import type { AuthorNode } from "../types.js";

export async function createAuthor(
  session: Session,
  name: string,
): Promise<AuthorNode> {
  const trimmed = name.trim();
  const result = await session.run(
    `MERGE (a:Author {name: $name}) RETURN a`,
    { name: trimmed },
  );

  const record = result.records[0];
  if (!record) {
    throw new Error("Failed to create author node");
  }
  return record.get("a").properties as AuthorNode;
}

export async function linkAuthoredBy(
  session: Session,
  linkUrl: string,
  authorName: string,
): Promise<void> {
  const trimmed = authorName.trim();
  await session.run(
    `MATCH (l:Link {url: $linkUrl})
     MATCH (a:Author {name: $authorName})
     MERGE (l)-[:AUTHORED_BY]->(a)`,
    { linkUrl, authorName: trimmed },
  );
}

export async function findAuthorsByLink(
  session: Session,
  url: string,
): Promise<AuthorNode[]> {
  const result = await session.run(
    `MATCH (l:Link {url: $url})-[:AUTHORED_BY]->(a:Author)
     RETURN a ORDER BY a.name`,
    { url },
  );
  return result.records.map((r) => r.get("a").properties as AuthorNode);
}

export async function findLinksByAuthor(
  session: Session,
  authorName: string,
  limit = 20,
): Promise<{ url: string; title: string; forgeScore: number; contentType: string }[]> {
  const trimmed = authorName.trim();
  const result = await session.run(
    `MATCH (l:Link)-[:AUTHORED_BY]->(a:Author {name: $authorName})
     RETURN l.url AS url, l.title AS title,
            COALESCE(l.forgeScore, 0) AS forgeScore,
            COALESCE(l.contentType, 'reference') AS contentType
     ORDER BY l.forgeScore DESC
     LIMIT $limit`,
    { authorName: trimmed, limit },
  );
  return result.records.map((r) => ({
    url: r.get("url") as string,
    title: r.get("title") as string,
    forgeScore: typeof r.get("forgeScore") === "number" ? r.get("forgeScore") : Number(r.get("forgeScore")),
    contentType: r.get("contentType") as string,
  }));
}

export async function listTopAuthors(
  session: Session,
  limit = 30,
): Promise<{ name: string; mentionCount: number }[]> {
  const result = await session.run(
    `MATCH (a:Author)<-[r:AUTHORED_BY]-()
     WITH a, count(r) AS authored
     ORDER BY authored DESC
     LIMIT $limit
     RETURN a.name AS name, authored AS mentionCount`,
    { limit },
  );
  return result.records.map((r) => ({
    name: r.get("name") as string,
    mentionCount: typeof r.get("mentionCount") === "number" ? r.get("mentionCount") : Number(r.get("mentionCount")),
  }));
}

export async function findCoAuthors(
  session: Session,
  authorName: string,
  limit = 10,
): Promise<{ name: string; sharedLinks: number }[]> {
  const trimmed = authorName.trim();
  const result = await session.run(
    `MATCH (a:Author {name: $authorName})<-[:AUTHORED_BY]-(l:Link)-[:AUTHORED_BY]->(other:Author)
     WHERE other.name <> $authorName
     WITH other, count(l) AS sharedLinks
     ORDER BY sharedLinks DESC
     LIMIT $limit
     RETURN other.name AS name, sharedLinks`,
    { authorName: trimmed, limit },
  );
  return result.records.map((r) => ({
    name: r.get("name") as string,
    sharedLinks: typeof r.get("sharedLinks") === "number" ? r.get("sharedLinks") : Number(r.get("sharedLinks")),
  }));
}
