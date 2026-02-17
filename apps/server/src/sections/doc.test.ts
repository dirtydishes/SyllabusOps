import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LibrarySession } from "../library/library";
import { generateUnifiedSectionDoc } from "./doc";
import type { SectionRow } from "./store";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "syllabusops-sections-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function makeSection(): SectionRow {
  const now = new Date().toISOString();
  return {
    id: "section_abc123",
    course_slug: "bio101",
    slug: "unit-2-cells",
    title: "Unit 2 Cells",
    start_date: "2026-02-10",
    end_date: "2026-02-20",
    description: "Cell structure and energy transfer",
    created_at: now,
    updated_at: now,
  };
}

function makeSessions(): LibrarySession[] {
  return [
    {
      date: "2026-02-09",
      artifacts: [],
    },
    {
      date: "2026-02-12",
      artifacts: [
        {
          id: "sha-slide",
          kind: "slides",
          fileName: "BIO101 2026-02-12 Slides.pdf",
          relPath: "bio101/raw/2026/2026-02-12/BIO101 2026-02-12 Slides.pdf",
          sha256: "sha-slide",
          ingestedAt: "2026-02-12T10:00:00.000Z",
          sourcePath: "/tmp/Slides.pdf",
          ext: ".pdf",
          cache: { type: "pdf", extractedTextAvailable: true },
          generated: {
            artifactSummaryPath:
              "bio101/generated/artifacts/sha-slide/summary.md",
          },
        },
      ],
    },
    {
      date: "2026-02-17",
      artifacts: [
        {
          id: "sha-vtt",
          kind: "transcript",
          fileName: "BIO101 2026-02-17 Transcript.vtt",
          relPath:
            "bio101/raw/2026/2026-02-17/BIO101 2026-02-17 Transcript.vtt",
          sha256: "sha-vtt",
          ingestedAt: "2026-02-17T10:00:00.000Z",
          sourcePath: "/tmp/Transcript.vtt",
          ext: ".vtt",
          cache: { type: "transcripts", extractedTextAvailable: true },
          generated: {
            artifactSummaryPath:
              "bio101/generated/artifacts/sha-vtt/summary.md",
          },
        },
      ],
    },
  ];
}

describe("generateUnifiedSectionDoc", () => {
  test("writes unified section doc with in-range sessions and textbook summaries", async () => {
    await withTempDir(async (dir) => {
      const unifiedDir = path.join(dir, "Unified");
      const stateDir = path.join(dir, "state");
      const textbookSha = "abc123def456ghi789jkl012mno345pq";
      const section = makeSection();
      const sessions = makeSessions();

      const summaryAPath = path.join(
        unifiedDir,
        "bio101",
        "generated",
        "sessions",
        "2026-02-12",
        "session-summary.md"
      );
      const summaryBPath = path.join(
        unifiedDir,
        "bio101",
        "generated",
        "sessions",
        "2026-02-17",
        "session-summary.md"
      );
      await fs.mkdir(path.dirname(summaryAPath), { recursive: true });
      await fs.mkdir(path.dirname(summaryBPath), { recursive: true });
      await fs.writeFile(
        summaryAPath,
        "# BIO101 Session\n\n## Overview\nCells and organelles.\n",
        "utf8"
      );
      await fs.writeFile(
        summaryBPath,
        "# BIO101 Session\n\n## Overview\nATP and respiration.\n",
        "utf8"
      );

      const textbooksDir = path.join(stateDir, "cache", "textbooks");
      await fs.mkdir(textbooksDir, { recursive: true });
      await fs.writeFile(
        path.join(textbooksDir, `${textbookSha}.index.json`),
        `${JSON.stringify(
          {
            version: 1,
            source: {
              relPath:
                "bio101/raw/2026/2026-02-12/BIO101 2026-02-12 Slides.pdf",
              sessionDate: "2026-02-12",
            },
            chunks: [
              {
                text: "Chapter 4 introduces membranes, transport, and ATP usage in cells.",
              },
            ],
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(textbooksDir, "catalog.json"),
        `${JSON.stringify(
          {
            version: 1,
            updatedAt: new Date().toISOString(),
            entries: [
              {
                sha256: textbookSha,
                indexedAt: new Date().toISOString(),
                canonicalPath: path.join(
                  unifiedDir,
                  "bio101",
                  "raw",
                  "2026",
                  "2026-02-12",
                  "BIO101 2026-02-12 Slides.pdf"
                ),
                relPath:
                  "bio101/raw/2026/2026-02-12/BIO101 2026-02-12 Slides.pdf",
                courseSlug: "bio101",
                sessionDate: "2026-02-12",
                sourceTextChars: 2000,
                chunks: 8,
              },
            ],
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const out = await generateUnifiedSectionDoc({
        unifiedDir,
        stateDir,
        course: { slug: "bio101", name: "BIO101" },
        section,
        sessions,
      });

      expect(out.relPath).toBe(
        "bio101/generated/sections/unit-2-cells/unified-study-doc.md"
      );
      expect(out.sessionCount).toBe(2);
      expect(out.textbookCount).toBe(1);

      const docText = await fs.readFile(out.absolutePath, "utf8");
      expect(docText).toContain("# BIO101");
      expect(docText).toContain("Unit 2 Cells");
      expect(docText).toContain("2026-02-12");
      expect(docText).toContain("2026-02-17");
      expect(docText).not.toContain("2026-02-09");
      expect(docText).toContain("Chapter 4 introduces membranes");
    });
  });
});
