import path from "node:path";

export type ArtifactKind = "transcript" | "slides" | "unknown";

export function detectArtifactKind(sourcePath: string): ArtifactKind {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === ".vtt" || ext === ".txt" || ext === ".md") return "transcript";
  if (ext === ".pptx" || ext === ".pdf") return "slides";
  return "unknown";
}

export function slugifyCourse(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return s || "inbox";
}

export function courseFromSourcePath(sourcePath: string): {
  courseShort: string;
  courseSlug: string;
} {
  const parent = path.basename(path.dirname(sourcePath));
  const courseShort = parent?.trim() ? parent.trim() : "Inbox";
  return { courseShort, courseSlug: slugifyCourse(courseShort) };
}

export function buildCanonicalBaseName(opts: {
  courseShort: string;
  sessionDate: string;
  kind: ArtifactKind;
}): string {
  const suffix =
    opts.kind === "transcript"
      ? "Transcript"
      : opts.kind === "slides"
        ? "Slides"
        : "Artifact";
  return `${opts.courseShort} ${opts.sessionDate} ${suffix}`;
}

export function buildRawDir(opts: {
  unifiedDir: string;
  courseSlug: string;
  sessionDate: string;
}): { courseDir: string; rawDir: string } {
  const year = opts.sessionDate.slice(0, 4);
  const courseDir = path.join(opts.unifiedDir, opts.courseSlug);
  const rawDir = path.join(courseDir, "raw", year, opts.sessionDate);
  return { courseDir, rawDir };
}
