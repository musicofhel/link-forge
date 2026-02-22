/**
 * Link Forge - Sync Configuration
 *
 * Reads SYNC_* environment variables, validates required values,
 * and exports a typed config object. Auto-generates a node UUID
 * on first run if SYNC_NODE_ID is not set.
 */

import { randomUUID } from "crypto";
import { existsSync, readFileSync, appendFileSync } from "fs";
import { resolve } from "path";
import type { SyncConfig } from "./types.js";

const ENV_FILE = resolve(process.cwd(), ".env");

function generateAndPersistNodeId(): string {
  const nodeId = randomUUID();
  try {
    if (existsSync(ENV_FILE)) {
      const content = readFileSync(ENV_FILE, "utf-8");
      if (!content.includes("SYNC_NODE_ID")) {
        appendFileSync(ENV_FILE, `\nSYNC_NODE_ID=${nodeId}\n`);
      }
    }
  } catch {
    console.warn("[sync:config] Could not persist SYNC_NODE_ID to .env. Set it manually.");
  }
  return nodeId;
}

function resolveModelPath(): string {
  const candidates = [
    process.env.EMBEDDING_MODEL_PATH,
    resolve(process.cwd(), "models/all-MiniLM-L6-v2/model.onnx"),
    resolve(process.cwd(), "node_modules/@xenova/transformers/models/all-MiniLM-L6-v2/onnx/model.onnx"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return candidates[0] || "models/all-MiniLM-L6-v2/model.onnx";
}

export function loadSyncConfig(): SyncConfig {
  const enabled = process.env.SYNC_ENABLED === "true";
  const nodeId = process.env.SYNC_NODE_ID || generateAndPersistNodeId();
  const peerUri = process.env.SYNC_PEER_URI || "";
  const peerUser = process.env.SYNC_PEER_USER || "neo4j";
  const peerPassword = process.env.SYNC_PEER_PASSWORD || "";
  const cron = process.env.SYNC_CRON || "0 3 * * *";
  const onStartup = process.env.SYNC_ON_STARTUP === "true";
  const batchSize = parseInt(process.env.SYNC_BATCH_SIZE || "100", 10);
  const logFile = process.env.SYNC_LOG_FILE || resolve(process.cwd(), "logs/sync.log");
  const embeddingModelPath = resolveModelPath();

  const config: SyncConfig = {
    enabled,
    nodeId,
    peerUri,
    peerUser,
    peerPassword,
    cron,
    onStartup,
    batchSize,
    logFile,
    embeddingModelPath,
    embeddingModelHash: null,
  };

  if (enabled) {
    validateConfig(config);
  }

  return config;
}

function validateConfig(config: SyncConfig): void {
  const errors: string[] = [];

  if (!config.peerUri) {
    errors.push("SYNC_PEER_URI is required when sync is enabled (e.g., bolt://100.x.x.x:7687)");
  } else if (
    !config.peerUri.startsWith("bolt://") &&
    !config.peerUri.startsWith("bolt+s://") &&
    !config.peerUri.startsWith("neo4j://")
  ) {
    errors.push(`SYNC_PEER_URI must start with bolt://, bolt+s://, or neo4j:// (got: ${config.peerUri})`);
  }

  if (!config.peerPassword) {
    errors.push("SYNC_PEER_PASSWORD is required when sync is enabled");
  } else if (config.peerPassword === "link_forge_dev") {
    errors.push("SYNC_PEER_PASSWORD must not be the default 'link_forge_dev' when sync is enabled.");
  }

  if (config.batchSize < 1 || config.batchSize > 10000) {
    errors.push(`SYNC_BATCH_SIZE must be between 1 and 10000 (got: ${config.batchSize})`);
  }

  if (errors.length > 0) {
    throw new Error(`[sync:config] Invalid sync configuration:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

export function warnIfDefaultLocalPassword(): void {
  const localPassword = process.env.NEO4J_PASSWORD;
  if (localPassword === "link_forge_dev") {
    console.warn(
      "[sync:config] WARNING: Local NEO4J_PASSWORD is still the default 'link_forge_dev'. " +
        "Change it to a strong password before exposing Neo4j over Tailscale."
    );
  }
}
