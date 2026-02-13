import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { CREATE_QUEUE_TABLE, MIGRATE_ADD_PARENT_URL } from "./schema.js";

export class QueueClient {
  readonly db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_QUEUE_TABLE);
    this.migrate();
  }

  private migrate(): void {
    // Add parent_url column if it doesn't exist (for existing DBs)
    const columns = this.db.pragma("table_info(queue)") as Array<{ name: string }>;
    const hasParentUrl = columns.some((c) => c.name === "parent_url");
    if (!hasParentUrl) {
      this.db.exec(MIGRATE_ADD_PARENT_URL);
    }
  }

  close(): void {
    this.db.close();
  }
}
