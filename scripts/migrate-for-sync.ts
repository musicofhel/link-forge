#!/usr/bin/env node
/**
 * Link Forge - Sync Schema Migration
 * Usage: npm run migrate:sync
 *
 * Idempotent, non-destructive, backward-compatible.
 */

import "dotenv/config";
import neo4j from "neo4j-driver";
import { loadSyncConfig } from "../src/sync/config.js";

async function main() {
  const config = loadSyncConfig();

  const driver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "link_forge_dev")
  );

  const session = driver.session();
  const now = new Date().toISOString();

  try {
    console.log("🔧 Link Forge Sync Schema Migration\n");

    console.log("1/6  Adding createdAt to Links...");
    let r = await session.run(`MATCH (l:Link) WHERE l.createdAt IS NULL SET l.createdAt = coalesce(l.savedAt, $now) RETURN count(l) AS n`, { now });
    console.log(`     ${r.records[0].get("n")} updated`);

    console.log("2/6  Adding updatedAt to Links...");
    r = await session.run(`MATCH (l:Link) WHERE l.updatedAt IS NULL SET l.updatedAt = coalesce(l.processedAt, l.savedAt, $now) RETURN count(l) AS n`, { now });
    console.log(`     ${r.records[0].get("n")} updated`);

    console.log("3/6  Adding originNodeId to Links...");
    r = await session.run(`MATCH (l:Link) WHERE l.originNodeId IS NULL SET l.originNodeId = $nodeId RETURN count(l) AS n`, { nodeId: config.nodeId });
    console.log(`     ${r.records[0].get("n")} updated`);

    console.log("4/6  Adding updatedAt to Category/Tool/Technology...");
    for (const label of ["Category", "Tool", "Technology"]) {
      r = await session.run(`MATCH (n:${label}) WHERE n.updatedAt IS NULL SET n.updatedAt = $now RETURN count(n) AS n`, { now });
      console.log(`     ${label}: ${r.records[0].get("n")}`);
    }

    console.log("5/6  Adding updatedAt to Users...");
    r = await session.run(`MATCH (u:User) WHERE u.updatedAt IS NULL SET u.updatedAt = $now RETURN count(u) AS n`, { now });
    console.log(`     ${r.records[0].get("n")} updated`);

    console.log("6/6  Creating SyncMeta node...");
    await session.run(
      `MERGE (m:SyncMeta {nodeId: $nodeId})
       ON CREATE SET m.peerId = null, m.lastPushAt = '1970-01-01T00:00:00Z', m.lastPullAt = '1970-01-01T00:00:00Z',
         m.lastPushCount = 0, m.lastPullCount = 0, m.syncVersion = 1`,
      { nodeId: config.nodeId }
    );
    console.log(`     Created for ${config.nodeId}`);

    console.log("\n📇 Creating indexes...");
    const indexes = [
      "CREATE INDEX link_updatedAt IF NOT EXISTS FOR (l:Link) ON (l.updatedAt)",
      "CREATE INDEX category_updatedAt IF NOT EXISTS FOR (c:Category) ON (c.updatedAt)",
      "CREATE INDEX tool_updatedAt IF NOT EXISTS FOR (t:Tool) ON (t.updatedAt)",
      "CREATE INDEX technology_updatedAt IF NOT EXISTS FOR (t:Technology) ON (t.updatedAt)",
      "CREATE INDEX user_updatedAt IF NOT EXISTS FOR (u:User) ON (u.updatedAt)",
      "CREATE INDEX syncmeta_nodeId IF NOT EXISTS FOR (m:SyncMeta) ON (m.nodeId)",
    ];
    for (const idx of indexes) {
      try { await session.run(idx); console.log(`     ✅ ${idx.match(/INDEX (\S+)/)?.[1]}`); }
      catch (e: any) { console.log(`     ⚠️  ${e.message.substring(0, 80)}`); }
    }

    console.log("\n📊 Verification:");
    r = await session.run(
      `MATCH (l:Link) WHERE l.updatedAt IS NOT NULL WITH count(l) AS ready
       MATCH (l2:Link) RETURN ready, count(l2) AS total`
    );
    console.log(`     ${r.records[0].get("ready")}/${r.records[0].get("total")} links ready`);
    console.log("\n✅ Migration complete!");
  } finally { await session.close(); await driver.close(); }
}

main().catch((err) => { console.error("❌", err.message); process.exit(1); });
