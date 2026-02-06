import { describe, expect, test } from "bun:test";
import { extractTranscriptText } from "./transcript";

describe("extractTranscriptText", () => {
  test("strips WEBVTT cues, timestamps, and tags", () => {
    const vtt = `WEBVTT

NOTE this is metadata
ignored line

1
00:00:00.000 --> 00:00:02.000
<v Alice> Hello   world</v>
<i>How are you?</i>

2
00:00:02.000 --> 00:00:04.000 align:start position:0%
<c.yellow>Second cue</c>
`;

    const res = extractTranscriptText({
      sourcePath: "meeting.vtt",
      content: vtt,
    });
    expect(res.stats.kind).toBe("vtt");
    expect(res.stats.cues).toBe(2);
    expect(res.text).toBe("Hello world\nHow are you?\n\nSecond cue\n");
  });

  test("normalizes whitespace for plain text", () => {
    const res = extractTranscriptText({
      sourcePath: "notes.txt",
      content: "a\t\tb  c\r\n\r\n\r\n  d ",
    });
    expect(res.stats.kind).toBe("text");
    expect(res.text).toBe("a b c\n\nd\n");
  });
});
