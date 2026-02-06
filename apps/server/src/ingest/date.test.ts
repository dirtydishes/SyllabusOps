import { describe, expect, test } from "bun:test";
import { detectDateInFileName, detectSessionDate } from "./date";

describe("detectDateInFileName", () => {
  test("detects YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD", () => {
    expect(detectDateInFileName("BIO101 2026-02-05 Transcript.vtt")).toBe(
      "2026-02-05"
    );
    expect(detectDateInFileName("BIO101_2026_02_05_Transcript.vtt")).toBe(
      "2026-02-05"
    );
    expect(detectDateInFileName("BIO101.2026.02.05.Transcript.vtt")).toBe(
      "2026-02-05"
    );
  });

  test("detects MM-DD-YYYY (Zoom-style) and rewrites to YYYY-MM-DD", () => {
    expect(detectDateInFileName("02-05-2026 Zoom Recording.vtt")).toBe(
      "2026-02-05"
    );
  });
});

describe("detectSessionDate", () => {
  test("prefers dates found in the filename over mtime", () => {
    const date = detectSessionDate({
      sourcePath: "/tmp/whatever 2026-02-01 Transcript.vtt",
      mtimeMs: 0,
    });
    expect(date).toBe("2026-02-01");
  });

  test("falls back to local date derived from mtime", () => {
    const mtimeMs = Date.UTC(2026, 1, 6, 12, 0, 0); // Feb 6, 2026 @ 12:00 UTC
    const d = new Date(mtimeMs);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(detectSessionDate({ sourcePath: "/tmp/no-date.vtt", mtimeMs })).toBe(
      expected
    );
  });
});
