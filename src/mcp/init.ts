import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import type { EmbeddingService } from "../embeddings/index.js";

export interface McpDeps {
  neo4jDriver: Driver;
  embeddings: EmbeddingService;
}

export async function initMcpDeps(): Promise<McpDeps> {
  const uri = process.env["NEO4J_URI"] || "bolt://localhost:7687";
  const user = process.env["NEO4J_USER"] || "neo4j";
  const password = process.env["NEO4J_PASSWORD"] || "link_forge_dev";

  // MCP logs to stderr only (stdout is protocol)
  const log = (msg: string) => process.stderr.write(`[link-forge] ${msg}\n`);

  log("Connecting to Neo4j...");
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  await driver.verifyConnectivity();
  log("Neo4j connected");

  log("Loading embedding model...");
  const { createEmbeddingService } = await import("../embeddings/index.js");

  // Redirect pino to stderr (fd 2) since stdout is MCP protocol
  const pino = await import("pino");
  const stderrLogger = pino.default({
    level: "info",
    name: "mcp",
  }, pino.destination(2));

  const embeddings = await createEmbeddingService(stderrLogger);
  log("Embedding model loaded");

  return { neo4jDriver: driver, embeddings };
}
