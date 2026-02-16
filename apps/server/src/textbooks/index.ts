import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type TextbookChunk = {
  id: string;
  chunkNo: number;
  startChar: number;
  endChar: number;
  text: string;
};

export type TextbookIndex = {
  version: 1;
  sha256: string;
  indexedAt: string;
  source: {
    canonicalPath: string;
    relPath: string | null;
    courseSlug: string | null;
    sessionDate: string | null;
  };
  chunking: {
    targetChars: number;
    overlapChars: number;
  };
  sourceTextChars: number;
  chunks: TextbookChunk[];
};

export type TextbookCatalogEntry = {
  sha256: string;
  indexedAt: string;
  canonicalPath: string;
  relPath: string | null;
  courseSlug: string | null;
  sessionDate: string | null;
  sourceTextChars: number;
  chunks: number;
};

const TextbookChunkSchema = z.object({
  id: z.string().min(1),
  chunkNo: z.number().int().positive(),
  startChar: z.number().int().min(0),
  endChar: z.number().int().min(0),
  text: z.string(),
});

const TextbookIndexSchema: z.ZodType<TextbookIndex> = z.object({
  version: z.literal(1),
  sha256: z.string().min(10),
  indexedAt: z.string().min(1),
  source: z.object({
    canonicalPath: z.string().min(1),
    relPath: z.string().nullable(),
    courseSlug: z.string().nullable(),
    sessionDate: z.string().nullable(),
  }),
  chunking: z.object({
    targetChars: z.number().int().positive(),
    overlapChars: z.number().int().nonnegative(),
  }),
  sourceTextChars: z.number().int().nonnegative(),
  chunks: z.array(TextbookChunkSchema),
});

const TextbookCatalogEntrySchema: z.ZodType<TextbookCatalogEntry> = z.object({
  sha256: z.string().min(10),
  indexedAt: z.string().min(1),
  canonicalPath: z.string().min(1),
  relPath: z.string().nullable(),
  courseSlug: z.string().nullable(),
  sessionDate: z.string().nullable(),
  sourceTextChars: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
});

const TextbookCatalogSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  entries: z.array(TextbookCatalogEntrySchema),
});

type ChunkWindow = {
  targetChars: number;
  overlapChars: number;
};

function normalizeForChunking(input: string): string {
  return input
    .replaceAll(/\r\n?/g, "\n")
    .replaceAll("\u0000", "")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

function pickSplitPoint(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) return text.length;
  const minSearch = start + Math.floor((hardEnd - start) * 0.55);
  const paragraph = text.lastIndexOf("\n\n", hardEnd);
  const line = text.lastIndexOf("\n", hardEnd);
  const period = text.lastIndexOf(". ", hardEnd);
  const question = text.lastIndexOf("? ", hardEnd);
  const bang = text.lastIndexOf("! ", hardEnd);
  const candidates = [
    paragraph + 2,
    line + 1,
    period + 1,
    question + 1,
    bang + 1,
  ]
    .filter((n) => n > minSearch && n < hardEnd)
    .sort((a, b) => b - a);
  return candidates[0] ?? hardEnd;
}

export function chunkTextForTextbookIndex(
  input: string,
  window: Partial<ChunkWindow> = {}
): Array<{
  chunkNo: number;
  startChar: number;
  endChar: number;
  text: string;
}> {
  const targetChars = Math.max(500, Math.floor(window.targetChars ?? 2400));
  const overlapChars = Math.max(
    0,
    Math.min(targetChars - 100, Math.floor(window.overlapChars ?? 280))
  );
  const minChunkChars = Math.max(250, Math.floor(targetChars * 0.2));
  const text = normalizeForChunking(input);
  if (!text) return [];

  const chunks: Array<{
    chunkNo: number;
    startChar: number;
    endChar: number;
    text: string;
  }> = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + targetChars, text.length);
    let end = pickSplitPoint(text, start, hardEnd);
    if (end <= start) end = hardEnd;
    if (end - start < minChunkChars && hardEnd > end) end = hardEnd;

    const chunkText = text.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        chunkNo: chunks.length + 1,
        startChar: start,
        endChar: end,
        text: chunkText,
      });
    }
    if (end >= text.length) break;

    let nextStart = Math.max(end - overlapChars, start + 1);
    while (nextStart < text.length && /\s/.test(text[nextStart] ?? "")) {
      nextStart += 1;
    }
    start = nextStart;
  }

  return chunks;
}

function inferSourceContext(opts: {
  canonicalPath: string;
  unifiedDir: string;
}): {
  relPath: string | null;
  courseSlug: string | null;
  sessionDate: string | null;
} {
  const abs = path.resolve(opts.canonicalPath);
  const unified = path.resolve(opts.unifiedDir);
  const rel = path.relative(unified, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { relPath: null, courseSlug: null, sessionDate: null };
  }

  const relPath = rel.replaceAll(path.sep, "/");
  const parts = rel.split(path.sep).filter(Boolean);
  const courseSlug = parts[0] ?? null;

  let sessionDate: string | null = null;
  const rawIdx = parts.indexOf("raw");
  const maybeDate = rawIdx >= 0 ? parts[rawIdx + 2] : null;
  if (maybeDate && /^\d{4}-\d{2}-\d{2}$/.test(maybeDate)) {
    sessionDate = maybeDate;
  }

  return { relPath, courseSlug, sessionDate };
}

async function readTextbookIndex(
  indexPath: string
): Promise<TextbookIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    return TextbookIndexSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function upsertCatalog(opts: {
  catalogPath: string;
  entry: TextbookCatalogEntry;
}): Promise<void> {
  let entries: TextbookCatalogEntry[] = [];
  try {
    const raw = await fs.readFile(opts.catalogPath, "utf8");
    const parsed = TextbookCatalogSchema.parse(JSON.parse(raw));
    entries = parsed.entries;
  } catch {
    entries = [];
  }

  const map = new Map(entries.map((e) => [e.sha256, e]));
  map.set(opts.entry.sha256, opts.entry);
  const nextEntries = Array.from(map.values()).sort((a, b) => {
    const ac = a.courseSlug ?? "";
    const bc = b.courseSlug ?? "";
    if (ac !== bc) return ac.localeCompare(bc);
    const ar = a.relPath ?? "";
    const br = b.relPath ?? "";
    if (ar !== br) return ar.localeCompare(br);
    return a.sha256.localeCompare(b.sha256);
  });

  const catalog = {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    entries: nextEntries,
  };
  await fs.writeFile(
    opts.catalogPath,
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8"
  );
}

function toCatalogEntry(index: TextbookIndex): TextbookCatalogEntry {
  return {
    sha256: index.sha256,
    indexedAt: index.indexedAt,
    canonicalPath: index.source.canonicalPath,
    relPath: index.source.relPath,
    courseSlug: index.source.courseSlug,
    sessionDate: index.source.sessionDate,
    sourceTextChars: index.sourceTextChars,
    chunks: index.chunks.length,
  };
}

export async function indexPdfTextbookCache(opts: {
  canonicalPath: string;
  sha256: string;
  stateDir: string;
  unifiedDir: string;
  targetChars?: number;
  overlapChars?: number;
}): Promise<{
  indexPath: string;
  catalogPath: string;
  chunkCount: number;
  sourceTextChars: number;
  courseSlug: string | null;
  relPath: string | null;
  fromCache: boolean;
}> {
  const cacheDir = path.join(opts.stateDir, "cache", "textbooks");
  await fs.mkdir(cacheDir, { recursive: true });

  const indexPath = path.join(cacheDir, `${opts.sha256}.index.json`);
  const catalogPath = path.join(cacheDir, "catalog.json");

  const existing = await readTextbookIndex(indexPath);
  if (existing) {
    await upsertCatalog({
      catalogPath,
      entry: toCatalogEntry(existing),
    });
    return {
      indexPath,
      catalogPath,
      chunkCount: existing.chunks.length,
      sourceTextChars: existing.sourceTextChars,
      courseSlug: existing.source.courseSlug,
      relPath: existing.source.relPath,
      fromCache: true,
    };
  }

  const extractedTextPath = path.join(
    opts.stateDir,
    "cache",
    "pdf",
    `${opts.sha256}.txt`
  );
  const text = await fs.readFile(extractedTextPath, "utf8");
  const chunks = chunkTextForTextbookIndex(text, {
    targetChars: opts.targetChars,
    overlapChars: opts.overlapChars,
  });
  const context = inferSourceContext({
    canonicalPath: opts.canonicalPath,
    unifiedDir: opts.unifiedDir,
  });

  const index: TextbookIndex = {
    version: 1,
    sha256: opts.sha256,
    indexedAt: new Date().toISOString(),
    source: {
      canonicalPath: opts.canonicalPath,
      relPath: context.relPath,
      courseSlug: context.courseSlug,
      sessionDate: context.sessionDate,
    },
    chunking: {
      targetChars: Math.max(500, Math.floor(opts.targetChars ?? 2400)),
      overlapChars: Math.max(0, Math.floor(opts.overlapChars ?? 280)),
    },
    sourceTextChars: normalizeForChunking(text).length,
    chunks: chunks.map((c) => ({
      id: `${opts.sha256}:chunk:${String(c.chunkNo).padStart(4, "0")}`,
      chunkNo: c.chunkNo,
      startChar: c.startChar,
      endChar: c.endChar,
      text: c.text,
    })),
  };
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  await upsertCatalog({
    catalogPath,
    entry: toCatalogEntry(index),
  });

  return {
    indexPath,
    catalogPath,
    chunkCount: index.chunks.length,
    sourceTextChars: index.sourceTextChars,
    courseSlug: index.source.courseSlug,
    relPath: index.source.relPath,
    fromCache: false,
  };
}

export async function listTextbookCatalog(opts: {
  stateDir: string;
  courseSlug?: string;
}): Promise<TextbookCatalogEntry[]> {
  const p = path.join(opts.stateDir, "cache", "textbooks", "catalog.json");
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = TextbookCatalogSchema.parse(JSON.parse(raw));
    const entries = parsed.entries;
    if (!opts.courseSlug) return entries;
    return entries.filter((e) => e.courseSlug === opts.courseSlug);
  } catch {
    return [];
  }
}
