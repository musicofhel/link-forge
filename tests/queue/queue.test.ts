import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { QueueClient } from "../../src/queue/client.js";
import {
  enqueue,
  dequeue,
  markCompleted,
  markFailed,
  resetStale,
  getStats,
} from "../../src/queue/operations.js";

describe("QueueClient", () => {
  let client: QueueClient;

  beforeEach(() => {
    client = new QueueClient(":memory:");
  });

  afterEach(() => {
    client.close();
  });

  it("should open a database and create the queue table", () => {
    const tables = client.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='queue'`
      )
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("queue");
  });

  it("should set WAL journal mode (in-memory falls back to memory)", () => {
    // In-memory SQLite does not support WAL, so the pragma returns "memory".
    // The important thing is that the pragma was called without error.
    const result = client.db.pragma("journal_mode") as Array<{
      journal_mode: string;
    }>;
    expect(result[0]!.journal_mode).toBe("memory");
  });
});

describe("Queue operations", () => {
  let client: QueueClient;

  beforeEach(() => {
    client = new QueueClient(":memory:");
  });

  afterEach(() => {
    client.close();
  });

  describe("enqueue", () => {
    it("should insert a row and return the id", () => {
      const id = enqueue(client.db, {
        url: "https://example.com",
        discordMessageId: "msg-1",
        discordChannelId: "chan-1",
      });
      expect(id).toBe(1);
    });

    it("should insert with an optional comment", () => {
      const id = enqueue(client.db, {
        url: "https://example.com",
        comment: "Great article",
        discordMessageId: "msg-2",
        discordChannelId: "chan-1",
      });
      expect(id).toBe(1);

      const row = client.db
        .prepare(`SELECT comment FROM queue WHERE id = ?`)
        .get(id) as { comment: string | null };
      expect(row.comment).toBe("Great article");
    });

    it("should insert null comment when not provided", () => {
      const id = enqueue(client.db, {
        url: "https://example.com",
        discordMessageId: "msg-3",
        discordChannelId: "chan-1",
      });

      const row = client.db
        .prepare(`SELECT comment FROM queue WHERE id = ?`)
        .get(id) as { comment: string | null };
      expect(row.comment).toBeNull();
    });

    it("should reject duplicate discord_message_id", () => {
      enqueue(client.db, {
        url: "https://example.com",
        discordMessageId: "msg-dup",
        discordChannelId: "chan-1",
      });

      expect(() =>
        enqueue(client.db, {
          url: "https://other.com",
          discordMessageId: "msg-dup",
          discordChannelId: "chan-1",
        })
      ).toThrow(/UNIQUE constraint failed/);
    });
  });

  describe("dequeue", () => {
    it("should return the oldest pending item and mark it processing", () => {
      enqueue(client.db, {
        url: "https://first.com",
        discordMessageId: "msg-a",
        discordChannelId: "chan-1",
      });
      enqueue(client.db, {
        url: "https://second.com",
        discordMessageId: "msg-b",
        discordChannelId: "chan-1",
      });

      const item = dequeue(client.db);
      expect(item).not.toBeNull();
      expect(item!.url).toBe("https://first.com");
      expect(item!.status).toBe("processing");

      // Verify DB state
      const row = client.db
        .prepare(`SELECT status FROM queue WHERE id = ?`)
        .get(item!.id) as { status: string };
      expect(row.status).toBe("processing");
    });

    it("should return null when there are no pending items", () => {
      const item = dequeue(client.db);
      expect(item).toBeNull();
    });

    it("should skip items that are already processing", () => {
      enqueue(client.db, {
        url: "https://first.com",
        discordMessageId: "msg-a",
        discordChannelId: "chan-1",
      });
      enqueue(client.db, {
        url: "https://second.com",
        discordMessageId: "msg-b",
        discordChannelId: "chan-1",
      });

      // Dequeue the first one (marks it processing)
      const first = dequeue(client.db);
      expect(first!.url).toBe("https://first.com");

      // Second dequeue should get the second item
      const second = dequeue(client.db);
      expect(second!.url).toBe("https://second.com");

      // Third dequeue should return null
      const third = dequeue(client.db);
      expect(third).toBeNull();
    });

    it("should maintain FIFO ordering", () => {
      const urls = [
        "https://1.com",
        "https://2.com",
        "https://3.com",
      ];

      for (let i = 0; i < urls.length; i++) {
        enqueue(client.db, {
          url: urls[i]!,
          discordMessageId: `msg-${i}`,
          discordChannelId: "chan-1",
        });
      }

      for (const expected of urls) {
        const item = dequeue(client.db);
        expect(item!.url).toBe(expected);
      }
    });
  });

  describe("markCompleted", () => {
    it("should update status to completed", () => {
      const id = enqueue(client.db, {
        url: "https://example.com",
        discordMessageId: "msg-1",
        discordChannelId: "chan-1",
      });

      markCompleted(client.db, id);

      const row = client.db
        .prepare(`SELECT status FROM queue WHERE id = ?`)
        .get(id) as { status: string };
      expect(row.status).toBe("completed");
    });
  });

  describe("markFailed", () => {
    it("should update status to failed and set error message", () => {
      const id = enqueue(client.db, {
        url: "https://example.com",
        discordMessageId: "msg-1",
        discordChannelId: "chan-1",
      });

      markFailed(client.db, id, "Connection timeout");

      const row = client.db
        .prepare(`SELECT status, error FROM queue WHERE id = ?`)
        .get(id) as { status: string; error: string };
      expect(row.status).toBe("failed");
      expect(row.error).toBe("Connection timeout");
    });
  });

  describe("resetStale", () => {
    it("should reset old processing items back to pending", () => {
      const id = enqueue(client.db, {
        url: "https://example.com",
        discordMessageId: "msg-1",
        discordChannelId: "chan-1",
      });

      // Mark as processing
      dequeue(client.db);

      // Manually backdate the updated_at to simulate staleness
      client.db
        .prepare(
          `UPDATE queue SET updated_at = datetime('now', '-2 hours') WHERE id = ?`
        )
        .run(id);

      // Reset items older than 1 hour
      const count = resetStale(client.db, 60 * 60 * 1000);
      expect(count).toBe(1);

      const row = client.db
        .prepare(`SELECT status FROM queue WHERE id = ?`)
        .get(id) as { status: string };
      expect(row.status).toBe("pending");
    });

    it("should not reset recently-processing items", () => {
      enqueue(client.db, {
        url: "https://example.com",
        discordMessageId: "msg-1",
        discordChannelId: "chan-1",
      });

      dequeue(client.db);

      // Reset items older than 1 hour — the item just started processing
      const count = resetStale(client.db, 60 * 60 * 1000);
      expect(count).toBe(0);
    });

    it("should not reset completed or failed items", () => {
      const id1 = enqueue(client.db, {
        url: "https://a.com",
        discordMessageId: "msg-a",
        discordChannelId: "chan-1",
      });
      const id2 = enqueue(client.db, {
        url: "https://b.com",
        discordMessageId: "msg-b",
        discordChannelId: "chan-1",
      });

      markCompleted(client.db, id1);
      markFailed(client.db, id2, "error");

      // Backdate both
      client.db
        .prepare(
          `UPDATE queue SET updated_at = datetime('now', '-2 hours') WHERE id IN (?, ?)`
        )
        .run(id1, id2);

      const count = resetStale(client.db, 60 * 60 * 1000);
      expect(count).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return correct counts by status", () => {
      // 2 pending
      enqueue(client.db, {
        url: "https://pending1.com",
        discordMessageId: "msg-1",
        discordChannelId: "chan-1",
      });
      enqueue(client.db, {
        url: "https://pending2.com",
        discordMessageId: "msg-2",
        discordChannelId: "chan-1",
      });

      // 1 completed
      const id3 = enqueue(client.db, {
        url: "https://completed.com",
        discordMessageId: "msg-3",
        discordChannelId: "chan-1",
      });
      markCompleted(client.db, id3);

      // 1 failed
      const id4 = enqueue(client.db, {
        url: "https://failed.com",
        discordMessageId: "msg-4",
        discordChannelId: "chan-1",
      });
      markFailed(client.db, id4, "err");

      // dequeue picks msg-1 (oldest pending) -> processing
      dequeue(client.db);

      // Now: msg-1 = processing, msg-2 = pending, msg-3 = completed, msg-4 = failed
      const stats = getStats(client.db);
      expect(stats.pending).toBe(1); // msg-2
      expect(stats.processing).toBe(1); // msg-1 was dequeued
      expect(stats.completed).toBe(1); // msg-3
      expect(stats.failed).toBe(1); // msg-4
    });

    it("should return zeroes for empty database", () => {
      const stats = getStats(client.db);
      expect(stats).toEqual({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });
    });
  });
});
