/**
 * Link Forge - Sync Delta Export (v2 — all fixes)
 *
 * FIX #1: Uses `l { .* }` to export ALL Link properties, not a fixed
 *         list of 10. forgeScore, contentType, purpose, domain, etc.
 *         are now captured automatically.
 * FIX #2: Exports LINKS_TO, SUBCATEGORY_OF, USED_WITH relationships.
 * FIX #3: getNodeCounts uses `count {}` subqueries so it returns
 *         correct results even when some labels have zero nodes.
 */

import type { Driver, Session } from "neo4j-driver";
import type {
  DeltaExport,
  ExportedLink,
  ExportedCategory,
  ExportedTool,
  ExportedTechnology,
  ExportedUser,
  ExportedRelatedLink,
  ExportedLinksToEdge,
  ExportedSubcategoryEdge,
  ExportedUsedWithEdge,
} from "./types.js";
import { logSync } from "./logger.js";

// ─── Node Exports ────────────────────────────────────────────

async function exportLinks(session: Session, since: string): Promise<ExportedLink[]> {
  const result = await session.run(
    `MATCH (l:Link) WHERE l.updatedAt > $since
     OPTIONAL MATCH (l)-[:CATEGORIZED_IN]->(c:Category)
     OPTIONAL MATCH (l)-[:TAGGED_WITH]->(t:Tag)
     OPTIONAL MATCH (l)-[:MENTIONS_TOOL]->(tool:Tool)
     OPTIONAL MATCH (l)-[:MENTIONS_TECH]->(tech:Technology)
     OPTIONAL MATCH (l)-[:SHARED_BY]->(u:User)
     RETURN l { .* } AS link,
     c.name AS category,
     collect(DISTINCT t.name) AS tags,
     collect(DISTINCT tool.name) AS tools,
     collect(DISTINCT tech.name) AS technologies,
     u.discordId AS sharedByDiscordId
     ORDER BY l.updatedAt ASC`,
    { since }
  );

  return result.records.map((r) => ({
    ...r.get("link"),
    category: r.get("category"),
    tags: r.get("tags").filter(Boolean),
    tools: r.get("tools").filter(Boolean),
    technologies: r.get("technologies").filter(Boolean),
    sharedByDiscordId: r.get("sharedByDiscordId"),
  }));
}

async function exportCategories(session: Session, since: string): Promise<ExportedCategory[]> {
  const result = await session.run(
    `MATCH (c:Category) WHERE c.updatedAt > $since
     RETURN c { .* } AS cat ORDER BY c.updatedAt ASC`,
    { since }
  );
  return result.records.map((r) => r.get("cat"));
}

async function exportTools(session: Session, since: string): Promise<ExportedTool[]> {
  const result = await session.run(
    `MATCH (t:Tool) WHERE t.updatedAt > $since
     RETURN t { .* } AS tool ORDER BY t.updatedAt ASC`,
    { since }
  );
  return result.records.map((r) => r.get("tool"));
}

async function exportTechnologies(session: Session, since: string): Promise<ExportedTechnology[]> {
  const result = await session.run(
    `MATCH (t:Technology) WHERE t.updatedAt > $since
     RETURN t { .* } AS tech ORDER BY t.updatedAt ASC`,
    { since }
  );
  return result.records.map((r) => r.get("tech"));
}

async function exportUsers(session: Session, since: string): Promise<ExportedUser[]> {
  const result = await session.run(
    `MATCH (u:User) WHERE u.updatedAt > $since
     RETURN u { .* } AS user ORDER BY u.updatedAt ASC`,
    { since }
  );
  return result.records.map((r) => {
    const u = r.get("user");
    return { ...u, interests: u.interests || [] };
  });
}

// ─── Relationship Exports ────────────────────────────────────

async function exportRelatedLinks(session: Session, since: string): Promise<ExportedRelatedLink[]> {
  const result = await session.run(
    `MATCH (a:Link)-[r:RELATED_TO]->(b:Link)
     WHERE a.updatedAt > $since OR b.updatedAt > $since
     RETURN a.url AS fromUrl, b.url AS toUrl, r.score AS score`,
    { since }
  );
  return result.records.map((r) => ({
    fromUrl: r.get("fromUrl"),
    toUrl: r.get("toUrl"),
    score: r.get("score"),
  }));
}

async function exportLinksToEdges(session: Session, since: string): Promise<ExportedLinksToEdge[]> {
  const result = await session.run(
    `MATCH (a:Link)-[r:LINKS_TO]->(b:Link)
     WHERE a.updatedAt > $since OR b.updatedAt > $since
     RETURN a.url AS fromUrl, b.url AS toUrl, r { .* } AS props`,
    { since }
  );
  return result.records.map((r) => ({
    fromUrl: r.get("fromUrl"),
    toUrl: r.get("toUrl"),
    props: r.get("props") || {},
  }));
}

async function exportSubcategoryEdges(session: Session, since: string): Promise<ExportedSubcategoryEdge[]> {
  const result = await session.run(
    `MATCH (child:Category)-[r:SUBCATEGORY_OF]->(parent:Category)
     WHERE child.updatedAt > $since OR parent.updatedAt > $since
     RETURN child.name AS childName, parent.name AS parentName`,
    { since }
  );
  return result.records.map((r) => ({
    childName: r.get("childName"),
    parentName: r.get("parentName"),
  }));
}

async function exportUsedWithEdges(session: Session, since: string): Promise<ExportedUsedWithEdge[]> {
  const result = await session.run(
    `MATCH (t:Tool)-[r:USED_WITH]->(tech:Technology)
     WHERE t.updatedAt > $since OR tech.updatedAt > $since
     RETURN t.name AS toolName, tech.name AS techName, r { .* } AS props`,
    { since }
  );
  return result.records.map((r) => ({
    toolName: r.get("toolName"),
    techName: r.get("techName"),
    props: r.get("props") || {},
  }));
}

// ─── Node Counts ─────────────────────────────────────────────

/**
 * FIX #3: Uses count{} subqueries. The v1 version chained MATCH
 * clauses, which returns zero rows if ANY label has zero nodes.
 * count{} is a Neo4j 5+ feature that returns 0 for empty labels.
 */
export async function getNodeCounts(driver: Driver): Promise<Record<string, number>> {
  const session = driver.session();
  try {
    const result = await session.run(
      `RETURN
         count { (l:Link) } AS links,
         count { (c:Category) } AS categories,
         count { (t:Tag) } AS tags,
         count { (tool:Tool) } AS tools,
         count { (tech:Technology) } AS technologies,
         count { (u:User) } AS users`
    );
    if (result.records.length === 0) {
      return { links: 0, categories: 0, tags: 0, tools: 0, technologies: 0, users: 0 };
    }
    const r = result.records[0]!;
    const toNum = (v: any) => (typeof v?.toNumber === "function" ? v.toNumber() : Number(v) || 0);
    return {
      links: toNum(r.get("links")),
      categories: toNum(r.get("categories")),
      tags: toNum(r.get("tags")),
      tools: toNum(r.get("tools")),
      technologies: toNum(r.get("technologies")),
      users: toNum(r.get("users")),
    };
  } finally {
    await session.close();
  }
}

// ─── Main Export ─────────────────────────────────────────────

export async function exportDelta(
  driver: Driver,
  sourceNodeId: string,
  since: string
): Promise<DeltaExport> {
  const session = driver.session();
  try {
    logSync("INFO", "sync:export", `Exporting delta since ${since}...`);

    const [links, categories, tools, technologies, users, relatedLinks, linksToEdges, subcategoryEdges, usedWithEdges] =
      await Promise.all([
        exportLinks(session, since),
        exportCategories(session, since),
        exportTools(session, since),
        exportTechnologies(session, since),
        exportUsers(session, since),
        exportRelatedLinks(session, since),
        exportLinksToEdges(session, since),
        exportSubcategoryEdges(session, since),
        exportUsedWithEdges(session, since),
      ]);

    const delta: DeltaExport = {
      exportedAt: new Date().toISOString(),
      sourceNodeId,
      since,
      links,
      categories,
      tools,
      technologies,
      users,
      relatedLinks,
      linksToEdges,
      subcategoryEdges,
      usedWithEdges,
    };

    logSync(
      "INFO",
      "sync:export",
      `Export: ${links.length} links, ${categories.length} cats, ${tools.length} tools, ` +
        `${technologies.length} techs, ${users.length} users, ${relatedLinks.length} related, ` +
        `${linksToEdges.length} links_to, ${subcategoryEdges.length} subcats, ${usedWithEdges.length} used_with`
    );

    return delta;
  } finally {
    await session.close();
  }
}
