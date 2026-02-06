import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Logger } from "../logger";
import { ingestFile } from "./ingest-file";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "syllabusops-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("ingestFile", () => {
  test("copies into Unified raw dir and writes meta sidecar", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source", "BIO101");
      await fs.mkdir(sourceDir, { recursive: true });

      const sourcePath = path.join(sourceDir, "Zoom Recording 2026-02-01.vtt");
      await fs.writeFile(sourcePath, "hello", "utf8");

      const unifiedDir = path.join(dir, "Unified");
      const logger = new Logger({ logsDir: path.join(dir, "logs") });

      const res = await ingestFile({
        sourcePath,
        unifiedDir,
        pipelineVersion: "test",
        logger,
      });

      expect(res.ok).toBeTrue();
      if (!res.ok) return;

      expect(res.courseSlug).toBe("bio101");
      expect(res.kind).toBe("transcript");
      expect(res.sessionDate).toBe("2026-02-01");

      await expect(fs.stat(res.copiedTo)).resolves.toBeTruthy();
      await expect(fs.stat(res.metaPath)).resolves.toBeTruthy();

      const meta = JSON.parse(await fs.readFile(res.metaPath, "utf8")) as {
        sourcePath: string;
        sha256: string;
        pipelineVersion: string;
      };
      expect(meta.sourcePath).toBe(sourcePath);
      expect(meta.sha256).toBe(res.sha256);
      expect(meta.pipelineVersion).toBe("test");

      expect(res.copiedTo.startsWith(unifiedDir)).toBeTrue();
      expect(path.basename(res.copiedTo)).toBe(
        "BIO101 2026-02-01 Transcript.vtt"
      );
    });
  });

  test("dedupes by sha256 within the same raw session dir", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source", "BIO101");
      await fs.mkdir(sourceDir, { recursive: true });

      const sourcePath = path.join(sourceDir, "Zoom Recording 2026-02-01.vtt");
      await fs.writeFile(sourcePath, "hello", "utf8");

      const unifiedDir = path.join(dir, "Unified");
      const logger = new Logger({ logsDir: path.join(dir, "logs") });

      const first = await ingestFile({
        sourcePath,
        unifiedDir,
        pipelineVersion: "test",
        logger,
      });
      expect(first.ok).toBeTrue();
      if (!first.ok) return;

      const second = await ingestFile({
        sourcePath,
        unifiedDir,
        pipelineVersion: "test",
        logger,
      });
      expect(second.ok).toBeTrue();
      if (!second.ok) return;

      expect(second.copiedTo).toBe(first.copiedTo);
      expect(second.metaPath).toBe(first.metaPath);

      const rawDir = path.dirname(first.copiedTo);
      const entries = (await fs.readdir(rawDir)).filter(
        (e) => !e.endsWith(".meta.json")
      );
      expect(entries).toHaveLength(1);
    });
  });

  test("adds a (2) suffix when canonical name collides but sha differs", async () => {
    await withTempDir(async (dir) => {
      const sourceDir = path.join(dir, "source", "BIO101");
      await fs.mkdir(sourceDir, { recursive: true });

      const sourcePath1 = path.join(sourceDir, "Zoom Recording 2026-02-01.vtt");
      const sourcePath2 = path.join(sourceDir, "Copy 2026-02-01.vtt");
      await fs.writeFile(sourcePath1, "hello", "utf8");
      await fs.writeFile(sourcePath2, "hello world", "utf8");

      const unifiedDir = path.join(dir, "Unified");
      const logger = new Logger({ logsDir: path.join(dir, "logs") });

      const first = await ingestFile({
        sourcePath: sourcePath1,
        unifiedDir,
        pipelineVersion: "test",
        logger,
      });
      expect(first.ok).toBeTrue();
      if (!first.ok) return;

      const second = await ingestFile({
        sourcePath: sourcePath2,
        unifiedDir,
        pipelineVersion: "test",
        logger,
      });
      expect(second.ok).toBeTrue();
      if (!second.ok) return;

      expect(path.basename(first.copiedTo)).toBe(
        "BIO101 2026-02-01 Transcript.vtt"
      );
      expect(path.basename(second.copiedTo)).toBe(
        "BIO101 2026-02-01 Transcript (2).vtt"
      );
    });
  });
});
