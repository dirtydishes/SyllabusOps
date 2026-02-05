import fs from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "@syllabusops/core";
import { looksLikeRelativePath, resolveWithinRoot } from "@syllabusops/core";
import { z } from "zod";
import type { Logger } from "./logger";

const AllowedExt = z.enum([".md", ".txt", ".json", ".yaml", ".yml"]);
const FsPathQuery = z.object({ path: z.string() });

function ensureExtAllowed(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return AllowedExt.safeParse(ext).success;
}

export async function listDir(opts: { unifiedDir: string; relPath: string }) {
  if (!looksLikeRelativePath(opts.relPath)) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid path (must be relative).",
    };
  }

  const resolved = resolveWithinRoot(opts.unifiedDir, opts.relPath);
  if (!resolved.ok)
    return { ok: false as const, status: 403, error: "FS_PATH_DENIED" };

  const entries = await fs.readdir(resolved.absolutePath, {
    withFileTypes: true,
  });
  return {
    ok: true as const,
    path: opts.relPath,
    entries: entries
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? ("dir" as const) : ("file" as const),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function readTextFile(opts: {
  unifiedDir: string;
  relPath: string;
}) {
  if (!looksLikeRelativePath(opts.relPath)) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid path (must be relative).",
    };
  }

  const resolved = resolveWithinRoot(opts.unifiedDir, opts.relPath);
  if (!resolved.ok)
    return { ok: false as const, status: 403, error: "FS_PATH_DENIED" };
  if (!ensureExtAllowed(resolved.absolutePath)) {
    return { ok: false as const, status: 415, error: "Unsupported file type." };
  }

  const content = await fs.readFile(resolved.absolutePath, "utf8");
  return {
    ok: true as const,
    path: opts.relPath,
    content,
    sha256: sha256Hex(content),
  };
}

export async function writeTextFile(opts: {
  unifiedDir: string;
  stateDir: string;
  relPath: string;
  content: string;
  expectedSha256?: string;
  logger: Logger;
}) {
  if (!looksLikeRelativePath(opts.relPath)) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid path (must be relative).",
    };
  }

  const resolved = resolveWithinRoot(opts.unifiedDir, opts.relPath);
  if (!resolved.ok)
    return { ok: false as const, status: 403, error: "FS_PATH_DENIED" };
  if (!ensureExtAllowed(resolved.absolutePath)) {
    return { ok: false as const, status: 415, error: "Unsupported file type." };
  }

  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(resolved.absolutePath, "utf8");
  } catch {
    existingContent = null;
  }

  if (existingContent !== null && opts.expectedSha256) {
    const current = sha256Hex(existingContent);
    if (current !== opts.expectedSha256) {
      return { ok: false as const, status: 409, error: "FS_CONFLICT" };
    }
  }

  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, opts.content, "utf8");

  const savedAt = new Date().toISOString();
  const sha256 = sha256Hex(opts.content);

  await snapshotRevision({
    stateDir: opts.stateDir,
    relPath: opts.relPath,
    content: opts.content,
  });

  opts.logger.info("editor.save", {
    path: opts.relPath,
    bytes: opts.content.length,
  });
  return { ok: true as const, path: opts.relPath, sha256, savedAt };
}

async function snapshotRevision(opts: {
  stateDir: string;
  relPath: string;
  content: string;
}) {
  const pathHash = sha256Hex(opts.relPath);
  const ext = path.extname(opts.relPath) || ".txt";
  const ts = toRevisionStamp(new Date());
  const dir = path.join(opts.stateDir, "revisions", pathHash);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${ts}${ext}`);
  await fs.writeFile(file, opts.content, "utf8");
}

export const FsSchemas = {
  FsPathQuery,
  FsWriteBody: z.object({
    content: z.string(),
    expectedSha256: z.string().optional(),
  }),
  FsRestoreBody: z.object({ path: z.string(), revisionFile: z.string() }),
};

export function getRevisionDir(stateDir: string, relPath: string): string {
  return path.join(stateDir, "revisions", sha256Hex(relPath));
}

export function toRevisionStamp(d: Date): string {
  const iso = d.toISOString(); // 2026-02-05T21:41:00.123Z
  const noMs = iso.replace(/\.\d{3}Z$/, "Z"); // 2026-02-05T21:41:00Z
  const ymd = noMs.slice(0, 10).replaceAll("-", "");
  const hms = noMs.slice(11, 19).replaceAll(":", "");
  return `${ymd}-${hms}Z`;
}

export function parseRevisionStamp(fileName: string): string | null {
  const match = fileName.match(/^(\d{8}-\d{6}Z)/);
  if (!match) return null;
  const stamp = match[1];
  const y = stamp.slice(0, 4);
  const m = stamp.slice(4, 6);
  const d = stamp.slice(6, 8);
  const hh = stamp.slice(9, 11);
  const mm = stamp.slice(11, 13);
  const ss = stamp.slice(13, 15);
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
}
