import type BetterSqlite3 from "better-sqlite3";

export interface EnqueueItem {
  url: string;
  comment?: string;
  discordMessageId: string;
  discordChannelId: string;
  discordAuthorId?: string;
  discordAuthorName?: string;
}

export interface QueueRow {
  id: number;
  url: string;
  comment: string | null;
  discord_message_id: string;
  discord_channel_id: string;
  discord_author_id: string | null;
  discord_author_name: string | null;
  status: string;
  error: string | null;
  parent_url: string | null;
  source_type: string;
  file_name: string | null;
  file_path: string | null;
  file_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export function enqueue(db: BetterSqlite3.Database, item: EnqueueItem): number {
  const stmt = db.prepare(
    `INSERT INTO queue (url, comment, discord_message_id, discord_channel_id, discord_author_id, discord_author_name)
     VALUES (@url, @comment, @discordMessageId, @discordChannelId, @discordAuthorId, @discordAuthorName)`
  );
  const result = stmt.run({
    url: item.url,
    comment: item.comment ?? null,
    discordMessageId: item.discordMessageId,
    discordChannelId: item.discordChannelId,
    discordAuthorId: item.discordAuthorId ?? null,
    discordAuthorName: item.discordAuthorName ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function dequeue(db: BetterSqlite3.Database): QueueRow | null {
  const selectStmt = db.prepare(
    `SELECT * FROM queue WHERE status = 'pending' ORDER BY id ASC LIMIT 1`
  );
  const updateStmt = db.prepare(
    `UPDATE queue SET status = 'processing', updated_at = datetime('now') WHERE id = @id`
  );

  const txn = db.transaction(() => {
    const row = selectStmt.get() as QueueRow | undefined;
    if (!row) return null;
    updateStmt.run({ id: row.id });
    return { ...row, status: "processing" } as QueueRow;
  });

  return txn();
}

export function markCompleted(db: BetterSqlite3.Database, id: number): void {
  const stmt = db.prepare(
    `UPDATE queue SET status = 'completed', updated_at = datetime('now') WHERE id = @id`
  );
  stmt.run({ id });
}

export function markFailed(
  db: BetterSqlite3.Database,
  id: number,
  error: string
): void {
  const stmt = db.prepare(
    `UPDATE queue SET status = 'failed', error = @error, updated_at = datetime('now') WHERE id = @id`
  );
  stmt.run({ id, error });
}

export function resetStale(
  db: BetterSqlite3.Database,
  olderThanMs: number
): number {
  const thresholdSeconds = olderThanMs / 1000;
  const stmt = db.prepare(
    `UPDATE queue
     SET status = 'pending', updated_at = datetime('now')
     WHERE status = 'processing'
       AND (julianday('now') - julianday(updated_at)) * 86400 > @thresholdSeconds`
  );
  const result = stmt.run({ thresholdSeconds });
  return result.changes;
}

export interface EnqueueDiscoveredItem {
  url: string;
  parentUrl: string;
  discordChannelId: string;
}

export function enqueueDiscovered(
  db: BetterSqlite3.Database,
  item: EnqueueDiscoveredItem,
): number | null {
  // Skip if this URL is already in the queue (any status)
  const existing = db.prepare(
    `SELECT id FROM queue WHERE url = @url LIMIT 1`,
  ).get({ url: item.url }) as { id: number } | undefined;
  if (existing) return null;

  // Use a synthetic discord_message_id to satisfy the UNIQUE constraint
  const hash = Buffer.from(item.url).toString("base64url").slice(0, 16);
  const syntheticId = `auto:${hash}`;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO queue (url, comment, discord_message_id, discord_channel_id, parent_url)
     VALUES (@url, @comment, @syntheticId, @discordChannelId, @parentUrl)`,
  );
  const result = stmt.run({
    url: item.url,
    comment: `Discovered in ${item.parentUrl}`,
    syntheticId,
    discordChannelId: item.discordChannelId,
    parentUrl: item.parentUrl,
  });
  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
}

export function isUrlQueued(db: BetterSqlite3.Database, url: string): boolean {
  const row = db.prepare(
    `SELECT 1 FROM queue WHERE url = @url LIMIT 1`,
  ).get({ url }) as { 1: number } | undefined;
  return !!row;
}

export interface EnqueueFileItem {
  fileName: string;
  filePath: string;
  fileHash: string;
  discordChannelId: string;
  discordAuthorId?: string;
  discordAuthorName?: string;
  /** Prefix for synthetic message ID: "file" (Discord) or "gdrive" (Drive). */
  sourcePrefix?: string;
}

export function enqueueFile(
  db: BetterSqlite3.Database,
  item: EnqueueFileItem,
): number | null {
  const prefix = item.sourcePrefix ?? "file";
  const syntheticUrl = `file:///${item.fileHash}/${item.fileName}`;
  const syntheticMessageId = `${prefix}:${item.fileHash.slice(0, 16)}`;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO queue
       (url, comment, discord_message_id, discord_channel_id,
        discord_author_id, discord_author_name,
        source_type, file_name, file_path, file_hash)
     VALUES
       (@url, @comment, @messageId, @channelId,
        @authorId, @authorName,
        'file', @fileName, @filePath, @fileHash)`,
  );

  const result = stmt.run({
    url: syntheticUrl,
    comment: `Document: ${item.fileName}`,
    messageId: syntheticMessageId,
    channelId: item.discordChannelId,
    authorId: item.discordAuthorId ?? null,
    authorName: item.discordAuthorName ?? null,
    fileName: item.fileName,
    filePath: item.filePath,
    fileHash: item.fileHash,
  });

  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
}

export function getStats(db: BetterSqlite3.Database): QueueStats {
  const stmt = db.prepare(
    `SELECT status, COUNT(*) as count FROM queue GROUP BY status`
  );
  const rows = stmt.all() as Array<{ status: string; count: number }>;

  const stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  for (const row of rows) {
    if (row.status in stats) {
      stats[row.status as keyof QueueStats] = row.count;
    }
  }

  return stats;
}
