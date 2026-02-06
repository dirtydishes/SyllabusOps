import { sha256Hex } from "@syllabusops/core";
import type { Db } from "../db";

export type CalendarScheduleRow = {
  id: string;
  course_slug: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  zoom_join_url: string | null;
  zoom_meeting_id: string | null;
  zoom_passcode: string | null;
  created_at: string;
  updated_at: string;
};

export type CalendarEventRow = {
  id: string;
  course_slug: string;
  uid: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string | null;
  description: string | null;
  zoom_join_url: string | null;
  zoom_meeting_id: string | null;
  zoom_passcode: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type NewCalendarSchedule = {
  courseSlug: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  zoomJoinUrl?: string | null;
  zoomMeetingId?: string | null;
  zoomPasscode?: string | null;
};

export type NewCalendarEvent = {
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location?: string | null;
  description?: string | null;
  zoomJoinUrl?: string | null;
  zoomMeetingId?: string | null;
  zoomPasscode?: string | null;
  source?: string;
};

function asNullableText(v?: string | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function scheduleId(seed: string): string {
  return `sched_${sha256Hex(seed).slice(0, 12)}`;
}

function eventId(seed: string): string {
  return `evt_${sha256Hex(seed).slice(0, 12)}`;
}

export function createCalendarStore(db: Db) {
  return {
    list: (opts?: {
      courseSlug?: string;
      limit?: number;
    }): {
      schedules: CalendarScheduleRow[];
      events: CalendarEventRow[];
    } => {
      const limit = opts?.limit ?? 300;
      if (opts?.courseSlug) {
        const schedules = db
          .query(
            `
            SELECT * FROM calendar_schedules
            WHERE course_slug = ?
            ORDER BY day_of_week ASC, start_time ASC
            LIMIT ?
          `
          )
          .all(opts.courseSlug, limit) as CalendarScheduleRow[];
        const events = db
          .query(
            `
            SELECT * FROM calendar_events
            WHERE course_slug = ?
            ORDER BY starts_at ASC, title ASC
            LIMIT ?
          `
          )
          .all(opts.courseSlug, limit) as CalendarEventRow[];
        return { schedules, events };
      }

      const schedules = db
        .query(
          `
          SELECT * FROM calendar_schedules
          ORDER BY course_slug ASC, day_of_week ASC, start_time ASC
          LIMIT ?
        `
        )
        .all(limit) as CalendarScheduleRow[];
      const events = db
        .query(
          `
          SELECT * FROM calendar_events
          ORDER BY starts_at ASC, title ASC
          LIMIT ?
        `
        )
        .all(limit) as CalendarEventRow[];
      return { schedules, events };
    },

    upsertSchedule: (next: NewCalendarSchedule): CalendarScheduleRow => {
      const id = scheduleId(
        `${next.courseSlug}:${next.dayOfWeek}:${next.startTime}:${next.endTime}:${next.timezone}`
      );
      const now = new Date().toISOString();
      db.query(
        `
        INSERT INTO calendar_schedules
          (
            id, course_slug, day_of_week, start_time, end_time, timezone,
            zoom_join_url, zoom_meeting_id, zoom_passcode,
            created_at, updated_at
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(course_slug, day_of_week, start_time, end_time, timezone)
        DO UPDATE SET
          zoom_join_url = excluded.zoom_join_url,
          zoom_meeting_id = excluded.zoom_meeting_id,
          zoom_passcode = excluded.zoom_passcode,
          updated_at = excluded.updated_at
      `
      ).run(
        id,
        next.courseSlug,
        next.dayOfWeek,
        next.startTime,
        next.endTime,
        next.timezone,
        asNullableText(next.zoomJoinUrl),
        asNullableText(next.zoomMeetingId),
        asNullableText(next.zoomPasscode),
        now,
        now
      );

      return db
        .query(
          `
          SELECT * FROM calendar_schedules
          WHERE course_slug = ? AND day_of_week = ? AND start_time = ? AND end_time = ? AND timezone = ?
          LIMIT 1
        `
        )
        .get(
          next.courseSlug,
          next.dayOfWeek,
          next.startTime,
          next.endTime,
          next.timezone
        ) as CalendarScheduleRow;
    },

    deleteSchedule: (id: string): { ok: true; changed: number } => {
      const result = db
        .query("DELETE FROM calendar_schedules WHERE id = ?")
        .run(id);
      return { ok: true, changed: result.changes };
    },

    upsertEvents: (opts: {
      courseSlug: string;
      events: NewCalendarEvent[];
    }): { inserted: number; updated: number; total: number } => {
      let inserted = 0;
      let updated = 0;
      const tx = db.transaction(() => {
        for (const ev of opts.events) {
          const id = eventId(`${opts.courseSlug}:${ev.uid}`);
          const existing = db
            .query(
              "SELECT id FROM calendar_events WHERE course_slug = ? AND uid = ? LIMIT 1"
            )
            .get(opts.courseSlug, ev.uid) as { id?: string } | null;
          if (existing?.id) updated += 1;
          else inserted += 1;

          const now = new Date().toISOString();
          db.query(
            `
            INSERT INTO calendar_events
              (
                id, course_slug, uid, title, starts_at, ends_at, timezone,
                location, description, zoom_join_url, zoom_meeting_id, zoom_passcode,
                source, created_at, updated_at
              )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(course_slug, uid)
            DO UPDATE SET
              title = excluded.title,
              starts_at = excluded.starts_at,
              ends_at = excluded.ends_at,
              timezone = excluded.timezone,
              location = excluded.location,
              description = excluded.description,
              zoom_join_url = excluded.zoom_join_url,
              zoom_meeting_id = excluded.zoom_meeting_id,
              zoom_passcode = excluded.zoom_passcode,
              source = excluded.source,
              updated_at = excluded.updated_at
          `
          ).run(
            id,
            opts.courseSlug,
            ev.uid,
            ev.title,
            ev.startsAt,
            ev.endsAt,
            ev.timezone,
            asNullableText(ev.location),
            asNullableText(ev.description),
            asNullableText(ev.zoomJoinUrl),
            asNullableText(ev.zoomMeetingId),
            asNullableText(ev.zoomPasscode),
            asNullableText(ev.source) ?? "ics",
            now,
            now
          );
        }
      });
      tx.immediate();
      return { inserted, updated, total: opts.events.length };
    },
  };
}
