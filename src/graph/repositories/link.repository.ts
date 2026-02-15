import type { Session } from "neo4j-driver";
import type { LinkNode } from "../types.js";

export async function createLink(
  session: Session,
  link: LinkNode,
): Promise<LinkNode> {
  const result = await session.run(
    `MERGE (l:Link {url: $url})
     SET l.title = $title,
         l.description = $description,
         l.content = $content,
         l.embedding = $embedding,
         l.domain = $domain,
         l.savedAt = $savedAt,
         l.discordMessageId = $discordMessageId,
         l.forgeScore = $forgeScore,
         l.contentType = $contentType,
         l.purpose = $purpose,
         l.integrationType = $integrationType,
         l.quality = $quality,
         l.keyConcepts = $keyConcepts,
         l.authors = $authors,
         l.keyTakeaways = $keyTakeaways,
         l.difficulty = $difficulty
     RETURN l`,
    {
      url: link.url,
      title: link.title,
      description: link.description,
      content: link.content,
      embedding: link.embedding,
      domain: link.domain,
      savedAt: link.savedAt,
      discordMessageId: link.discordMessageId,
      forgeScore: link.forgeScore,
      contentType: link.contentType,
      purpose: link.purpose,
      integrationType: link.integrationType,
      quality: link.quality,
      keyConcepts: link.keyConcepts ?? [],
      authors: link.authors ?? [],
      keyTakeaways: link.keyTakeaways ?? [],
      difficulty: link.difficulty ?? "",
    },
  );

  const record = result.records[0];
  if (!record) {
    throw new Error("Failed to create link node");
  }
  const node = record.get("l");
  return node.properties as LinkNode;
}

export async function updateLinkMetadata(
  session: Session,
  url: string,
  metadata: {
    forgeScore: number;
    contentType: string;
    purpose: string;
    integrationType: string;
    quality: string;
    description?: string;
  },
): Promise<void> {
  await session.run(
    `MATCH (l:Link {url: $url})
     SET l.forgeScore = $forgeScore,
         l.contentType = $contentType,
         l.purpose = $purpose,
         l.integrationType = $integrationType,
         l.quality = $quality
     ${metadata.description ? ", l.description = $description" : ""}`,
    {
      url,
      forgeScore: metadata.forgeScore,
      contentType: metadata.contentType,
      purpose: metadata.purpose,
      integrationType: metadata.integrationType,
      quality: metadata.quality,
      ...(metadata.description ? { description: metadata.description } : {}),
    },
  );
}

export async function findLinkByUrl(
  session: Session,
  url: string,
): Promise<LinkNode | null> {
  const result = await session.run(
    `MATCH (l:Link {url: $url}) RETURN l`,
    { url },
  );

  const record = result.records[0];
  if (!record) {
    return null;
  }
  return record.get("l").properties as LinkNode;
}

export async function findLinksByDomain(
  session: Session,
  domain: string,
  limit = 50,
): Promise<LinkNode[]> {
  const result = await session.run(
    `MATCH (l:Link {domain: $domain})
     RETURN l
     ORDER BY l.savedAt DESC
     LIMIT $limit`,
    { domain, limit },
  );

  return result.records.map((record) => record.get("l").properties as LinkNode);
}

export async function deleteLinkByUrl(
  session: Session,
  url: string,
): Promise<void> {
  await session.run(
    `MATCH (l:Link {url: $url}) DETACH DELETE l`,
    { url },
  );
}

export async function linkExists(
  session: Session,
  url: string,
): Promise<boolean> {
  const result = await session.run(
    `MATCH (l:Link {url: $url}) RETURN count(l) > 0 AS exists`,
    { url },
  );
  const record = result.records[0];
  return record ? record.get("exists") === true : false;
}

export async function countLinks(session: Session): Promise<number> {
  const result = await session.run(`MATCH (l:Link) RETURN count(l) AS count`);

  const record = result.records[0];
  if (!record) {
    return 0;
  }

  const count = record.get("count");
  // neo4j-driver may return an Integer object
  return typeof count === "number" ? count : Number(count);
}
