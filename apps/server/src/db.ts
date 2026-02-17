import { Database } from "bun:sqlite";
import fs from "node:fs/promises";
import path from "node:path";

export type Db = Database;

export async function openDb(opts: { stateDir: string }): Promise<Db> {
  await fs.mkdir(opts.stateDir, { recursive: true });
  const dbPath = path.join(opts.stateDir, "syllabusops.sqlite");
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  applyMigration(db, "2026-02-04_jobs_v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 2,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_run_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_next ON jobs(status, next_run_at, priority);
    `);
  });

  applyMigration(db, "2026-02-05_tasks_v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        course_slug TEXT NOT NULL,
        session_date TEXT,
        artifact_sha TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        due TEXT,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_course_status ON tasks(course_slug, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(course_slug, session_date, created_at);
    `);
  });

  applyMigration(db, "2026-02-06_calendar_v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_schedules (
        id TEXT PRIMARY KEY,
        course_slug TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        timezone TEXT NOT NULL,
        zoom_join_url TEXT,
        zoom_meeting_id TEXT,
        zoom_passcode TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_schedules_unique
        ON calendar_schedules(course_slug, day_of_week, start_time, end_time, timezone);
      CREATE INDEX IF NOT EXISTS idx_calendar_schedules_course
        ON calendar_schedules(course_slug, day_of_week, start_time);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        course_slug TEXT NOT NULL,
        uid TEXT NOT NULL,
        title TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        location TEXT,
        description TEXT,
        zoom_join_url TEXT,
        zoom_meeting_id TEXT,
        zoom_passcode TEXT,
        source TEXT NOT NULL DEFAULT 'ics',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_unique
        ON calendar_events(course_slug, uid);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_course_starts
        ON calendar_events(course_slug, starts_at);
    `);
  });

  applyMigration(db, "2026-02-16_sections_v1", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_sections (
        id TEXT PRIMARY KEY,
        course_slug TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_course_sections_slug
        ON course_sections(course_slug, slug);
      CREATE INDEX IF NOT EXISTS idx_course_sections_course_date
        ON course_sections(course_slug, start_date, end_date);
    `);
  });
}

function applyMigration(db: Db, id: string, fn: () => void) {
  const existing = db.query("SELECT 1 FROM migrations WHERE id = ?").get(id);
  if (existing) return;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    fn();
    db.query("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(
      id,
      now
    );
  });
  tx();
}
