import { sha256Hex } from "@syllabusops/core";
import type { Db } from "../db";

export type TaskStatus = "suggested" | "approved" | "done" | "dismissed";

export type TaskRow = {
  id: string;
  course_slug: string;
  session_date: string | null;
  artifact_sha: string | null;
  title: string;
  description: string;
  due: string | null;
  confidence: number;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
};

export type NewTask = {
  courseSlug: string;
  sessionDate: string | null;
  artifactSha: string | null;
  title: string;
  description: string;
  due: string | null;
  confidence: number;
};

function taskIdFromSeed(seed: string): string {
  return `task_${sha256Hex(seed).slice(0, 12)}`;
}

export function createTasksStore(db: Db) {
  return {
    list: (opts: {
      courseSlug: string;
      sessionDate?: string;
      status?: TaskStatus;
      limit?: number;
    }): TaskRow[] => {
      const limit = opts.limit ?? 200;
      if (opts.sessionDate && opts.status) {
        return db
          .query(
            `
            SELECT * FROM tasks
            WHERE course_slug = ? AND session_date = ? AND status = ?
            ORDER BY created_at DESC
            LIMIT ?
          `
          )
          .all(opts.courseSlug, opts.sessionDate, opts.status, limit) as TaskRow[];
      }
      if (opts.sessionDate) {
        return db
          .query(
            `
            SELECT * FROM tasks
            WHERE course_slug = ? AND session_date = ?
            ORDER BY created_at DESC
            LIMIT ?
          `
          )
          .all(opts.courseSlug, opts.sessionDate, limit) as TaskRow[];
      }
      if (opts.status) {
        return db
          .query(
            `
            SELECT * FROM tasks
            WHERE course_slug = ? AND status = ?
            ORDER BY created_at DESC
            LIMIT ?
          `
          )
          .all(opts.courseSlug, opts.status, limit) as TaskRow[];
      }
      return db
        .query(
          `
          SELECT * FROM tasks
          WHERE course_slug = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
        )
        .all(opts.courseSlug, limit) as TaskRow[];
    },

    insertSuggested: (tasks: NewTask[]): { inserted: number; ids: string[] } => {
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        const ids: string[] = [];
        let inserted = 0;
        for (const t of tasks) {
          const id = taskIdFromSeed(
            `${t.courseSlug}:${t.sessionDate ?? ""}:${t.artifactSha ?? ""}:${t.title.toLowerCase()}`
          );
          const result = db
            .query(
              `
              INSERT OR IGNORE INTO tasks
                (id, course_slug, session_date, artifact_sha, title, description, due, confidence, status, created_at, updated_at)
              VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?)
            `
            )
            .run(
              id,
              t.courseSlug,
              t.sessionDate,
              t.artifactSha,
              t.title,
              t.description,
              t.due,
              t.confidence,
              now,
              now
            );
          if (result.changes === 1) {
            inserted += 1;
            ids.push(id);
          }
        }
        return { inserted, ids };
      });
      return tx.immediate();
    },

    setStatus: (opts: { id: string; status: TaskStatus }) => {
      const now = new Date().toISOString();
      const result = db
        .query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
        .run(opts.status, now, opts.id);
      return { ok: true as const, changed: result.changes };
    },
  };
}

