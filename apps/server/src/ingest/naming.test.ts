import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  buildCanonicalBaseName,
  courseFromSourcePath,
  detectArtifactKind,
  slugifyCourse,
} from "./naming";

describe("detectArtifactKind", () => {
  test("classifies common extensions", () => {
    expect(detectArtifactKind("/x/meeting.vtt")).toBe("transcript");
    expect(detectArtifactKind("/x/notes.md")).toBe("transcript");
    expect(detectArtifactKind("/x/deck.pptx")).toBe("slides");
    expect(detectArtifactKind("/x/deck.pdf")).toBe("slides");
    expect(detectArtifactKind("/x/unknown.bin")).toBe("unknown");
  });
});

describe("slugifyCourse", () => {
  test("slugifies and falls back to inbox", () => {
    expect(slugifyCourse("  The Bionic Human ")).toBe("the-bionic-human");
    expect(slugifyCourse("")).toBe("inbox");
    expect(slugifyCourse("!!!")).toBe("inbox");
  });
});

describe("courseFromSourcePath", () => {
  test("uses watchRoot to skip generic buckets and infer course", () => {
    const root = path.join("/tmp", "watch-root");
    const src = path.join(root, "School", "Transcripts", "BIO101", "a.vtt");
    expect(courseFromSourcePath(src, root)).toEqual({
      courseShort: "BIO101",
      courseSlug: "bio101",
    });
  });

  test("strips leading Zoom date/time folder prefixes", () => {
    const root = path.join("/tmp", "zoom");
    const folder = "2026-02-02 15.48.46 The Bionic Human";
    const src = path.join(root, folder, "meeting.vtt");
    expect(courseFromSourcePath(src, root)).toEqual({
      courseShort: "The Bionic Human",
      courseSlug: "the-bionic-human",
    });
  });

  test("falls back to parent directory when watchRoot is not provided", () => {
    const src = path.join("/tmp", "BIO101", "meeting.vtt");
    expect(courseFromSourcePath(src)).toEqual({
      courseShort: "BIO101",
      courseSlug: "bio101",
    });
  });
});

describe("buildCanonicalBaseName", () => {
  test("builds canonical base names by kind", () => {
    expect(
      buildCanonicalBaseName({
        courseShort: "BIO101",
        sessionDate: "2026-02-01",
        kind: "transcript",
      })
    ).toBe("BIO101 2026-02-01 Transcript");
    expect(
      buildCanonicalBaseName({
        courseShort: "BIO101",
        sessionDate: "2026-02-01",
        kind: "slides",
      })
    ).toBe("BIO101 2026-02-01 Slides");
    expect(
      buildCanonicalBaseName({
        courseShort: "BIO101",
        sessionDate: "2026-02-01",
        kind: "unknown",
      })
    ).toBe("BIO101 2026-02-01 Artifact");
  });
});
