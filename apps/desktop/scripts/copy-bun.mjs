import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveBunBinary() {
  const fromEnv =
    process.env.SYLLABUSOPS_BUN_BIN?.trim() ??
    process.env.BUN_BINARY?.trim() ??
    "";
  if (fromEnv) return fromEnv;

  const probe = spawnSync("bash", ["-lc", "command -v bun"], {
    encoding: "utf8",
  });
  if (probe.status !== 0 || !probe.stdout.trim()) {
    throw new Error(
      "Unable to locate bun binary. Set SYLLABUSOPS_BUN_BIN to an absolute path."
    );
  }
  return probe.stdout.trim();
}

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const outDir = path.join(desktopRoot, "resources", "bin");
const outPath = path.join(outDir, "bun");
const bunBinary = resolveBunBinary();

await mkdir(outDir, { recursive: true });
await copyFile(bunBinary, outPath);
await chmod(outPath, 0o755);

const st = await stat(outPath);
if (!st.isFile()) {
  throw new Error(`Bundled bun binary was not created at ${outPath}`);
}

console.log(`Bundled bun binary: ${outPath}`);
