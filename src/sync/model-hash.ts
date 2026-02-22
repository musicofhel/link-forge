/**
 * Link Forge - Embedding Model Hash Verification
 *
 * FIX from v1: storeLocalModelHash now takes nodeId as a parameter
 * instead of reading process.env.SYNC_NODE_ID, which may not be
 * set yet if the ID was auto-generated and not persisted.
 */

import { createHash } from "crypto";
import { createReadStream, existsSync } from "fs";
import type { Driver } from "neo4j-driver";
import { logSync } from "./logger.js";

export async function computeFileHash(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`Model file not found: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Store the local model hash in Neo4j as a property on the SyncMeta node.
 * @param nodeId - The sync node ID from config (not process.env)
 */
export async function storeLocalModelHash(driver: Driver, nodeId: string, hash: string): Promise<void> {
  const session = driver.session();
  try {
    await session.run(
      `MERGE (m:SyncMeta {nodeId: $nodeId})
       SET m.embeddingModelHash = $hash`,
      { nodeId, hash }
    );
  } finally {
    await session.close();
  }
}

export async function getRemoteModelHash(remoteDriver: Driver): Promise<string | null> {
  const session = remoteDriver.session();
  try {
    const result = await session.run(`MATCH (m:SyncMeta) RETURN m.embeddingModelHash AS hash LIMIT 1`);
    if (result.records.length === 0) return null;
    return result.records[0]!.get("hash") as string | null;
  } finally {
    await session.close();
  }
}

/**
 * Verify that local and remote embedding models match.
 * @param nodeId - The sync node ID from config (fixes #7)
 */
export async function verifyModelMatch(
  localModelPath: string,
  localDriver: Driver,
  remoteDriver: Driver,
  nodeId: string
): Promise<{ match: boolean; localHash: string; remoteHash: string | null }> {
  const localHash = await computeFileHash(localModelPath);

  await storeLocalModelHash(localDriver, nodeId, localHash);

  const remoteHash = await getRemoteModelHash(remoteDriver);

  if (remoteHash === null) {
    logSync("INFO", "sync:model-hash", "Remote peer has no model hash stored yet. Proceeding.", {
      localHash,
    });
    return { match: true, localHash, remoteHash: null };
  }

  const match = localHash === remoteHash;

  if (!match) {
    logSync("CRITICAL", "sync:model-hash", "Embedding model hash MISMATCH. Sync blocked.", {
      localHash,
      remoteHash,
    });
  }

  return { match, localHash, remoteHash };
}
