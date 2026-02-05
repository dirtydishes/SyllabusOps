import fs from "node:fs/promises";
import path from "node:path";
import { extractTranscriptText } from "@syllabusops/core";

export async function extractTranscriptToCache(opts: {
  canonicalPath: string;
  sha256: string;
  stateDir: string;
}): Promise<{ textPath: string; statsPath: string }> {
  const cacheDir = path.join(opts.stateDir, "cache", "transcripts");
  await fs.mkdir(cacheDir, { recursive: true });

  const textPath = path.join(cacheDir, `${opts.sha256}.txt`);
  const statsPath = path.join(cacheDir, `${opts.sha256}.stats.json`);

  try {
    await fs.stat(textPath);
    await fs.stat(statsPath);
    return { textPath, statsPath };
  } catch {
    // continue
  }

  const content = await fs.readFile(opts.canonicalPath, "utf8");
  const extracted = extractTranscriptText({
    sourcePath: opts.canonicalPath,
    content,
  });

  await fs.writeFile(textPath, extracted.text, "utf8");
  await fs.writeFile(
    statsPath,
    `${JSON.stringify(extracted.stats, null, 2)}\n`,
    "utf8"
  );

  return { textPath, statsPath };
}
