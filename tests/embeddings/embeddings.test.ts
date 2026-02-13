import { describe, it, expect, vi } from "vitest";
import type { EmbeddingService } from "../../src/embeddings/index.js";

describe("embeddings", () => {
  it("EmbeddingService interface has correct shape", () => {
    // Type-level test to ensure interface is correct
    const mockService: EmbeddingService = {
      embed: vi.fn().mockResolvedValue(new Array(384).fill(0)),
      embedBatch: vi.fn().mockResolvedValue([new Array(384).fill(0)]),
      dimension: 384,
    };

    expect(mockService.dimension).toBe(384);
    expect(mockService.embed).toBeDefined();
    expect(mockService.embedBatch).toBeDefined();
  });

  it("embed returns 384-dim vector from mock", async () => {
    const mockEmbed = vi.fn().mockResolvedValue(new Array(384).fill(0.5));
    const service: EmbeddingService = {
      embed: mockEmbed,
      embedBatch: vi.fn(),
      dimension: 384,
    };

    const result = await service.embed("test text");
    expect(result).toHaveLength(384);
    expect(result[0]).toBe(0.5);
    expect(mockEmbed).toHaveBeenCalledWith("test text");
  });

  it("embedBatch processes multiple texts", async () => {
    const vectors = [
      new Array(384).fill(0.1),
      new Array(384).fill(0.2),
    ];
    const service: EmbeddingService = {
      embed: vi.fn(),
      embedBatch: vi.fn().mockResolvedValue(vectors),
      dimension: 384,
    };

    const result = await service.embedBatch(["text1", "text2"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(384);
    expect(result[1]?.[0]).toBe(0.2);
  });
});
