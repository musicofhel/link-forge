/**
 * Link Forge - Multi-Node Sync Types (v2 — all fixes applied)
 *
 * FIXES from v1:
 * - ExportedLink uses Record<string, any> spread to capture ALL Link
 *   properties (forgeScore, contentType, purpose, etc.) instead of
 *   a fixed list of 10 fields
 * - Added ExportedLinksToEdge, ExportedSubcategoryEdge, ExportedUsedWithEdge
 * - DeltaExport includes the three missing relationship arrays
 */

// ─── Sync Configuration ──────────────────────────────────────

export interface SyncConfig {
  enabled: boolean;
  nodeId: string;
  peerUri: string;
  peerUser: string;
  peerPassword: string;
  cron: string;
  onStartup: boolean;
  batchSize: number;
  logFile: string;
  embeddingModelPath: string;
  embeddingModelHash: string | null;
}

// ─── Sync Metadata (stored as Neo4j node) ────────────────────

export interface SyncMeta {
  nodeId: string;
  peerId: string | null;
  lastPushAt: string; // ISO 8601
  lastPullAt: string; // ISO 8601
  lastPushCount: number;
  lastPullCount: number;
  syncVersion: number;
}

// ─── Sync Results ────────────────────────────────────────────

export type SyncDirection = "pull" | "push";

export interface SyncConflict {
  entityType: "Link" | "Category" | "Tag" | "Tool" | "Technology" | "User";
  dedupKey: string;
  resolution: "first-write-wins" | "last-write-wins" | "set-union" | "skipped";
  kept: "local" | "remote";
  details?: string;
}

export interface SyncCycleResult {
  direction: SyncDirection;
  peer: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  nodesTransferred: number;
  relationshipsTransferred: number;
  conflicts: SyncConflict[];
  errors: string[];
  localNodeCount: number;
  remoteNodeCount: number;
  success: boolean;
}

export interface SyncResult {
  pull: SyncCycleResult;
  push: SyncCycleResult;
  overallSuccess: boolean;
}

// ─── Delta Export Types ──────────────────────────────────────

/**
 * ExportedLink carries ALL properties from the Link node via `l { .* }`.
 * We define the known fields for type-safety but the spread captures
 * everything, including fields like forgeScore, contentType, purpose,
 * integrationType, quality, domain, discordMessageId, keyConcepts,
 * authors, keyTakeaways, difficulty — and any future additions.
 */
export interface ExportedLink {
  // Core fields (always present)
  url: string;
  savedAt: string;
  createdAt: string;
  updatedAt: string;
  originNodeId: string;

  // Content fields (may be null for unprocessed links)
  title?: string | null;
  description?: string | null;
  content?: string | null;
  embedding?: number[] | null;
  sourceType?: string | null;
  processedAt?: string | null;

  // Extended metadata (captured by .* spread)
  forgeScore?: number | null;
  contentType?: string | null;
  purpose?: string | null;
  integrationType?: string | null;
  quality?: string | null;
  domain?: string | null;
  discordMessageId?: string | null;
  keyConcepts?: string[] | null;
  authors?: string[] | null;
  keyTakeaways?: string[] | null;
  difficulty?: string | null;

  // Relationship data (populated by export query, not stored on node)
  category: string | null;
  tags: string[];
  tools: string[];
  technologies: string[];
  sharedByDiscordId: string | null;

  // Catch-all for any properties we haven't explicitly typed
  [key: string]: any;
}

export interface ExportedCategory {
  name: string;
  description?: string | null;
  updatedAt: string;
  [key: string]: any; // capture all properties
}

export interface ExportedTool {
  name: string;
  description?: string | null;
  updatedAt: string;
  [key: string]: any;
}

export interface ExportedTechnology {
  name: string;
  description?: string | null;
  updatedAt: string;
  [key: string]: any;
}

export interface ExportedUser {
  discordId: string;
  username?: string | null;
  interests: string[];
  updatedAt: string;
  [key: string]: any;
}

export interface ExportedRelatedLink {
  fromUrl: string;
  toUrl: string;
  score: number;
}

/**
 * LINKS_TO: discovered URLs from tweets/articles pointing to other tracked URLs.
 */
export interface ExportedLinksToEdge {
  fromUrl: string;
  toUrl: string;
  props: Record<string, any>;
}

/**
 * SUBCATEGORY_OF: category hierarchy edges.
 */
export interface ExportedSubcategoryEdge {
  childName: string;
  parentName: string;
}

/**
 * USED_WITH: tool-technology associations.
 */
export interface ExportedUsedWithEdge {
  toolName: string;
  techName: string;
  props: Record<string, any>;
}

export interface DeltaExport {
  exportedAt: string;
  sourceNodeId: string;
  since: string;
  links: ExportedLink[];
  categories: ExportedCategory[];
  tools: ExportedTool[];
  technologies: ExportedTechnology[];
  users: ExportedUser[];
  relatedLinks: ExportedRelatedLink[];
  linksToEdges: ExportedLinksToEdge[];
  subcategoryEdges: ExportedSubcategoryEdge[];
  usedWithEdges: ExportedUsedWithEdge[];
}

// ─── Failover Types ──────────────────────────────────────────

export type NodeRole = "local" | "remote";

export interface NodeHealth {
  role: NodeRole;
  uri: string;
  healthy: boolean;
  lastCheck: Date | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
}

export interface FailoverState {
  activeNode: NodeRole;
  local: NodeHealth;
  remote: NodeHealth;
  failoverActive: boolean;
  failoverActivatedAt: Date | null;
}

// ─── Sync Status (for /api/sync/status) ─────────────────────

export interface SyncStatus {
  enabled: boolean;
  nodeId: string;
  peerId: string | null;
  lastSync: {
    pull: { at: string; count: number; success: boolean } | null;
    push: { at: string; count: number; success: boolean } | null;
  };
  nodeCounts: {
    local: { links: number; categories: number; tags: number; tools: number; technologies: number; users: number };
    remote: { links: number; categories: number; tags: number; tools: number; technologies: number; users: number } | null;
  };
  delta: number | null;
  health: FailoverState;
  embeddingModelMatch: boolean | null;
  nextSyncAt: string | null;
  consecutiveFailures: number;
}
