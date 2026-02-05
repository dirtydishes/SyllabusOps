import fs from "node:fs/promises";
import path from "node:path";
import { extractPptxTextFromZipBytes } from "@syllabusops/core";

export async function extractPptxToCache(opts: {
  canonicalPath: string;
  sha256: string;
  stateDir: string;
}): Promise<{ jsonPath: string; textPath: string }> {
  const cacheDir = path.join(opts.stateDir, "cache", "pptx");
  await fs.mkdir(cacheDir, { recursive: true });

  const jsonPath = path.join(cacheDir, `${opts.sha256}.json`);
  const textPath = path.join(cacheDir, `${opts.sha256}.txt`);

  try {
    await fs.stat(jsonPath);
    await fs.stat(textPath);
    return { jsonPath, textPath };
  } catch {
    // continue
  }

  const bytes = new Uint8Array(await fs.readFile(opts.canonicalPath));
  const extracted = extractPptxTextFromZipBytes(bytes);

  await fs.writeFile(
    jsonPath,
    `${JSON.stringify(extracted, null, 2)}\n`,
    "utf8"
  );

  const lines: string[] = [];
  for (const s of extracted.slides) {
    lines.push(`# Slide ${s.slideNo}`);
    if (s.text) lines.push(s.text);
    if (s.notesText) {
      lines.push("");
      lines.push("## Notes");
      lines.push(s.notesText);
    }
    lines.push("");
  }
  await fs.writeFile(textPath, `${lines.join("\n").trimEnd()}\n`, "utf8");

  return { jsonPath, textPath };
}
