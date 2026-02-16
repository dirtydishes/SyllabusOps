import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chunkTextForTextbookIndex,
  indexPdfTextbookCache,
  listTextbookCatalog,
} from "./index";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "syllabusops-textbook-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function buildSampleText(): string {
  const parts: string[] = [];
  for (let i = 1; i <= 24; i++) {
    parts.push(
      `Chapter section ${i}. This section explains textbook concepts, worked examples, and review notes for unit ${i}.`
    );
  }
  return parts.join("\n\n");
}

describe("chunkTextForTextbookIndex", () => {
  test("is deterministic and returns ordered chunk windows", () => {
    const text = buildSampleText();
    const first = chunkTextForTextbookIndex(text, {
      targetChars: 600,
      overlapChars: 120,
    });
    const second = chunkTextForTextbookIndex(text, {
      targetChars: 600,
      overlapChars: 120,
    });

    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual(second);
    expect(first.map((c) => c.chunkNo)).toEqual(
      Array.from({ length: first.length }, (_, i) => i + 1)
    );
    for (const chunk of first) {
      expect(chunk.startChar).toBeGreaterThanOrEqual(0);
      expect(chunk.endChar).toBeGreaterThan(chunk.startChar);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });
});

describe("indexPdfTextbookCache", () => {
  test("writes textbook index + catalog and returns cached result on rerun", async () => {
    await withTempDir(async (dir) => {
      const stateDir = path.join(dir, "state");
      const unifiedDir = path.join(dir, "Unified");
      const sha256 = "abc123def456ghi789jkl012mno345pq";
      const courseSlug = "bio101";
      const sessionDate = "2026-02-16";
      const canonicalPath = path.join(
        unifiedDir,
        courseSlug,
        "raw",
        "2026",
        sessionDate,
        `BIO101 ${sessionDate} Slides.pdf`
      );

      await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
      await fs.writeFile(canonicalPath, "fake-pdf-bytes", "utf8");

      const extractedTextPath = path.join(
        stateDir,
        "cache",
        "pdf",
        `${sha256}.txt`
      );
      await fs.mkdir(path.dirname(extractedTextPath), { recursive: true });
      await fs.writeFile(extractedTextPath, buildSampleText(), "utf8");

      const first = await indexPdfTextbookCache({
        canonicalPath,
        sha256,
        stateDir,
        unifiedDir,
        targetChars: 600,
        overlapChars: 120,
      });
      expect(first.fromCache).toBeFalse();
      expect(first.chunkCount).toBeGreaterThan(1);
      expect(first.courseSlug).toBe(courseSlug);
      expect(first.relPath).toBe(
        `${courseSlug}/raw/2026/${sessionDate}/BIO101 ${sessionDate} Slides.pdf`
      );

      const indexRaw = await fs.readFile(first.indexPath, "utf8");
      const indexParsed = JSON.parse(indexRaw) as {
        sha256: string;
        chunks: unknown[];
        source: { courseSlug: string; sessionDate: string };
      };
      expect(indexParsed.sha256).toBe(sha256);
      expect(indexParsed.chunks.length).toBe(first.chunkCount);
      expect(indexParsed.source.courseSlug).toBe(courseSlug);
      expect(indexParsed.source.sessionDate).toBe(sessionDate);

      const second = await indexPdfTextbookCache({
        canonicalPath,
        sha256,
        stateDir,
        unifiedDir,
      });
      expect(second.fromCache).toBeTrue();
      expect(second.chunkCount).toBe(first.chunkCount);

      const catalog = await listTextbookCatalog({ stateDir, courseSlug });
      expect(catalog).toHaveLength(1);
      expect(catalog[0]?.sha256).toBe(sha256);
      expect(catalog[0]?.courseSlug).toBe(courseSlug);
      expect(catalog[0]?.chunks).toBe(first.chunkCount);
    });
  });
});
