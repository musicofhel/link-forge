/**
 * Re-categorize URL-based links using the updated URL prompt.
 * Uses content already stored in Neo4j — no re-scraping needed.
 * Processes in batches with configurable concurrency.
 *
 * Usage: npx tsx scripts/reprocess-urls.ts [--batch-size 10] [--skip N] [--dry-run]
 */
import { loadConfig } from "../src/config/index.js";
import { createLogger } from "../src/config/logger.js";
import { createGraphClient } from "../src/graph/client.js";
import { createEmbeddingService } from "../src/embeddings/index.js";
import { categorizeWithClaude } from "../src/processor/claude-cli.js";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";

async function main() {
  const args = process.argv.slice(2);
  const batchSize = getArg(args, "--batch-size", 10);
  const skip = getArg(args, "--skip", 0);
  const limit = getArg(args, "--limit", 0); // 0 = no limit
  const dryRun = args.includes("--dry-run");

  const config = loadConfig();
  const workerId = skip > 0 ? `worker-${skip}` : "reprocess-urls";
  const logger = createLogger("info", workerId);

  logger.info({ batchSize, skip, limit, dryRun }, "Starting URL reprocessing");

  const graphClient = await createGraphClient(
    config.neo4j.uri, config.neo4j.user, config.neo4j.password, logger,
  );

  const embeddings = await createEmbeddingService(logger);

  await reprocessUrls(graphClient.driver, embeddings, config.processor.claudeTimeoutMs, logger, batchSize, skip, limit, dryRun);

  await graphClient.close();
  logger.info("Done!");
}

function getArg(args: string[], flag: string, defaultVal: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return parseInt(args[idx + 1]!, 10) || defaultVal;
}

async function reprocessUrls(
  driver: Driver,
  embeddings: { embed(text: string): Promise<number[]> },
  claudeTimeoutMs: number,
  logger: ReturnType<typeof createLogger>,
  batchSize: number,
  skip: number,
  limit: number,
  dryRun: boolean,
) {
  const session = driver.session();
  try {
    const cypher = `MATCH (l:Link)
       WHERE l.domain <> 'local-file' AND l.content IS NOT NULL
       RETURN l.url AS url, l.title AS title, l.content AS content,
              l.description AS desc, l.domain AS domain,
              l.forgeScore AS oldScore, l.contentType AS oldType
       ORDER BY l.savedAt ASC
       SKIP $skip` + (limit > 0 ? ` LIMIT $limit` : "");
    const params: Record<string, unknown> = { skip: neo4j.int(skip) };
    if (limit > 0) params["limit"] = neo4j.int(limit);
    const result = await session.run(cypher, params);

    const total = result.records.length;
    logger.info({ total, skip }, "Found URL links to reprocess");

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < total; i += batchSize) {
      const batch = result.records.slice(i, i + batchSize);
      logger.info({ batch: Math.floor(i / batchSize) + 1, of: Math.ceil(total / batchSize) }, "Processing batch");

      for (const record of batch) {
        const url = record.get("url") as string;
        const title = record.get("title") as string;
        const content = record.get("content") as string;
        const desc = record.get("desc") as string;
        const oldScore = record.get("oldScore") as number;
        const oldType = record.get("oldType") as string;

        try {
          const categorization = await categorizeWithClaude(
            title, desc, content, url, claudeTimeoutMs, logger, false,
          );

          if (dryRun) {
            logger.info({
              title: title?.slice(0, 60),
              oldScore,
              newScore: categorization.forge_score,
              oldType,
              newType: categorization.content_type,
              tags: categorization.tags.length,
            }, "DRY RUN — would update");
            processed++;
            continue;
          }

          // Regenerate embedding with updated summary
          const textForEmbedding = `${title}. ${desc}. ${categorization.summary}`;
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
                 l.embedding = $embedding`,
            {
              url,
              description: categorization.summary,
              forgeScore: categorization.forge_score,
              contentType: categorization.content_type,
              purpose: categorization.purpose,
              integrationType: categorization.integration_type,
              quality: categorization.quality,
              embedding,
            },
          );

          // Update tags — clear old and add new
          await session.run(
            `MATCH (l:Link {url: $url})-[r:TAGGED_WITH]->() DELETE r`,
            { url },
          );
          const uniqueTags = [...new Set(categorization.tags.map(t => t.toLowerCase().replace(/\s+/g, "-")))];
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

          // Update tools
          await session.run(
            `MATCH (l:Link {url: $url})-[r:MENTIONS_TOOL]->() DELETE r`,
            { url },
          );
          for (const tool of categorization.tools) {
            await session.run(
              `MERGE (t:Tool {name: $name})
               ON CREATE SET t.url = $toolUrl
               WITH t
               MATCH (l:Link {url: $linkUrl})
               MERGE (l)-[:MENTIONS_TOOL]->(t)`,
              { name: tool.name, toolUrl: tool.url || "", linkUrl: url },
            );
          }

          // Update technologies
          await session.run(
            `MATCH (l:Link {url: $url})-[r:MENTIONS_TECH]->() DELETE r`,
            { url },
          );
          for (const tech of categorization.technologies) {
            await session.run(
              `MERGE (t:Technology {name: $name})
               WITH t
               MATCH (l:Link {url: $url})
               MERGE (l)-[:MENTIONS_TECH]->(t)`,
              { url, name: tech },
            );
          }

          processed++;
          logger.info({
            title: title?.slice(0, 60),
            score: `${oldScore?.toFixed(2)} → ${categorization.forge_score.toFixed(2)}`,
            type: `${oldType} → ${categorization.content_type}`,
            tags: categorization.tags.length,
          }, `Reprocessed (${processed}/${total})`);
        } catch (err) {
          failed++;
          logger.error({ title: title?.slice(0, 60), err: err instanceof Error ? err.message : err }, "Failed to reprocess");
        }
      }
    }

    logger.info({ processed, failed, total }, "Reprocessing complete");
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
