import { unzipSync } from "fflate";

export type PptxSlideText = {
  slideNo: number;
  text: string;
  notesText: string;
};

export type PptxExtractResult = {
  slides: PptxSlideText[];
  stats: {
    slides: number;
    slidesWithNotes: number;
    charsOut: number;
  };
};

function decodeXmlEntities(input: string): string {
  return input
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replaceAll(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCodePoint(Number.parseInt(n, 16))
    );
}

function extractATextRuns(xml: string): string {
  // Minimal PPTX text extraction: grab <a:t>...</a:t> contents
  const out: string[] = [];
  const re = /<a:t>([\s\S]*?)<\/a:t>/g;
  let match: RegExpExecArray | null = re.exec(xml);
  while (match) {
    const txt = decodeXmlEntities(match[1] ?? "").trim();
    if (txt) out.push(txt);
    match = re.exec(xml);
  }
  return out.join("\n").trim();
}

function slideNoFromPath(p: string): number | null {
  const m = p.match(/slide(\d+)\.xml$/);
  return m ? Number(m[1]) : null;
}

function notesNoFromPath(p: string): number | null {
  const m = p.match(/notesSlide(\d+)\.xml$/);
  return m ? Number(m[1]) : null;
}

export function extractPptxTextFromZipBytes(
  zipBytes: Uint8Array
): PptxExtractResult {
  const files = unzipSync(zipBytes);

  const slideXmlByNo = new Map<number, string>();
  const notesXmlByNo = new Map<number, string>();

  for (const [filePath, file] of Object.entries(files)) {
    if (filePath.startsWith("ppt/slides/slide") && filePath.endsWith(".xml")) {
      const no = slideNoFromPath(filePath);
      if (!no) continue;
      slideXmlByNo.set(no, new TextDecoder().decode(file));
      continue;
    }
    if (
      filePath.startsWith("ppt/notesSlides/notesSlide") &&
      filePath.endsWith(".xml")
    ) {
      const no = notesNoFromPath(filePath);
      if (!no) continue;
      notesXmlByNo.set(no, new TextDecoder().decode(file));
    }
  }

  const slideNos = Array.from(slideXmlByNo.keys()).sort((a, b) => a - b);
  const slides: PptxSlideText[] = [];

  for (const slideNo of slideNos) {
    const xml = slideXmlByNo.get(slideNo) ?? "";
    const notesXml = notesXmlByNo.get(slideNo) ?? "";
    const text = extractATextRuns(xml);
    const notesText = extractATextRuns(notesXml);
    slides.push({ slideNo, text, notesText });
  }

  const charsOut = slides.reduce(
    (sum, s) => sum + s.text.length + s.notesText.length,
    0
  );
  const slidesWithNotes = slides.filter((s) => s.notesText.length > 0).length;
  return {
    slides,
    stats: { slides: slides.length, slidesWithNotes, charsOut },
  };
}
