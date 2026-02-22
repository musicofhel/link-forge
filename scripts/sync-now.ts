#!/usr/bin/env node
/**
 * Link Forge - Manual Sync CLI
 * Usage: npm run sync
 */

import "dotenv/config";
import neo4j from "neo4j-driver";
import { loadSyncConfig } from "../src/sync/config.js";
import { initLogger } from "../src/sync/logger.js";
import { sync } from "../src/sync/engine.js";

async function main() {
  const config = loadSyncConfig();
  if (!config.enabled) { console.error("❌ Sync disabled. Set SYNC_ENABLED=true"); process.exit(1); }

  initLogger(config);

  const localDriver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "link_forge_dev")
  );

  try {
    console.log("🔄 Starting sync...\n");
    console.log(`  Local:  ${process.env.NEO4J_URI || "bolt://localhost:7687"}`);
    console.log(`  Remote: ${config.peerUri}`);
    console.log(`  Node:   ${config.nodeId}\n`);

    const result = await sync(localDriver, config);

    console.log("📥 PULL (remote → local):");
    if (result.pull.success) {
      console.log(`  ✅ ${result.pull.nodesTransferred} nodes, ${result.pull.relationshipsTransferred} rels (${result.pull.durationMs}ms)`);
      for (const c of result.pull.conflicts) { console.log(`  ⚠️  ${c.entityType} "${c.dedupKey}": ${c.resolution} (kept: ${c.kept})`); }
    } else { console.log(`  ❌ ${result.pull.errors.join("; ")}`); }

    console.log("\n📤 PUSH (local → remote):");
    if (result.push.success) {
      console.log(`  ✅ ${result.push.nodesTransferred} nodes, ${result.push.relationshipsTransferred} rels (${result.push.durationMs}ms)`);
      for (const c of result.push.conflicts) { console.log(`  ⚠️  ${c.entityType} "${c.dedupKey}": ${c.resolution} (kept: ${c.kept})`); }
    } else { console.log(`  ❌ ${result.push.errors.join("; ")}`); }

    console.log("\n📊 Node counts:");
    console.log(`  Local:  ${result.pull.localNodeCount} links`);
    console.log(`  Remote: ${result.pull.remoteNodeCount} links`);
    const delta = Math.abs(result.pull.localNodeCount - result.pull.remoteNodeCount);
    if (delta > 0) console.log(`  Delta:  ${delta}${delta > 100 ? " ⚠️" : ""}`);

    console.log(`\n${result.overallSuccess ? "✅ Sync complete!" : "⚠️  Completed with errors."}`);
    process.exit(result.overallSuccess ? 0 : 1);
  } finally { await localDriver.close(); }
}

main().catch((err) => { console.error("💀", err.message); process.exit(1); });
