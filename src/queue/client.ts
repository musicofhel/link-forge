import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { CREATE_QUEUE_TABLE, MIGRATE_ADD_PARENT_URL, MIGRATE_ADD_AUTHOR, MIGRATE_ADD_AUTHOR_NAME } from "./schema.js";

export class QueueClient {
  readonly db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_QUEUE_TABLE);
    this.migrate();
  }

  private migrate(): void {
    const columns = this.db.pragma("table_info(queue)") as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has("parent_url")) {
      this.db.exec(MIGRATE_ADD_PARENT_URL);
    }
    if (!colNames.has("discord_author_id")) {
      this.db.exec(MIGRATE_ADD_AUTHOR);
    }
    if (!colNames.has("discord_author_name")) {
      this.db.exec(MIGRATE_ADD_AUTHOR_NAME);
    }
  }

  close(): void {
    this.db.close();
  }
}
