import type { Driver } from "neo4j-driver";
import {
  listTopConcepts,
  findLinksByConcept,
  findRelatedConcepts,
} from "../../graph/repositories/concept.repository.js";

export async function handleForgeConcepts(
  args: { concept?: string; limit?: number },
  driver: Driver,
): Promise<string> {
  const limit = args.limit ?? 15;
  const session = driver.session();

  try {
    if (args.concept) {
      // Show links + related concepts for a specific concept
      const normalized = args.concept.toLowerCase().trim();
      const [links, related] = await Promise.all([
        findLinksByConcept(session, normalized, limit),
        findRelatedConcepts(session, normalized, 10),
      ]);

      if (links.length === 0) {
        return `No links found for concept "${normalized}". Try listing top concepts without a specific name.`;
      }

      const parts: string[] = [`## Concept: "${normalized}" (${links.length} links)\n`];

      parts.push("### Links");
      for (const link of links) {
        parts.push(`- **${link.title || link.url}** (forge: ${link.forgeScore.toFixed(2)}, type: ${link.contentType})`);
        parts.push(`  URL: ${link.url}`);
      }

      if (related.length > 0) {
        parts.push("\n### Related Concepts (co-occur on same links)");
        for (const r of related) {
          parts.push(`- ${r.name} (${r.coOccurrences} shared links)`);
        }
      }

      return parts.join("\n");
    } else {
      // List top concepts
      const concepts = await listTopConcepts(session, limit);

      if (concepts.length === 0) {
        return "No concepts found in the knowledge graph yet.";
      }

      const parts: string[] = [`## Top ${concepts.length} Concepts\n`];
      for (const c of concepts) {
        parts.push(`- **${c.name}** (${c.mentionCount} links)`);
      }

      return parts.join("\n");
    }
  } finally {
    await session.close();
  }
}
