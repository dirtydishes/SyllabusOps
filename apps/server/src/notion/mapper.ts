import { sha256Hex } from "@syllabusops/core";
import type { NotionBlockInput } from "./client";

export type NotionPublishTask = {
  id: string;
  title: string;
  description: string;
  due: string | null;
  status: "approved" | "done" | "dismissed";
  confidence: number;
};

export type BuildSessionManagedBlocksInput = {
  courseSlug: string;
  sessionDate: string;
  generatedAt: string;
  summaryRelPath: string;
  artifactRelPaths: string[];
  summaryMarkdown: string;
  tasks: NotionPublishTask[];
};

function splitText(content: string, maxLen = 1800): string[] {
  const text = content.trim();
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  const out: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < 1) cut = maxLen;
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) out.push(remaining);
  return out;
}

function richText(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

function paragraphBlocks(content: string): NotionBlockInput[] {
  return splitText(content).map((part) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(part) },
  }));
}

function quoteBlocks(content: string): NotionBlockInput[] {
  return splitText(content).map((part) => ({
    object: "block",
    type: "quote",
    quote: { rich_text: richText(part) },
  }));
}

function bulletedBlocks(content: string): NotionBlockInput[] {
  return splitText(content).map((part) => ({
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(part) },
  }));
}

function headingBlock(level: 1 | 2 | 3, content: string): NotionBlockInput {
  if (level === 1) {
    return {
      object: "block",
      type: "heading_1",
      heading_1: { rich_text: richText(content) },
    };
  }
  if (level === 2) {
    return {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: richText(content) },
    };
  }
  return {
    object: "block",
    type: "heading_3",
    heading_3: { rich_text: richText(content) },
  };
}

function parseSummaryMarkdown(markdown: string): NotionBlockInput[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const out: NotionBlockInput[] = [];
  let paragraphBuf: string[] = [];
  let firstContentSeen = false;

  function flushParagraph() {
    if (paragraphBuf.length === 0) return;
    const text = paragraphBuf.join(" ").replaceAll(/\s+/g, " ").trim();
    paragraphBuf = [];
    if (!text) return;
    out.push(...paragraphBlocks(text));
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 2;
      const text = heading[2]?.trim() ?? "";
      if (!text) continue;
      if (!firstContentSeen && level === 1) {
        firstContentSeen = true;
        continue;
      }
      out.push(headingBlock(level === 1 ? 2 : (level as 2 | 3), text));
      firstContentSeen = true;
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      const text = line.slice(2).trim();
      if (text) out.push(...bulletedBlocks(text));
      firstContentSeen = true;
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      const text = line.slice(2).trim();
      if (text) out.push(...quoteBlocks(text));
      firstContentSeen = true;
      continue;
    }

    paragraphBuf.push(line);
    firstContentSeen = true;
  }

  flushParagraph();
  return out;
}

function taskLine(task: NotionPublishTask): string {
  const due = task.due ? ` (due: ${task.due})` : "";
  const desc = task.description.trim();
  if (!desc) return `${task.title.trim()}${due}`;
  return `${task.title.trim()}${due} - ${desc}`;
}

export function buildSessionManagedBlocks(
  input: BuildSessionManagedBlocksInput
): { blocks: NotionBlockInput[]; contentHash: string } {
  const blocks: NotionBlockInput[] = [];

  blocks.push(headingBlock(2, "Metadata"));
  blocks.push(...bulletedBlocks(`Course slug: ${input.courseSlug}`));
  blocks.push(...bulletedBlocks(`Session date: ${input.sessionDate}`));
  blocks.push(...bulletedBlocks(`Summary path: ${input.summaryRelPath}`));
  blocks.push(...bulletedBlocks(`Published at: ${input.generatedAt}`));

  if (input.artifactRelPaths.length === 0) {
    blocks.push(...bulletedBlocks("Artifacts: (none)"));
  } else {
    blocks.push(...bulletedBlocks("Artifacts:"));
    for (const rel of [...input.artifactRelPaths].sort((a, b) =>
      a.localeCompare(b)
    )) {
      blocks.push(...bulletedBlocks(rel));
    }
  }

  blocks.push(headingBlock(2, "Summary"));
  const summaryBlocks = parseSummaryMarkdown(input.summaryMarkdown);
  if (summaryBlocks.length === 0) {
    blocks.push(...paragraphBlocks("No summary content found."));
  } else {
    blocks.push(...summaryBlocks);
  }

  const visibleTasks = input.tasks
    .filter(
      (t) =>
        t.status === "approved" ||
        t.status === "done" ||
        t.status === "dismissed"
    )
    .slice()
    .sort((a, b) => {
      const byStatus = a.status.localeCompare(b.status);
      if (byStatus !== 0) return byStatus;
      const byTitle = a.title.localeCompare(b.title);
      if (byTitle !== 0) return byTitle;
      return a.id.localeCompare(b.id);
    });

  const approved = visibleTasks.filter((t) => t.status === "approved");
  const done = visibleTasks.filter((t) => t.status === "done");
  const dismissed = visibleTasks.filter((t) => t.status === "dismissed");

  blocks.push(headingBlock(2, "Tasks"));

  blocks.push(headingBlock(3, "Open"));
  if (approved.length === 0) {
    blocks.push(...paragraphBlocks("No approved tasks."));
  } else {
    for (const task of approved) {
      for (const part of splitText(taskLine(task))) {
        blocks.push({
          object: "block",
          type: "to_do",
          to_do: { rich_text: richText(part), checked: false },
        });
      }
    }
  }

  blocks.push(headingBlock(3, "Completed"));
  if (done.length === 0) {
    blocks.push(...paragraphBlocks("No completed tasks."));
  } else {
    for (const task of done) {
      for (const part of splitText(taskLine(task))) {
        blocks.push({
          object: "block",
          type: "to_do",
          to_do: { rich_text: richText(part), checked: true },
        });
      }
    }
  }

  blocks.push(headingBlock(3, "Dismissed"));
  if (dismissed.length === 0) {
    blocks.push(...paragraphBlocks("No dismissed tasks."));
  } else {
    for (const task of dismissed) {
      blocks.push(...bulletedBlocks(taskLine(task)));
    }
  }

  const contentHash = sha256Hex(JSON.stringify(blocks));
  return { blocks, contentHash };
}
