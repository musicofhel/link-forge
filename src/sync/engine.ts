/**
 * Link Forge - Sync Engine (v2 — all fixes)
 *
 * FIX #7: Passes config.nodeId to verifyModelMatch instead of
 *         relying on process.env.SYNC_NODE_ID.
 */

import neo4j, { type Driver } from "neo4j-driver";
import type { SyncConfig, SyncMeta, SyncCycleResult, SyncResult, SyncStatus } from "./types.js";
import { exportDelta, getNodeCounts } from "./export.js";
import { importDelta } from "./import.js";
import { verifyModelMatch } from "./model-hash.js";
import { logSync, logSyncCycle, getConsecutiveFailures } from "./logger.js";

// ─── Sync Metadata ───────────────────────────────────────────

async function getSyncMeta(driver: Driver, nodeId: string): Promise<SyncMeta> {
  const session = driver.session();
  try {
    const result = await session.run(
      `MERGE (m:SyncMeta {nodeId: $nodeId})
       ON CREATE SET
         m.peerId = null,
         m.lastPushAt = '1970-01-01T00:00:00Z',
         m.lastPullAt = '1970-01-01T00:00:00Z',
         m.lastPushCount = 0,
         m.lastPullCount = 0,
         m.syncVersion = 1
       RETURN m {.*} AS meta`,
      { nodeId }
    );
    return result.records[0]!.get("meta") as SyncMeta;
  } finally {
    await session.close();
  }
}

async function updateSyncMeta(
  driver: Driver,
  nodeId: string,
  direction: "push" | "pull",
  timestamp: string,
  count: number,
  peerId: string | null
): Promise<void> {
  const session = driver.session();
  try {
    const setClause =
      direction === "pull"
        ? "m.lastPullAt = $timestamp, m.lastPullCount = $count"
        : "m.lastPushAt = $timestamp, m.lastPushCount = $count";

    await session.run(
      `MATCH (m:SyncMeta {nodeId: $nodeId})
       SET ${setClause}${peerId ? ", m.peerId = $peerId" : ""}`,
      { nodeId, timestamp, count, peerId }
    );
  } finally {
    await session.close();
  }
}

// ─── Remote Driver ───────────────────────────────────────────

function createRemoteDriver(config: SyncConfig): Driver {
  return neo4j.driver(config.peerUri, neo4j.auth.basic(config.peerUser, config.peerPassword), {
    connectionTimeout: 5000,
    maxConnectionLifetime: 60000,
  });
}

async function testRemoteConnection(driver: Driver): Promise<boolean> {
  const session = driver.session();
  try {
    await session.run("RETURN 1 AS heartbeat");
    return true;
  } catch {
    return false;
  } finally {
    await session.close();
  }
}

async function getRemoteNodeId(remoteDriver: Driver): Promise<string | null> {
  const session = remoteDriver.session();
  try {
    const result = await session.run("MATCH (m:SyncMeta) RETURN m.nodeId AS nodeId LIMIT 1");
    return result.records.length > 0 ? (result.records[0]!.get("nodeId") as string) : null;
  } finally {
    await session.close();
  }
}

// ─── Sync Cycle ──────────────────────────────────────────────

export async function sync(localDriver: Driver, config: SyncConfig): Promise<SyncResult> {
  const remoteDriver = createRemoteDriver(config);

  try {
    logSync("INFO", "sync:engine", `Starting sync with peer ${config.peerUri}...`);

    const remoteReachable = await testRemoteConnection(remoteDriver);
    if (!remoteReachable) {
      const errorMsg = `Remote peer ${config.peerUri} is unreachable`;
      logSync("WARNING", "sync:engine", errorMsg);
      const failResult = makeFailResult(config.peerUri, errorMsg);
      logSyncCycle(failResult.pull);
      logSyncCycle(failResult.push);
      return failResult;
    }

    // Verify embedding model (FIX #7: pass config.nodeId)
    if (config.embeddingModelPath) {
      try {
        const modelCheck = await verifyModelMatch(config.embeddingModelPath, localDriver, remoteDriver, config.nodeId);
        if (!modelCheck.match) {
          const errorMsg = `Embedding model mismatch! Local: ${modelCheck.localHash}, Remote: ${modelCheck.remoteHash}. Sync blocked.`;
          logSync("CRITICAL", "sync:engine", errorMsg);
          const failResult = makeFailResult(config.peerUri, errorMsg);
          logSyncCycle(failResult.pull);
          logSyncCycle(failResult.push);
          return failResult;
        }
      } catch (err: any) {
        // Model file might not exist — warn but don't block
        logSync("WARNING", "sync:engine", `Model hash check failed: ${err.message}. Proceeding without verification.`);
      }
    }

    const meta = await getSyncMeta(localDriver, config.nodeId);
    const remoteNodeId = await getRemoteNodeId(remoteDriver);

    // PULL: remote → local
    const pullResult = await executePull(localDriver, remoteDriver, config, meta, remoteNodeId);
    logSyncCycle(pullResult);

    // PUSH: local → remote
    const pushResult = await executePush(localDriver, remoteDriver, config, meta, remoteNodeId);
    logSyncCycle(pushResult);

    const overallSuccess = pullResult.success && pushResult.success;
    logSync(
      overallSuccess ? "INFO" : "WARNING",
      "sync:engine",
      `Sync complete. Pull: ${pullResult.nodesTransferred} nodes. Push: ${pushResult.nodesTransferred} nodes.`
    );

    return { pull: pullResult, push: pushResult, overallSuccess };
  } finally {
    await remoteDriver.close();
  }
}

// ─── Pull ────────────────────────────────────────────────────

async function executePull(
  localDriver: Driver,
  remoteDriver: Driver,
  config: SyncConfig,
  meta: SyncMeta,
  remoteNodeId: string | null
): Promise<SyncCycleResult> {
  const startedAt = new Date();
  try {
    const delta = await exportDelta(remoteDriver, remoteNodeId || "unknown", meta.lastPullAt);
    const importResult = await importDelta(localDriver, delta, config.batchSize);

    const localCounts = await getNodeCounts(localDriver);
    let remoteCounts: Record<string, number> = { links: 0 };
    try { remoteCounts = await getNodeCounts(remoteDriver); } catch {}

    const completedAt = new Date();
    const maxUpdatedAt = findMaxUpdatedAt(delta) || completedAt.toISOString();
    await updateSyncMeta(localDriver, config.nodeId, "pull", maxUpdatedAt, importResult.nodesImported, remoteNodeId);

    return {
      direction: "pull",
      peer: config.peerUri,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      nodesTransferred: importResult.nodesImported,
      relationshipsTransferred: importResult.relationshipsImported,
      conflicts: importResult.conflicts,
      errors: [],
      localNodeCount: localCounts.links || 0,
      remoteNodeCount: remoteCounts.links || 0,
      success: true,
    };
  } catch (err: any) {
    const completedAt = new Date();
    return {
      direction: "pull",
      peer: config.peerUri,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      nodesTransferred: 0,
      relationshipsTransferred: 0,
      conflicts: [],
      errors: [err.message || String(err)],
      localNodeCount: 0,
      remoteNodeCount: 0,
      success: false,
    };
  }
}

// ─── Push ────────────────────────────────────────────────────

async function executePush(
  localDriver: Driver,
  remoteDriver: Driver,
  config: SyncConfig,
  meta: SyncMeta,
  _remoteNodeId: string | null
): Promise<SyncCycleResult> {
  const startedAt = new Date();
  try {
    const delta = await exportDelta(localDriver, config.nodeId, meta.lastPushAt);
    const importResult = await importDelta(remoteDriver, delta, config.batchSize);

    const localCounts = await getNodeCounts(localDriver);
    let remoteCounts: Record<string, number> = { links: 0 };
    try { remoteCounts = await getNodeCounts(remoteDriver); } catch {}

    const completedAt = new Date();
    const maxUpdatedAt = findMaxUpdatedAt(delta) || completedAt.toISOString();
    await updateSyncMeta(localDriver, config.nodeId, "push", maxUpdatedAt, importResult.nodesImported, null);

    return {
      direction: "push",
      peer: config.peerUri,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      nodesTransferred: importResult.nodesImported,
      relationshipsTransferred: importResult.relationshipsImported,
      conflicts: importResult.conflicts,
      errors: [],
      localNodeCount: localCounts.links || 0,
      remoteNodeCount: remoteCounts.links || 0,
      success: true,
    };
  } catch (err: any) {
    const completedAt = new Date();
    return {
      direction: "push",
      peer: config.peerUri,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      nodesTransferred: 0,
      relationshipsTransferred: 0,
      conflicts: [],
      errors: [err.message || String(err)],
      localNodeCount: 0,
      remoteNodeCount: 0,
      success: false,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function findMaxUpdatedAt(delta: any): string | null {
  const timestamps: string[] = [];
  for (const arr of [delta.links, delta.categories, delta.tools, delta.technologies, delta.users]) {
    for (const item of arr || []) {
      if (item.updatedAt) timestamps.push(item.updatedAt);
    }
  }
  return timestamps.length > 0 ? timestamps.sort().pop()! : null;
}

function makeFailResult(peer: string, error: string): SyncResult {
  const now = new Date().toISOString();
  const fail: SyncCycleResult = {
    direction: "pull", peer, startedAt: now, completedAt: now, durationMs: 0,
    nodesTransferred: 0, relationshipsTransferred: 0, conflicts: [], errors: [error],
    localNodeCount: 0, remoteNodeCount: 0, success: false,
  };
  return { pull: { ...fail, direction: "pull" }, push: { ...fail, direction: "push" }, overallSuccess: false };
}

// ─── Status ──────────────────────────────────────────────────

export async function getSyncStatus(
  localDriver: Driver,
  config: SyncConfig,
  failoverState?: any
): Promise<SyncStatus> {
  const meta = await getSyncMeta(localDriver, config.nodeId);
  const localCounts = await getNodeCounts(localDriver);

  let remoteCounts: Record<string, number> | null = null;
  let embeddingModelMatch: boolean | null = null;

  if (config.enabled && config.peerUri) {
    const remoteDriver = createRemoteDriver(config);
    try {
      const reachable = await testRemoteConnection(remoteDriver);
      if (reachable) {
        remoteCounts = await getNodeCounts(remoteDriver);
        if (config.embeddingModelPath) {
          try {
            const check = await verifyModelMatch(config.embeddingModelPath, localDriver, remoteDriver, config.nodeId);
            embeddingModelMatch = check.match;
          } catch { embeddingModelMatch = null; }
        }
      }
    } finally {
      await remoteDriver.close();
    }
  }

  const delta = remoteCounts !== null ? Math.abs((localCounts.links || 0) - (remoteCounts.links || 0)) : null;

  return {
    enabled: config.enabled,
    nodeId: config.nodeId,
    peerId: meta.peerId,
    lastSync: {
      pull: meta.lastPullAt !== "1970-01-01T00:00:00Z" ? { at: meta.lastPullAt, count: meta.lastPullCount, success: true } : null,
      push: meta.lastPushAt !== "1970-01-01T00:00:00Z" ? { at: meta.lastPushAt, count: meta.lastPushCount, success: true } : null,
    },
    nodeCounts: { local: localCounts as any, remote: remoteCounts as any },
    delta,
    health: failoverState || { activeNode: "local", failoverActive: false },
    embeddingModelMatch,
    nextSyncAt: null,
    consecutiveFailures: getConsecutiveFailures(),
  };
}
