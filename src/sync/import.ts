/**
 * Link Forge - Sync Delta Import (v2 — all fixes)
 *
 * FIX #1: Uses `SET l += $props` to write ALL Link properties at once,
 *         instead of listing 10 individual SET assignments. Properties
 *         like forgeScore, contentType, keyConcepts, etc. are no longer
 *         silently dropped during sync.
 *
 * FIX #2: Imports LINKS_TO, SUBCATEGORY_OF, USED_WITH relationships.
 *
 * FIX #5: User interests merge uses pure Cypher (UNWIND + collect DISTINCT)
 *         instead of APOC. Neo4j Community doesn't ship with APOC, so the
 *         v1 fallback path silently dropped interests entirely.
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
  SyncConflict,
} from "./types.js";
import { logSync } from "./logger.js";

interface ImportResult {
  nodesImported: number;
  relationshipsImported: number;
  conflicts: SyncConflict[];
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Strip relationship-derived fields from a Link export object,
 * leaving only properties that belong on the Neo4j node itself.
 */
function extractNodeProps(link: ExportedLink): Record<string, any> {
  const { category, tags, tools, technologies, sharedByDiscordId, ...nodeProps } = link;
  return nodeProps;
}

// ─── Link Import ─────────────────────────────────────────────

async function importLinks(
  session: Session,
  links: ExportedLink[],
  batchSize: number
): Promise<{ imported: number; relsCreated: number; conflicts: SyncConflict[] }> {
  let imported = 0;
  let relsCreated = 0;
  const conflicts: SyncConflict[] = [];

  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    const tx = session.beginTransaction();

    try {
      for (const link of batch) {
        const nodeProps = extractNodeProps(link);

        // Check if link already exists locally with content
        const existing = await tx.run(
          `MATCH (l:Link {url: $url})
           RETURN l.content IS NOT NULL AS hasContent, l.createdAt AS createdAt`,
          { url: link.url }
        );

        if (existing.records.length > 0 && existing.records[0]!.get("hasContent")) {
          // ── First-write-wins: keep local scalars, merge relationship arrays ──
          conflicts.push({
            entityType: "Link",
            dedupKey: link.url,
            resolution: "first-write-wins",
            kept: "local",
            details: "Local link has content; merging relationships only",
          });

          // Merge tags (set-union)
          for (const tagName of link.tags) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (t:Tag {name: $tagName})
               MERGE (l)-[:TAGGED_WITH]->(t)`,
              { url: link.url, tagName }
            );
            relsCreated++;
          }

          // Merge tools
          for (const toolName of link.tools) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (t:Tool {name: $toolName})
               ON CREATE SET t.updatedAt = $now
               MERGE (l)-[:MENTIONS_TOOL]->(t)`,
              { url: link.url, toolName, now: new Date().toISOString() }
            );
            relsCreated++;
          }

          // Merge technologies
          for (const techName of link.technologies) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (t:Technology {name: $techName})
               ON CREATE SET t.updatedAt = $now
               MERGE (l)-[:MENTIONS_TECH]->(t)`,
              { url: link.url, techName, now: new Date().toISOString() }
            );
            relsCreated++;
          }
        } else {
          // ── New link or exists without content: full import ──
          // SET l += $props writes ALL properties in one shot (fix #1)
          await tx.run(
            `MERGE (l:Link {url: $url})
             SET l += $props
             SET l.createdAt = coalesce(l.createdAt, $props.createdAt)
             SET l.originNodeId = coalesce(l.originNodeId, $props.originNodeId)`,
            { url: link.url, props: nodeProps }
          );

          // Category
          if (link.category) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (c:Category {name: $category})
               ON CREATE SET c.updatedAt = $now
               MERGE (l)-[:CATEGORIZED_IN]->(c)`,
              { url: link.url, category: link.category, now: new Date().toISOString() }
            );
            relsCreated++;
          }

          // Tags
          for (const tagName of link.tags) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (t:Tag {name: $tagName})
               MERGE (l)-[:TAGGED_WITH]->(t)`,
              { url: link.url, tagName }
            );
            relsCreated++;
          }

          // Tools
          for (const toolName of link.tools) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (t:Tool {name: $toolName})
               ON CREATE SET t.updatedAt = $now
               MERGE (l)-[:MENTIONS_TOOL]->(t)`,
              { url: link.url, toolName, now: new Date().toISOString() }
            );
            relsCreated++;
          }

          // Technologies
          for (const techName of link.technologies) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (t:Technology {name: $techName})
               ON CREATE SET t.updatedAt = $now
               MERGE (l)-[:MENTIONS_TECH]->(t)`,
              { url: link.url, techName, now: new Date().toISOString() }
            );
            relsCreated++;
          }

          // User
          if (link.sharedByDiscordId) {
            await tx.run(
              `MATCH (l:Link {url: $url})
               MERGE (u:User {discordId: $discordId})
               ON CREATE SET u.updatedAt = $now
               MERGE (l)-[:SHARED_BY]->(u)`,
              { url: link.url, discordId: link.sharedByDiscordId, now: new Date().toISOString() }
            );
            relsCreated++;
          }

          imported++;
        }
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  return { imported, relsCreated, conflicts };
}

// ─── Category Import ─────────────────────────────────────────

async function importCategories(session: Session, categories: ExportedCategory[]): Promise<number> {
  let imported = 0;
  for (const cat of categories) {
    const { name, ...otherProps } = cat;
    await session.run(
      `MERGE (c:Category {name: $name})
       ON CREATE SET c += $props
       ON MATCH SET c.description = CASE
         WHEN c.description IS NULL THEN $props.description
         ELSE c.description
       END`,
      { name, props: otherProps }
    );
    imported++;
  }
  return imported;
}

// ─── Tool Import ─────────────────────────────────────────────

async function importTools(session: Session, tools: ExportedTool[]): Promise<{ imported: number; conflicts: SyncConflict[] }> {
  let imported = 0;
  const conflicts: SyncConflict[] = [];

  for (const tool of tools) {
    const { name, ...otherProps } = tool;
    const result = await session.run(
      `MERGE (t:Tool {name: $name})
       ON CREATE SET t += $props
       ON MATCH SET
         t.description = CASE WHEN $props.updatedAt > coalesce(t.updatedAt, '') THEN $props.description ELSE t.description END,
         t.updatedAt = CASE WHEN $props.updatedAt > coalesce(t.updatedAt, '') THEN $props.updatedAt ELSE t.updatedAt END
       RETURN t.updatedAt = $props.updatedAt AS wasUpdated`,
      { name, props: otherProps }
    );

    if (result.records[0]?.get("wasUpdated") === false) {
      conflicts.push({ entityType: "Tool", dedupKey: tool.name, resolution: "last-write-wins", kept: "local" });
    }
    imported++;
  }

  return { imported, conflicts };
}

// ─── Technology Import ───────────────────────────────────────

async function importTechnologies(session: Session, technologies: ExportedTechnology[]): Promise<{ imported: number; conflicts: SyncConflict[] }> {
  let imported = 0;
  const conflicts: SyncConflict[] = [];

  for (const tech of technologies) {
    const { name, ...otherProps } = tech;
    const result = await session.run(
      `MERGE (t:Technology {name: $name})
       ON CREATE SET t += $props
       ON MATCH SET
         t.description = CASE WHEN $props.updatedAt > coalesce(t.updatedAt, '') THEN $props.description ELSE t.description END,
         t.updatedAt = CASE WHEN $props.updatedAt > coalesce(t.updatedAt, '') THEN $props.updatedAt ELSE t.updatedAt END
       RETURN t.updatedAt = $props.updatedAt AS wasUpdated`,
      { name, props: otherProps }
    );

    if (result.records[0]?.get("wasUpdated") === false) {
      conflicts.push({ entityType: "Technology", dedupKey: tech.name, resolution: "last-write-wins", kept: "local" });
    }
    imported++;
  }

  return { imported, conflicts };
}

// ─── User Import ─────────────────────────────────────────────

/**
 * FIX #5: Pure Cypher set-union for interests. The v1 code used
 * apoc.coll.toSet() which isn't available in Neo4j Community.
 * The fallback silently dropped interests entirely.
 *
 * This version uses UNWIND + collect(DISTINCT) — works everywhere.
 */
async function importUsers(session: Session, users: ExportedUser[]): Promise<number> {
  let imported = 0;
  for (const user of users) {
    await session.run(
      `MERGE (u:User {discordId: $discordId})
       ON CREATE SET u.username = $username, u.interests = $interests, u.updatedAt = $updatedAt
       ON MATCH SET
         u.username = coalesce($username, u.username),
         u.updatedAt = CASE WHEN $updatedAt > coalesce(u.updatedAt, '') THEN $updatedAt ELSE u.updatedAt END
       WITH u, $interests AS newInterests
       WITH u, coalesce(u.interests, []) + coalesce(newInterests, []) AS combined
       UNWIND combined AS item
       WITH u, collect(DISTINCT item) AS merged
       SET u.interests = merged`,
      {
        discordId: user.discordId,
        username: user.username || null,
        interests: user.interests,
        updatedAt: user.updatedAt,
      }
    );
    imported++;
  }
  return imported;
}

// ─── Relationship Imports ────────────────────────────────────

async function importRelatedLinks(session: Session, relatedLinks: ExportedRelatedLink[]): Promise<number> {
  let imported = 0;
  for (const rel of relatedLinks) {
    await session.run(
      `MATCH (a:Link {url: $fromUrl}), (b:Link {url: $toUrl})
       MERGE (a)-[r:RELATED_TO]->(b)
       ON CREATE SET r.score = $score
       ON MATCH SET r.score = CASE WHEN $score > r.score THEN $score ELSE r.score END`,
      { fromUrl: rel.fromUrl, toUrl: rel.toUrl, score: rel.score }
    );
    imported++;
  }
  return imported;
}

/**
 * FIX #2: Import LINKS_TO relationships (discovered URLs).
 */
async function importLinksToEdges(session: Session, edges: ExportedLinksToEdge[]): Promise<number> {
  let imported = 0;
  for (const edge of edges) {
    await session.run(
      `MATCH (a:Link {url: $fromUrl}), (b:Link {url: $toUrl})
       MERGE (a)-[r:LINKS_TO]->(b)
       SET r += $props`,
      { fromUrl: edge.fromUrl, toUrl: edge.toUrl, props: edge.props }
    );
    imported++;
  }
  return imported;
}

/**
 * FIX #2: Import SUBCATEGORY_OF relationships (category hierarchy).
 */
async function importSubcategoryEdges(session: Session, edges: ExportedSubcategoryEdge[]): Promise<number> {
  let imported = 0;
  for (const edge of edges) {
    await session.run(
      `MATCH (child:Category {name: $childName}), (parent:Category {name: $parentName})
       MERGE (child)-[:SUBCATEGORY_OF]->(parent)`,
      { childName: edge.childName, parentName: edge.parentName }
    );
    imported++;
  }
  return imported;
}

/**
 * FIX #2: Import USED_WITH relationships (tool ↔ technology).
 */
async function importUsedWithEdges(session: Session, edges: ExportedUsedWithEdge[]): Promise<number> {
  let imported = 0;
  for (const edge of edges) {
    await session.run(
      `MATCH (t:Tool {name: $toolName}), (tech:Technology {name: $techName})
       MERGE (t)-[r:USED_WITH]->(tech)
       SET r += $props`,
      { toolName: edge.toolName, techName: edge.techName, props: edge.props }
    );
    imported++;
  }
  return imported;
}

// ─── Recount ─────────────────────────────────────────────────

async function recountCategoryLinkCounts(session: Session): Promise<void> {
  await session.run(
    `MATCH (c:Category)
     OPTIONAL MATCH (c)<-[:CATEGORIZED_IN]-(l:Link)
     WITH c, count(l) AS cnt
     SET c.linkCount = cnt`
  );
}

// ─── Main Import ─────────────────────────────────────────────

export async function importDelta(
  driver: Driver,
  delta: DeltaExport,
  batchSize: number
): Promise<ImportResult> {
  const session = driver.session();
  const allConflicts: SyncConflict[] = [];
  let totalNodes = 0;
  let totalRels = 0;

  try {
    logSync(
      "INFO",
      "sync:import",
      `Importing: ${delta.links.length} links, ${delta.categories.length} cats, ` +
        `${delta.tools.length} tools, ${delta.technologies.length} techs, ${delta.users.length} users...`
    );

    // Import in dependency order: supporting nodes → links → edges

    // 1. Categories
    totalNodes += await importCategories(session, delta.categories);

    // 2. Tools
    const toolResult = await importTools(session, delta.tools);
    totalNodes += toolResult.imported;
    allConflicts.push(...toolResult.conflicts);

    // 3. Technologies
    const techResult = await importTechnologies(session, delta.technologies);
    totalNodes += techResult.imported;
    allConflicts.push(...techResult.conflicts);

    // 4. Users (pure Cypher interests merge — no APOC dependency)
    totalNodes += await importUsers(session, delta.users);

    // 5. Links (batched, with all properties via SET +=)
    const linkResult = await importLinks(session, delta.links, batchSize);
    totalNodes += linkResult.imported;
    totalRels += linkResult.relsCreated;
    allConflicts.push(...linkResult.conflicts);

    // 6. RELATED_TO edges
    totalRels += await importRelatedLinks(session, delta.relatedLinks);

    // 7. LINKS_TO edges (fix #2)
    totalRels += await importLinksToEdges(session, delta.linksToEdges);

    // 8. SUBCATEGORY_OF edges (fix #2)
    totalRels += await importSubcategoryEdges(session, delta.subcategoryEdges);

    // 9. USED_WITH edges (fix #2)
    totalRels += await importUsedWithEdges(session, delta.usedWithEdges);

    // 10. Recount category link counts
    await recountCategoryLinkCounts(session);

    logSync("INFO", "sync:import", `Import complete: ${totalNodes} nodes, ${totalRels} rels, ${allConflicts.length} conflicts`);

    return { nodesImported: totalNodes, relationshipsImported: totalRels, conflicts: allConflicts };
  } finally {
    await session.close();
  }
}
