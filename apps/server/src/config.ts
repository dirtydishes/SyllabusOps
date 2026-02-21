import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AppConfig = {
  port: number;
  stateDir: string;
  unifiedDir: string;
  watchRoots: string[];
  webDistDir: string | null;
};

function getRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

export function loadConfig(): AppConfig {
  const repoRoot = getRepoRoot();
  const homeDir = process.env.HOME ?? os.homedir();
  const schoolRoot = path.join(
    homeDir,
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs",
    "School"
  );
  const defaultUnifiedDir = path.join(schoolRoot, "Unified");
  const webDistDir = process.env.SYLLABUSOPS_WEB_DIST_DIR?.trim() || null;

  const port = Number(process.env.PORT ?? "4959");
  const stateDir =
    process.env.SYLLABUSOPS_STATE_DIR ?? path.join(repoRoot, ".syllabusops");
  const unifiedDir = process.env.SYLLABUSOPS_UNIFIED_DIR ?? defaultUnifiedDir;

  const watchRoots = [schoolRoot, path.join(homeDir, "Documents/Zoom")];

  return { port, stateDir, unifiedDir, watchRoots, webDistDir };
}
