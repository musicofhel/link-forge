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
    // 2a. Chunk-level vector search (finer granularity)
    let chunkResults: { chunkText: string; chunkScore: number; linkUrl: string; linkTitle: string; forgeScore: number; contentType: string }[] = [];
    try {
      const chunkRes = await session.run(
        `CALL db.index.vector.queryNodes('chunk_embedding_idx', 40, $embedding)
         YIELD node AS chunk, score
         MATCH (link:Link)-[:HAS_CHUNK]->(chunk)
         RETURN link.url AS linkUrl, link.title AS linkTitle,
                COALESCE(link.forgeScore, 0) AS forgeScore,
                COALESCE(link.contentType, 'reference') AS contentType,
                chunk.text AS chunkText, score AS chunkScore
         ORDER BY score DESC`,
        { embedding: questionEmbedding },
      );
      chunkResults = chunkRes.records.map(r => ({
        chunkText: r.get("chunkText") as string,
        chunkScore: toNum(r.get("chunkScore")),
        linkUrl: r.get("linkUrl") as string,
        linkTitle: (r.get("linkTitle") as string) || "",
        forgeScore: toNum(r.get("forgeScore")),
        contentType: (r.get("contentType") as string) || "reference",
      }));
      logger.info({ chunkMatches: chunkResults.length }, "Chunk vector search complete");
    } catch {
      // Chunk index may not exist yet — gracefully fall back to doc-level only
      logger.debug("Chunk vector index not available, using doc-level search only");
    }

    // Group chunks by parent link, keep top 3 per link
    const linkChunkMap = new Map<string, {
      url: string; title: string; forgeScore: number; contentType: string;
      chunks: { text: string; score: number }[];
      bestScore: number;
    }>();
    for (const cr of chunkResults) {
      if (!linkChunkMap.has(cr.linkUrl)) {
        linkChunkMap.set(cr.linkUrl, {
          url: cr.linkUrl, title: cr.linkTitle, forgeScore: cr.forgeScore,
          contentType: cr.contentType, chunks: [], bestScore: cr.chunkScore,
        });
      }
      const entry = linkChunkMap.get(cr.linkUrl)!;
      if (entry.chunks.length < 3) {
        entry.chunks.push({ text: cr.chunkText, score: cr.chunkScore });
      }
    }

    // 2b. Document-level vector search
    const vectorRes = await session.run(
      `CALL db.index.vector.queryNodes('link_embedding_idx', 20, $embedding)
       YIELD node AS l, score
       RETURN l.url AS url, l.title AS title, l.description AS description,
              COALESCE(l.forgeScore, 0) AS forgeScore, COALESCE(l.contentType, 'reference') AS contentType,
              l.purpose AS purpose, l.domain AS domain, score AS relevance
       ORDER BY score DESC`,
      { embedding: questionEmbedding },
    );

    const docLinks = vectorRes.records.map(r => ({
      url: r.get("url") as string,
      title: (r.get("title") as string) || "",
      description: (r.get("description") as string) || "",
      forgeScore: toNum(r.get("forgeScore")),
      contentType: (r.get("contentType") as string) || "reference",
      purpose: (r.get("purpose") as string) || "",
      domain: (r.get("domain") as string) || "",
      relevance: toNum(r.get("relevance")),
    }));

    // Merge: chunk results first (they have passage-level evidence), then doc-level fills gaps
    const mergedUrls = new Set<string>();
    const topLinks: {
      url: string; title: string; description: string; forgeScore: number;
      contentType: string; purpose: string; domain: string; relevance: number;
      chunks?: { text: string; score: number }[];
    }[] = [];

    // Add chunk-sourced links first (sorted by best chunk score)
    const chunkEntries = [...linkChunkMap.values()].sort((a, b) => b.bestScore - a.bestScore);
    for (const entry of chunkEntries) {
      const docMatch = docLinks.find(d => d.url === entry.url);
      topLinks.push({
        url: entry.url,
        title: entry.title,
        description: docMatch?.description || "",
        forgeScore: entry.forgeScore,
        contentType: entry.contentType,
        purpose: docMatch?.purpose || "",
        domain: docMatch?.domain || "",
        relevance: entry.bestScore,
        chunks: entry.chunks,
      });
      mergedUrls.add(entry.url);
    }

    // Fill from doc-level results
    for (const doc of docLinks) {
      if (!mergedUrls.has(doc.url)) {
        topLinks.push(doc);
        mergedUrls.add(doc.url);
      }
    }

    // Keep top 15 combined results
    topLinks.splice(15);

    logger.info({ matches: topLinks.length, chunkLinks: chunkEntries.length, topRelevance: topLinks[0]?.relevance }, "Vector search complete");

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

    // 3b. Concept-aware expansion: find related links via shared concepts
    const conceptExpansion: { url: string; title: string; forgeScore: number; viaConcept: string }[] = [];
    try {
      const conceptRes = await session.run(
        `MATCH (l:Link)-[:RELATES_TO_CONCEPT]->(c:Concept)
         WHERE l.url IN $topUrls
         WITH c, count(l) AS relevance
         ORDER BY relevance DESC LIMIT 10
         MATCH (c)<-[:RELATES_TO_CONCEPT]-(related:Link)
         WHERE NOT related.url IN $topUrls
         RETURN DISTINCT related.url AS url, related.title AS title,
                COALESCE(related.forgeScore, 0) AS forgeScore, c.name AS viaConcept
         LIMIT 10`,
        { topUrls: linkUrls },
      );
      for (const r of conceptRes.records) {
        conceptExpansion.push({
          url: r.get("url") as string,
          title: (r.get("title") as string) || "",
          forgeScore: toNum(r.get("forgeScore")),
          viaConcept: r.get("viaConcept") as string,
        });
      }
      if (conceptExpansion.length > 0) {
        logger.info({ conceptExpansionCount: conceptExpansion.length }, "Concept expansion found related links");
      }
    } catch {
      // Concept nodes may not exist yet
      logger.debug("Concept expansion skipped (no Concept nodes)");
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
      // Include chunk excerpts if available
      if (link.chunks && link.chunks.length > 0) {
        contextParts.push("**Key Passages:**");
        for (const chunk of link.chunks) {
          contextParts.push(`> "${chunk.text.slice(0, 300)}${chunk.text.length > 300 ? "..." : ""}" (relevance: ${(chunk.score * 100).toFixed(0)}%)`);
        }
      }
    }

    // Concept-expanded links (related via shared concepts)
    if (conceptExpansion.length > 0) {
      contextParts.push("\n## Related Links (discovered via shared concepts)");
      for (const link of conceptExpansion) {
        contextParts.push(`- **${link.title || link.url}** (forge: ${link.forgeScore}, via concept: "${link.viaConcept}")`);
      }
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
