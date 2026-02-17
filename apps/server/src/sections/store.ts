import { sha256Hex } from "@syllabusops/core";
import type { Db } from "../db";

export type SectionRow = {
  id: string;
  course_slug: string;
  slug: string;
  title: string;
  start_date: string;
  end_date: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeNullableText(v?: string | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function slugifySection(input: string): string {
  const out = input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return out || "section";
}

function sectionId(seed: string): string {
  return `section_${sha256Hex(seed).slice(0, 12)}`;
}

export function createSectionsStore(db: Db) {
  return {
    list: (opts: { courseSlug: string }): SectionRow[] => {
      return db
        .query(
          `
          SELECT * FROM course_sections
          WHERE course_slug = ?
          ORDER BY start_date ASC, end_date ASC, title ASC
        `
        )
        .all(opts.courseSlug) as SectionRow[];
    },

    getById: (id: string): SectionRow | null => {
      return (
        (db
          .query("SELECT * FROM course_sections WHERE id = ? LIMIT 1")
          .get(id) as SectionRow | null) ?? null
      );
    },

    upsert: (opts: {
      courseSlug: string;
      title: string;
      startDate: string;
      endDate: string;
      slug?: string;
      description?: string | null;
    }): SectionRow => {
      const normalizedSlug = slugifySection(opts.slug ?? opts.title);
      const id = sectionId(
        `${opts.courseSlug}:${normalizedSlug}:${opts.startDate}:${opts.endDate}`
      );
      const now = new Date().toISOString();
      db.query(
        `
        INSERT INTO course_sections
          (id, course_slug, slug, title, start_date, end_date, description, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(course_slug, slug)
        DO UPDATE SET
          title = excluded.title,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          description = excluded.description,
          updated_at = excluded.updated_at
      `
      ).run(
        id,
        opts.courseSlug,
        normalizedSlug,
        opts.title.trim(),
        opts.startDate,
        opts.endDate,
        normalizeNullableText(opts.description),
        now,
        now
      );

      return db
        .query(
          `
          SELECT * FROM course_sections
          WHERE course_slug = ? AND slug = ?
          LIMIT 1
        `
        )
        .get(opts.courseSlug, normalizedSlug) as SectionRow;
    },

    delete: (id: string): { ok: true; changed: number } => {
      const result = db
        .query("DELETE FROM course_sections WHERE id = ?")
        .run(id);
      return { ok: true, changed: result.changes };
    },
  };
}
