export const CREATE_QUEUE_TABLE = `
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  comment TEXT,
  discord_message_id TEXT UNIQUE NOT NULL,
  discord_channel_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  parent_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const MIGRATE_ADD_PARENT_URL = `
ALTER TABLE queue ADD COLUMN parent_url TEXT;
`;
