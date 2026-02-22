/**
 * Link Forge - Sync Logger
 *
 * Structured JSON logging for sync events.
 */

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { SyncCycleResult, SyncConfig } from "./types.js";

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "CRITICAL";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

let logFilePath: string | null = null;
let consecutiveFailures = 0;

export function initLogger(config: SyncConfig): void {
  logFilePath = config.logFile;
  const dir = dirname(logFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeLog(entry: LogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line);
    } catch (err) {
      console.error(`[sync:logger] Failed to write to ${logFilePath}:`, err);
    }
  }
  if (entry.level === "CRITICAL" || entry.level === "WARNING") {
    console.error(`[${entry.level}] [${entry.component}] ${entry.message}`);
  }
}

export function logSyncCycle(result: SyncCycleResult): void {
  if (result.success) {
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
  }

  writeLog({
    timestamp: result.completedAt,
    level: result.success ? "INFO" : "WARNING",
    component: `sync:${result.direction}`,
    message: result.success
      ? `${result.direction} completed: ${result.nodesTransferred} nodes, ${result.relationshipsTransferred} rels in ${result.durationMs}ms`
      : `${result.direction} failed: ${result.errors.join("; ")}`,
    data: {
      direction: result.direction,
      peer: result.peer,
      nodesTransferred: result.nodesTransferred,
      relationshipsTransferred: result.relationshipsTransferred,
      conflicts: result.conflicts.length,
      conflictDetails: result.conflicts,
      durationMs: result.durationMs,
      errors: result.errors,
      localNodeCount: result.localNodeCount,
      remoteNodeCount: result.remoteNodeCount,
    },
  });

  if (consecutiveFailures >= 3) {
    writeLog({
      timestamp: new Date().toISOString(),
      level: "CRITICAL",
      component: "sync:alert",
      message: `Sync has failed ${consecutiveFailures} consecutive times.`,
    });
  }

  const delta = Math.abs(result.localNodeCount - result.remoteNodeCount);
  if (delta > 100) {
    writeLog({
      timestamp: new Date().toISOString(),
      level: "WARNING",
      component: "sync:alert",
      message: `Node count delta is ${delta} (local: ${result.localNodeCount}, remote: ${result.remoteNodeCount}).`,
    });
  }
}

export function logSync(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  writeLog({ timestamp: new Date().toISOString(), level, component, message, data });
}

export function logFailover(event: "activated" | "resolved", details: Record<string, unknown>): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: event === "activated" ? "WARNING" : "INFO",
    component: "failover",
    message:
      event === "activated"
        ? "Failover ACTIVATED: routing queries to remote peer"
        : "Failover RESOLVED: routing queries back to local",
    data: details,
  });
}

export function getConsecutiveFailures(): number {
  return consecutiveFailures;
}
