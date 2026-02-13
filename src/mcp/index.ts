import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initMcpDeps } from "./init.js";
import {
  handleForgeSearch,
  handleForgeCategories,
  handleForgeBrowseCategory,
  handleForgeFindTools,
  handleForgeRelated,
  handleForgeRecent,
} from "./tools/index.js";

async function main() {
  const log = (msg: string) => process.stderr.write(`[link-forge-mcp] ${msg}\n`);

  const server = new McpServer({
    name: "link-forge",
    version: "1.0.0",
  });

  log("Initializing dependencies...");
  const { neo4jDriver, embeddings } = await initMcpDeps();

  // Register tools
  server.tool(
    "forge_search",
    "Search your saved links using hybrid vector + keyword search. Use natural language queries.",
    {
      query: z.string().describe("Natural language search query"),
      limit: z.number().optional().describe("Maximum results to return (default: 10)"),
    },
    async ({ query, limit }) => {
      try {
        const text = await handleForgeSearch({ query, limit }, neo4jDriver, embeddings);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "forge_categories",
    "List all categories in the link library as a tree with link counts.",
    {},
    async () => {
      try {
        const text = await handleForgeCategories(neo4jDriver);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "forge_browse_category",
    "List all links saved under a specific category.",
    {
      category: z.string().describe("Category name to browse"),
      limit: z.number().optional().describe("Maximum results (default: 20)"),
    },
    async ({ category, limit }) => {
      try {
        const text = await handleForgeBrowseCategory({ category, limit }, neo4jDriver);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "forge_find_tools",
    "Find tools saved for a specific technology or framework.",
    {
      technology: z.string().describe("Technology name to search tools for"),
    },
    async ({ technology }) => {
      try {
        const text = await handleForgeFindTools({ technology }, neo4jDriver);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "forge_related",
    "Find links related to a specific link by URL using graph relationships and vector similarity.",
    {
      url: z.string().describe("URL of the link to find related content for"),
      limit: z.number().optional().describe("Maximum results (default: 5)"),
    },
    async ({ url, limit }) => {
      try {
        const text = await handleForgeRelated({ url, limit }, neo4jDriver);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "forge_recent",
    "Get the most recently saved links with titles, URLs, categories, and save dates.",
    {
      limit: z.number().optional().describe("Number of recent links (default: 10, max: 50)"),
    },
    async ({ limit }) => {
      try {
        const text = await handleForgeRecent({ limit }, neo4jDriver);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  // Graceful shutdown
  process.on("SIGINT", async () => {
    log("Shutting down...");
    await neo4jDriver.close();
    process.exit(0);
  });

  log("Starting MCP server on stdio...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running");
}

main().catch((err) => {
  process.stderr.write(`[link-forge-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
