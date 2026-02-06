import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderSessionSummaryMarkdown } from "@syllabusops/core";
import {
  scanCourseDetailGrouped,
  scanCoursesGrouped,
} from "../courses/grouped-library";
import { createCourseRegistry } from "../courses/registry";
import { extractTranscriptToCache } from "../extract/transcript";
import { ingestFile } from "../ingest/ingest-file";
import { Logger } from "../logger";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "syllabusops-int-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("pipeline smoke", () => {
  test("ingest -> copy+meta -> summary generation -> grouped listing", async () => {
    await withTempDir(async (dir) => {
      const watchRoot = path.join(dir, "watch");
      const sourceDir = path.join(watchRoot, "BIO101");
      await fs.mkdir(sourceDir, { recursive: true });

      const sourcePath = path.join(
        sourceDir,
        "Zoom Recording 2026-02-14 Transcript.vtt"
      );
      await fs.writeFile(
        sourcePath,
        `WEBVTT

00:00:00.000 --> 00:00:02.000
<v Instructor>Cells use ATP for energy.

00:00:02.000 --> 00:00:04.000
<v Student>The mitochondria is involved.
`,
        "utf8"
      );

      const unifiedDir = path.join(dir, "Unified");
      const stateDir = path.join(dir, "state");
      const logger = new Logger({ logsDir: path.join(stateDir, "logs") });

      const ingested = await ingestFile({
        sourcePath,
        watchRoot,
        unifiedDir,
        pipelineVersion: "test",
        logger,
      });
      expect(ingested.ok).toBeTrue();
      if (!ingested.ok) return;

      await expect(fs.stat(ingested.copiedTo)).resolves.toBeTruthy();
      await expect(fs.stat(ingested.metaPath)).resolves.toBeTruthy();
      expect(path.basename(ingested.copiedTo)).toBe(
        "BIO101 2026-02-14 Transcript.vtt"
      );

      const cached = await extractTranscriptToCache({
        canonicalPath: ingested.copiedTo,
        sha256: ingested.sha256,
        stateDir,
      });
      const extractedText = await fs.readFile(cached.textPath, "utf8");
      expect(extractedText).toContain("Cells use ATP for energy.");
      expect(extractedText).toContain("The mitochondria is involved.");

      const summary = renderSessionSummaryMarkdown({
        version: 1,
        course: {
          courseShort: "BIO101",
          courseSlug: ingested.courseSlug,
        },
        sessionDate: ingested.sessionDate,
        overview: "Cells and ATP production were covered.",
        concepts: ["ATP", "Mitochondria"],
        reviewNext: ["Review chapter 3"],
        tasks: [
          {
            title: "Read chapter 3",
            description: "Focus on ATP synthesis.",
            due: "2026-02-20",
            confidence: 0.7,
          },
        ],
        references: ["Lecture transcript"],
      });

      const summaryRelPath = `${ingested.courseSlug}/generated/sessions/${ingested.sessionDate}/session-summary.md`;
      const summaryAbsPath = path.join(unifiedDir, summaryRelPath);
      await fs.mkdir(path.dirname(summaryAbsPath), { recursive: true });
      await fs.writeFile(summaryAbsPath, summary, "utf8");

      const registry = createCourseRegistry({ stateDir, logger });
      const courses = await scanCoursesGrouped({
        unifiedDir,
        stateDir,
        registry,
      });
      expect(courses).toHaveLength(1);
      expect(courses[0]?.slug).toBe("bio101");
      expect(courses[0]?.sessionsCount).toBe(1);
      expect(courses[0]?.artifactsCount).toBe(1);

      const detail = await scanCourseDetailGrouped({
        unifiedDir,
        stateDir,
        registry,
        courseSlug: "bio101",
      });
      expect(detail.ok).toBeTrue();
      if (!detail.ok) return;
      expect(detail.sessions).toHaveLength(1);
      expect(detail.sessions[0]?.artifacts).toHaveLength(1);
      expect(detail.sessions[0]?.artifacts[0]?.kind).toBe("transcript");
      expect(
        detail.sessions[0]?.artifacts[0]?.cache.extractedTextAvailable
      ).toBeTrue();

      // This mirrors the /api/courses/:courseSlug payload shape consumed by the UI.
      const uiSessionPath = `${detail.course.slug}/generated/sessions/${detail.sessions[0]?.date}/session-summary.md`;
      expect(uiSessionPath).toBe(summaryRelPath);
      const writtenSummary = await fs.readFile(
        path.join(unifiedDir, uiSessionPath),
        "utf8"
      );
      expect(writtenSummary).toContain("# BIO101");
      expect(writtenSummary).toContain("## Concepts");
    });
  });
});
