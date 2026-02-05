import path from "node:path";

export type ResolveWithinRootResult =
  | { ok: true; absolutePath: string }
  | { ok: false; error: string };

export function resolveWithinRoot(
  rootDir: string,
  requestedPath: string
): ResolveWithinRootResult {
  const rootResolved = path.resolve(rootDir);
  const candidate = path.resolve(rootResolved, requestedPath);
  const rel = path.relative(rootResolved, candidate);

  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return { ok: true, absolutePath: candidate };
  }

  return { ok: false, error: "Path escapes allowed root." };
}

export function looksLikeRelativePath(p: string): boolean {
  if (!p) return false;
  if (p.includes("\0")) return false;
  if (path.isAbsolute(p)) return false;
  return true;
}
