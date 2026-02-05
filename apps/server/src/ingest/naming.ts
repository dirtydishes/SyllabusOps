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
};
export function courseFromSourcePath(
  sourcePath: string,
  watchRoot: string | null
): {
  courseShort: string;
  courseSlug: string;
};

function toLooseSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

const GENERIC_BUCKETS = new Set([
  "school",
  "class-transcripts",
  "transcripts",
  "transcript",
  "transcripts-unified",
  "powerpoints",
  "presentations",
  "slides",
  "slide-decks",
  "homework",
  "journals",
  "notes",
  "materials",
  "documents",
  "readings",
  "unified",
]);

function stripLeadingDateTimeFolder(name: string): string | null {
  // Common Zoom folder patterns:
  // - 2026-02-02 15.48.46 The Bionic Human
  // - 2026-02-05 10.19.03 Disasters_ Geology vs. Hollywood
  const m = name.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ _-]+(\d{2}[.:]\d{2}[.:]\d{2}))?[ _-]+(.+)$/
  );
  if (!m) return null;
  const rest = m[3]?.trim();
  return rest ? rest : null;
}

export function courseFromSourcePath(
  sourcePath: string,
  watchRoot: string | null = null
): {
  courseShort: string;
  courseSlug: string;
} {
  if (watchRoot) {
    const absRoot = path.resolve(watchRoot);
    const absSrc = path.resolve(sourcePath);
    const pre = absRoot.endsWith(path.sep) ? absRoot : `${absRoot}${path.sep}`;
    if (absSrc === absRoot || absSrc.startsWith(pre)) {
      const rel = path.relative(absRoot, absSrc);
      const parts = rel.split(path.sep).filter(Boolean);
      const dirParts = parts.slice(0, -1);
      for (const seg of dirParts) {
        const raw = seg.trim();
        if (!raw) continue;
        const rawSlug = toLooseSlug(raw);
        if (GENERIC_BUCKETS.has(rawSlug)) continue;

        const stripped = stripLeadingDateTimeFolder(raw);
        const courseShort = stripped ?? raw;
        const courseSlug = slugifyCourse(courseShort);
        return { courseShort, courseSlug };
      }
    }
  }

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
