import { sha256Hex } from "@syllabusops/core";
import type { Db } from "../db";

export type NotionEntityType =
  | "course_page"
  | "session_page"
  | "session_managed_block";

export type NotionBindingRow = {
  id: string;
  entity_type: NotionEntityType;
  entity_key: string;
  notion_id: string;
  last_published_hash: string;
  created_at: string;
  updated_at: string;
};

export type NotionSyncStatus = "running" | "succeeded" | "failed" | "blocked";

export type NotionSyncRunRow = {
  id: string;
  job_id: string | null;
  course_slug: string;
  session_date: string | null;
  status: NotionSyncStatus;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

function newId(prefix: string, seed: string): string {
  const raw = `${prefix}:${seed}:${new Date().toISOString()}:${Math.random()}`;
  return `${prefix}_${sha256Hex(raw).slice(0, 12)}`;
}

export function createNotionStore(db: Db) {
  return {
    getBinding(opts: {
      entityType: NotionEntityType;
      entityKey: string;
    }): NotionBindingRow | null {
      return (
        (db
          .query(
            `
            SELECT * FROM notion_bindings
            WHERE entity_type = ? AND entity_key = ?
            LIMIT 1
          `
          )
          .get(opts.entityType, opts.entityKey) as NotionBindingRow | null) ??
        null
      );
    },

    upsertBinding(opts: {
      entityType: NotionEntityType;
      entityKey: string;
      notionId: string;
      lastPublishedHash: string;
    }): NotionBindingRow {
      const id = newId("notionbind", `${opts.entityType}:${opts.entityKey}`);
      const now = new Date().toISOString();
      db.query(
        `
        INSERT INTO notion_bindings
          (id, entity_type, entity_key, notion_id, last_published_hash, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_key)
        DO UPDATE SET
          notion_id = excluded.notion_id,
          last_published_hash = excluded.last_published_hash,
          updated_at = excluded.updated_at
      `
      ).run(
        id,
        opts.entityType,
        opts.entityKey,
        opts.notionId,
        opts.lastPublishedHash,
        now,
        now
      );

      return db
        .query(
          `
          SELECT * FROM notion_bindings
          WHERE entity_type = ? AND entity_key = ?
          LIMIT 1
        `
        )
        .get(opts.entityType, opts.entityKey) as NotionBindingRow;
    },

    startSyncRun(opts: {
      jobId?: string | null;
      courseSlug: string;
      sessionDate?: string | null;
    }): NotionSyncRunRow {
      const id = newId(
        "notionsync",
        `${opts.jobId ?? "manual"}:${opts.courseSlug}:${opts.sessionDate ?? ""}`
      );
      const now = new Date().toISOString();
      db.query(
        `
        INSERT INTO notion_sync_runs
          (id, job_id, course_slug, session_date, status, error, started_at, finished_at)
        VALUES
          (?, ?, ?, ?, 'running', NULL, ?, NULL)
      `
      ).run(
        id,
        opts.jobId ?? null,
        opts.courseSlug,
        opts.sessionDate ?? null,
        now
      );

      return db
        .query("SELECT * FROM notion_sync_runs WHERE id = ? LIMIT 1")
        .get(id) as NotionSyncRunRow;
    },

    finishSyncRun(opts: {
      id: string;
      status: Exclude<NotionSyncStatus, "running">;
      error?: string | null;
    }): { ok: true; changed: number } {
      const now = new Date().toISOString();
      const result = db
        .query(
          `
          UPDATE notion_sync_runs
          SET status = ?, error = ?, finished_at = ?
          WHERE id = ?
        `
        )
        .run(opts.status, opts.error ?? null, now, opts.id);
      return { ok: true, changed: result.changes };
    },

    listSyncRuns(opts?: {
      courseSlug?: string;
      limit?: number;
    }): NotionSyncRunRow[] {
      const limit = opts?.limit ?? 100;
      if (opts?.courseSlug) {
        return db
          .query(
            `
            SELECT * FROM notion_sync_runs
            WHERE course_slug = ?
            ORDER BY started_at DESC
            LIMIT ?
          `
          )
          .all(opts.courseSlug, limit) as NotionSyncRunRow[];
      }
      return db
        .query(
          `
          SELECT * FROM notion_sync_runs
          ORDER BY started_at DESC
          LIMIT ?
        `
        )
        .all(limit) as NotionSyncRunRow[];
    },
  };
}
