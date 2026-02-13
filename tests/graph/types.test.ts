import { describe, it, expect } from "vitest";
import type {
  LinkNode,
  CategoryNode,
  TagNode,
  TechnologyNode,
  ToolNode,
  SearchResult,
} from "../../src/graph/types.js";

describe("graph types", () => {
  it("LinkNode interface compiles correctly", () => {
    const link: LinkNode = {
      url: "https://example.com",
      title: "Example",
      description: "An example link",
      content: "Full text content",
      embedding: new Array(384).fill(0),
      domain: "example.com",
      savedAt: new Date().toISOString(),
      discordMessageId: "123456789",
      forgeScore: 0.85,
      contentType: "tool",
      purpose: "Example tool for testing",
      integrationType: "cli",
      quality: "high",
    };
    expect(link.url).toBe("https://example.com");
    expect(link.embedding).toHaveLength(384);
    expect(link.forgeScore).toBe(0.85);
    expect(link.contentType).toBe("tool");
  });

  it("CategoryNode interface compiles correctly", () => {
    const category: CategoryNode = {
      name: "Web Development",
      description: "Links about web dev",
      linkCount: 42,
    };
    expect(category.name).toBe("Web Development");
    expect(category.linkCount).toBe(42);
  });

  it("TagNode interface compiles correctly", () => {
    const tag: TagNode = {
      name: "react-hooks",
    };
    expect(tag.name).toBe("react-hooks");
  });

  it("TechnologyNode interface compiles correctly", () => {
    const tech: TechnologyNode = {
      name: "TypeScript",
      description: "A typed superset of JavaScript",
    };
    expect(tech.name).toBe("TypeScript");
  });

  it("ToolNode interface compiles correctly", () => {
    const tool: ToolNode = {
      name: "Vite",
      description: "Next generation frontend tooling",
      url: "https://vitejs.dev",
    };
    expect(tool.url).toBe("https://vitejs.dev");
  });

  it("SearchResult interface compiles correctly", () => {
    const result: SearchResult = {
      link: {
        url: "https://example.com",
        title: "Example",
        description: "An example",
        content: "Content",
        embedding: [],
        domain: "example.com",
        savedAt: new Date().toISOString(),
        discordMessageId: "123",
        forgeScore: 0.72,
        contentType: "tutorial",
        purpose: "Learn testing",
        integrationType: "guide",
        quality: "high",
      },
      score: 0.95,
      matchType: "vector",
      categoryName: "Web Dev",
      tags: ["typescript", "react"],
    };
    expect(result.score).toBe(0.95);
    expect(result.matchType).toBe("vector");
  });

  it("SearchResult allows optional fields to be omitted", () => {
    const result: SearchResult = {
      link: {
        url: "https://example.com",
        title: "Example",
        description: "An example",
        content: "Content",
        embedding: [],
        domain: "example.com",
        savedAt: new Date().toISOString(),
        discordMessageId: "123",
        forgeScore: 0.5,
        contentType: "reference",
        purpose: "",
        integrationType: "reference",
        quality: "medium",
      },
      score: 0.8,
      matchType: "keyword",
    };
    expect(result.categoryName).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });
});
