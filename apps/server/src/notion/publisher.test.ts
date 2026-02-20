import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDb } from "../db";
import { Logger } from "../logger";
import type { NotionClient } from "./client";
import { createNotionPublisher } from "./publisher";
import { createNotionStore } from "./store";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "syllabusops-notion-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createFakeNotionClient() {
  let nextId = 1;
  const childrenByBlock = new Map<string, string[]>();
  const archived = new Set<string>();
  const appendCalls: Array<{ blockId: string; count: number }> = [];

  function newId(prefix: string): string {
    const n = String(nextId++).padStart(4, "0");
    return `${prefix}_${n}`;
  }

  const client: NotionClient = {
    usersMe: async () => ({ object: "user" }),
    createPage: async () => {
      const id = newId("page");
      childrenByBlock.set(id, []);
      return { id };
    },
    listBlockChildren: async (blockId: string) => {
      const rows = childrenByBlock.get(blockId) ?? [];
      return rows.filter((id) => !archived.has(id)).map((id) => ({ id }));
    },
    appendBlockChildren: async ({ blockId, children }) => {
      appendCalls.push({ blockId, count: children.length });
      const row = childrenByBlock.get(blockId) ?? [];
      const ids: string[] = [];
      for (const child of children) {
        const id = newId("blk");
        ids.push(id);
        row.push(id);
        if (child.type === "toggle") {
          childrenByBlock.set(id, []);
        }
      }
      childrenByBlock.set(blockId, row);
      return ids;
    },
    archiveBlock: async (blockId: string) => {
      archived.add(blockId);
    },
    textValue: (content: string) => [{ type: "text", text: { content } }],
  };

  return {
    client,
    childrenByBlock,
    archived,
    appendCalls,
  };
}

describe("createNotionPublisher", () => {
  test("creates pages once and only replaces managed children on republish", async () => {
    await withTempDir(async (dir) => {
      const db = await openDb({ stateDir: path.join(dir, "state") });
      const store = createNotionStore(db);
      const fake = createFakeNotionClient();
      const logger = new Logger({ logsDir: path.join(dir, "logs") });
      const publisher = createNotionPublisher({
        notion: fake.client,
        store,
        logger,
      });

      const input = {
        jobId: "job_1",
        rootPageId: "9f6bd4d9af6c4d2e8e7495ca11d385fa",
        course: { slug: "bio101", name: "BIO 101" },
        sessionDate: "2026-02-20",
        summaryRelPath:
          "bio101/generated/sessions/2026-02-20/session-summary.md",
        summaryMarkdown: "# Title\n\n## Overview\nCells and ATP.",
        artifactRelPaths: [
          "bio101/raw/2026/2026-02-20/BIO101 2026-02-20 Transcript.vtt",
        ],
        tasks: [
          {
            id: "task_1",
            title: "Read chapter 3",
            description: "",
            due: null,
            status: "approved" as const,
            confidence: 0.8,
          },
        ],
      };

      const first = await publisher.publishSession(input);
      expect(first.changed).toBeTrue();

      const beforeCalls = fake.appendCalls.length;
      const second = await publisher.publishSession(input);
      expect(second.changed).toBeFalse();
      expect(fake.appendCalls.length).toBe(beforeCalls);

      const sessionChildren =
        fake.childrenByBlock.get(first.sessionPageId) ?? [];
      sessionChildren.push("user_note_1");
      fake.childrenByBlock.set(first.sessionPageId, sessionChildren);

      const third = await publisher.publishSession({
        ...input,
        tasks: [
          {
            id: "task_1",
            title: "Read chapter 3",
            description: "",
            due: null,
            status: "done" as const,
            confidence: 0.8,
          },
        ],
      });
      expect(third.changed).toBeTrue();
      expect(fake.archived.has("user_note_1")).toBeFalse();

      const runs = store.listSyncRuns({ courseSlug: "bio101", limit: 10 });
      expect(runs.length).toBe(3);
      expect(runs[0]?.status).toBe("succeeded");
    });
  });
});
