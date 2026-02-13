import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import type pino from "pino";
import { generateScoreDistributionChart, generateContentTypeChart, generateTopCategoriesChart } from "./charts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveHtml(): string {
  const local = path.join(__dirname, "index.html");
  if (fs.existsSync(local)) return local;
  const srcPath = path.join(__dirname, "../../src/dashboard/index.html");
  if (fs.existsSync(srcPath)) return srcPath;
  return local;
}

const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);

export interface DashboardServer {
  start(port: number): void;
  stop(): void;
}

export function createDashboardServer(
  neo4jDriver: Driver,
  logger: pino.Logger,
): DashboardServer {
  const app = express();
  let server: ReturnType<typeof app.listen> | null = null;

  const htmlPath = resolveHtml();
  app.get("/dashboard", (_req, res) => {
    res.sendFile(htmlPath);
  });

  // Users API
  app.get("/api/users", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(`
        MATCH (u:User)
        OPTIONAL MATCH (u)<-[:SHARED_BY]-(l:Link)
        RETURN u.discordId AS discordId, u.username AS username,
               u.displayName AS displayName, u.avatarUrl AS avatarUrl,
               count(l) AS linkCount
        ORDER BY linkCount DESC
      `);

      const users = result.records.map((r) => ({
        discordId: r.get("discordId") as string,
        username: r.get("username") as string,
        displayName: r.get("displayName") as string,
        avatarUrl: r.get("avatarUrl") as string,
        linkCount: toNum(r.get("linkCount")),
      }));

      res.json({ users });
    } catch (err) {
      logger.error({ err }, "Failed to fetch users");
      res.status(500).json({ error: "Failed to fetch users" });
    } finally {
      await session.close();
    }
  });

  // Stats API — optional ?user=discordId filter
  app.get("/api/stats", async (req, res) => {
    const session = neo4jDriver.session();
    const userId = req.query["user"] as string | undefined;
    try {
      const uf = userId ? { match: "(l:Link)-[:SHARED_BY]->(u:User {discordId: $userId})", params: { userId } }
                        : { match: "(l:Link)", params: {} };

      const linksRes = await session.run(`MATCH ${uf.match} RETURN count(l) AS count`, uf.params);
      const catsRes = await session.run(
        `MATCH ${uf.match}-[:CATEGORIZED_IN]->(c:Category) RETURN count(DISTINCT c) AS count`, uf.params);
      const scoreRes = await session.run(`
        MATCH ${uf.match}
        WHERE l.forgeScore IS NOT NULL
        RETURN
          sum(CASE WHEN l.forgeScore >= 0.85 THEN 1 ELSE 0 END) AS artifact,
          sum(CASE WHEN l.forgeScore >= 0.65 AND l.forgeScore < 0.85 THEN 1 ELSE 0 END) AS guide,
          sum(CASE WHEN l.forgeScore >= 0.45 AND l.forgeScore < 0.65 THEN 1 ELSE 0 END) AS analysis,
          sum(CASE WHEN l.forgeScore >= 0.25 AND l.forgeScore < 0.45 THEN 1 ELSE 0 END) AS pointer,
          sum(CASE WHEN l.forgeScore >= 0.10 AND l.forgeScore < 0.25 THEN 1 ELSE 0 END) AS commentary,
          sum(CASE WHEN l.forgeScore < 0.10 THEN 1 ELSE 0 END) AS junk,
          avg(l.forgeScore) AS avgScore
      `, uf.params);
      const typeRes = await session.run(`
        MATCH ${uf.match}
        WHERE l.contentType IS NOT NULL
        RETURN l.contentType AS type, count(l) AS count
        ORDER BY count DESC
      `, uf.params);

      // Only compute global tag/tool/tech counts when no user filter
      let tagCount = 0, toolCount = 0, techCount = 0;
      if (!userId) {
        const tagsRes = await session.run("MATCH (t:Tag) RETURN count(t) AS count");
        const toolsRes = await session.run("MATCH (t:Tool) RETURN count(t) AS count");
        const techsRes = await session.run("MATCH (t:Technology) RETURN count(t) AS count");
        tagCount = toNum(tagsRes.records[0]?.get("count"));
        toolCount = toNum(toolsRes.records[0]?.get("count"));
        techCount = toNum(techsRes.records[0]?.get("count"));
      } else {
        const tagsRes = await session.run(
          `MATCH ${uf.match}-[:TAGGED_WITH]->(t:Tag) RETURN count(DISTINCT t) AS count`, uf.params);
        const toolsRes = await session.run(
          `MATCH ${uf.match}-[:MENTIONS_TOOL]->(t:Tool) RETURN count(DISTINCT t) AS count`, uf.params);
        const techsRes = await session.run(
          `MATCH ${uf.match}-[:MENTIONS_TECH]->(t:Technology) RETURN count(DISTINCT t) AS count`, uf.params);
        tagCount = toNum(tagsRes.records[0]?.get("count"));
        toolCount = toNum(toolsRes.records[0]?.get("count"));
        techCount = toNum(techsRes.records[0]?.get("count"));
      }

      const scoreRec = scoreRes.records[0]!;

      res.json({
        counts: {
          links: toNum(linksRes.records[0]?.get("count")),
          categories: toNum(catsRes.records[0]?.get("count")),
          tags: tagCount,
          tools: toolCount,
          technologies: techCount,
        },
        scoreDistribution: {
          artifact: toNum(scoreRec.get("artifact")),
          guide: toNum(scoreRec.get("guide")),
          analysis: toNum(scoreRec.get("analysis")),
          pointer: toNum(scoreRec.get("pointer")),
          commentary: toNum(scoreRec.get("commentary")),
          junk: toNum(scoreRec.get("junk")),
        },
        avgScore: Math.round(toNum(scoreRec.get("avgScore")) * 100) / 100,
        contentTypes: typeRes.records.map((r) => ({
          type: r.get("type") as string,
          count: toNum(r.get("count")),
        })),
      });
    } catch (err) {
      logger.error({ err }, "Failed to fetch stats");
      res.status(500).json({ error: "Failed to fetch stats" });
    } finally {
      await session.close();
    }
  });

  // Graph data API — optional ?user=discordId filter
  app.get("/api/graph", async (req, res) => {
    const session = neo4jDriver.session();
    const userId = req.query["user"] as string | undefined;
    try {
      const uf = userId ? { match: "(l:Link)-[:SHARED_BY]->(u:User {discordId: $userId})", params: { userId } }
                        : { match: "(l:Link)", params: {} };

      const nodesRes = await session.run(`
        MATCH ${uf.match}
        RETURN l.url AS id, l.title AS title, l.domain AS domain,
               COALESCE(l.forgeScore, 0) AS forgeScore,
               COALESCE(l.contentType, 'reference') AS contentType
        ORDER BY l.forgeScore DESC
      `, uf.params);

      // For LINKS_TO, only show edges between links in the current set
      const linkUrls = new Set(nodesRes.records.map((r) => r.get("id") as string));

      const linksToRes = await session.run(`
        MATCH (a:Link)-[:LINKS_TO]->(b:Link)
        RETURN a.url AS source, b.url AS target, 'LINKS_TO' AS type
      `);
      const catEdgesRes = await session.run(`
        MATCH ${uf.match}-[:CATEGORIZED_IN]->(c:Category)
        RETURN l.url AS source, c.name AS target, 'CATEGORIZED_IN' AS type
      `, uf.params);

      // Also include SHARED_BY edges + User nodes for the "All" view
      let userNodes: Array<{ id: string; title: string; domain: string; forgeScore: number; contentType: string; nodeType: "user" }> = [];
      let sharedByEdges: Array<{ source: string; target: string; type: string }> = [];

      if (!userId) {
        const userRes = await session.run(`
          MATCH (u:User)<-[:SHARED_BY]-(l:Link)
          RETURN DISTINCT u.discordId AS discordId, u.displayName AS displayName
        `);
        userNodes = userRes.records.map((r) => ({
          id: `user:${r.get("discordId") as string}`,
          title: r.get("displayName") as string,
          domain: "",
          forgeScore: 0,
          contentType: "",
          nodeType: "user" as const,
        }));

        const sbRes = await session.run(`
          MATCH (l:Link)-[:SHARED_BY]->(u:User)
          RETURN l.url AS source, u.discordId AS target, 'SHARED_BY' AS type
        `);
        sharedByEdges = sbRes.records.map((r) => ({
          source: r.get("source") as string,
          target: `user:${r.get("target") as string}`,
          type: "SHARED_BY",
        }));
      }

      const categoryNodes = new Set<string>();
      catEdgesRes.records.forEach((r) => categoryNodes.add(r.get("target") as string));

      const nodes = [
        ...nodesRes.records.map((r) => ({
          id: r.get("id") as string,
          title: r.get("title") as string,
          domain: r.get("domain") as string,
          forgeScore: toNum(r.get("forgeScore")),
          contentType: r.get("contentType") as string,
          nodeType: "link" as const,
        })),
        ...[...categoryNodes].map((name) => ({
          id: `cat:${name}`,
          title: name,
          domain: "",
          forgeScore: 0,
          contentType: "",
          nodeType: "category" as const,
        })),
        ...userNodes,
      ];

      const edges = [
        ...linksToRes.records
          .filter((r) => linkUrls.has(r.get("source") as string) && linkUrls.has(r.get("target") as string))
          .map((r) => ({
            source: r.get("source") as string,
            target: r.get("target") as string,
            type: "LINKS_TO",
          })),
        ...catEdgesRes.records.map((r) => ({
          source: r.get("source") as string,
          target: `cat:${r.get("target") as string}`,
          type: "CATEGORIZED_IN",
        })),
        ...sharedByEdges,
      ];

      res.json({ nodes, edges });
    } catch (err) {
      logger.error({ err }, "Failed to fetch graph data");
      res.status(500).json({ error: "Failed to fetch graph data" });
    } finally {
      await session.close();
    }
  });

  // Paginated links API — optional ?user=discordId filter
  app.get("/api/links", async (req, res) => {
    const session = neo4jDriver.session();
    try {
      const minScore = parseFloat(req.query["min_score"] as string) || 0;
      const category = (req.query["category"] as string) || "";
      const contentType = (req.query["content_type"] as string) || "";
      const userId = (req.query["user"] as string) || "";
      const limit = neo4j.int(Math.min(parseInt(req.query["limit"] as string) || 50, 200));
      const offset = neo4j.int(parseInt(req.query["offset"] as string) || 0);

      let cypher = "MATCH (l:Link)";
      const params: Record<string, unknown> = { limit, offset, minScore };

      if (userId) {
        cypher += "-[:SHARED_BY]->(u:User {discordId: $userId})";
        params["userId"] = userId;
      }

      if (category) {
        // Need a second MATCH for category when user filter is also present
        if (userId) {
          cypher += " MATCH (l)-[:CATEGORIZED_IN]->(c:Category {name: $category})";
        } else {
          cypher += "-[:CATEGORIZED_IN]->(c:Category {name: $category})";
        }
        params["category"] = category;
      }

      cypher += " WHERE COALESCE(l.forgeScore, 0) >= $minScore";

      if (contentType) {
        cypher += " AND l.contentType = $contentType";
        params["contentType"] = contentType;
      }

      cypher += `
        RETURN l.url AS url, l.title AS title, l.domain AS domain,
               COALESCE(l.forgeScore, 0) AS forgeScore,
               COALESCE(l.contentType, 'reference') AS contentType,
               l.purpose AS purpose, l.quality AS quality, l.savedAt AS savedAt
        ORDER BY forgeScore DESC, l.savedAt DESC
        SKIP $offset LIMIT $limit
      `;

      const result = await session.run(cypher, params);

      const links = result.records.map((r) => ({
        url: r.get("url"),
        title: r.get("title"),
        domain: r.get("domain"),
        forgeScore: toNum(r.get("forgeScore")),
        contentType: r.get("contentType"),
        purpose: r.get("purpose"),
        quality: r.get("quality"),
        savedAt: r.get("savedAt"),
      }));

      res.json({ links, count: links.length, offset: offset.toNumber(), limit: limit.toNumber() });
    } catch (err) {
      logger.error({ err }, "Failed to fetch links");
      res.status(500).json({ error: "Failed to fetch links" });
    } finally {
      await session.close();
    }
  });

  // Overlap / intersection analysis API
  app.get("/api/overlap", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      // Get all user-category-linkCount triples
      const catRes = await session.run(`
        MATCH (u:User)<-[:SHARED_BY]-(l:Link)-[:CATEGORIZED_IN]->(c:Category)
        RETURN u.discordId AS userId, u.displayName AS displayName,
               c.name AS category, count(l) AS linkCount
        ORDER BY c.name, linkCount DESC
      `);

      // Get all users
      const userRes = await session.run(`
        MATCH (u:User)
        OPTIONAL MATCH (u)<-[:SHARED_BY]-(l:Link)
        RETURN u.discordId AS discordId, u.displayName AS displayName, count(l) AS linkCount
        ORDER BY linkCount DESC
      `);

      // Get per-user content type breakdown
      const typeRes = await session.run(`
        MATCH (u:User)<-[:SHARED_BY]-(l:Link)
        WHERE l.contentType IS NOT NULL
        RETURN u.discordId AS userId, l.contentType AS type, count(l) AS count
        ORDER BY userId, count DESC
      `);

      // Get per-user score averages
      const scoreRes = await session.run(`
        MATCH (u:User)<-[:SHARED_BY]-(l:Link)
        WHERE l.forgeScore IS NOT NULL
        RETURN u.discordId AS userId,
               avg(l.forgeScore) AS avgScore,
               max(l.forgeScore) AS maxScore,
               min(l.forgeScore) AS minScore
      `);

      // Get per-user tag overlap (top tags per user)
      const tagRes = await session.run(`
        MATCH (u:User)<-[:SHARED_BY]-(l:Link)-[:TAGGED_WITH]->(t:Tag)
        RETURN u.discordId AS userId, t.name AS tag, count(l) AS count
        ORDER BY userId, count DESC
      `);

      // Get per-user tool overlap
      const toolRes = await session.run(`
        MATCH (u:User)<-[:SHARED_BY]-(l:Link)-[:MENTIONS_TOOL]->(t:Tool)
        RETURN u.discordId AS userId, t.name AS tool, count(l) AS count
        ORDER BY userId, count DESC
      `);

      const users = userRes.records.map((r) => ({
        discordId: r.get("discordId") as string,
        displayName: r.get("displayName") as string,
        linkCount: toNum(r.get("linkCount")),
      }));

      // Build category → { userId: linkCount } map
      const categoryMap: Record<string, Record<string, number>> = {};
      const userCategories: Record<string, Set<string>> = {};

      for (const r of catRes.records) {
        const userId = r.get("userId") as string;
        const cat = r.get("category") as string;
        const count = toNum(r.get("linkCount"));

        if (!categoryMap[cat]) categoryMap[cat] = {};
        categoryMap[cat][userId] = count;

        if (!userCategories[userId]) userCategories[userId] = new Set();
        userCategories[userId].add(cat);
      }

      // Build categories list with overlap info
      const categories = Object.entries(categoryMap)
        .map(([name, userCounts]) => ({
          name,
          users: userCounts,
          sharedByCount: Object.keys(userCounts).length,
          totalLinks: Object.values(userCounts).reduce((a, b) => a + b, 0),
        }))
        .sort((a, b) => b.sharedByCount - a.sharedByCount || b.totalLinks - a.totalLinks);

      // Build pairwise similarity matrix (Jaccard index on categories)
      const userIds = users.map((u) => u.discordId);
      const pairwise: Array<{
        userA: string;
        userB: string;
        sharedCategories: number;
        jaccard: number;
        onlyA: number;
        onlyB: number;
        overlap: string[];
      }> = [];

      for (let i = 0; i < userIds.length; i++) {
        for (let j = i + 1; j < userIds.length; j++) {
          const idA = userIds[i]!;
          const idB = userIds[j]!;
          const a = userCategories[idA] || new Set<string>();
          const b = userCategories[idB] || new Set<string>();
          const shared = [...a].filter((c) => b.has(c));
          const union = new Set([...a, ...b]);
          pairwise.push({
            userA: idA,
            userB: idB,
            sharedCategories: shared.length,
            jaccard: union.size > 0 ? Math.round((shared.length / union.size) * 100) / 100 : 0,
            onlyA: [...a].filter((c) => !b.has(c)).length,
            onlyB: [...b].filter((c) => !a.has(c)).length,
            overlap: shared.sort(),
          });
        }
      }

      // Per-user stats
      const userStats: Record<string, {
        totalCategories: number;
        uniqueCategories: number;
        avgScore: number;
        maxScore: number;
        topTypes: Array<{ type: string; count: number }>;
        topTags: Array<{ tag: string; count: number }>;
        topTools: Array<{ tool: string; count: number }>;
      }> = {};

      for (const uid of userIds) {
        const cats = userCategories[uid] || new Set<string>();
        const otherUserCats = new Set<string>();
        for (const other of userIds) {
          if (other !== uid && userCategories[other]) {
            for (const c of userCategories[other]) otherUserCats.add(c);
          }
        }
        const unique = [...cats].filter((c) => !otherUserCats.has(c));

        const scoreRec = scoreRes.records.find((r) => r.get("userId") === uid);
        const types = typeRes.records
          .filter((r) => r.get("userId") === uid)
          .map((r) => ({ type: r.get("type") as string, count: toNum(r.get("count")) }));
        const tags = tagRes.records
          .filter((r) => r.get("userId") === uid)
          .slice(0, 10)
          .map((r) => ({ tag: r.get("tag") as string, count: toNum(r.get("count")) }));
        const tools = toolRes.records
          .filter((r) => r.get("userId") === uid)
          .slice(0, 10)
          .map((r) => ({ tool: r.get("tool") as string, count: toNum(r.get("count")) }));

        userStats[uid] = {
          totalCategories: cats.size,
          uniqueCategories: unique.length,
          avgScore: scoreRec ? Math.round(toNum(scoreRec.get("avgScore")) * 100) / 100 : 0,
          maxScore: scoreRec ? Math.round(toNum(scoreRec.get("maxScore")) * 100) / 100 : 0,
          topTypes: types,
          topTags: tags,
          topTools: tools,
        };
      }

      res.json({ users, categories, pairwise, userStats });
    } catch (err) {
      logger.error({ err }, "Failed to compute overlap analysis");
      res.status(500).json({ error: "Failed to compute overlap analysis" });
    } finally {
      await session.close();
    }
  });

  // Chart image endpoints
  app.get("/api/charts/scores", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const scoreRes = await session.run(`
        MATCH (l:Link) WHERE l.forgeScore IS NOT NULL
        RETURN
          sum(CASE WHEN l.forgeScore >= 0.85 THEN 1 ELSE 0 END) AS artifact,
          sum(CASE WHEN l.forgeScore >= 0.65 AND l.forgeScore < 0.85 THEN 1 ELSE 0 END) AS guide,
          sum(CASE WHEN l.forgeScore >= 0.45 AND l.forgeScore < 0.65 THEN 1 ELSE 0 END) AS analysis,
          sum(CASE WHEN l.forgeScore >= 0.25 AND l.forgeScore < 0.45 THEN 1 ELSE 0 END) AS pointer,
          sum(CASE WHEN l.forgeScore >= 0.10 AND l.forgeScore < 0.25 THEN 1 ELSE 0 END) AS commentary,
          sum(CASE WHEN l.forgeScore < 0.10 THEN 1 ELSE 0 END) AS junk
      `);
      const rec = scoreRes.records[0]!;
      const dist = {
        artifact: toNum(rec.get("artifact")),
        guide: toNum(rec.get("guide")),
        analysis: toNum(rec.get("analysis")),
        pointer: toNum(rec.get("pointer")),
        commentary: toNum(rec.get("commentary")),
        junk: toNum(rec.get("junk")),
      };
      const png = await generateScoreDistributionChart(dist);
      res.type("image/png").send(png);
    } catch (err) {
      logger.error({ err }, "Failed to generate score chart");
      res.status(500).json({ error: "Chart generation failed" });
    } finally {
      await session.close();
    }
  });

  app.get("/api/charts/types", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const typeRes = await session.run(`
        MATCH (l:Link) WHERE l.contentType IS NOT NULL
        RETURN l.contentType AS type, count(l) AS count ORDER BY count DESC
      `);
      const types = typeRes.records.map((r) => ({
        type: r.get("type") as string,
        count: toNum(r.get("count")),
      }));
      const png = await generateContentTypeChart(types);
      res.type("image/png").send(png);
    } catch (err) {
      logger.error({ err }, "Failed to generate type chart");
      res.status(500).json({ error: "Chart generation failed" });
    } finally {
      await session.close();
    }
  });

  app.get("/api/charts/categories", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const catRes = await session.run(`
        MATCH (l:Link)-[:CATEGORIZED_IN]->(c:Category)
        RETURN c.name AS name, count(l) AS count
        ORDER BY count DESC LIMIT 10
      `);
      const cats = catRes.records.map((r) => ({
        name: r.get("name") as string,
        count: toNum(r.get("count")),
      }));
      const png = await generateTopCategoriesChart(cats);
      res.type("image/png").send(png);
    } catch (err) {
      logger.error({ err }, "Failed to generate category chart");
      res.status(500).json({ error: "Chart generation failed" });
    } finally {
      await session.close();
    }
  });

  return {
    start(port: number) {
      server = app.listen(port, () => {
        logger.info({ port }, "Dashboard server started");
      });
    },
    stop() {
      if (server) {
        server.close();
        server = null;
        logger.info("Dashboard server stopped");
      }
    },
  };
}
