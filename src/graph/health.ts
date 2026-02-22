/**
 * Link Forge - Neo4j Health Check
 *
 * Background health pinger for local and remote Neo4j instances.
 */

import type { Driver } from "neo4j-driver";
import type { NodeHealth, FailoverState } from "../sync/types.js";
import { logFailover, logSync } from "../sync/logger.js";

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const UNREACHABLE_ALERT_MS = 60 * 60 * 1000;

export class HealthMonitor {
  private localDriver: Driver;
  private remoteDriver: Driver | null;
  private localHealth: NodeHealth;
  private remoteHealth: NodeHealth;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private failoverActive = false;
  private failoverActivatedAt: Date | null = null;
  private remoteUnreachableSince: Date | null = null;

  constructor(localDriver: Driver, remoteDriver: Driver | null, localUri: string, remoteUri: string | null) {
    this.localDriver = localDriver;
    this.remoteDriver = remoteDriver;
    this.localHealth = { role: "local", uri: localUri, healthy: true, lastCheck: null, lastLatencyMs: null, consecutiveFailures: 0 };
    this.remoteHealth = { role: "remote", uri: remoteUri || "", healthy: false, lastCheck: null, lastLatencyMs: null, consecutiveFailures: 0 };
  }

  start(): void {
    if (this.intervalHandle) return;
    this.checkBoth();
    this.intervalHandle = setInterval(() => this.checkBoth(), HEALTH_CHECK_INTERVAL_MS);
    logSync("INFO", "health", `Health monitor started (${HEALTH_CHECK_INTERVAL_MS / 1000}s interval)`);
  }

  stop(): void {
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
  }

  private async checkDriver(driver: Driver): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const session = driver.session();
      try { await session.run("RETURN 1 AS heartbeat"); return { healthy: true, latencyMs: Date.now() - start }; }
      finally { await session.close(); }
    } catch { return { healthy: false, latencyMs: Date.now() - start }; }
  }

  private async checkBoth(): Promise<void> {
    const localResult = await this.checkDriver(this.localDriver);
    const wasLocalHealthy = this.localHealth.healthy;
    this.localHealth.healthy = localResult.healthy;
    this.localHealth.lastCheck = new Date();
    this.localHealth.lastLatencyMs = localResult.latencyMs;
    this.localHealth.consecutiveFailures = localResult.healthy ? 0 : this.localHealth.consecutiveFailures + 1;

    if (this.remoteDriver) {
      const remoteResult = await this.checkDriver(this.remoteDriver);
      this.remoteHealth.healthy = remoteResult.healthy;
      this.remoteHealth.lastCheck = new Date();
      this.remoteHealth.lastLatencyMs = remoteResult.latencyMs;
      this.remoteHealth.consecutiveFailures = remoteResult.healthy ? 0 : this.remoteHealth.consecutiveFailures + 1;

      if (!remoteResult.healthy) {
        if (!this.remoteUnreachableSince) { this.remoteUnreachableSince = new Date(); }
        else {
          const downMs = Date.now() - this.remoteUnreachableSince.getTime();
          if (downMs > UNREACHABLE_ALERT_MS) {
            logSync("WARNING", "health:alert", `Remote peer unreachable for ${Math.round(downMs / 60000)} min`, { remoteUri: this.remoteHealth.uri });
          }
        }
      } else { this.remoteUnreachableSince = null; }
    }

    // Failover transitions
    if (wasLocalHealthy && !this.localHealth.healthy && this.remoteHealth.healthy) {
      this.failoverActive = true;
      this.failoverActivatedAt = new Date();
      logFailover("activated", { localUri: this.localHealth.uri, remoteUri: this.remoteHealth.uri });
    } else if (!wasLocalHealthy && this.localHealth.healthy && this.failoverActive) {
      this.failoverActive = false;
      const downtimeMs = this.failoverActivatedAt ? Date.now() - this.failoverActivatedAt.getTime() : 0;
      logFailover("resolved", { localUri: this.localHealth.uri, downtimeMs });
      this.failoverActivatedAt = null;
    }
  }

  getState(): FailoverState {
    return { activeNode: this.failoverActive ? "remote" : "local", local: { ...this.localHealth }, remote: { ...this.remoteHealth }, failoverActive: this.failoverActive, failoverActivatedAt: this.failoverActivatedAt };
  }

  getActiveDriver(): Driver | null {
    if (this.localHealth.healthy) return this.localDriver;
    if (this.remoteDriver && this.remoteHealth.healthy) return this.remoteDriver;
    return null;
  }

  markLocalUnhealthy(): void { this.localHealth.healthy = false; this.localHealth.consecutiveFailures++; }
  isLocalHealthy(): boolean { return this.localHealth.healthy; }
  isRemoteHealthy(): boolean { return this.remoteHealth.healthy; }
}
