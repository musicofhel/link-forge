import type pino from "pino";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimension: number;
}

export async function createEmbeddingService(
  logger: pino.Logger,
): Promise<EmbeddingService> {
  logger.info({ model: MODEL_NAME }, "Loading embedding model...");

  const { pipeline: createPipeline } = await import(
    "@huggingface/transformers"
  );

  const pipe = await createPipeline("feature-extraction", MODEL_NAME, {
    dtype: "fp32",
  });

  logger.info({ model: MODEL_NAME, dim: EMBEDDING_DIM }, "Embedding model loaded");

  async function embed(text: string): Promise<number[]> {
    const output = await pipe(text, {
      pooling: "mean",
      normalize: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = Array.from((output as any).data as Float32Array).slice(
      0,
      EMBEDDING_DIM,
    );
    return data;
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embed(text));
    }
    return results;
  }

  return {
    embed,
    embedBatch,
    dimension: EMBEDDING_DIM,
  };
}
