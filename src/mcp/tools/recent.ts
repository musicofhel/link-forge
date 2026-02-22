import neo4j, { type Driver } from "neo4j-driver";

export const forgeRecentTool = {
  name: "forge_recent",
  description:
    "Get the most recently saved links. " +
    "Shows titles, URLs, categories, and when they were saved.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "number",
        description: "Number of recent links to return (default: 10, max: 50)",
      },
    },
  },
};

export async function handleForgeRecent(
  args: { limit?: number },
  driver: Driver,
): Promise<string> {
  const limit = neo4j.int(Math.round(Math.min(args.limit ?? 10, 50)));
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (l:Link)
       OPTIONAL MATCH (l)-[:CATEGORIZED_IN]->(c:Category)
       OPTIONAL MATCH (l)-[:TAGGED_WITH]->(t:Tag)
       RETURN l, c.name AS category, collect(t.name) AS tags
       ORDER BY l.savedAt DESC
       LIMIT $limit`,
      { limit },
    );

    if (result.records.length === 0) {
      return "No links saved yet. Start dropping links in Discord!";
    }

    const formatted = result.records.map((rec, i) => {
      const link = rec.get("l").properties;
      const category = rec.get("category") as string | null;
      const tags = rec.get("tags") as string[];

      const parts = [
        `${i + 1}. **${link.title}**`,
        `   URL: ${link.url}`,
        `   ${link.description}`,
      ];
      if (category) parts.push(`   Category: ${category}`);
      if (tags.length > 0) parts.push(`   Tags: ${tags.join(", ")}`);
      if (link.savedAt) parts.push(`   Saved: ${link.savedAt}`);
      return parts.join("\n");
    });

    return `${result.records.length} most recent links:\n\n${formatted.join("\n\n")}`;
  } finally {
    await session.close();
  }
}
