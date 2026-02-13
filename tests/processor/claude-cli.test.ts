import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { parseClaudeOutput } from "../../src/processor/claude-cli.js";

const logger = pino({ level: "silent" });

const sampleResponse = readFileSync(
  join(import.meta.dirname, "../fixtures/claude-response.json"),
  "utf-8",
);

describe("parseClaudeOutput", () => {
  it("parses clean JSON output", () => {
    const result = parseClaudeOutput(sampleResponse, logger);
    expect(result.category).toBe("LLM Frameworks");
    expect(result.tags).toContain("rag");
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]?.name).toBe("LangChain");
    expect(result.technologies).toContain("Python");
    expect(result.summary).toContain("RAG pipelines");
    expect(result.quality).toBe("high");
    expect(result.forge_score).toBe(0.72);
    expect(result.content_type).toBe("tutorial");
    expect(result.purpose).toContain("RAG pipelines");
    expect(result.integration_type).toBe("guide");
  });

  it("parses JSON wrapped in markdown code fence", () => {
    const wrapped = "Here is the categorization:\n```json\n" + sampleResponse + "\n```\n";
    const result = parseClaudeOutput(wrapped, logger);
    expect(result.category).toBe("LLM Frameworks");
    expect(result.tags).toContain("rag");
  });

  it("parses JSON embedded in surrounding text", () => {
    const embedded = "I analyzed the content and here is the result:\n" + sampleResponse + "\n\nLet me know if you need anything else.";
    const result = parseClaudeOutput(embedded, logger);
    expect(result.category).toBe("LLM Frameworks");
  });

  it("throws on completely invalid output", () => {
    expect(() => parseClaudeOutput("This is not JSON at all", logger)).toThrow(
      "Failed to parse Claude output",
    );
  });

  it("throws on JSON missing required fields", () => {
    const incomplete = '{"tags": ["test"]}';
    expect(() => parseClaudeOutput(incomplete, logger)).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const minimal = '{"category": "Testing", "tags": ["test"], "summary": "A test."}';
    const result = parseClaudeOutput(minimal, logger);
    expect(result.category).toBe("Testing");
    expect(result.tools).toEqual([]);
    expect(result.technologies).toEqual([]);
    expect(result.quality).toBe("medium");
    expect(result.forge_score).toBe(0.5);
    expect(result.content_type).toBe("reference");
    expect(result.purpose).toBe("");
    expect(result.integration_type).toBe("reference");
  });

  it("validates forge_score range", () => {
    const tooHigh = '{"category": "Test", "tags": [], "summary": "x", "forge_score": 1.5}';
    expect(() => parseClaudeOutput(tooHigh, logger)).toThrow();

    const tooLow = '{"category": "Test", "tags": [], "summary": "x", "forge_score": -0.1}';
    expect(() => parseClaudeOutput(tooLow, logger)).toThrow();
  });

  it("validates content_type enum", () => {
    const invalid = '{"category": "Test", "tags": [], "summary": "x", "content_type": "blog"}';
    expect(() => parseClaudeOutput(invalid, logger)).toThrow();
  });

  it("validates integration_type enum", () => {
    const invalid = '{"category": "Test", "tags": [], "summary": "x", "integration_type": "widget"}';
    expect(() => parseClaudeOutput(invalid, logger)).toThrow();
  });

  it("handles code fence without json language hint", () => {
    const wrapped = "```\n" + sampleResponse + "\n```";
    const result = parseClaudeOutput(wrapped, logger);
    expect(result.category).toBe("LLM Frameworks");
  });
});
