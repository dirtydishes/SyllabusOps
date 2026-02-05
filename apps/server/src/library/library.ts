import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ArtifactMetaSchema = z.object({
  version: z.literal(1),
  ingestedAt: z.string(),
  sourcePath: z.string(),
  sha256: z.string(),
  kind: z.enum(["transcript", "slides", "unknown"]),
  detected: z.object({
    courseShort: z.string(),
    courseSlug: z.string(),
    sessionDate: z.string(),
  }),
  pipelineVersion: z.string(),
});

export type LibraryCourse = {
  slug: string;
  name: string;
  sessionsCount: number;
  artifactsCount: number;
  lastIngestedAt: string | null;
};

export type LibrarySession = {
  date: string; // YYYY-MM-DD
  artifacts: LibraryArtifact[];
};

export type CacheType = "transcripts" | "pptx" | "pdf";

export type LibraryArtifact = {
  id: string; // sha256
  kind: "transcript" | "slides" | "unknown";
  fileName: string;
  relPath: string; // rel to Unified root
  sha256: string;
  ingestedAt: string;
  sourcePath: string;
  ext: string;
  cache: { type: CacheType | null; extractedTextAvailable: boolean };
  generated: {
    artifactSummaryPath: string; // rel to Unified root
  };
};

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

async function listDirs(dir: string): Promise<string[]> {
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !isHidden(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function inferCacheType(opts: {
  kind: "transcript" | "slides" | "unknown";
  ext: string;
}): CacheType | null {
  if (opts.kind === "transcript") return "transcripts";
  if (opts.ext === ".pptx") return "pptx";
  if (opts.ext === ".pdf") return "pdf";
  return null;
}

function relFromUnified(unifiedDir: string, absPath: string): string {
  const rel = path.relative(unifiedDir, absPath);
  return rel.replaceAll(path.sep, "/");
}

export async function scanCourses(opts: {
  unifiedDir: string;
  stateDir: string;
}): Promise<LibraryCourse[]> {
  const courseSlugs = await listDirs(opts.unifiedDir);

  const courses: LibraryCourse[] = [];
  for (const slug of courseSlugs) {
    const detail = await scanCourseDetail({
      unifiedDir: opts.unifiedDir,
      stateDir: opts.stateDir,
      courseSlug: slug,
      limitSessions: 0,
    });
    if (!detail.ok) continue;

    courses.push({
      slug,
      name: detail.course.name,
      sessionsCount: detail.sessions.length,
      artifactsCount: detail.sessions.reduce(
        (acc, s) => acc + s.artifacts.length,
        0
      ),
      lastIngestedAt:
        detail.sessions
          .flatMap((s) => s.artifacts.map((a) => a.ingestedAt))
          .sort()
          .at(-1) ?? null,
    });
  }

  return courses.sort((a, b) => a.name.localeCompare(b.name));
}

export async function scanCourseDetail(opts: {
  unifiedDir: string;
  stateDir: string;
  courseSlug: string;
  limitSessions?: number; // 0 means no limit
}): Promise<
  | { ok: true; course: { slug: string; name: string }; sessions: LibrarySession[] }
  | { ok: false; error: "COURSE_NOT_FOUND" }
> {
  const courseDir = path.join(opts.unifiedDir, opts.courseSlug);
  if (!(await fileExists(courseDir))) return { ok: false, error: "COURSE_NOT_FOUND" };

  const rawDir = path.join(courseDir, "raw");
  const years = await listDirs(rawDir);

  const sessions: LibrarySession[] = [];
  let displayName: string | null = null;

  const yearDirs = years.sort((a, b) => b.localeCompare(a));
  for (const year of yearDirs) {
    const datesDir = path.join(rawDir, year);
    const dateDirs = (await listDirs(datesDir)).sort((a, b) =>
      b.localeCompare(a)
    );

    for (const date of dateDirs) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const sessionAbs = path.join(datesDir, date);
      let fileNames: string[] = [];
      try {
        fileNames = (await fs.readdir(sessionAbs)).sort((a, b) =>
          a.localeCompare(b)
        );
      } catch {
        fileNames = [];
      }

      const artifacts: LibraryArtifact[] = [];
      for (const fileName of fileNames) {
        if (fileName.endsWith(".meta.json")) continue;
        if (isHidden(fileName)) continue;

        const abs = path.join(sessionAbs, fileName);
        const metaPath = `${abs}.meta.json`;
        if (!(await fileExists(metaPath))) continue;

        let metaRaw: unknown;
        try {
          metaRaw = JSON.parse(await fs.readFile(metaPath, "utf8"));
        } catch {
          continue;
        }
        const meta = ArtifactMetaSchema.safeParse(metaRaw);
        if (!meta.success) continue;

        if (!displayName) displayName = meta.data.detected.courseShort;

        const ext = path.extname(fileName).toLowerCase();
        const cacheType = inferCacheType({ kind: meta.data.kind, ext });
        const extractedTextAvailable = cacheType
          ? await fileExists(
              path.join(opts.stateDir, "cache", cacheType, `${meta.data.sha256}.txt`)
            )
          : false;

        const relPath = relFromUnified(opts.unifiedDir, abs);
        const artifactSummaryPath = `${opts.courseSlug}/generated/artifacts/${meta.data.sha256}/summary.md`;

        artifacts.push({
          id: meta.data.sha256,
          kind: meta.data.kind,
          fileName,
          relPath,
          sha256: meta.data.sha256,
          ingestedAt: meta.data.ingestedAt,
          sourcePath: meta.data.sourcePath,
          ext,
          cache: { type: cacheType, extractedTextAvailable },
          generated: { artifactSummaryPath },
        });
      }

      sessions.push({ date, artifacts });

      const lim = opts.limitSessions ?? 0;
      if (lim > 0 && sessions.length >= lim) break;
    }
    const lim = opts.limitSessions ?? 0;
    if (lim > 0 && sessions.length >= lim) break;
  }

  return {
    ok: true,
    course: { slug: opts.courseSlug, name: displayName ?? opts.courseSlug },
    sessions,
  };
}

