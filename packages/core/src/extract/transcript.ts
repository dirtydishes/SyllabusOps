import path from "node:path";

export type TranscriptExtractResult = {
  text: string;
  stats: {
    kind: "vtt" | "text";
    cues?: number;
    linesIn: number;
    charsOut: number;
  };
};

function normalizeWhitespace(s: string): string {
  const normalized = s
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n[ \t]+/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
  return `${normalized}\n`;
}

function isTimestampLine(line: string): boolean {
  // 00:00:00.000 --> 00:00:05.000 (optionally with settings at end)
  return /^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(
    line
  );
}

function isVttCueIndex(line: string): boolean {
  return /^\d+$/.test(line.trim());
}

function stripVtt(input: string): TranscriptExtractResult {
  const raw = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = raw.split("\n");

  const out: string[] = [];
  let cues = 0;
  let i = 0;

  // Skip WEBVTT header and leading metadata blocks.
  if (lines[0]?.startsWith("WEBVTT")) i++;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("NOTE")) {
      i++;
      while (i < lines.length && (lines[i] ?? "").trim() !== "") i++;
      continue;
    }
    if (line.startsWith("STYLE")) {
      i++;
      while (i < lines.length && (lines[i] ?? "").trim() !== "") i++;
      continue;
    }
    if (line.startsWith("REGION")) {
      i++;
      while (i < lines.length && (lines[i] ?? "").trim() !== "") i++;
      continue;
    }

    if (isVttCueIndex(line)) {
      i++;
      continue;
    }
    if (isTimestampLine(line)) {
      cues++;
      i++;
      while (i < lines.length) {
        const t = lines[i] ?? "";
        if (t.trim() === "") break;
        // remove common inline tags like <c>, <v>, <i>, etc.
        const cleaned = t.replaceAll(/<[^>]+>/g, "").trim();
        if (cleaned) out.push(cleaned);
        i++;
      }
      out.push("");
      i++;
      continue;
    }

    i++;
  }

  const text = normalizeWhitespace(out.join("\n"));
  return {
    text,
    stats: { kind: "vtt", cues, linesIn: lines.length, charsOut: text.length },
  };
}

export function extractTranscriptText(opts: {
  sourcePath: string;
  content: string;
}): TranscriptExtractResult {
  const ext = path.extname(opts.sourcePath).toLowerCase();
  if (ext === ".vtt") return stripVtt(opts.content);
  const text = normalizeWhitespace(opts.content);
  return {
    text,
    stats: {
      kind: "text",
      linesIn: opts.content.split(/\r\n|\r|\n/).length,
      charsOut: text.length,
    },
  };
}
