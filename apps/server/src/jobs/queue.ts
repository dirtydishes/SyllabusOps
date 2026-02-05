import { sha256Hex } from "@syllabusops/core";
import type { Db } from "../db";
import type { JobRecord, JobStatus, JobType } from "./schemas";

export type JobQueue = {
  enqueue: (opts: {
    jobType: JobType;
    payload: Record<string, unknown>;
    priority: number;
  }) => JobRecord;
  list: (opts?: { limit?: number; status?: JobStatus; jobType?: JobType }) => JobRecord[];
  stats: () => { counts: Record<JobStatus, number> };
  claimNext: () => JobRecord | null;
  succeed: (id: string) => void;
  fail: (id: string, error: string) => void;
  block: (id: string, reason: string) => void;
};

function newJobId(jobType: string): string {
  const seed = `${jobType}:${new Date().toISOString()}:${Math.random()}`;
  return `job_${sha256Hex(seed).slice(0, 12)}`;
}

export function createJobQueue(db: Db): JobQueue {
  return {
    enqueue: ({ jobType, payload, priority }) => {
      const id = newJobId(jobType);
      const now = new Date().toISOString();
      const payloadJson = JSON.stringify(payload ?? {});
      db.query(
        `
        INSERT INTO jobs
          (id, job_type, status, priority, payload_json, attempts, max_attempts, next_run_at, last_error, created_at, updated_at)
        VALUES
          (?, ?, 'queued', ?, ?, 0, 5, ?, NULL, ?, ?)
      `
      ).run(id, jobType, priority, payloadJson, now, now, now);

      return db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRecord;
    },
    list: ({ limit = 100, status, jobType } = {}) => {
      if (status && jobType) {
        return db
          .query(
            "SELECT * FROM jobs WHERE status = ? AND job_type = ? ORDER BY priority ASC, next_run_at ASC LIMIT ?"
          )
          .all(status, jobType, limit) as JobRecord[];
      }
      if (status) {
        return db
          .query(
            "SELECT * FROM jobs WHERE status = ? ORDER BY priority ASC, next_run_at ASC LIMIT ?"
          )
          .all(status, limit) as JobRecord[];
      }
      if (jobType) {
        return db
          .query(
            "SELECT * FROM jobs WHERE job_type = ? ORDER BY updated_at DESC LIMIT ?"
          )
          .all(jobType, limit) as JobRecord[];
      }
      return db
        .query("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?")
        .all(limit) as JobRecord[];
    },
    stats: () => {
      const rows = db
        .query("SELECT status, COUNT(1) as n FROM jobs GROUP BY status")
        .all() as Array<{ status: JobStatus; n: number }>;
      const counts: Record<JobStatus, number> = {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        blocked: 0,
      };
      for (const r of rows) {
        if (r.status in counts) counts[r.status] = Number(r.n ?? 0);
      }
      return { counts };
    },
    claimNext: () => {
      const now = new Date().toISOString();

      const tx = db.transaction(() => {
        const row = db
          .query(
            `
            SELECT * FROM jobs
            WHERE status IN ('queued', 'failed')
              AND attempts < max_attempts
              AND next_run_at <= ?
            ORDER BY priority ASC, next_run_at ASC
            LIMIT 1
          `
          )
          .get(now) as JobRecord | null;
        if (!row) return null;

        const updatedAt = new Date().toISOString();
        const result = db
          .query(
            `
            UPDATE jobs
            SET status = 'running', attempts = attempts + 1, updated_at = ?
            WHERE id = ? AND status IN ('queued', 'failed')
          `
          )
          .run(updatedAt, row.id);
        if (result.changes !== 1) return null;

        return db
          .query("SELECT * FROM jobs WHERE id = ?")
          .get(row.id) as JobRecord;
      });

      return tx.immediate();
    },
    succeed: (id: string) => {
      const now = new Date().toISOString();
      db.query(
        "UPDATE jobs SET status = 'succeeded', updated_at = ? WHERE id = ?"
      ).run(now, id);
    },
    fail: (id: string, error: string) => {
      const now = new Date().toISOString();
      const row = db
        .query("SELECT attempts, max_attempts FROM jobs WHERE id = ?")
        .get(id) as { attempts?: number; max_attempts?: number } | null;
      const attempts = Number(row?.attempts ?? 1);
      const delaySeconds = Math.min(10 * 2 ** Math.max(0, attempts - 1), 10 * 60);
      const nextRunAt = new Date(
        Date.now() + delaySeconds * 1000
      ).toISOString();
      db.query(
        `
        UPDATE jobs
        SET status = 'failed', last_error = ?, next_run_at = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(error.slice(0, 2000), nextRunAt, now, id);
    },
    block: (id: string, reason: string) => {
      const now = new Date().toISOString();
      db.query(
        "UPDATE jobs SET status = 'blocked', last_error = ?, updated_at = ? WHERE id = ?"
      ).run(reason.slice(0, 2000), now, id);
    },
  };
}
