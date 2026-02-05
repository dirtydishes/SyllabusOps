import fs from "node:fs/promises";
import { scanCourseDetail, scanSession } from "../library/library";
import type { LibraryCourse, LibrarySession } from "../library/library";
import type { CourseRegistry } from "./registry";

async function listDirs(dir: string): Promise<string[]> {
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function mergeSessions(sessions: LibrarySession[]): LibrarySession[] {
  const map = new Map<string, LibrarySession>();
  for (const s of sessions) {
    const existing = map.get(s.date);
    if (!existing) {
      map.set(s.date, { date: s.date, artifacts: [...s.artifacts] });
      continue;
    }
    const seen = new Set(existing.artifacts.map((a) => `${a.sha256}:${a.relPath}`));
    for (const a of s.artifacts) {
      const key = `${a.sha256}:${a.relPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      existing.artifacts.push(a);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export type GroupedCourse = LibraryCourse & { memberSlugs: string[] };

export async function scanCoursesGrouped(opts: {
  unifiedDir: string;
  stateDir: string;
  registry: CourseRegistry;
}): Promise<GroupedCourse[]> {
  const physicalSlugs = await listDirs(opts.unifiedDir);
  const aliasGroups = new Map<string, string[]>();

  for (const slug of physicalSlugs) {
    const canonical = await opts.registry.resolveCanonical(slug);
    const list = aliasGroups.get(canonical) ?? [];
    list.push(slug);
    aliasGroups.set(canonical, list);
  }

  const out: GroupedCourse[] = [];
  for (const [canonicalSlug, memberSlugs] of aliasGroups.entries()) {
    const details = await Promise.all(
      memberSlugs.map((slug) =>
        scanCourseDetail({
          unifiedDir: opts.unifiedDir,
          stateDir: opts.stateDir,
          courseSlug: slug,
          limitSessions: 0,
        })
      )
    );
    const okDetails = details.filter((d) => d.ok) as Array<
      Extract<Awaited<ReturnType<typeof scanCourseDetail>>, { ok: true }>
    >;
    if (okDetails.length === 0) continue;

    const mergedSessions = mergeSessions(okDetails.flatMap((d) => d.sessions));
    const artifacts = mergedSessions.flatMap((s) => s.artifacts);
    const lastIngestedAt = artifacts.map((a) => a.ingestedAt).sort().at(-1) ?? null;

    const registryName = await opts.registry.nameFor(canonicalSlug);
    const fallbackName = okDetails[0]!.course.name;

    out.push({
      slug: canonicalSlug,
      name: registryName ?? fallbackName ?? canonicalSlug,
      sessionsCount: mergedSessions.length,
      artifactsCount: artifacts.length,
      lastIngestedAt,
      memberSlugs: [...memberSlugs].sort((a, b) => a.localeCompare(b)),
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function scanCourseDetailGrouped(opts: {
  unifiedDir: string;
  stateDir: string;
  registry: CourseRegistry;
  courseSlug: string; // canonical or physical
}): Promise<
  | { ok: true; course: { slug: string; name: string; memberSlugs: string[] }; sessions: LibrarySession[] }
  | { ok: false; error: "COURSE_NOT_FOUND" }
> {
  const physicalSlugs = await listDirs(opts.unifiedDir);
  const canonical = await opts.registry.resolveCanonical(opts.courseSlug);

  // Build member list by resolving each physical slug's canonical.
  const members: string[] = [];
  for (const p of physicalSlugs) {
    const c = await opts.registry.resolveCanonical(p);
    if (c === canonical) members.push(p);
  }
  if (members.length === 0) return { ok: false, error: "COURSE_NOT_FOUND" };

  const details = await Promise.all(
    members.map((slug) =>
      scanCourseDetail({
        unifiedDir: opts.unifiedDir,
        stateDir: opts.stateDir,
        courseSlug: slug,
        limitSessions: 0,
      })
    )
  );
  const okDetails = details.filter((d) => d.ok) as Array<
    Extract<Awaited<ReturnType<typeof scanCourseDetail>>, { ok: true }>
  >;
  if (okDetails.length === 0) return { ok: false, error: "COURSE_NOT_FOUND" };

  const mergedSessions = mergeSessions(okDetails.flatMap((d) => d.sessions));
  const registryName = await opts.registry.nameFor(canonical);
  const fallbackName = okDetails[0]!.course.name;

  return {
    ok: true,
    course: { slug: canonical, name: registryName ?? fallbackName ?? canonical, memberSlugs: members },
    sessions: mergedSessions,
  };
}

export async function scanSessionGrouped(opts: {
  unifiedDir: string;
  stateDir: string;
  registry: CourseRegistry;
  courseSlug: string; // canonical or physical
  sessionDate: string;
}): Promise<
  | { ok: true; course: { slug: string; name: string; memberSlugs: string[] }; session: LibrarySession }
  | { ok: false; error: "COURSE_NOT_FOUND" | "SESSION_NOT_FOUND" }
> {
  const canonical = await opts.registry.resolveCanonical(opts.courseSlug);

  const physicalSlugs = await listDirs(opts.unifiedDir);
  const members: string[] = [];
  for (const p of physicalSlugs) {
    const c = await opts.registry.resolveCanonical(p);
    if (c === canonical) members.push(p);
  }
  if (members.length === 0) return { ok: false, error: "COURSE_NOT_FOUND" };

  const results = await Promise.all(
    members.map((slug) =>
      scanSession({
        unifiedDir: opts.unifiedDir,
        stateDir: opts.stateDir,
        courseSlug: slug,
        sessionDate: opts.sessionDate,
      })
    )
  );
  const okSessions = results.filter((r) => r.ok) as Array<
    Extract<Awaited<ReturnType<typeof scanSession>>, { ok: true }>
  >;
  if (okSessions.length === 0) return { ok: false, error: "SESSION_NOT_FOUND" };

  const merged = mergeSessions(okSessions.map((r) => r.session));
  const session = merged.find((s) => s.date === opts.sessionDate) ?? null;
  if (!session) return { ok: false, error: "SESSION_NOT_FOUND" };

  const registryName = await opts.registry.nameFor(canonical);
  const fallbackName = okSessions[0]!.course.name;

  return {
    ok: true,
    course: { slug: canonical, name: registryName ?? fallbackName ?? canonical, memberSlugs: members },
    session,
  };
}
