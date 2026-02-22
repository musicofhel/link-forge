import neo4j, { type Driver } from "neo4j-driver";
import { listCategoryTree } from "../../graph/repositories/category.repository.js";
import { findToolsByTechnology, listTools } from "../../graph/repositories/tool.repository.js";

export const forgeCategoriesListTool = {
  name: "forge_categories",
  description:
    "List all categories in the link library as a tree. " +
    "Shows category names, descriptions, and link counts. " +
    "Use this to explore what topics are available before browsing.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleForgeCategories(
  driver: Driver,
): Promise<string> {
  const session = driver.session();
  try {
    const tree = await listCategoryTree(session);

    if (tree.length === 0) {
      return "No categories yet. Start dropping links in Discord!";
    }

    const formatted = tree.map((cat) => {
      let line = `- **${cat.name}** (${cat.linkCount} links)`;
      if (cat.description) line += ` — ${cat.description}`;
      if (cat.subcategories && cat.subcategories.length > 0) {
        for (const sub of cat.subcategories) {
          line += `\n  - ${sub.name} (${sub.linkCount} links)`;
        }
      }
      return line;
    });

    return `Categories:\n\n${formatted.join("\n")}`;
  } finally {
    await session.close();
  }
}

export const forgeBrowseCategoryTool = {
  name: "forge_browse_category",
  description:
    "List all links saved under a specific category. " +
    "Returns link titles, URLs, and summaries.",
  inputSchema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        description: "Category name to browse",
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 20)",
      },
    },
    required: ["category"],
  },
};

export async function handleForgeBrowseCategory(
  args: { category: string; limit?: number },
  driver: Driver,
): Promise<string> {
  const limit = args.limit ?? 20;
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (l:Link)-[:CATEGORIZED_IN]->(c:Category {name: $category})
       OPTIONAL MATCH (l)-[:TAGGED_WITH]->(t:Tag)
       RETURN l, collect(t.name) AS tags
       ORDER BY COALESCE(l.forgeScore, 0) DESC, l.savedAt DESC
       LIMIT $limit`,
      { category: args.category, limit: neo4jInt(limit) },
    );

    if (result.records.length === 0) {
      return `No links found in category "${args.category}".`;
    }

    const formatted = result.records.map((rec, i) => {
      const link = rec.get("l").properties;
      const tags = rec.get("tags") as string[];
      const forgeScore = link.forgeScore as number | null;
      const contentType = link.contentType as string | null;
      const parts = [
        `${i + 1}. **${link.title}**`,
        `   URL: ${link.url}`,
        `   ${link.description}`,
      ];
      if (forgeScore != null) parts.push(`   Forge: ${(forgeScore as number).toFixed(2)} | ${contentType ?? "unknown"}`);
      if (tags.length > 0) parts.push(`   Tags: ${tags.join(", ")}`);
      return parts.join("\n");
    });

    return `Links in "${args.category}":\n\n${formatted.join("\n\n")}`;
  } finally {
    await session.close();
  }
}

export const forgeFindToolsTool = {
  name: "forge_find_tools",
  description:
    "Find tools saved for a specific technology or framework. " +
    "Example: find tools for 'Python', 'React', or 'Neo4j'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      technology: {
        type: "string",
        description: "Technology name to search tools for",
      },
    },
    required: ["technology"],
  },
};

export async function handleForgeFindTools(
  args: { technology: string },
  driver: Driver,
): Promise<string> {
  const session = driver.session();
  try {
    const tools = await findToolsByTechnology(session, args.technology);

    if (tools.length === 0) {
      // Fall back to listing all tools
      const allTools = await listTools(session);
      if (allTools.length === 0) {
        return `No tools found for "${args.technology}" and no tools in the library yet.`;
      }
      return `No tools specifically for "${args.technology}", but here are all saved tools:\n\n` +
        allTools.map((t) => `- **${t.name}**${t.url ? ` (${t.url})` : ""}${t.description ? ` — ${t.description}` : ""}`).join("\n");
    }

    const formatted = tools.map(
      (t) => `- **${t.name}**${t.url ? ` (${t.url})` : ""}${t.description ? ` — ${t.description}` : ""}`,
    );

    return `Tools for "${args.technology}":\n\n${formatted.join("\n")}`;
  } finally {
    await session.close();
  }
}

export const forgeRelatedTool = {
  name: "forge_related",
  description:
    "Find links related to a specific link by URL. " +
    "Uses both graph relationships and vector similarity.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "URL of the link to find related content for",
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 5)",
      },
    },
    required: ["url"],
  },
};

export async function handleForgeRelated(
  args: { url: string; limit?: number },
  driver: Driver,
): Promise<string> {
  const limit = args.limit ?? 5;
  const session = driver.session();
  try {
    // Find via graph relationships first
    const graphResult = await session.run(
      `MATCH (l:Link {url: $url})-[:RELATED_TO]-(related:Link)
       RETURN related
       LIMIT $limit`,
      { url: args.url, limit: neo4jInt(limit) },
    );

    // Also find via shared categories/tags
    const sharedResult = await session.run(
      `MATCH (l:Link {url: $url})-[:CATEGORIZED_IN]->(c:Category)<-[:CATEGORIZED_IN]-(related:Link)
       WHERE related.url <> $url
       RETURN DISTINCT related, count(*) AS shared
       ORDER BY shared DESC
       LIMIT $limit`,
      { url: args.url, limit: neo4jInt(limit) },
    );

    const seen = new Set<string>();
    const links: Array<{ title: string; url: string; description: string }> = [];

    for (const rec of graphResult.records) {
      const props = rec.get("related").properties;
      if (!seen.has(props.url)) {
        seen.add(props.url);
        links.push({ title: props.title, url: props.url, description: props.description });
      }
    }

    for (const rec of sharedResult.records) {
      const props = rec.get("related").properties;
      if (!seen.has(props.url)) {
        seen.add(props.url);
        links.push({ title: props.title, url: props.url, description: props.description });
      }
    }

    if (links.length === 0) {
      return `No related links found for "${args.url}".`;
    }

    const formatted = links.map(
      (l, i) => `${i + 1}. **${l.title}**\n   URL: ${l.url}\n   ${l.description}`,
    );

    return `Related links:\n\n${formatted.join("\n\n")}`;
  } finally {
    await session.close();
  }
}

function neo4jInt(n: number) {
  // neo4j driver expects integers for LIMIT; MCP SDK may pass floats
  return neo4j.int(Math.round(n));
}
