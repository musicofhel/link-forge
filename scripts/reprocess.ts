/**
 * Re-categorize all existing Link nodes with the enriched schema
 * (forge_score, content_type, purpose, integration_type, quality).
 *
 * Usage: npx tsx scripts/reprocess.ts
 */

import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import pino from "pino";
import { categorizeWithClaude } from "../src/processor/claude-cli.js";
import { updateLinkMetadata } from "../src/graph/repositories/link.repository.js";
import { createCategory } from "../src/graph/repositories/category.repository.js";
import { createTag } from "../src/graph/repositories/tag.repository.js";
import { createTool } from "../src/graph/repositories/tool.repository.js";
import { createTechnology } from "../src/graph/repositories/technology.repository.js";
import {
  categorizeLink,
  tagLink,
  linkMentionsTool,
  linkMentionsTech,
} from "../src/graph/relationships.js";
import { updateLinkCount } from "../src/graph/repositories/category.repository.js";

dotenv.config();

const logger = pino({
  level: "info",
  transport: { target: "pino-pretty" },
});

const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASSWORD = process.env["NEO4J_PASSWORD"] ?? "link_forge_dev";
const CLAUDE_TIMEOUT = 90_000;

async function main() {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await driver.verifyConnectivity();
  logger.info("Connected to Neo4j");

  const session = driver.session();
  try {
    // Fetch all Link nodes
    const result = await session.run(
      `MATCH (l:Link)
       RETURN l.url AS url, l.title AS title, l.description AS description, l.content AS content
       ORDER BY l.savedAt ASC`,
    );

    const links = result.records.map((rec) => ({
      url: rec.get("url") as string,
      title: rec.get("title") as string,
      description: rec.get("description") as string,
      content: rec.get("content") as string,
    }));

    logger.info({ count: links.length }, "Links to reprocess");

    let success = 0;
    let failed = 0;

    for (const link of links) {
      const log = logger.child({ url: link.url });
      try {
        log.info("Re-categorizing...");
        const cat = await categorizeWithClaude(
          link.title,
          link.description,
          link.content,
          link.url,
          CLAUDE_TIMEOUT,
          log,
        );

        // Update metadata on the Link node
        await updateLinkMetadata(session, link.url, {
          forgeScore: cat.forge_score,
          contentType: cat.content_type,
          purpose: cat.purpose,
          integrationType: cat.integration_type,
          quality: cat.quality,
          description: cat.summary,
        });

        // Ensure category + relationship exist (may have changed)
        await createCategory(session, cat.category, "");
        await categorizeLink(session, link.url, cat.category);

        // Ensure tags + relationships
        for (const tagName of cat.tags) {
          await createTag(session, tagName);
          await tagLink(session, link.url, tagName);
        }

        // Ensure tools + relationships
        for (const tool of cat.tools) {
          await createTool(session, tool.name, "", tool.url ?? "");
          await linkMentionsTool(session, link.url, tool.name);
        }

        // Ensure technologies + relationships
        for (const techName of cat.technologies) {
          await createTechnology(session, techName, "");
          await linkMentionsTech(session, link.url, techName);
        }

        await updateLinkCount(session, cat.category);

        log.info(
          {
            forgeScore: cat.forge_score,
            contentType: cat.content_type,
            integrationType: cat.integration_type,
            quality: cat.quality,
          },
          "Re-categorized successfully",
        );
        success++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "Failed to re-categorize");
        failed++;
      }
    }

    logger.info({ success, failed, total: links.length }, "Reprocessing complete");

    // Print summary table
    const summary = await session.run(
      `MATCH (l:Link)
       RETURN l.title AS title, l.forgeScore AS forgeScore, l.contentType AS contentType, l.purpose AS purpose
       ORDER BY l.forgeScore DESC`,
    );

    console.log("\n--- Forge Score Distribution ---");
    for (const rec of summary.records) {
      const score = rec.get("forgeScore") as number | null;
      const title = rec.get("title") as string;
      const type = rec.get("contentType") as string | null;
      const purpose = rec.get("purpose") as string | null;
      console.log(
        `  ${score != null ? score.toFixed(2) : "N/A"} | ${type ?? "?"} | ${title}`,
      );
      if (purpose) console.log(`       └─ ${purpose}`);
    }
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Reprocess script failed");
  process.exit(1);
});
