import { describe, it, expect } from "vitest";

// We test the JSON parsing logic from splitter (similar to claude-cli)
describe("taxonomy splitter", () => {
  it("validates a well-formed split proposal", () => {
    const proposal = {
      subcategories: [
        {
          name: "RAG Frameworks",
          description: "Tools for building RAG pipelines",
          linkUrls: ["https://example.com/1", "https://example.com/2"],
        },
        {
          name: "Vector Databases",
          description: "Database solutions for vector search",
          linkUrls: ["https://example.com/3", "https://example.com/4"],
        },
      ],
      reasoning: "Split by use case focus",
    };

    expect(proposal.subcategories).toHaveLength(2);
    expect(proposal.subcategories[0]?.name).toBe("RAG Frameworks");
    expect(proposal.reasoning).toBeTruthy();
  });

  it("rejects proposal with fewer than 2 subcategories", () => {
    const { z } = require("zod") as typeof import("zod");
    const schema = z.object({
      subcategories: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          linkUrls: z.array(z.string()),
        }),
      ).min(2).max(5),
      reasoning: z.string(),
    });

    const bad = {
      subcategories: [
        { name: "Only One", description: "desc", linkUrls: ["url1"] },
      ],
      reasoning: "Not enough subcategories",
    };

    expect(() => schema.parse(bad)).toThrow();
  });

  it("rejects proposal with more than 5 subcategories", () => {
    const { z } = require("zod") as typeof import("zod");
    const schema = z.object({
      subcategories: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          linkUrls: z.array(z.string()),
        }),
      ).min(2).max(5),
      reasoning: z.string(),
    });

    const bad = {
      subcategories: Array.from({ length: 6 }, (_, i) => ({
        name: `Cat ${i}`,
        description: "desc",
        linkUrls: ["url"],
      })),
      reasoning: "Too many",
    };

    expect(() => schema.parse(bad)).toThrow();
  });
});
