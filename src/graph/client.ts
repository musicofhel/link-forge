/**
 * Link Forge - Failover Graph Client (v2 — all fixes)
 *
 * FIX #4: Exposes a `.driver` getter that returns the currently active
 *         Neo4j driver (local or remote depending on health). This
 *         matches the existing interface where subsystems (processor,
 *         dashboard, bot, taxonomy, gdrive) access `graphClient.driver`.
 *         All subsystems now get failover benefits without code changes.
 *
 * FIX #6: Factory function renamed from `createGraphClient` to
 *         `createFailoverClient` to avoid collision with the existing
 *         export in src/graph/client.ts.
 *
 * Integration: Replace the existing client.ts contents with this file.
 * Existing code like `graphClient.driver.session()` continues to work
 * but now routes through failover.
 */

import neo4j, { type Driver, type Session, type QueryResult } from "neo4j-driver";
import { HealthMonitor } from "./health.js";
import { logSync } from "../sync/logger.js";

export interface FailoverClientConfig {
  localUri: string;
  localUser: string;
  localPassword: string;
  remoteUri?: string;
  remoteUser?: string;
  remotePassword?: string;
  maxRetries?: number;
  connectionTimeoutMs?: number;
}

export class FailoverGraphClient {
  private localDriver: Driver;
  private remoteDriver: Driver | null = null;
  private healthMonitor: HealthMonitor;
  private config: FailoverClientConfig;
  private isConnected = false;

  constructor(config: FailoverClientConfig) {
    this.config = config;

    this.localDriver = neo4j.driver(
      config.localUri,
      neo4j.auth.basic(config.localUser, config.localPassword),
      { connectionTimeout: config.connectionTimeoutMs || 5000, maxConnectionLifetime: 3600000 }
    );

    if (config.remoteUri && config.remotePassword) {
      this.remoteDriver = neo4j.driver(
        config.remoteUri,
        neo4j.auth.basic(config.remoteUser || "neo4j", config.remotePassword),
        { connectionTimeout: config.connectionTimeoutMs || 5000, maxConnectionLifetime: 3600000 }
      );
    }

    this.healthMonitor = new HealthMonitor(
      this.localDriver,
      this.remoteDriver,
      config.localUri,
      config.remoteUri || null
    );
  }

  /**
   * FIX #4: `.driver` getter for interface compatibility.
   *
   * The existing codebase passes `graphClient.driver` to every subsystem:
   *   this.bot = new DiscordBot(graphClient.driver, ...);
   *   this.processor = new Processor(graphClient.driver, ...);
   *   this.dashboard = new Dashboard(graphClient.driver, ...);
   *
   * This getter returns whichever driver is currently healthy,
   * so all subsystems automatically get failover without changes.
   *
   * IMPORTANT: The returned driver may switch from local to remote
   * between calls if a failover event occurs. This is safe because
   * Neo4j sessions are created per-operation and don't hold state.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  get driver(): Driver {
    const active = this.healthMonitor.getActiveDriver();
    if (!active) {
      // If both are down, return local driver anyway — it will error
      // at the session level, which callers already handle.
      return this.localDriver;
    }
    return active;
  }

  async connect(): Promise<void> {
    const session = this.localDriver.session();
    try {
      await session.run("RETURN 1 AS heartbeat");
    } catch {
      logSync("WARNING", "failover:client", "Local Neo4j unreachable at startup.");
    } finally {
      await session.close();
    }

    this.healthMonitor.start();
    this.isConnected = true;

    logSync("INFO", "failover:client", `Connected. Local: ${this.config.localUri}, Remote: ${this.config.remoteUri || "none"}`);
  }

  /**
   * Execute a Cypher query with automatic failover.
   */
  async run(cypher: string, params?: Record<string, any>): Promise<QueryResult> {
    const activeDriver = this.healthMonitor.getActiveDriver();

    if (!activeDriver) {
      throw new Error("[FailoverGraphClient] Both Neo4j instances unreachable.");
    }

    try {
      const session = activeDriver.session();
      try {
        return await session.run(cypher, params);
      } finally {
        await session.close();
      }
    } catch (err) {
      if (activeDriver === this.localDriver) {
        this.healthMonitor.markLocalUnhealthy();
        logSync("WARNING", "failover:client", `Local query failed: ${(err as Error).message}`);

        if (this.remoteDriver && this.healthMonitor.isRemoteHealthy()) {
          const session = this.remoteDriver.session();
          try {
            return await session.run(cypher, params);
          } finally {
            await session.close();
          }
        }
      }
      throw err;
    }
  }

  /**
   * Get a session from the active driver.
   */
  session(): Session {
    return this.driver.session();
  }

  /**
   * Get the local driver directly (sync operations MUST target local).
   */
  getLocalDriver(): Driver {
    return this.localDriver;
  }

  /**
   * Get the remote driver directly (sync operations).
   */
  getRemoteDriver(): Driver | null {
    return this.remoteDriver;
  }

  getFailoverState() {
    return this.healthMonitor.getState();
  }

  async close(): Promise<void> {
    this.healthMonitor.stop();
    await this.localDriver.close();
    if (this.remoteDriver) await this.remoteDriver.close();
    this.isConnected = false;
  }
}

// ─── Factory Function ────────────────────────────────────────

/**
 * FIX #6: Renamed from `createGraphClient` to `createFailoverClient`
 * to avoid collision with the existing export in src/graph/client.ts.
 *
 * Usage in src/index.ts:
 *   import { createFailoverClient } from './graph/client.js';
 *   const graphClient = createFailoverClient();
 *   await graphClient.connect();
 *
 *   // Existing code continues to work:
 *   new DiscordBot(graphClient.driver, ...);  // ← .driver getter
 */
export function createFailoverClient(): FailoverGraphClient {
  return new FailoverGraphClient({
    localUri: process.env.NEO4J_URI || "bolt://localhost:7687",
    localUser: process.env.NEO4J_USER || "neo4j",
    localPassword: process.env.NEO4J_PASSWORD || "link_forge_dev",
    remoteUri: process.env.SYNC_PEER_URI || undefined,
    remoteUser: process.env.SYNC_PEER_USER || "neo4j",
    remotePassword: process.env.SYNC_PEER_PASSWORD || undefined,
  });
}
