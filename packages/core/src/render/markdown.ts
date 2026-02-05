import type { ArtifactSummary, SessionSummary } from "../llm/schemas";

function h1(title: string) {
  return `# ${title}\n`;
}

function h2(title: string) {
  return `\n## ${title}\n`;
}

function bullets(items: string[]) {
  if (items.length === 0) return "";
  return `${items.map((i) => `- ${i}`).join("\n")}\n`;
}

export function renderArtifactSummaryMarkdown(s: ArtifactSummary): string {
  const lines: string[] = [];
  lines.push(h1(s.title).trimEnd());
  lines.push(`- Kind: \`${s.artifact.kind}\``);
  if (s.sessionDate) lines.push(`- Session date: \`${s.sessionDate}\``);
  if (s.course) lines.push(`- Course: \`${s.course.courseShort}\``);
  lines.push("");
  lines.push(s.overview.trim());

  if (s.topics.length) {
    lines.push(h2("Topics").trimEnd());
    lines.push(bullets(s.topics).trimEnd());
  }
  if (s.keyPoints.length) {
    lines.push(h2("Key Points").trimEnd());
    lines.push(bullets(s.keyPoints).trimEnd());
  }
  if (s.glossary.length) {
    lines.push(h2("Glossary").trimEnd());
    lines.push(
      `${s.glossary.map((g) => `- **${g.term}**: ${g.definition}`).join("\n")}`.trimEnd()
    );
  }
  if (s.quotes.length) {
    lines.push(h2("Quotes").trimEnd());
    lines.push(bullets(s.quotes).trimEnd());
  }
  if (s.slides.length) {
    lines.push(h2("Slides").trimEnd());
    for (const slide of s.slides) {
      lines.push(`\n### Slide ${slide.slideNo}\n`.trimEnd());
      if (slide.bullets.length) lines.push(bullets(slide.bullets).trimEnd());
      if (slide.notes.length) {
        lines.push("\n**Notes**\n".trimEnd());
        lines.push(bullets(slide.notes).trimEnd());
      }
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function renderSessionSummaryMarkdown(s: SessionSummary): string {
  const title = `${s.course.courseShort} — ${s.sessionDate}`;
  const lines: string[] = [];
  lines.push(h1(title).trimEnd());
  lines.push(`- Course: \`${s.course.courseSlug}\``);
  lines.push(`- Date: \`${s.sessionDate}\``);
  lines.push("");
  lines.push(s.overview.trim());

  if (s.concepts.length) {
    lines.push(h2("Concepts").trimEnd());
    lines.push(bullets(s.concepts).trimEnd());
  }
  if (s.reviewNext.length) {
    lines.push(h2("Review Next").trimEnd());
    lines.push(bullets(s.reviewNext).trimEnd());
  }
  if (s.tasks.length) {
    lines.push(h2("Suggested Tasks").trimEnd());
    for (const t of s.tasks) {
      lines.push(
        `- ${t.title}${t.due ? ` (due: ${t.due})` : ""} — confidence: ${t.confidence.toFixed(2)}`
      );
      if (t.description) lines.push(`  - ${t.description}`);
    }
  }
  if (s.references.length) {
    lines.push(h2("References").trimEnd());
    lines.push(bullets(s.references).trimEnd());
  }

  return `${lines.join("\n").trim()}\n`;
}
