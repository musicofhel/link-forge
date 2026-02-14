/**
 * RAG query engine — ask natural language questions against the knowledge graph.
 *
 * Pipeline:
 *   1. Embed the question (all-MiniLM-L6-v2)
 *   2. Vector search Neo4j for top-K relevant links
 *   3. Pull relationships (categories, tools, techs, users) for matches
 *   4. Get user expertise summaries + tool landscape
 *   5. Build context prompt
 *   6. Call Claude CLI for synthesis
 *   7. Return answer + sources
 */

import { spawn } from "node:child_process";
import type { Driver } from "neo4j-driver";
import type pino from "pino";
import type { EmbeddingService } from "../embeddings/index.js";

export interface RAGSource {
  url: string;
  title: string;
  forgeScore: number;
  relevance: number;
  contentType: string;
  category?: string;
}

export interface RAGResult {
  answer: string;
  sources: RAGSource[];
  context: {
    linksSearched: number;
    topLinksUsed: number;
    usersReferenced: number;
  };
}

const toNum = (val: unknown) => typeof val === "number" ? val : Number(val);

const RAG_SYSTEM_PROMPT = `You are an AI advisor for a Discord community of builders, developers, and AI enthusiasts. You have access to their collective knowledge graph — every link, tool, technology, and idea they've shared and discussed.

Use the context below to answer the question. Ground your answer in the actual data — reference specific tools, links, users, and patterns from the knowledge graph.

Guidelines:
- Be concise, actionable, and specific
- When recommending tools or approaches, cite the actual links and who shared them
- If the data supports a strong answer, be confident. If it's speculative, say so.
- Reference community members by name when their expertise is relevant
- Don't just list things — synthesize insights and draw connections between the data points`;

export async function askQuestion(
  question: string,
  neo4jDriver: Driver,
  embeddings: EmbeddingService,
  logger: pino.Logger,
): Promise<RAGResult> {
  const startTime = Date.now();

  // 1. Embed the question
  logger.info({ question }, "Embedding question");
  const questionEmbedding = await embeddings.embed(question);

  const session = neo4jDriver.session();
  try {
    // 2. Vector search for relevant links
    const vectorRes = await session.run(
      `CALL db.index.vector.queryNodes('link_embedding_idx', 20, $embedding)
       YIELD node AS l, score
       RETURN l.url AS url, l.title AS title, l.description AS description,
              COALESCE(l.forgeScore, 0) AS forgeScore, COALESCE(l.contentType, 'reference') AS contentType,
              l.purpose AS purpose, l.domain AS domain, score AS relevance
       ORDER BY score DESC`,
      { embedding: questionEmbedding },
    );

    const topLinks = vectorRes.records.map(r => ({
      url: r.get("url") as string,
      title: (r.get("title") as string) || "",
      description: (r.get("description") as string) || "",
      forgeScore: toNum(r.get("forgeScore")),
      contentType: (r.get("contentType") as string) || "reference",
      purpose: (r.get("purpose") as string) || "",
      domain: (r.get("domain") as string) || "",
      relevance: toNum(r.get("relevance")),
    }));

    logger.info({ matches: topLinks.length, topRelevance: topLinks[0]?.relevance }, "Vector search complete");

    // 3. Get categories + tools + techs + users for top links
    const linkUrls = topLinks.map(l => l.url);

    const relRes = await session.run(
      `UNWIND $urls AS url
       MATCH (l:Link {url: url})
       OPTIONAL MATCH (l)-[:CATEGORIZED_IN]->(c:Category)
       OPTIONAL MATCH (l)-[:MENTIONS_TOOL]->(tool:Tool)
       OPTIONAL MATCH (l)-[:MENTIONS_TECH]->(tech:Technology)
       OPTIONAL MATCH (l)-[:SHARED_BY]->(u:User)
       RETURN l.url AS url,
              collect(DISTINCT c.name) AS categories,
              collect(DISTINCT tool.name) AS tools,
              collect(DISTINCT tech.name) AS technologies,
              collect(DISTINCT u.displayName) AS sharedBy`,
      { urls: linkUrls },
    );

    const relMap: Record<string, { categories: string[]; tools: string[]; technologies: string[]; sharedBy: string[] }> = {};
    for (const r of relRes.records) {
      relMap[r.get("url") as string] = {
        categories: (r.get("categories") as string[]).filter(Boolean),
        tools: (r.get("tools") as string[]).filter(Boolean),
        technologies: (r.get("technologies") as string[]).filter(Boolean),
        sharedBy: (r.get("sharedBy") as string[]).filter(Boolean),
      };
    }

    // 4. Get user expertise summaries
    const userRes = await session.run(`
      MATCH (u:User)<-[:SHARED_BY]-(l:Link)
      WITH u, count(l) AS linkCount
      OPTIONAL MATCH (u)<-[:SHARED_BY]-(l2:Link)-[:CATEGORIZED_IN]->(c:Category)
      WITH u, linkCount, collect(DISTINCT c.name)[0..5] AS topCategories
      OPTIONAL MATCH (u)<-[:SHARED_BY]-(l3:Link)-[:MENTIONS_TOOL]->(t:Tool)
      WITH u, linkCount, topCategories, collect(DISTINCT t.name)[0..5] AS topTools
      RETURN u.displayName AS name, linkCount, topCategories, topTools
      ORDER BY linkCount DESC
    `);

    const users = userRes.records.map(r => ({
      name: r.get("name") as string,
      linkCount: toNum(r.get("linkCount")),
      topCategories: (r.get("topCategories") as string[]).filter(Boolean),
      topTools: (r.get("topTools") as string[]).filter(Boolean),
    }));

    // 5. Get global tool landscape (top 30 by mention count)
    const toolRes = await session.run(`
      MATCH (t:Tool)<-[:MENTIONS_TOOL]-(l:Link)
      RETURN t.name AS name, count(l) AS mentions
      ORDER BY mentions DESC LIMIT 30
    `);
    const topTools = toolRes.records.map(r => ({
      name: r.get("name") as string,
      mentions: toNum(r.get("mentions")),
    }));

    // 6. Get category landscape
    const catRes = await session.run(`
      MATCH (c:Category)<-[:CATEGORIZED_IN]-(l:Link)
      RETURN c.name AS name, count(l) AS count
      ORDER BY count DESC LIMIT 15
    `);
    const topCategories = catRes.records.map(r => ({
      name: r.get("name") as string,
      count: toNum(r.get("count")),
    }));

    // 7. Build context
    const contextParts: string[] = [];

    contextParts.push("## Most Relevant Links (by semantic similarity to question)");
    for (const link of topLinks) {
      const rels = relMap[link.url] || { categories: [], tools: [], technologies: [], sharedBy: [] };
      contextParts.push(`\n### ${link.title || link.url}`);
      contextParts.push(`URL: ${link.url}`);
      contextParts.push(`Forge Score: ${link.forgeScore} | Type: ${link.contentType} | Relevance: ${(link.relevance * 100).toFixed(0)}%`);
      if (link.description) contextParts.push(`Summary: ${link.description}`);
      if (link.purpose) contextParts.push(`Purpose: ${link.purpose}`);
      if (rels.categories.length) contextParts.push(`Categories: ${rels.categories.join(", ")}`);
      if (rels.tools.length) contextParts.push(`Tools mentioned: ${rels.tools.join(", ")}`);
      if (rels.technologies.length) contextParts.push(`Technologies: ${rels.technologies.join(", ")}`);
      if (rels.sharedBy.length) contextParts.push(`Shared by: ${rels.sharedBy.join(", ")}`);
    }

    contextParts.push("\n## Community Members & Expertise");
    for (const user of users) {
      contextParts.push(`- **${user.name}** (${user.linkCount} links): categories=[${user.topCategories.join(", ")}], tools=[${user.topTools.join(", ")}]`);
    }

    contextParts.push("\n## Top Categories in the Community");
    contextParts.push(topCategories.map(c => `${c.name} (${c.count} links)`).join(", "));

    contextParts.push("\n## Top Tools in the Community (by mention count)");
    contextParts.push(topTools.map(t => `${t.name} (${t.mentions})`).join(", "));

    contextParts.push(`\n## Graph Stats`);
    contextParts.push(`Total links: ${topLinks.length >= 20 ? "600+" : topLinks.length}`);
    contextParts.push(`Community members: ${users.length}`);
    contextParts.push(`Tools tracked: ${topTools.length}+`);

    const fullContext = contextParts.join("\n");

    // 8. Call Claude
    logger.info("Calling Claude for synthesis");
    const input = `${fullContext}\n\n## Question\n${question}`;
    const answer = await spawnClaude(RAG_SYSTEM_PROMPT, input, 120000, logger);

    const elapsed = Date.now() - startTime;
    logger.info({ elapsed, answerLength: answer.length }, "RAG query complete");

    // 9. Build sources
    const sources: RAGSource[] = topLinks.slice(0, 10).map(l => ({
      url: l.url,
      title: l.title,
      forgeScore: l.forgeScore,
      relevance: l.relevance,
      contentType: l.contentType,
      category: relMap[l.url]?.categories[0],
    }));

    return {
      answer,
      sources,
      context: {
        linksSearched: topLinks.length,
        topLinksUsed: topLinks.length,
        usersReferenced: users.length,
      },
    };
  } finally {
    await session.close();
  }
}

function spawnClaude(
  systemPrompt: string,
  input: string,
  timeoutMs: number,
  logger: pino.Logger,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Strip CLAUDECODE env var to allow running inside a Claude Code session
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", ["-p", systemPrompt], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
      env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        logger.warn({ code, stderr: stderr.slice(0, 500) }, "Claude CLI exited with error");
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.on("error", (err) => {
      reject(new Error(`Claude CLI spawn error: ${err.message}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}
