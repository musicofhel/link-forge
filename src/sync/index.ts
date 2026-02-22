/**
 * Link Forge - Sync Module Public API (v2)
 *
 * FIX #6: Re-exports `createFailoverClient` (renamed from
 * `createGraphClient` to avoid collision with existing export).
 */

import type { Driver } from "neo4j-driver";
import type { SyncConfig, SyncResult, SyncStatus as SyncStatusType } from "./types.js";
import { loadSyncConfig, warnIfDefaultLocalPassword } from "./config.js";
import { initLogger } from "./logger.js";
import { getSyncStatus as getStatus } from "./engine.js";
import { startScheduler, stopScheduler, triggerManualSync } from "./scheduler.js";

// Re-exports
export type { SyncConfig, SyncResult, SyncStatus } from "./types.js";
export type { DedupResult } from "../processor/dedup.js";
export { shouldProcessUrl, batchCheckUrls } from "../processor/dedup.js";
export { FailoverGraphClient, createFailoverClient } from "../graph/client.js";

export interface SyncContext {
  config: SyncConfig;
  localDriver: Driver;
}

export async function initSync(localDriver: Driver): Promise<SyncContext | null> {
  const config = loadSyncConfig();

  if (!config.enabled) {
    console.log("[sync] Sync disabled (SYNC_ENABLED != true).");
    return null;
  }

  initLogger(config);
  warnIfDefaultLocalPassword();
  console.log(`[sync] Initialized. Node: ${config.nodeId}, Peer: ${config.peerUri}`);

  return { config, localDriver };
}

export function startSyncDaemon(ctx: SyncContext): void {
  startScheduler(ctx.localDriver, ctx.config);
}

export function stopSyncDaemon(): void {
  stopScheduler();
}

export async function syncNow(ctx: SyncContext): Promise<SyncResult> {
  return triggerManualSync(ctx.localDriver, ctx.config);
}

export async function querySyncStatus(ctx: SyncContext, failoverState?: any): Promise<SyncStatusType> {
  return getStatus(ctx.localDriver, ctx.config, failoverState);
}
