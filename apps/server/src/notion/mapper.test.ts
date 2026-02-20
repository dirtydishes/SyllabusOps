import { describe, expect, test } from "bun:test";
import { buildSessionManagedBlocks } from "./mapper";

describe("buildSessionManagedBlocks", () => {
  test("is deterministic and includes task status sections", () => {
    const input = {
      courseSlug: "bio101",
      sessionDate: "2026-02-20",
      generatedAt: "2026-02-20T12:00:00.000Z",
      summaryRelPath: "bio101/generated/sessions/2026-02-20/session-summary.md",
      artifactRelPaths: [
        "bio101/raw/2026/2026-02-20/BIO101 2026-02-20 Transcript.vtt",
        "bio101/raw/2026/2026-02-20/BIO101 2026-02-20 Slides.pdf",
      ],
      summaryMarkdown: `# Session title

## Overview
Cells and ATP.

## Key points
- Mitochondria
- Electron transport
`,
      tasks: [
        {
          id: "task_a",
          title: "Read chapter 3",
          description: "Focus on ATP synthesis",
          due: "2026-02-25",
          status: "approved" as const,
          confidence: 0.9,
        },
        {
          id: "task_b",
          title: "Review notes",
          description: "",
          due: null,
          status: "done" as const,
          confidence: 0.8,
        },
        {
          id: "task_c",
          title: "Ignore me",
          description: "",
          due: null,
          status: "dismissed" as const,
          confidence: 0.1,
        },
      ],
    };

    const first = buildSessionManagedBlocks(input);
    const second = buildSessionManagedBlocks(input);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.blocks).toEqual(second.blocks);

    const asJson = JSON.stringify(first.blocks);
    expect(asJson).toContain("Read chapter 3");
    expect(asJson).toContain("Review notes");
    expect(asJson).toContain("Ignore me");
    expect(asJson).toContain("Course slug");
  });

  test("chunks long text into multiple blocks", () => {
    const longLine = "A".repeat(5000);
    const out = buildSessionManagedBlocks({
      courseSlug: "chem101",
      sessionDate: "2026-02-20",
      generatedAt: "2026-02-20T12:00:00.000Z",
      summaryRelPath:
        "chem101/generated/sessions/2026-02-20/session-summary.md",
      artifactRelPaths: [],
      summaryMarkdown: longLine,
      tasks: [],
    });

    const paragraphs = out.blocks.filter((b) => b.type === "paragraph");
    expect(paragraphs.length).toBeGreaterThan(1);
  });
});
