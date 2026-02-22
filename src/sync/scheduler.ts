/**
 * Link Forge - Sync Scheduler
 */

import cron from "node-cron";
import type { Driver } from "neo4j-driver";
import type { SyncConfig } from "./types.js";
import { sync } from "./engine.js";
import { logSync } from "./logger.js";

let scheduledTask: cron.ScheduledTask | null = null;
let isRunning = false;

export function startScheduler(localDriver: Driver, config: SyncConfig): void {
  if (!config.enabled) { logSync("INFO", "sync:scheduler", "Sync disabled."); return; }
  if (!cron.validate(config.cron)) { logSync("CRITICAL", "sync:scheduler", `Invalid cron: "${config.cron}".`); return; }

  scheduledTask = cron.schedule(config.cron, async () => {
    if (isRunning) { logSync("WARNING", "sync:scheduler", "Already running, skipping."); return; }
    isRunning = true;
    try { await sync(localDriver, config); }
    catch (err: any) { logSync("CRITICAL", "sync:scheduler", `Scheduled sync failed: ${err.message}`); }
    finally { isRunning = false; }
  });

  logSync("INFO", "sync:scheduler", `Scheduler started: "${config.cron}"`);

  if (config.onStartup) {
    logSync("INFO", "sync:scheduler", "Running startup sync...");
    setImmediate(async () => {
      if (isRunning) return;
      isRunning = true;
      try { await sync(localDriver, config); }
      catch (err: any) { logSync("WARNING", "sync:scheduler", `Startup sync failed: ${err.message}`); }
      finally { isRunning = false; }
    });
  }
}

export function stopScheduler(): void {
  if (scheduledTask) { scheduledTask.stop(); scheduledTask = null; }
}

export async function triggerManualSync(localDriver: Driver, config: SyncConfig) {
  if (isRunning) throw new Error("Sync already in progress.");
  isRunning = true;
  try { return await sync(localDriver, config); }
  finally { isRunning = false; }
}

export function isSyncRunning(): boolean { return isRunning; }
