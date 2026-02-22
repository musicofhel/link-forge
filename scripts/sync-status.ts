#!/usr/bin/env node
/**
 * Link Forge - Sync Status CLI
 * Usage: npm run sync:status
 */

import "dotenv/config";
import neo4j from "neo4j-driver";
import { loadSyncConfig } from "../src/sync/config.js";
import { initLogger } from "../src/sync/logger.js";
import { getSyncStatus } from "../src/sync/engine.js";
import { computeFileHash } from "../src/sync/model-hash.js";

async function main() {
  const config = loadSyncConfig();
  initLogger(config);

  const localDriver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "link_forge_dev")
  );

  try {
    console.log("📋 Link Forge Sync Status\n" + "─".repeat(50));
    console.log(`  Enabled:  ${config.enabled ? "✅" : "❌"}`);
    console.log(`  Node ID:  ${config.nodeId}`);
    console.log(`  Peer:     ${config.peerUri || "(not set)"}`);
    console.log(`  Schedule: ${config.cron}`);

    if (!config.enabled) { console.log("\nSync disabled."); return; }

    const status = await getSyncStatus(localDriver, config);

    console.log("\n📅 Last Sync:");
    if (status.lastSync.pull) { console.log(`  Pull: ${status.lastSync.pull.at} (${status.lastSync.pull.count} items ${status.lastSync.pull.success ? "✅" : "❌"})`); }
    else { console.log("  Pull: never"); }
    if (status.lastSync.push) { console.log(`  Push: ${status.lastSync.push.at} (${status.lastSync.push.count} items ${status.lastSync.push.success ? "✅" : "❌"})`); }
    else { console.log("  Push: never"); }

    console.log("\n📊 Counts:");
    const lc = status.nodeCounts.local;
    console.log(`  Local:  ${lc.links} links, ${lc.categories} cats, ${lc.tags} tags, ${lc.tools} tools, ${lc.technologies} techs, ${lc.users} users`);
    if (status.nodeCounts.remote) {
      const rc = status.nodeCounts.remote;
      console.log(`  Remote: ${rc.links} links, ${rc.categories} cats, ${rc.tags} tags, ${rc.tools} tools, ${rc.technologies} techs, ${rc.users} users`);
    } else { console.log("  Remote: unreachable"); }
    if (status.delta !== null) console.log(`  Delta:  ${status.delta}${status.delta > 100 ? " ⚠️" : ""}`);

    console.log("\n🧠 Model:");
    try {
      const h = await computeFileHash(config.embeddingModelPath);
      console.log(`  Hash:  ${h.substring(0, 16)}...`);
      console.log(`  Match: ${status.embeddingModelMatch === true ? "✅" : status.embeddingModelMatch === false ? "❌ MISMATCH" : "⚠️ unknown"}`);
    } catch { console.log(`  Path: ${config.embeddingModelPath} (not found)`); }

    if (status.consecutiveFailures > 0) console.log(`\n⚠️  Consecutive failures: ${status.consecutiveFailures}`);
    console.log("\n" + "─".repeat(50));
  } finally { await localDriver.close(); }
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
