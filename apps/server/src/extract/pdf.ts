import fs from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfExtractStats = {
  method: "pdftotext" | "pdfjs";
  pages?: number;
  charsOut: number;
};

async function tryExtractWithPdftotext(
  pdfPath: string
): Promise<string | null> {
  try {
    const proc = Bun.spawn(["pdftotext", "-layout", "-nopgbrk", pdfPath, "-"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return stdout;
  } catch {
    return null;
  }
}

async function extractWithPdfjs(
  bytes: Uint8Array
): Promise<{ text: string; pages: number }> {
  const loadingTask = getDocument({ data: bytes, disableWorker: true });
  const pdf = await loadingTask.promise;
  const parts: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items as Array<{ str?: string }>;
    const pageText = items
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean)
      .join(" ");
    parts.push(pageText.trim());
  }

  return { text: `${parts.join("\n\n").trim()}\n`, pages: pdf.numPages };
}

export async function extractPdfToCache(opts: {
  canonicalPath: string;
  sha256: string;
  stateDir: string;
}): Promise<{ textPath: string; statsPath: string }> {
  const cacheDir = path.join(opts.stateDir, "cache", "pdf");
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

  const pdftotext = await tryExtractWithPdftotext(opts.canonicalPath);
  if (pdftotext !== null) {
    const text = pdftotext.trim() ? `${pdftotext.trim()}\n` : "\n";
    const stats: PdfExtractStats = {
      method: "pdftotext",
      charsOut: text.length,
    };
    await fs.writeFile(textPath, text, "utf8");
    await fs.writeFile(
      statsPath,
      `${JSON.stringify(stats, null, 2)}\n`,
      "utf8"
    );
    return { textPath, statsPath };
  }

  const bytes = new Uint8Array(await fs.readFile(opts.canonicalPath));
  const extracted = await extractWithPdfjs(bytes);
  const stats: PdfExtractStats = {
    method: "pdfjs",
    pages: extracted.pages,
    charsOut: extracted.text.length,
  };
  await fs.writeFile(textPath, extracted.text, "utf8");
  await fs.writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  return { textPath, statsPath };
}
