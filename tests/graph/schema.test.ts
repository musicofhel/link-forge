import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupSchema } from "../../src/graph/schema.js";
import type { Session } from "neo4j-driver";
import type { Logger } from "pino";

function createMockSession(): Session {
  return {
    run: vi.fn().mockResolvedValue({ records: [] }),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Session;
}

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("setupSchema", () => {
  let session: Session;
  let logger: Logger;

  beforeEach(() => {
    session = createMockSession();
    logger = createMockLogger();
  });

  it("creates all uniqueness constraints", async () => {
    await setupSchema(session, logger);

    const runMock = vi.mocked(session.run);
    const calls = runMock.mock.calls.map((c) => c[0] as string);

    expect(calls).toContainEqual(
      expect.stringContaining("CREATE CONSTRAINT link_url_unique IF NOT EXISTS"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("CREATE CONSTRAINT category_name_unique IF NOT EXISTS"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("CREATE CONSTRAINT tag_name_unique IF NOT EXISTS"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("CREATE CONSTRAINT technology_name_unique IF NOT EXISTS"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("CREATE CONSTRAINT tool_name_unique IF NOT EXISTS"),
    );
  });

  it("creates text indexes for Link title and description", async () => {
    await setupSchema(session, logger);

    const runMock = vi.mocked(session.run);
    const calls = runMock.mock.calls.map((c) => c[0] as string);

    expect(calls).toContainEqual(
      expect.stringContaining("CREATE INDEX link_title_idx IF NOT EXISTS"),
    );
    expect(calls).toContainEqual(
      expect.stringContaining("CREATE INDEX link_description_idx IF NOT EXISTS"),
    );
  });

  it("creates vector index with correct dimensions and similarity", async () => {
    await setupSchema(session, logger);

    const runMock = vi.mocked(session.run);
    const calls = runMock.mock.calls.map((c) => c[0] as string);

    const vectorCall = calls.find((c) =>
      c.includes("CREATE VECTOR INDEX link_embedding_idx IF NOT EXISTS"),
    );
    expect(vectorCall).toBeDefined();
    expect(vectorCall).toContain("vector.dimensions");
    expect(vectorCall).toContain("384");
    expect(vectorCall).toContain("cosine");
  });

  it("runs the expected total number of DDL statements", async () => {
    await setupSchema(session, logger);

    const runMock = vi.mocked(session.run);
    // 6 constraints + 2 text indexes + 1 vector index = 9
    expect(runMock).toHaveBeenCalledTimes(9);
  });

  it("logs progress at each stage", async () => {
    await setupSchema(session, logger);

    const infoMock = vi.mocked(logger.info);
    expect(infoMock).toHaveBeenCalledWith(
      expect.stringContaining("constraints"),
    );
    expect(infoMock).toHaveBeenCalledWith(
      expect.stringContaining("text indexes"),
    );
    expect(infoMock).toHaveBeenCalledWith(
      expect.stringContaining("vector index"),
    );
    expect(infoMock).toHaveBeenCalledWith(
      expect.stringContaining("complete"),
    );
  });
});
