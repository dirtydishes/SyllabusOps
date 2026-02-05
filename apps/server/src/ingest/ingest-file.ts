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

export async function ingestFile(opts: {
  sourcePath: string;
  unifiedDir: string;
  pipelineVersion: string;
  logger: Logger;
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
  const { courseShort, courseSlug } = courseFromSourcePath(opts.sourcePath);
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

  let copiedTo: string | null = null;
  for (let n = 1; n <= 25; n++) {
    const name = `${withDuplicateSuffix(canonicalBase, n)}${ext}`;
    const candidate = path.join(rawDir, name);
    if (await exists(candidate)) continue;
    await fs.copyFile(opts.sourcePath, candidate);
    copiedTo = candidate;
    break;
  }
  if (!copiedTo)
    return { ok: false, error: "Could not find a free canonical filename." };

  const sha256 = await sha256FileHex(copiedTo);
  const meta: ArtifactMetaV1 = {
    version: 1,
    ingestedAt: new Date().toISOString(),
    sourcePath: opts.sourcePath,
    sha256,
    kind,
    detected: { courseShort, courseSlug, sessionDate },
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
  });

  return { ok: true, copiedTo, metaPath, sha256, sessionDate, courseSlug };
}
