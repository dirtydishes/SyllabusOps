import { describe, expect, test } from "bun:test";
import {
  renderArtifactSummaryMarkdown,
  renderSessionSummaryMarkdown,
} from "./markdown";

describe("renderArtifactSummaryMarkdown", () => {
  test("renders stable sections and ends with newline", () => {
    const md = renderArtifactSummaryMarkdown({
      version: 1,
      course: { courseShort: "BIO101", courseSlug: "bio101" },
      sessionDate: "2026-02-01",
      artifact: { kind: "slides", sourceName: "deck.pptx" },
      title: "BIO101 Slides",
      overview: "Overview text.",
      topics: ["Topic A"],
      keyPoints: ["Point 1", "Point 2"],
      glossary: [{ term: "ATP", definition: "Energy currency." }],
      quotes: ["A quote."],
      slides: [{ slideNo: 1, bullets: ["Bullet"], notes: ["Note"] }],
    });

    expect(md.endsWith("\n")).toBeTrue();
    expect(md).toContain("# BIO101 Slides");
    expect(md).toContain("- Kind: `slides`");
    expect(md).toContain("- Session date: `2026-02-01`");
    expect(md).toContain("- Course: `BIO101`");
    expect(md).toContain("## Topics");
    expect(md).toContain("## Key Points");
    expect(md).toContain("## Glossary");
    expect(md).toContain("**ATP**: Energy currency.");
    expect(md).toContain("## Slides");
    expect(md).toContain("### Slide 1");
    expect(md).toContain("**Notes**");
  });
});

describe("renderSessionSummaryMarkdown", () => {
  test("renders tasks with due dates and confidence formatting", () => {
    const md = renderSessionSummaryMarkdown({
      version: 1,
      course: { courseShort: "BIO101", courseSlug: "bio101" },
      sessionDate: "2026-02-01",
      overview: "Session overview.",
      concepts: ["Concept 1"],
      reviewNext: ["Review 1"],
      tasks: [
        {
          title: "Do thing",
          description: "More detail",
          due: "2026-02-10",
          confidence: 0.6,
        },
      ],
      references: ["Ref 1"],
    });

    expect(md).toContain("# BIO101 — 2026-02-01");
    expect(md).toContain("## Suggested Tasks");
    expect(md).toContain("- Do thing (due: 2026-02-10) — confidence: 0.60");
    expect(md).toContain("  - More detail");
  });
});
