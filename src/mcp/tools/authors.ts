import type { Driver } from "neo4j-driver";
import {
  listTopAuthors,
  findLinksByAuthor,
  findCoAuthors,
} from "../../graph/repositories/author.repository.js";

export async function handleForgeAuthors(
  args: { author?: string; limit?: number },
  driver: Driver,
): Promise<string> {
  const limit = args.limit ?? 15;
  const session = driver.session();

  try {
    if (args.author) {
      // Show links + co-authors for a specific author
      const trimmed = args.author.trim();
      const [links, coAuthors] = await Promise.all([
        findLinksByAuthor(session, trimmed, limit),
        findCoAuthors(session, trimmed, 10),
      ]);

      if (links.length === 0) {
        return `No links found for author "${trimmed}". Try listing top authors without a specific name.`;
      }

      const parts: string[] = [`## Author: "${trimmed}" (${links.length} links)\n`];

      parts.push("### Publications");
      for (const link of links) {
        parts.push(`- **${link.title || link.url}** (forge: ${link.forgeScore.toFixed(2)}, type: ${link.contentType})`);
        parts.push(`  URL: ${link.url}`);
      }

      if (coAuthors.length > 0) {
        parts.push("\n### Co-Authors");
        for (const ca of coAuthors) {
          parts.push(`- ${ca.name} (${ca.sharedLinks} shared publications)`);
        }
      }

      return parts.join("\n");
    } else {
      // List top authors
      const authors = await listTopAuthors(session, limit);

      if (authors.length === 0) {
        return "No authors found in the knowledge graph yet.";
      }

      const parts: string[] = [`## Top ${authors.length} Authors\n`];
      for (const a of authors) {
        parts.push(`- **${a.name}** (${a.mentionCount} links)`);
      }

      return parts.join("\n");
    }
  } finally {
    await session.close();
  }
}
