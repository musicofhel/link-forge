import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { compareSync } from "bcryptjs";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import type pino from "pino";
import type { EmbeddingService } from "../embeddings/index.js";
import { askQuestion } from "../rag/query.js";
import { generateScoreDistributionChart, generateContentTypeChart, generateTopCategoriesChart } from "./charts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveHtml(): string {
  const local = path.join(__dirname, "index.html");
  if (fs.existsSync(local)) return local;
  const srcPath = path.join(__dirname, "../../src/dashboard/index.html");
  if (fs.existsSync(srcPath)) return srcPath;
  return local;
}

function resolveGraphHtml(): string {
  const local = path.join(__dirname, "graph.html");
  if (fs.existsSync(local)) return local;
  const srcPath = path.join(__dirname, "../../src/dashboard/graph.html");
  if (fs.existsSync(srcPath)) return srcPath;
  return local;
}

function resolveLinkHtml(): string {
  const local = path.join(__dirname, "link.html");
  if (fs.existsSync(local)) return local;
  const srcPath = path.join(__dirname, "../../src/dashboard/link.html");
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
  embeddings?: EmbeddingService,
): DashboardServer {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // --- Auth config ---
  const dashGuid = process.env["DASHBOARD_GUID"] || "";
  const passwordHash = process.env["DASHBOARD_PASSWORD_HASH"] || "";
  const sessionSecret = process.env["DASHBOARD_SESSION_SECRET"] || randomBytes(32).toString("base64url");
  const authEnabled = !!(dashGuid && passwordHash);

  if (!authEnabled) {
    logger.warn("DASHBOARD_GUID or DASHBOARD_PASSWORD_HASH not set — dashboard is unauthenticated at /dashboard");
  } else {
    logger.info({ path: `/d/${dashGuid}` }, "Dashboard password auth enabled");
  }

  app.set("trust proxy", 1); // trust ngrok/reverse proxy for req.protocol
  app.use(cookieParser());

  // Session token helpers — HMAC-signed tokens with expiry
  const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function createSessionToken(): string {
    const payload = `${Date.now() + SESSION_MAX_AGE_MS}:${randomBytes(16).toString("hex")}`;
    const sig = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  function verifySessionToken(token: string): boolean {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx < 0) return false;
    const payload = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    const expected = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
    if (sig !== expected) return false;
    const expiry = parseInt(payload.split(":")[0]!, 10);
    return Date.now() < expiry;
  }

  // CORS
  const allowedOrigin = process.env["DASHBOARD_CORS_ORIGIN"] || undefined;
  app.use(cors({
    origin: allowedOrigin ?? false,
    credentials: true,
  }));

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });

  const askLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many queries, please try again later" },
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many login attempts, please try again later",
  });

  app.use("/api/", apiLimiter);

  // --- Auth middleware for /api/* and /d/:guid ---
  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!authEnabled) { next(); return; }
    const token = req.cookies?.["lf_session"];
    if (token && verifySessionToken(token)) { next(); return; }
    if (req.originalUrl.startsWith("/api/")) {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      // Redirect to login page
      res.redirect(`/d/${dashGuid}/login`);
    }
  }

  let server: ReturnType<typeof app.listen> | null = null;
  const htmlPath = resolveHtml();
  const graphHtmlPath = resolveGraphHtml();
  const linkHtmlPath = resolveLinkHtml();
  const loginHtmlPath = path.join(path.dirname(htmlPath), "login.html");

  // --- Login page ---
  if (authEnabled) {
    app.get(`/d/${dashGuid}/login`, (_req, res) => {
      res.sendFile(loginHtmlPath);
    });

    app.post(`/d/${dashGuid}/login`, loginLimiter, (req, res) => {
      const password = (req.body as { password?: string })?.password || "";
      if (compareSync(password, passwordHash)) {
        const token = createSessionToken();
        res.cookie("lf_session", token, {
          httpOnly: true,
          secure: req.protocol === "https",
          sameSite: "lax",
          maxAge: SESSION_MAX_AGE_MS,
          path: "/",
        });
        res.redirect(`/d/${dashGuid}`);
      } else {
        logger.warn({ ip: req.ip }, "Failed dashboard login attempt");
        res.redirect(`/d/${dashGuid}/login?error=1`);
      }
    });
  }

  // --- Dashboard route (GUID-based) ---
  if (authEnabled) {
    app.get(`/d/${dashGuid}`, requireAuth, (_req, res) => {
      res.sendFile(htmlPath);
    });
    app.get(`/d/${dashGuid}/graph`, requireAuth, (_req, res) => {
      res.sendFile(graphHtmlPath);
    });
  }

  // Legacy /dashboard — redirect to GUID path if auth enabled, else serve directly
  app.get("/dashboard", (_req, res) => {
    if (authEnabled) {
      res.redirect(`/d/${dashGuid}`);
    } else {
      res.sendFile(htmlPath);
    }
  });

  // Full-screen graph explorer
  app.get("/graph", (_req, res) => {
    if (authEnabled) {
      res.redirect(`/d/${dashGuid}/graph`);
    } else {
      res.sendFile(graphHtmlPath);
    }
  });

  // Link detail page
  if (authEnabled) {
    app.get(`/d/${dashGuid}/link/:encodedUrl`, requireAuth, (_req, res) => {
      res.sendFile(linkHtmlPath);
    });
  }
  app.get("/link/:encodedUrl", (_req, res) => {
    if (authEnabled) {
      res.redirect(`/d/${dashGuid}/link/${_req.params["encodedUrl"]}`);
    } else {
      res.sendFile(linkHtmlPath);
    }
  });

  // Protect all API routes
  app.use("/api/", requireAuth);

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

      // Only compute global tag/tool/tech/concept/author counts when no user filter
      let tagCount = 0, toolCount = 0, techCount = 0, conceptCount = 0, authorCount = 0;
      if (!userId) {
        const tagsRes = await session.run("MATCH (t:Tag) RETURN count(t) AS count");
        const toolsRes = await session.run("MATCH (t:Tool) RETURN count(t) AS count");
        const techsRes = await session.run("MATCH (t:Technology) RETURN count(t) AS count");
        const conceptsRes = await session.run("MATCH (c:Concept) RETURN count(c) AS count");
        const authorsRes2 = await session.run("MATCH (a:Author) RETURN count(a) AS count");
        tagCount = toNum(tagsRes.records[0]?.get("count"));
        toolCount = toNum(toolsRes.records[0]?.get("count"));
        techCount = toNum(techsRes.records[0]?.get("count"));
        conceptCount = toNum(conceptsRes.records[0]?.get("count"));
        authorCount = toNum(authorsRes2.records[0]?.get("count"));
      } else {
        const tagsRes = await session.run(
          `MATCH ${uf.match}-[:TAGGED_WITH]->(t:Tag) RETURN count(DISTINCT t) AS count`, uf.params);
        const toolsRes = await session.run(
          `MATCH ${uf.match}-[:MENTIONS_TOOL]->(t:Tool) RETURN count(DISTINCT t) AS count`, uf.params);
        const techsRes = await session.run(
          `MATCH ${uf.match}-[:MENTIONS_TECH]->(t:Technology) RETURN count(DISTINCT t) AS count`, uf.params);
        const conceptsRes = await session.run(
          `MATCH ${uf.match}-[:RELATES_TO_CONCEPT]->(c:Concept) RETURN count(DISTINCT c) AS count`, uf.params);
        const authorsRes2 = await session.run(
          `MATCH ${uf.match}-[:AUTHORED_BY]->(a:Author) RETURN count(DISTINCT a) AS count`, uf.params);
        tagCount = toNum(tagsRes.records[0]?.get("count"));
        toolCount = toNum(toolsRes.records[0]?.get("count"));
        techCount = toNum(techsRes.records[0]?.get("count"));
        conceptCount = toNum(conceptsRes.records[0]?.get("count"));
        authorCount = toNum(authorsRes2.records[0]?.get("count"));
      }

      const scoreRec = scoreRes.records[0]!;

      res.json({
        counts: {
          links: toNum(linksRes.records[0]?.get("count")),
          categories: toNum(catsRes.records[0]?.get("count")),
          tags: tagCount,
          tools: toolCount,
          technologies: techCount,
          concepts: conceptCount,
          authors: authorCount,
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

  // Full graph data API — all node types (except tags) with connection counts
  app.get("/api/graph/full", async (_req, res) => {
    // Each parallel query needs its own session (Neo4j doesn't allow concurrent queries on one session)
    const sessions = Array.from({ length: 9 }, () => neo4jDriver.session());
    try {
      const [linksRes, catsRes, techsRes, toolsRes, usersRes, edgesRes, metaRes, conceptsRes, authorsRes] = await Promise.all([
        sessions[0]!.run(`
          MATCH (l:Link)
          OPTIONAL MATCH (l)-[r]-() WHERE NOT type(r) = 'TAGGED_WITH'
          RETURN l.url AS id, l.title AS title, l.domain AS domain,
                 COALESCE(l.forgeScore, 0) AS forgeScore,
                 COALESCE(l.contentType, 'reference') AS contentType,
                 COALESCE(l.quality, '') AS quality,
                 COALESCE(l.integrationType, '') AS integrationType,
                 COALESCE(l.difficulty, '') AS difficulty,
                 l.savedAt AS savedAt,
                 count(r) AS connectionCount
        `),
        sessions[1]!.run(`
          MATCH (c:Category)
          OPTIONAL MATCH (c)-[r]-()
          RETURN c.name AS name, count(r) AS connectionCount
        `),
        sessions[2]!.run(`
          MATCH (t:Technology)
          OPTIONAL MATCH (t)-[r]-()
          RETURN t.name AS name, count(r) AS connectionCount
        `),
        sessions[3]!.run(`
          MATCH (t:Tool)
          OPTIONAL MATCH (t)-[r]-()
          RETURN t.name AS name, count(r) AS connectionCount
        `),
        sessions[4]!.run(`
          MATCH (u:User)
          OPTIONAL MATCH (u)-[r]-()
          RETURN u.discordId AS discordId, u.displayName AS displayName,
                 u.avatarUrl AS avatarUrl, u.interests AS interests,
                 count(r) AS connectionCount
        `),
        sessions[5]!.run(`
          MATCH (a)-[r]->(b)
          WHERE NOT type(r) = 'TAGGED_WITH' AND NOT type(r) = 'HAS_CHUNK'
            AND NOT a:Tag AND NOT b:Tag AND NOT a:Chunk AND NOT b:Chunk
          RETURN
            CASE
              WHEN a:Link THEN a.url
              WHEN a:Category THEN 'cat:' + a.name
              WHEN a:Technology THEN 'tech:' + a.name
              WHEN a:Tool THEN 'tool:' + a.name
              WHEN a:User THEN 'user:' + a.discordId
              WHEN a:Concept THEN 'concept:' + a.name
              WHEN a:Author THEN 'author:' + a.name
            END AS source,
            CASE
              WHEN b:Link THEN b.url
              WHEN b:Category THEN 'cat:' + b.name
              WHEN b:Technology THEN 'tech:' + b.name
              WHEN b:Tool THEN 'tool:' + b.name
              WHEN b:User THEN 'user:' + b.discordId
              WHEN b:Concept THEN 'concept:' + b.name
              WHEN b:Author THEN 'author:' + b.name
            END AS target,
            type(r) AS type
        `),
        sessions[6]!.run(`
          MATCH (l:Link) WITH count(l) AS links
          MATCH (c:Category) WITH links, count(c) AS categories
          MATCH (t:Technology) WITH links, categories, count(t) AS technologies
          MATCH (tl:Tool) WITH links, categories, technologies, count(tl) AS tools
          MATCH (u:User) WITH links, categories, technologies, tools, count(u) AS users
          OPTIONAL MATCH (con:Concept) WITH links, categories, technologies, tools, users, count(con) AS concepts
          OPTIONAL MATCH (au:Author) WITH links, categories, technologies, tools, users, concepts, count(au) AS authors
          RETURN links, categories, technologies, tools, users, concepts, authors
        `),
        sessions[7]!.run(`
          MATCH (c:Concept)<-[r:RELATES_TO_CONCEPT]-()
          WITH c, count(r) AS mentions
          ORDER BY mentions DESC LIMIT 200
          RETURN c.name AS name, mentions AS connectionCount
        `),
        sessions[8]!.run(`
          MATCH (a:Author)<-[r:AUTHORED_BY]-()
          WITH a, count(r) AS authored
          ORDER BY authored DESC LIMIT 100
          RETURN a.name AS name, authored AS connectionCount
        `),
      ]);

      const nodes = [
        ...linksRes.records.map((r) => ({
          id: r.get("id") as string,
          title: r.get("title") as string,
          nodeType: "link" as const,
          domain: r.get("domain") as string,
          forgeScore: toNum(r.get("forgeScore")),
          contentType: r.get("contentType") as string,
          quality: r.get("quality") as string,
          integrationType: r.get("integrationType") as string,
          difficulty: r.get("difficulty") as string,
          savedAt: (r.get("savedAt") || "") as string,
          connectionCount: toNum(r.get("connectionCount")),
        })),
        ...catsRes.records.map((r) => ({
          id: `cat:${r.get("name") as string}`,
          title: r.get("name") as string,
          nodeType: "category" as const,
          connectionCount: toNum(r.get("connectionCount")),
        })),
        ...techsRes.records.map((r) => ({
          id: `tech:${r.get("name") as string}`,
          title: r.get("name") as string,
          nodeType: "technology" as const,
          connectionCount: toNum(r.get("connectionCount")),
        })),
        ...toolsRes.records.map((r) => ({
          id: `tool:${r.get("name") as string}`,
          title: r.get("name") as string,
          nodeType: "tool" as const,
          connectionCount: toNum(r.get("connectionCount")),
        })),
        ...usersRes.records.map((r) => ({
          id: `user:${r.get("discordId") as string}`,
          title: r.get("displayName") as string,
          nodeType: "user" as const,
          avatarUrl: (r.get("avatarUrl") || "") as string,
          interests: (r.get("interests") ?? []) as string[],
          connectionCount: toNum(r.get("connectionCount")),
        })),
        ...conceptsRes.records.map((r) => ({
          id: `concept:${r.get("name") as string}`,
          title: r.get("name") as string,
          nodeType: "concept" as const,
          connectionCount: toNum(r.get("connectionCount")),
        })),
        ...authorsRes.records.map((r) => ({
          id: `author:${r.get("name") as string}`,
          title: r.get("name") as string,
          nodeType: "author" as const,
          connectionCount: toNum(r.get("connectionCount")),
        })),
      ];

      const edges = edgesRes.records
        .filter((r) => r.get("source") != null && r.get("target") != null)
        .map((r) => ({
          source: r.get("source") as string,
          target: r.get("target") as string,
          type: r.get("type") as string,
        }));

      const metaRec = metaRes.records[0]!;
      const meta = {
        totalLinks: toNum(metaRec.get("links")),
        totalCategories: toNum(metaRec.get("categories")),
        totalTechnologies: toNum(metaRec.get("technologies")),
        totalTools: toNum(metaRec.get("tools")),
        totalUsers: toNum(metaRec.get("users")),
        totalConcepts: toNum(metaRec.get("concepts")),
        totalAuthors: toNum(metaRec.get("authors")),
      };

      res.json({ nodes, edges, meta });
    } catch (err) {
      logger.error({ err }, "Failed to fetch full graph data");
      res.status(500).json({ error: "Failed to fetch full graph data" });
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  // Node neighborhood API — 2-hop neighborhood including tags
  app.get("/api/graph/node/:nodeId", async (req, res) => {
    const session = neo4jDriver.session();
    const nodeId = decodeURIComponent(req.params["nodeId"]!);
    try {
      // Parse node ID prefix to determine label and match property
      let label: string, matchProp: string, matchVal: string;
      if (nodeId.startsWith("cat:")) {
        label = "Category"; matchProp = "name"; matchVal = nodeId.slice(4);
      } else if (nodeId.startsWith("tech:")) {
        label = "Technology"; matchProp = "name"; matchVal = nodeId.slice(5);
      } else if (nodeId.startsWith("tool:")) {
        label = "Tool"; matchProp = "name"; matchVal = nodeId.slice(5);
      } else if (nodeId.startsWith("user:")) {
        label = "User"; matchProp = "discordId"; matchVal = nodeId.slice(5);
      } else if (nodeId.startsWith("concept:")) {
        label = "Concept"; matchProp = "name"; matchVal = nodeId.slice(8);
      } else if (nodeId.startsWith("author:")) {
        label = "Author"; matchProp = "name"; matchVal = nodeId.slice(7);
      } else {
        label = "Link"; matchProp = "url"; matchVal = nodeId;
      }

      // Find center node
      const centerRes = await session.run(
        `MATCH (c:${label} {${matchProp}: $val}) RETURN c, labels(c)[0] AS label`,
        { val: matchVal },
      );
      if (centerRes.records.length === 0) {
        res.status(404).json({ error: "Node not found" });
        return;
      }

      // Get 2-hop neighborhood nodes (including tags)
      const neighborsRes = await session.run(`
        MATCH (center:${label} {${matchProp}: $val})-[*1..2]-(n)
        WITH DISTINCT n
        RETURN labels(n)[0] AS label,
               CASE WHEN n:Link THEN n.url
                    WHEN n:Category THEN 'cat:' + n.name
                    WHEN n:Technology THEN 'tech:' + n.name
                    WHEN n:Tool THEN 'tool:' + n.name
                    WHEN n:User THEN 'user:' + n.discordId
                    WHEN n:Tag THEN 'tag:' + n.name
               END AS id,
               COALESCE(n.title, n.displayName, n.name) AS title,
               n.domain AS domain,
               COALESCE(n.forgeScore, 0) AS forgeScore,
               COALESCE(n.contentType, '') AS contentType
        LIMIT 500
      `, { val: matchVal });

      // Get all edges between center+neighbors
      const edgesRes = await session.run(`
        MATCH (center:${label} {${matchProp}: $val})
        WITH center
        OPTIONAL MATCH (center)-[*1..2]-(n)
        WITH center, collect(DISTINCT n) AS neighbors
        WITH [center] + neighbors AS allNodes
        UNWIND allNodes AS a
        MATCH (a)-[r]->(b) WHERE b IN allNodes
        RETURN DISTINCT
          CASE WHEN a:Link THEN a.url WHEN a:Category THEN 'cat:' + a.name
               WHEN a:Technology THEN 'tech:' + a.name WHEN a:Tool THEN 'tool:' + a.name
               WHEN a:User THEN 'user:' + a.discordId WHEN a:Tag THEN 'tag:' + a.name
          END AS source,
          CASE WHEN b:Link THEN b.url WHEN b:Category THEN 'cat:' + b.name
               WHEN b:Technology THEN 'tech:' + b.name WHEN b:Tool THEN 'tool:' + b.name
               WHEN b:User THEN 'user:' + b.discordId WHEN b:Tag THEN 'tag:' + b.name
          END AS target,
          type(r) AS type
      `, { val: matchVal });

      // Build center node
      const cRec = centerRes.records[0]!;
      const cNode = cRec.get("c");
      const cLabel = cRec.get("label") as string;
      const center = {
        id: nodeId,
        title: (cNode.properties.title || cNode.properties.displayName || cNode.properties.name) as string,
        nodeType: cLabel.toLowerCase(),
        domain: (cNode.properties.domain || "") as string,
        forgeScore: toNum(cNode.properties.forgeScore || 0),
        contentType: (cNode.properties.contentType || "") as string,
        keyConcepts: cNode.properties.keyConcepts || [],
      };

      const nodes = neighborsRes.records
        .filter((r) => r.get("id") != null)
        .map((r) => {
          const lbl = (r.get("label") as string).toLowerCase();
          return {
            id: r.get("id") as string,
            title: r.get("title") as string,
            nodeType: lbl === "tag" ? "tag" : lbl,
            domain: (r.get("domain") || "") as string,
            forgeScore: toNum(r.get("forgeScore")),
            contentType: (r.get("contentType") || "") as string,
          };
        });

      const edges = edgesRes.records
        .filter((r) => r.get("source") != null && r.get("target") != null)
        .map((r) => ({
          source: r.get("source") as string,
          target: r.get("target") as string,
          type: r.get("type") as string,
        }));

      res.json({ center, nodes, edges });
    } catch (err) {
      logger.error({ err, nodeId }, "Failed to fetch node neighborhood");
      res.status(500).json({ error: "Failed to fetch node neighborhood" });
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
        WITH l
        OPTIONAL MATCH (l)-[:CATEGORIZED_IN]->(cat:Category)
        WITH l, collect(cat.name) AS categories
        RETURN l.url AS url, l.title AS title, l.domain AS domain,
               COALESCE(l.forgeScore, 0) AS forgeScore,
               COALESCE(l.contentType, 'reference') AS contentType,
               l.purpose AS purpose, l.quality AS quality, l.savedAt AS savedAt,
               l.keyConcepts AS keyConcepts, l.authors AS authors,
               l.keyTakeaways AS keyTakeaways, l.difficulty AS difficulty,
               l.integrationType AS integrationType, categories
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
        keyConcepts: r.get("keyConcepts") ?? [],
        authors: r.get("authors") ?? [],
        keyTakeaways: r.get("keyTakeaways") ?? [],
        difficulty: r.get("difficulty") ?? null,
        integrationType: r.get("integrationType") ?? null,
        categories: r.get("categories") ?? [],
      }));

      res.json({ links, count: links.length, offset: offset.toNumber(), limit: limit.toNumber() });
    } catch (err) {
      logger.error({ err }, "Failed to fetch links");
      res.status(500).json({ error: "Failed to fetch links" });
    } finally {
      await session.close();
    }
  });

  // Single link detail API
  app.get("/api/link/:encodedUrl", async (req, res) => {
    const session = neo4jDriver.session();
    try {
      const url = decodeURIComponent(req.params["encodedUrl"]!);

      const result = await session.run(`
        MATCH (l:Link {url: $url})
        OPTIONAL MATCH (l)-[:CATEGORIZED_IN]->(c:Category)
        OPTIONAL MATCH (l)-[:TAGGED_WITH]->(t:Tag)
        OPTIONAL MATCH (l)-[:MENTIONS_TECH]->(tech:Technology)
        OPTIONAL MATCH (l)-[:MENTIONS_TOOL]->(tool:Tool)
        OPTIONAL MATCH (l)-[:SHARED_BY]->(u:User)
        OPTIONAL MATCH (l)-[:RELATES_TO_CONCEPT]->(con:Concept)
        OPTIONAL MATCH (l)-[:AUTHORED_BY]->(au:Author)
        RETURN l, collect(DISTINCT c.name) AS categories,
               collect(DISTINCT t.name) AS tags,
               collect(DISTINCT tech.name) AS technologies,
               collect(DISTINCT { name: tool.name, url: tool.url }) AS tools,
               collect(DISTINCT { displayName: u.displayName, avatarUrl: u.avatarUrl }) AS sharedBy,
               collect(DISTINCT con.name) AS concepts,
               collect(DISTINCT au.name) AS authors
      `, { url });

      if (result.records.length === 0) {
        res.status(404).json({ error: "Link not found" });
        return;
      }

      const rec = result.records[0]!;
      const l = rec.get("l").properties;

      // Get related links
      const relResult = await session.run(`
        MATCH (l:Link {url: $url})-[r:RELATED_TO]-(other:Link)
        RETURN other.url AS url, other.title AS title,
               COALESCE(other.forgeScore, 0) AS forgeScore, r.score AS score
        ORDER BY r.score DESC LIMIT 10
      `, { url });

      // Get links to / linked from
      const linksToResult = await session.run(`
        MATCH (l:Link {url: $url})-[:LINKS_TO]->(other:Link)
        RETURN other.url AS url, other.title AS title
        LIMIT 20
      `, { url });

      const linkedFromResult = await session.run(`
        MATCH (other:Link)-[:LINKS_TO]->(l:Link {url: $url})
        RETURN other.url AS url, other.title AS title
        LIMIT 20
      `, { url });

      res.json({
        link: {
          url: l.url,
          title: l.title,
          description: l.description ?? "",
          domain: l.domain,
          savedAt: l.savedAt,
          forgeScore: toNum(l.forgeScore ?? 0),
          contentType: l.contentType ?? "reference",
          purpose: l.purpose ?? "",
          integrationType: l.integrationType ?? "",
          quality: l.quality ?? "",
          keyConcepts: l.keyConcepts ?? [],
          authors: l.authors ?? [],
          keyTakeaways: l.keyTakeaways ?? [],
          difficulty: l.difficulty ?? "",
          content: (l.content ?? "").slice(0, 2000),
        },
        categories: rec.get("categories").filter((c: string | null) => c != null),
        tags: rec.get("tags").filter((t: string | null) => t != null),
        technologies: rec.get("technologies").filter((t: string | null) => t != null),
        tools: (rec.get("tools") as Array<{ name: string | null; url: string | null }>)
          .filter((t) => t.name != null),
        sharedBy: (rec.get("sharedBy") as Array<{ displayName: string | null; avatarUrl: string | null }>)
          .filter((u) => u.displayName != null),
        concepts: rec.get("concepts").filter((c: string | null) => c != null),
        graphAuthors: rec.get("authors").filter((a: string | null) => a != null),
        relatedLinks: relResult.records.map((r) => ({
          url: r.get("url") as string,
          title: r.get("title") as string,
          forgeScore: toNum(r.get("forgeScore")),
          score: toNum(r.get("score")),
        })),
        linksTo: linksToResult.records.map((r) => ({
          url: r.get("url") as string,
          title: r.get("title") as string,
        })),
        linkedFrom: linkedFromResult.records.map((r) => ({
          url: r.get("url") as string,
          title: r.get("title") as string,
        })),
      });
    } catch (err) {
      logger.error({ err }, "Failed to fetch link detail");
      res.status(500).json({ error: "Failed to fetch link detail" });
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
        RETURN u.discordId AS discordId, u.displayName AS displayName,
               u.avatarUrl AS avatarUrl, u.interests AS interests,
               count(l) AS linkCount
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
        avatarUrl: (r.get("avatarUrl") || "") as string,
        interests: (r.get("interests") ?? []) as string[],
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

  // Quality distribution
  app.get("/api/stats/quality", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(`
        MATCH (l:Link)
        RETURN COALESCE(l.quality, 'unknown') AS quality, count(l) AS count
        ORDER BY count DESC
      `);
      res.json(result.records.map((r) => ({
        quality: r.get("quality") as string,
        count: toNum(r.get("count")),
      })));
    } catch (err) {
      logger.error({ err }, "Failed to fetch quality stats");
      res.status(500).json({ error: "Failed to fetch quality stats" });
    } finally {
      await session.close();
    }
  });

  // Integration type distribution
  app.get("/api/stats/integration", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(`
        MATCH (l:Link)
        RETURN COALESCE(l.integrationType, 'unknown') AS integrationType, count(l) AS count
        ORDER BY count DESC
      `);
      res.json(result.records.map((r) => ({
        integrationType: r.get("integrationType") as string,
        count: toNum(r.get("count")),
      })));
    } catch (err) {
      logger.error({ err }, "Failed to fetch integration stats");
      res.status(500).json({ error: "Failed to fetch integration stats" });
    } finally {
      await session.close();
    }
  });

  // Top domains
  app.get("/api/stats/domains", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(`
        MATCH (l:Link)
        WHERE l.domain IS NOT NULL AND l.domain <> ''
        RETURN l.domain AS domain, count(l) AS count
        ORDER BY count DESC LIMIT 15
      `);
      res.json(result.records.map((r) => ({
        domain: r.get("domain") as string,
        count: toNum(r.get("count")),
      })));
    } catch (err) {
      logger.error({ err }, "Failed to fetch domain stats");
      res.status(500).json({ error: "Failed to fetch domain stats" });
    } finally {
      await session.close();
    }
  });

  // Difficulty distribution
  app.get("/api/stats/difficulty", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(`
        MATCH (l:Link)
        WHERE l.difficulty IS NOT NULL AND l.difficulty <> ''
        RETURN l.difficulty AS difficulty, count(l) AS count
        ORDER BY count DESC
      `);
      res.json(result.records.map((r) => ({
        difficulty: r.get("difficulty") as string,
        count: toNum(r.get("count")),
      })));
    } catch (err) {
      logger.error({ err }, "Failed to fetch difficulty stats");
      res.status(500).json({ error: "Failed to fetch difficulty stats" });
    } finally {
      await session.close();
    }
  });

  // Timeline (links per week)
  app.get("/api/stats/timeline", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(`
        MATCH (l:Link)
        WHERE l.savedAt IS NOT NULL
        WITH l, date(datetime(l.savedAt)) AS d
        WITH d.year AS yr, d.week AS wk, count(l) AS count
        ORDER BY yr, wk
        RETURN yr + '-W' + CASE WHEN wk < 10 THEN '0' + wk ELSE '' + wk END AS week, count
      `);
      res.json(result.records.map((r) => ({
        week: r.get("week") as string,
        count: toNum(r.get("count")),
      })));
    } catch (err) {
      logger.error({ err }, "Failed to fetch timeline stats");
      res.status(500).json({ error: "Failed to fetch timeline stats" });
    } finally {
      await session.close();
    }
  });

  // Technology landscape
  app.get("/api/stats/tech-landscape", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(`
        MATCH (l:Link)-[:MENTIONS_TECH]->(t:Technology)
        WITH t, count(l) AS linkCount, avg(COALESCE(l.forgeScore, 0)) AS avgScore
        ORDER BY linkCount DESC LIMIT 30
        OPTIONAL MATCH (tool:Tool)-[:USED_WITH]->(t)
        RETURN t.name AS name, linkCount, avgScore,
               collect(DISTINCT { name: tool.name, url: tool.url }) AS tools
      `);
      const techs = result.records.map((r) => ({
        name: r.get("name") as string,
        linkCount: toNum(r.get("linkCount")),
        avgScore: Math.round(toNum(r.get("avgScore")) * 100) / 100,
        tools: (r.get("tools") as Array<{ name: string | null; url: string | null }>)
          .filter((t) => t.name != null),
      }));
      res.json(techs);
    } catch (err) {
      logger.error({ err }, "Failed to fetch tech landscape");
      res.status(500).json({ error: "Failed to fetch tech landscape" });
    } finally {
      await session.close();
    }
  });

  // Category tree (SUBCATEGORY_OF hierarchy)
  app.get("/api/stats/category-tree", async (_req, res) => {
    const session = neo4jDriver.session();
    try {
      // Get all subcategory relationships
      const relRes = await session.run(`
        MATCH (child:Category)-[:SUBCATEGORY_OF]->(parent:Category)
        RETURN parent.name AS parent, child.name AS child
      `);
      // Get all categories with link counts
      const catRes = await session.run(`
        MATCH (c:Category)
        OPTIONAL MATCH (l:Link)-[:CATEGORIZED_IN]->(c)
        RETURN c.name AS name, count(l) AS linkCount
        ORDER BY linkCount DESC
      `);

      const linkCounts: Record<string, number> = {};
      for (const r of catRes.records) {
        linkCounts[r.get("name") as string] = toNum(r.get("linkCount"));
      }

      const children: Record<string, string[]> = {};
      const hasParent = new Set<string>();
      for (const r of relRes.records) {
        const parent = r.get("parent") as string;
        const child = r.get("child") as string;
        if (!children[parent]) children[parent] = [];
        children[parent].push(child);
        hasParent.add(child);
      }

      // Build tree: roots are categories with children that are not themselves children
      const roots = Object.keys(children)
        .filter((p) => !hasParent.has(p))
        .sort((a, b) => (linkCounts[b] || 0) - (linkCounts[a] || 0));

      const tree = roots.map((root) => ({
        name: root,
        linkCount: linkCounts[root] || 0,
        children: (children[root] || [])
          .map((ch) => ({ name: ch, linkCount: linkCounts[ch] || 0 }))
          .sort((a, b) => b.linkCount - a.linkCount),
      }));

      res.json(tree);
    } catch (err) {
      logger.error({ err }, "Failed to fetch category tree");
      res.status(500).json({ error: "Failed to fetch category tree" });
    } finally {
      await session.close();
    }
  });

  // RAG query endpoint (stricter rate limit)
  app.post("/api/ask", askLimiter, async (req, res) => {
    if (!embeddings) {
      res.status(503).json({ error: "Embedding service not available" });
      return;
    }

    const question = (req.body as { question?: string })?.question;
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      res.status(400).json({ error: "Missing or empty question" });
      return;
    }

    try {
      logger.info({ question: question.slice(0, 100) }, "RAG query from dashboard");
      const result = await askQuestion(question.trim(), neo4jDriver, embeddings, logger);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "RAG query failed");
      res.status(500).json({ error: "Query failed — check server logs" });
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
