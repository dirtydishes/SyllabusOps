import path from "node:path";
import { fileURLToPath } from "node:url";

export type AppConfig = {
  port: number;
  stateDir: string;
  unifiedDir: string;
  watchRoots: string[];
};

const DEFAULT_UNIFIED_DIR =
  "/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School/Unified";

function getRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

export function loadConfig(): AppConfig {
  const repoRoot = getRepoRoot();

  const port = Number(process.env.PORT ?? "4959");
  const stateDir =
    process.env.SYLLABUSOPS_STATE_DIR ?? path.join(repoRoot, ".syllabusops");
  const unifiedDir = process.env.SYLLABUSOPS_UNIFIED_DIR ?? DEFAULT_UNIFIED_DIR;

  const watchRoots = [
    "/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School",
    path.join(process.env.HOME ?? "", "Documents/Zoom"),
  ].filter(Boolean);

  return { port, stateDir, unifiedDir, watchRoots };
}
