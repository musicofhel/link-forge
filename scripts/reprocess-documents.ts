/**
 * Re-categorize all local-file documents using the updated document prompt.
 * Uses content already stored in Neo4j — no need for original files.
 *
 * Usage: npx tsx scripts/reprocess-documents.ts
 */
import { loadConfig } from "../src/config/index.js";
import { createLogger } from "../src/config/logger.js";
import { createGraphClient } from "../src/graph/client.js";
import { createEmbeddingService } from "../src/embeddings/index.js";
import { categorizeWithClaude } from "../src/processor/claude-cli.js";
import type { Driver } from "neo4j-driver";

async function main() {
  const config = loadConfig();
  const logger = createLogger("info", "reprocess");

  logger.info("Connecting to Neo4j...");
  const graphClient = await createGraphClient(
    config.neo4j.uri, config.neo4j.user, config.neo4j.password, logger,
  );

  logger.info("Loading embedding model...");
  const embeddings = await createEmbeddingService(logger);

  await reprocessDocuments(graphClient.driver, embeddings, config.processor.claudeTimeoutMs, logger);

  await graphClient.close();
  logger.info("Done!");
}

async function reprocessDocuments(
  driver: Driver,
  embeddings: { embed(text: string): Promise<number[]> },
  claudeTimeoutMs: number,
  logger: ReturnType<typeof createLogger>,
) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (l:Link) WHERE l.domain = 'local-file'
       RETURN l.url AS url, l.title AS title, l.content AS content, l.description AS desc`,
    );

    logger.info({ count: result.records.length }, "Found documents to reprocess");

    for (const record of result.records) {
      const url = record.get("url") as string;
      const title = record.get("title") as string;
      const content = record.get("content") as string;
      const desc = record.get("desc") as string;

      logger.info({ title }, "Reprocessing...");

      try {
        const categorization = await categorizeWithClaude(
          title, desc, content, url, claudeTimeoutMs, logger, true,
        );

        // Richer embedding with key concepts
        const conceptsStr = categorization.key_concepts.length > 0
          ? `. Key concepts: ${categorization.key_concepts.join(", ")}`
          : "";
        const textForEmbedding = `${title}. ${desc}. ${categorization.summary}${conceptsStr}`;
        const embedding = await embeddings.embed(textForEmbedding);

        // Update the node
        await session.run(
          `MATCH (l:Link {url: $url})
           SET l.description = $description,
               l.forgeScore = $forgeScore,
               l.contentType = $contentType,
               l.purpose = $purpose,
               l.integrationType = $integrationType,
               l.quality = $quality,
               l.keyConcepts = $keyConcepts,
               l.authors = $authors,
               l.keyTakeaways = $keyTakeaways,
               l.difficulty = $difficulty,
               l.embedding = $embedding`,
          {
            url,
            description: categorization.summary,
            forgeScore: categorization.forge_score,
            contentType: categorization.content_type,
            purpose: categorization.purpose,
            integrationType: categorization.integration_type,
            quality: categorization.quality,
            keyConcepts: categorization.key_concepts,
            authors: categorization.authors,
            keyTakeaways: categorization.key_takeaways,
            difficulty: categorization.difficulty,
            embedding,
          },
        );

        // Update tags — clear old ones and add new (including key concepts)
        await session.run(
          `MATCH (l:Link {url: $url})-[r:TAGGED_WITH]->() DELETE r`,
          { url },
        );
        const allTags = [...categorization.tags, ...categorization.key_concepts];
        const uniqueTags = [...new Set(allTags.map(t => t.toLowerCase().replace(/\s+/g, "-")))];
        for (const tag of uniqueTags) {
          await session.run(
            `MERGE (t:Tag {name: $tag})
             WITH t
             MATCH (l:Link {url: $url})
             MERGE (l)-[:TAGGED_WITH]->(t)`,
            { url, tag },
          );
        }

        // Update category
        await session.run(
          `MATCH (l:Link {url: $url})-[r:CATEGORIZED_IN]->() DELETE r`,
          { url },
        );
        await session.run(
          `MERGE (c:Category {name: $category})
           WITH c
           MATCH (l:Link {url: $url})
           MERGE (l)-[:CATEGORIZED_IN]->(c)`,
          { url, category: categorization.category },
        );

        logger.info({
          title,
          score: categorization.forge_score,
          type: categorization.content_type,
          category: categorization.category,
          concepts: categorization.key_concepts.length,
          takeaways: categorization.key_takeaways.length,
          difficulty: categorization.difficulty,
        }, "Reprocessed successfully");
      } catch (err) {
        logger.error({ title, err: err instanceof Error ? err.message : err }, "Failed to reprocess");
      }
    }
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
