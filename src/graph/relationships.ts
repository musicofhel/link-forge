import type { Session } from "neo4j-driver";

export async function categorizeLink(
  session: Session,
  linkUrl: string,
  categoryName: string,
): Promise<void> {
  await session.run(
    `MATCH (l:Link {url: $linkUrl})
     MATCH (c:Category {name: $categoryName})
     MERGE (l)-[:CATEGORIZED_IN]->(c)`,
    { linkUrl, categoryName },
  );
}

export async function tagLink(
  session: Session,
  linkUrl: string,
  tagName: string,
): Promise<void> {
  await session.run(
    `MATCH (l:Link {url: $linkUrl})
     MATCH (t:Tag {name: $tagName})
     MERGE (l)-[:TAGGED_WITH]->(t)`,
    { linkUrl, tagName },
  );
}

export async function linkMentionsTool(
  session: Session,
  linkUrl: string,
  toolName: string,
): Promise<void> {
  await session.run(
    `MATCH (l:Link {url: $linkUrl})
     MATCH (tool:Tool {name: $toolName})
     MERGE (l)-[:MENTIONS_TOOL]->(tool)`,
    { linkUrl, toolName },
  );
}

export async function linkMentionsTech(
  session: Session,
  linkUrl: string,
  techName: string,
): Promise<void> {
  await session.run(
    `MATCH (l:Link {url: $linkUrl})
     MATCH (tech:Technology {name: $techName})
     MERGE (l)-[:MENTIONS_TECH]->(tech)`,
    { linkUrl, techName },
  );
}

export async function relateLinks(
  session: Session,
  url1: string,
  url2: string,
  score: number,
): Promise<void> {
  await session.run(
    `MATCH (l1:Link {url: $url1})
     MATCH (l2:Link {url: $url2})
     MERGE (l1)-[r:RELATED_TO]->(l2)
     SET r.score = $score`,
    { url1, url2, score },
  );
}

export async function addSubcategory(
  session: Session,
  childName: string,
  parentName: string,
): Promise<void> {
  await session.run(
    `MATCH (child:Category {name: $childName})
     MATCH (parent:Category {name: $parentName})
     MERGE (child)-[:SUBCATEGORY_OF]->(parent)`,
    { childName, parentName },
  );
}

export async function linksTo(
  session: Session,
  fromUrl: string,
  toUrl: string,
): Promise<void> {
  await session.run(
    `MATCH (from:Link {url: $fromUrl})
     MATCH (to:Link {url: $toUrl})
     MERGE (from)-[:LINKS_TO]->(to)`,
    { fromUrl, toUrl },
  );
}

export async function sharedBy(
  session: Session,
  linkUrl: string,
  discordUserId: string,
): Promise<void> {
  await session.run(
    `MATCH (l:Link {url: $linkUrl})
     MATCH (u:User {discordId: $discordUserId})
     MERGE (l)-[:SHARED_BY]->(u)`,
    { linkUrl, discordUserId },
  );
}

export async function toolUsedWith(
  session: Session,
  toolName: string,
  techName: string,
): Promise<void> {
  await session.run(
    `MATCH (tool:Tool {name: $toolName})
     MATCH (tech:Technology {name: $techName})
     MERGE (tool)-[:USED_WITH]->(tech)`,
    { toolName, techName },
  );
}
