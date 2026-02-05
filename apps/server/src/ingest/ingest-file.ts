import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../logger";
import { detectSessionDate } from "./date";
import type { ArtifactMetaV1 } from "./meta";
import {
  buildCanonicalBaseName,
  buildRawDir,
  courseFromSourcePath,
  detectArtifactKind,
} from "./naming";
import { sha256FileHex } from "./sha";

export type IngestFileResult =
  | {
      ok: true;
      copiedTo: string;
      metaPath: string;
      sha256: string;
      sessionDate: string;
      courseSlug: string;
      kind: "transcript" | "slides" | "unknown";
    }
  | { ok: false; error: string };

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function withDuplicateSuffix(baseName: string, n: number): string {
  if (n <= 1) return baseName;
  return `${baseName} (${n})`;
}

async function findExistingIngestBySha(opts: {
  rawDir: string;
  sha256: string;
}): Promise<{ canonicalPath: string; metaPath: string } | null> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(opts.rawDir);
  } catch {
    return null;
  }

  const metas = entries.filter((e) => e.endsWith(".meta.json"));
  for (const metaFile of metas) {
    const metaPath = path.join(opts.rawDir, metaFile);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(metaPath, "utf8"));
    } catch {
      continue;
    }
    const sha = (parsed as { sha256?: unknown })?.sha256;
    if (typeof sha === "string" && sha === opts.sha256) {
      const canonicalPath = metaPath.replace(/\.meta\.json$/, "");
      return { canonicalPath, metaPath };
    }
  }
  return null;
}

export async function ingestFile(opts: {
  sourcePath: string;
  watchRoot?: string | null;
  unifiedDir: string;
  pipelineVersion: string;
  logger: Logger;
  resolveCourse?: (detected: {
    courseShort: string;
    courseSlug: string;
  }) => Promise<{ courseShort: string; courseSlug: string }>;
}): Promise<IngestFileResult> {
  let st: { mtimeMs: number } | null = null;
  try {
    const stat = await fs.stat(opts.sourcePath);
    if (!stat.isFile()) return { ok: false, error: "Source is not a file." };
    st = { mtimeMs: stat.mtimeMs };
  } catch {
    return { ok: false, error: "Source does not exist." };
  }
  if (!st) return { ok: false, error: "Missing stat." };

  const kind = detectArtifactKind(opts.sourcePath);
  const detectedCourse = courseFromSourcePath(
    opts.sourcePath,
    opts.watchRoot ?? null
  );
  const resolvedCourse = opts.resolveCourse
    ? await opts.resolveCourse(detectedCourse)
    : detectedCourse;
  const courseShort = resolvedCourse.courseShort;
  const courseSlug = resolvedCourse.courseSlug;
  const sessionDate = detectSessionDate({
    sourcePath: opts.sourcePath,
    mtimeMs: st.mtimeMs,
  });

  const ext = path.extname(opts.sourcePath);
  const canonicalBase = buildCanonicalBaseName({
    courseShort,
    sessionDate,
    kind,
  });
  const { rawDir } = buildRawDir({
    unifiedDir: opts.unifiedDir,
    courseSlug,
    sessionDate,
  });

  await fs.mkdir(rawDir, { recursive: true });

  // Compute sha before copy so we can de-dupe across restarts.
  const sha256 = await sha256FileHex(opts.sourcePath);
  const existing = await findExistingIngestBySha({ rawDir, sha256 });
  if (existing) {
    opts.logger.info("ingest.deduped", {
      sourcePath: opts.sourcePath,
      copiedTo: existing.canonicalPath,
      sha256,
      kind,
      sessionDate,
      courseSlug,
      detectedCourseSlug: detectedCourse.courseSlug,
    });
    return {
      ok: true,
      copiedTo: existing.canonicalPath,
      metaPath: existing.metaPath,
      sha256,
      sessionDate,
      courseSlug,
      kind,
    };
  }

  let copiedTo: string | null = null;
  for (let n = 1; n <= 999; n++) {
    const name = `${withDuplicateSuffix(canonicalBase, n)}${ext}`;
    const candidate = path.join(rawDir, name);
    if (await exists(candidate)) continue;
    try {
      await fs.copyFile(opts.sourcePath, candidate, fsConstants.COPYFILE_EXCL);
      copiedTo = candidate;
      break;
    } catch {}
  }
  if (!copiedTo) {
    const suffix = sha256.slice(0, 10);
    const name = `${canonicalBase} ${suffix}${ext}`;
    const candidate = path.join(rawDir, name);
    try {
      await fs.copyFile(opts.sourcePath, candidate, fsConstants.COPYFILE_EXCL);
      copiedTo = candidate;
    } catch {
      return { ok: false, error: "Could not find a free canonical filename." };
    }
  }

  const meta: ArtifactMetaV1 = {
    version: 1,
    ingestedAt: new Date().toISOString(),
    sourcePath: opts.sourcePath,
    sha256,
    kind,
    detected: {
      courseShort: detectedCourse.courseShort,
      courseSlug: detectedCourse.courseSlug,
      sessionDate,
    },
    resolved: { courseShort, courseSlug },
    pipelineVersion: opts.pipelineVersion,
  };

  const metaPath = `${copiedTo}.meta.json`;
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  opts.logger.info("ingest.copied", {
    sourcePath: opts.sourcePath,
    copiedTo,
    sha256,
    kind,
    sessionDate,
    courseSlug,
    detectedCourseSlug: detectedCourse.courseSlug,
  });

  return {
    ok: true,
    copiedTo,
    metaPath,
    sha256,
    sessionDate,
    courseSlug,
    kind,
  };
}
