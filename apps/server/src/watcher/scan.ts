import fs from "node:fs/promises";
import path from "node:path";

export type ScanFile = {
  root: string;
  absolutePath: string;
  stat: { size: number; mtimeMs: number };
};

export type ScanOptions = {
  roots: string[];
  allowedExtensions: Set<string>;
  ignoreDirNames?: Set<string>;
  ignoreAbsPrefixes?: string[];
  maxFiles?: number;
};

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".beads",
  ".syllabusops",
  ".DS_Store",
  "__MACOSX",
]);

function shouldIgnoreFileName(name: string): boolean {
  if (!name) return true;
  if (name === ".DS_Store") return true;
  if (name.startsWith(".")) return true;
  if (name.startsWith("~$")) return true; // Office temp
  return false;
}

function isTempLike(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".tmp") ||
    lower.endsWith(".partial") ||
    lower.endsWith(".crdownload") ||
    lower.endsWith(".download") ||
    lower.endsWith(".icloud")
  );
}

function normalizeExt(ext: string): string {
  if (!ext) return "";
  return ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

function normalizeAbsPrefix(p: string): string {
  const abs = path.resolve(p);
  return abs.endsWith(path.sep) ? abs : `${abs}${path.sep}`;
}

function isUnderAnyPrefix(absPath: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return false;
  const abs = path.resolve(absPath);
  // Compare with trailing separator on prefixes to avoid /foo/bar matching /foo/barbaz.
  return prefixes.some(
    (pre) => abs === pre.slice(0, -1) || abs.startsWith(pre)
  );
}

async function* walkDir(
  dir: string,
  opts: {
    allowedExtensions: Set<string>;
    ignoreDirNames: Set<string>;
    ignoreAbsPrefixes: string[];
  }
): AsyncGenerator<ScanFile> {
  if (isUnderAnyPrefix(dir, opts.ignoreAbsPrefixes)) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const name = ent.name;
    if (ent.isDirectory()) {
      if (opts.ignoreDirNames.has(name)) continue;
      if (name.startsWith(".")) continue;
      const child = path.join(dir, name);
      if (isUnderAnyPrefix(child, opts.ignoreAbsPrefixes)) continue;
      yield* walkDir(child, opts);
      continue;
    }

    if (!ent.isFile()) continue;
    if (shouldIgnoreFileName(name)) continue;
    if (isTempLike(name)) continue;

    const ext = normalizeExt(path.extname(name));
    if (!opts.allowedExtensions.has(ext)) continue;

    const absolutePath = path.join(dir, name);
    if (isUnderAnyPrefix(absolutePath, opts.ignoreAbsPrefixes)) continue;
    let st: { size: number; mtimeMs: number } | null = null;
    try {
      const stat = await fs.stat(absolutePath);
      st = { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      st = null;
    }
    if (!st) continue;

    yield { absolutePath, stat: st };
  }
}

export async function scanOnce(opts: ScanOptions): Promise<ScanFile[]> {
  const ignoreDirNames = opts.ignoreDirNames ?? DEFAULT_IGNORE_DIRS;
  const maxFiles = opts.maxFiles ?? 50_000;
  const ignoreAbsPrefixes = (opts.ignoreAbsPrefixes ?? [])
    .filter(Boolean)
    .map(normalizeAbsPrefix);
  const out: ScanFile[] = [];

  for (const root of opts.roots) {
    const absRoot = path.resolve(root);
    try {
      const st = await fs.stat(absRoot);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    for await (const file of walkDir(absRoot, {
      allowedExtensions: opts.allowedExtensions,
      ignoreDirNames,
      ignoreAbsPrefixes,
    })) {
      out.push({ ...file, root: absRoot });
      if (out.length >= maxFiles) return out;
    }
  }

  return out;
}
