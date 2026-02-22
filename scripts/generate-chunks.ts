/**
 * Backfill Chunk nodes: generate chunk-level embeddings for all existing Links.
 *
 * Usage: npx tsx scripts/generate-chunks.ts
 *
 * - Queries all Links with content
 * - Skips links that already have HAS_CHUNK relationships
 * - Chunks content (500 chars, 50 overlap)
 * - Generates 384-dim embeddings per chunk
 * - Creates Chunk nodes + HAS_CHUNK edges
 * - Processes 10 links at a time
 * - Idempotent — safe to run multiple times
 */

import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import pino from "pino";
import { createEmbeddingService } from "../src/embeddings/index.js";
import { chunkText } from "../src/embeddings/chunker.js";

dotenv.config();

const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";

const BATCH_SIZE = 10;

async function main() {
  console.log("Generating chunk-level embeddings for all links...\n");

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await driver.verifyConnectivity();
  console.log("Neo4j connected");

  // Ensure chunk constraint + vector index exist
  const setupSession = driver.session();
  await setupSession.run(
    "CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS FOR (ch:Chunk) REQUIRE ch.id IS UNIQUE",
  );
  await setupSession.run(
    `CREATE VECTOR INDEX chunk_embedding_idx IF NOT EXISTS
     FOR (ch:Chunk) ON (ch.embedding)
     OPTIONS {indexConfig: {\`vector.dimensions\`: 384, \`vector.similarity_function\`: 'cosine'}}`,
  );
  await setupSession.close();
  console.log("Schema verified");

  // Initialize embedding service
  console.log("Loading embedding model...");
  const logger = pino({ level: "warn" });
  const embeddings = await createEmbeddingService(logger);
  console.log(`Embedding model ready (dimension: ${embeddings.dimension})\n`);

  // Query links that don't yet have chunks
  const querySession = driver.session();
  const result = await querySession.run(
    `MATCH (l:Link)
     WHERE l.content IS NOT NULL AND l.content <> ''
     AND NOT EXISTS { (l)-[:HAS_CHUNK]->(:Chunk) }
     RETURN l.url AS url, l.title AS title, l.description AS description, l.content AS content
     ORDER BY l.savedAt DESC`,
  );
  await querySession.close();

  const totalLinks = result.records.length;
  console.log(`Links to process: ${totalLinks}\n`);

  if (totalLinks === 0) {
    console.log("All links already have chunks. Nothing to do.");
    await driver.close();
    return;
  }

  let processedLinks = 0;
  let totalChunks = 0;
  const startTime = Date.now();

  for (let i = 0; i < totalLinks; i += BATCH_SIZE) {
    const batch = result.records.slice(i, i + BATCH_SIZE);

    for (const record of batch) {
      const url = record.get("url") as string;
      const title = (record.get("title") as string) ?? "";
      const description = (record.get("description") as string) ?? "";
      const content = (record.get("content") as string) ?? "";

      const fullText = `${title}. ${description}. ${content}`;
      const chunks = chunkText(fullText, { chunkSize: 500, overlap: 50 });

      // Only create chunks if document is long enough to produce multiple
      if (chunks.length <= 1) {
        processedLinks++;
        continue;
      }

      const session = driver.session();
      try {
        for (const chunk of chunks) {
          const embedding = await embeddings.embed(chunk.text);
          const chunkId = `${url}#chunk-${chunk.index}`;

          await session.run(
            `MERGE (ch:Chunk {id: $id})
             SET ch.text = $text,
                 ch.index = $index,
                 ch.embedding = $embedding
             WITH ch
             MATCH (l:Link {url: $url})
             MERGE (l)-[:HAS_CHUNK]->(ch)`,
            {
              id: chunkId,
              text: chunk.text,
              index: chunk.index,
              embedding,
              url,
            },
          );
        }
        totalChunks += chunks.length;
      } finally {
        await session.close();
      }

      processedLinks++;
    }

    // Progress logging
    if (processedLinks % 50 === 0 || processedLinks === totalLinks) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processedLinks / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(
        `  [${elapsed}s] ${processedLinks}/${totalLinks} links, ${totalChunks} chunks (${rate} links/sec)`,
      );
    }
  }

  await driver.close();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n--- Chunk Generation Summary ---");
  console.log(`  Links processed: ${processedLinks}`);
  console.log(`  Chunks created: ${totalChunks}`);
  console.log(`  Avg chunks/link: ${(totalChunks / processedLinks).toFixed(1)}`);
  console.log(`  Total time: ${totalTime}s`);
  console.log("Done!");
}

main().catch((err) => {
  console.error("Chunk generation failed:", err);
  process.exit(1);
});
