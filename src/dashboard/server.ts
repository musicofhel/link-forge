import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import type pino from "pino";
import { generateScoreDistributionChart, generateContentTypeChart, generateTopCategoriesChart } from "./charts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve HTML file — works both in dev (tsx src/) and prod (node dist/)
function resolveHtml(): string {
  const local = path.join(__dirname, "index.html");
  if (fs.existsSync(local)) return local;
  // Fallback: look in src/dashboard/ from project root
  const srcPath = path.join(__dirname, "../../src/dashboard/index.html");
  if (fs.existsSync(srcPath)) return srcPath;
  return local; // will 404 if neither exists
}

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

  // Serve the dashboard HTML
  const htmlPath = resolveHtml();
  app.get("/dashboard", (_req, res) => {
    res.sendFile(htmlPath);
  });

  // Stats API — run queries sequentially (Neo4j sessions can't handle parallel queries)
  app.get("/api/stats", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const linksRes = await session.run("MATCH (l:Link) RETURN count(l) AS count");
      const catsRes = await session.run("MATCH (c:Category) RETURN count(c) AS count");
      const tagsRes = await session.run("MATCH (t:Tag) RETURN count(t) AS count");
      const toolsRes = await session.run("MATCH (t:Tool) RETURN count(t) AS count");
      const techsRes = await session.run("MATCH (t:Technology) RETURN count(t) AS count");
      const scoreRes = await session.run(`
        MATCH (l:Link)
        WHERE l.forgeScore IS NOT NULL
        RETURN
          sum(CASE WHEN l.forgeScore >= 0.85 THEN 1 ELSE 0 END) AS artifact,
          sum(CASE WHEN l.forgeScore >= 0.65 AND l.forgeScore < 0.85 THEN 1 ELSE 0 END) AS guide,
          sum(CASE WHEN l.forgeScore >= 0.45 AND l.forgeScore < 0.65 THEN 1 ELSE 0 END) AS analysis,
          sum(CASE WHEN l.forgeScore >= 0.25 AND l.forgeScore < 0.45 THEN 1 ELSE 0 END) AS pointer,
          sum(CASE WHEN l.forgeScore >= 0.10 AND l.forgeScore < 0.25 THEN 1 ELSE 0 END) AS commentary,
          sum(CASE WHEN l.forgeScore < 0.10 THEN 1 ELSE 0 END) AS junk,
          avg(l.forgeScore) AS avgScore
      `);
      const typeRes = await session.run(`
        MATCH (l:Link)
        WHERE l.contentType IS NOT NULL
        RETURN l.contentType AS type, count(l) AS count
        ORDER BY count DESC
      `);

      const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);
      const scoreRec = scoreRes.records[0]!;

      res.json({
        counts: {
          links: toNum(linksRes.records[0]?.get("count")),
          categories: toNum(catsRes.records[0]?.get("count")),
          tags: toNum(tagsRes.records[0]?.get("count")),
          tools: toNum(toolsRes.records[0]?.get("count")),
          technologies: toNum(techsRes.records[0]?.get("count")),
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

  // Graph data API for D3 force layout
  app.get("/api/graph", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const nodesRes = await session.run(`
        MATCH (l:Link)
        RETURN l.url AS id, l.title AS title, l.domain AS domain,
               COALESCE(l.forgeScore, 0) AS forgeScore,
               COALESCE(l.contentType, 'reference') AS contentType
        ORDER BY l.forgeScore DESC
      `);
      const linksToRes = await session.run(`
        MATCH (a:Link)-[:LINKS_TO]->(b:Link)
        RETURN a.url AS source, b.url AS target, 'LINKS_TO' AS type
      `);
      const catEdgesRes = await session.run(`
        MATCH (l:Link)-[:CATEGORIZED_IN]->(c:Category)
        RETURN l.url AS source, c.name AS target, 'CATEGORIZED_IN' AS type
      `);

      // Collect category nodes from edges
      const categoryNodes = new Set<string>();
      catEdgesRes.records.forEach((r) => categoryNodes.add(r.get("target") as string));

      const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);

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
      ];

      const edges = [
        ...linksToRes.records.map((r) => ({
          source: r.get("source") as string,
          target: r.get("target") as string,
          type: "LINKS_TO",
        })),
        ...catEdgesRes.records.map((r) => ({
          source: r.get("source") as string,
          target: `cat:${r.get("target") as string}`,
          type: "CATEGORIZED_IN",
        })),
      ];

      res.json({ nodes, edges });
    } catch (err) {
      logger.error({ err }, "Failed to fetch graph data");
      res.status(500).json({ error: "Failed to fetch graph data" });
    } finally {
      await session.close();
    }
  });

  // Paginated links API
  app.get("/api/links", async (req, res) => {
    const session = neo4jDriver.session();
    try {
      const minScore = parseFloat(req.query["min_score"] as string) || 0;
      const category = (req.query["category"] as string) || "";
      const contentType = (req.query["content_type"] as string) || "";
      const limit = neo4j.int(Math.min(parseInt(req.query["limit"] as string) || 50, 200));
      const offset = neo4j.int(parseInt(req.query["offset"] as string) || 0);

      let cypher = "MATCH (l:Link)";
      const params: Record<string, unknown> = { limit, offset, minScore };

      if (category) {
        cypher += "-[:CATEGORIZED_IN]->(c:Category {name: $category})";
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
      const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);

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

  // Chart image endpoints for Discord embeds
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
      const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);
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
      const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);
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
      const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);
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
