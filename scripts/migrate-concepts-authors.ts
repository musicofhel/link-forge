/**
 * Backfill Concept and Author nodes from existing Link keyConcepts/authors arrays.
 *
 * Usage: npx tsx scripts/migrate-concepts-authors.ts
 *
 * - Queries all Links with keyConcepts or authors properties
 * - Creates Concept nodes + RELATES_TO_CONCEPT edges
 * - Creates Author nodes + AUTHORED_BY edges
 * - Batched with UNWIND for performance
 * - Idempotent — safe to run multiple times (MERGE on all nodes/edges)
 */

import dotenv from "dotenv";
import neo4j from "neo4j-driver";

dotenv.config();

const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";

async function main() {
  console.log("Migrating concepts and authors to graph nodes...\n");

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await driver.verifyConnectivity();
  console.log("Neo4j connected");

  // Ensure constraints exist
  const setupSession = driver.session();
  await setupSession.run(
    "CREATE CONSTRAINT concept_name_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.name IS UNIQUE",
  );
  await setupSession.run(
    "CREATE CONSTRAINT author_name_unique IF NOT EXISTS FOR (a:Author) REQUIRE a.name IS UNIQUE",
  );
  await setupSession.close();
  console.log("Constraints verified\n");

  // --- Concepts ---
  console.log("=== CONCEPTS ===");
  const conceptSession = driver.session();

  const conceptLinks = await conceptSession.run(
    `MATCH (l:Link) WHERE l.keyConcepts IS NOT NULL AND size(l.keyConcepts) > 0
     RETURN l.url AS url, l.keyConcepts AS concepts`,
  );
  console.log(`Links with concepts: ${conceptLinks.records.length}`);

  let conceptsCreated = 0;
  let conceptEdges = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < conceptLinks.records.length; i += BATCH_SIZE) {
    const batch = conceptLinks.records.slice(i, i + BATCH_SIZE);
    const pairs: { url: string; concept: string }[] = [];

    for (const record of batch) {
      const url = record.get("url") as string;
      const concepts = record.get("concepts") as string[];
      for (const c of concepts) {
        const normalized = c.toLowerCase().trim();
        if (normalized) {
          pairs.push({ url, concept: normalized });
        }
      }
    }

    if (pairs.length === 0) continue;

    // Create concept nodes in batch
    const uniqueConcepts = [...new Set(pairs.map(p => p.concept))];
    await conceptSession.run(
      `UNWIND $names AS name
       MERGE (c:Concept {name: name})`,
      { names: uniqueConcepts },
    );
    conceptsCreated += uniqueConcepts.length;

    // Create edges in batch
    await conceptSession.run(
      `UNWIND $pairs AS pair
       MATCH (l:Link {url: pair.url})
       MATCH (c:Concept {name: pair.concept})
       MERGE (l)-[:RELATES_TO_CONCEPT]->(c)`,
      { pairs },
    );
    conceptEdges += pairs.length;

    if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= conceptLinks.records.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, conceptLinks.records.length)}/${conceptLinks.records.length} links`);
    }
  }

  await conceptSession.close();

  // Deduplicate count (MERGE handles this, but log unique)
  const countSession1 = driver.session();
  const conceptCount = await countSession1.run("MATCH (c:Concept) RETURN count(c) AS count");
  const uniqueConceptCount = Number(conceptCount.records[0]?.get("count") ?? 0);
  await countSession1.close();

  console.log(`  Concept nodes (unique): ${uniqueConceptCount}`);
  console.log(`  RELATES_TO_CONCEPT edges: ${conceptEdges}\n`);

  // --- Authors ---
  console.log("=== AUTHORS ===");
  const authorSession = driver.session();

  const authorLinks = await authorSession.run(
    `MATCH (l:Link) WHERE l.authors IS NOT NULL AND size(l.authors) > 0
     RETURN l.url AS url, l.authors AS authors`,
  );
  console.log(`Links with authors: ${authorLinks.records.length}`);

  let authorEdges = 0;

  for (let i = 0; i < authorLinks.records.length; i += BATCH_SIZE) {
    const batch = authorLinks.records.slice(i, i + BATCH_SIZE);
    const pairs: { url: string; author: string }[] = [];

    for (const record of batch) {
      const url = record.get("url") as string;
      const authors = record.get("authors") as string[];
      for (const a of authors) {
        const trimmed = a.trim();
        if (trimmed) {
          pairs.push({ url, author: trimmed });
        }
      }
    }

    if (pairs.length === 0) continue;

    // Create author nodes in batch
    const uniqueAuthors = [...new Set(pairs.map(p => p.author))];
    await authorSession.run(
      `UNWIND $names AS name
       MERGE (a:Author {name: name})`,
      { names: uniqueAuthors },
    );

    // Create edges in batch
    await authorSession.run(
      `UNWIND $pairs AS pair
       MATCH (l:Link {url: pair.url})
       MATCH (a:Author {name: pair.author})
       MERGE (l)-[:AUTHORED_BY]->(a)`,
      { pairs },
    );
    authorEdges += pairs.length;

    if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= authorLinks.records.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, authorLinks.records.length)}/${authorLinks.records.length} links`);
    }
  }

  await authorSession.close();

  const countSession2 = driver.session();
  const authorCount = await countSession2.run("MATCH (a:Author) RETURN count(a) AS count");
  const uniqueAuthorCount = Number(authorCount.records[0]?.get("count") ?? 0);
  await countSession2.close();

  console.log(`  Author nodes (unique): ${uniqueAuthorCount}`);
  console.log(`  AUTHORED_BY edges: ${authorEdges}\n`);

  await driver.close();

  console.log("--- Migration Summary ---");
  console.log(`  Concept nodes: ${uniqueConceptCount}`);
  console.log(`  Author nodes: ${uniqueAuthorCount}`);
  console.log(`  Total new edges: ${conceptEdges + authorEdges}`);
  console.log("Done!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
