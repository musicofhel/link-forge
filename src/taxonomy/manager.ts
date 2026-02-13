import type { Driver } from "neo4j-driver";
import type { Client } from "discord.js";
import type pino from "pino";
import { proposeSplit } from "./splitter.js";
import { notifySplit } from "./notifier.js";
import { createCategory } from "../graph/repositories/category.repository.js";
import { addSubcategory, categorizeLink } from "../graph/relationships.js";
import { updateLinkCount } from "../graph/repositories/category.repository.js";

export interface TaxonomyManager {
  start(): void;
  stop(): void;
  checkOnce(): Promise<void>;
}

export function createTaxonomyManager(
  neo4jDriver: Driver,
  discordClient: Client | null,
  channelId: string,
  threshold: number,
  checkIntervalMs: number,
  claudeTimeoutMs: number,
  logger: pino.Logger,
): TaxonomyManager {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function findOversizedCategories(): Promise<
    Array<{ name: string; linkCount: number }>
  > {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(
        `MATCH (c:Category)
         WHERE c.linkCount >= $threshold
         AND NOT EXISTS { MATCH (c)-[:SUBCATEGORY_OF]->() }
         RETURN c.name AS name, c.linkCount AS linkCount
         ORDER BY c.linkCount DESC`,
        { threshold },
      );
      return result.records.map((r) => ({
        name: r.get("name") as string,
        linkCount: (r.get("linkCount") as { toNumber?: () => number })?.toNumber?.() ?? (r.get("linkCount") as number),
      }));
    } finally {
      await session.close();
    }
  }

  async function getLinksInCategory(
    categoryName: string,
  ): Promise<Array<{ title: string; url: string }>> {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(
        `MATCH (l:Link)-[:CATEGORIZED_IN]->(c:Category {name: $name})
         RETURN l.title AS title, l.url AS url`,
        { name: categoryName },
      );
      return result.records.map((r) => ({
        title: r.get("title") as string,
        url: r.get("url") as string,
      }));
    } finally {
      await session.close();
    }
  }

  async function executeSplit(
    categoryName: string,
    proposal: Awaited<ReturnType<typeof proposeSplit>>,
  ): Promise<void> {
    const session = neo4jDriver.session();
    try {
      for (const subcat of proposal.subcategories) {
        // Create subcategory
        await createCategory(session, subcat.name, subcat.description);
        await addSubcategory(session, subcat.name, categoryName);

        // Re-categorize links
        for (const linkUrl of subcat.linkUrls) {
          // Remove old categorization
          await session.run(
            `MATCH (l:Link {url: $url})-[r:CATEGORIZED_IN]->(c:Category {name: $oldCat})
             DELETE r`,
            { url: linkUrl, oldCat: categoryName },
          );
          // Add new categorization
          await categorizeLink(session, linkUrl, subcat.name);
        }

        await updateLinkCount(session, subcat.name);
      }

      // Update parent link count
      await updateLinkCount(session, categoryName);
    } finally {
      await session.close();
    }
  }

  async function checkOnce(): Promise<void> {
    logger.debug("Checking for oversized categories...");
    const oversized = await findOversizedCategories();

    if (oversized.length === 0) {
      logger.debug("No oversized categories found");
      return;
    }

    for (const cat of oversized) {
      logger.info(
        { category: cat.name, linkCount: cat.linkCount },
        "Oversized category found, proposing split",
      );

      try {
        const links = await getLinksInCategory(cat.name);
        const proposal = await proposeSplit(cat.name, links, claudeTimeoutMs, logger);

        logger.info(
          {
            category: cat.name,
            subcategories: proposal.subcategories.map((s) => s.name),
          },
          "Split proposed, executing",
        );

        await executeSplit(cat.name, proposal);

        if (discordClient) {
          await notifySplit(discordClient, channelId, cat.name, proposal, logger);
        }

        logger.info({ category: cat.name }, "Category split complete");
      } catch (err) {
        logger.error({ err, category: cat.name }, "Failed to split category");
      }
    }
  }

  return {
    start() {
      logger.info(
        { checkIntervalMs, threshold },
        "Starting taxonomy manager",
      );
      timer = setInterval(() => void checkOnce(), checkIntervalMs);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info("Taxonomy manager stopped");
    },

    checkOnce,
  };
}
