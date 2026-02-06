import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { extractPptxTextFromZipBytes } from "./pptx";

function u8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("extractPptxTextFromZipBytes", () => {
  test("extracts slide text and matching notes text", () => {
    const zipBytes = zipSync({
      "ppt/slides/slide1.xml": u8(
        "<p:sld><a:t>Hello</a:t><a:t>World</a:t><a:t>Rock &amp; Roll</a:t></p:sld>"
      ),
      "ppt/notesSlides/notesSlide1.xml": u8(
        "<p:notes><a:t>Presenter</a:t><a:t>notes</a:t></p:notes>"
      ),
      "ppt/slides/slide2.xml": u8("<p:sld><a:t>Second</a:t></p:sld>"),
    });

    const res = extractPptxTextFromZipBytes(zipBytes);
    expect(res.stats.slides).toBe(2);
    expect(res.stats.slidesWithNotes).toBe(1);

    expect(res.slides[0]).toEqual({
      slideNo: 1,
      text: "Hello\nWorld\nRock & Roll",
      notesText: "Presenter\nnotes",
    });
    expect(res.slides[1]).toEqual({
      slideNo: 2,
      text: "Second",
      notesText: "",
    });
  });

  test("decodes numeric entities", () => {
    const zipBytes = zipSync({
      "ppt/slides/slide1.xml": u8(
        "<p:sld><a:t>&#169;</a:t><a:t>&#x1F600;</a:t></p:sld>"
      ),
    });

    const res = extractPptxTextFromZipBytes(zipBytes);
    expect(res.slides[0]?.text).toBe("©\n😀");
  });
});
