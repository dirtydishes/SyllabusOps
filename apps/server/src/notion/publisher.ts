import { sha256Hex } from "@syllabusops/core";
import type { Logger } from "../logger";
import type { NotionClient } from "./client";
import { normalizeNotionId } from "./client";
import { type NotionPublishTask, buildSessionManagedBlocks } from "./mapper";
import type { createNotionStore } from "./store";

type NotionStore = ReturnType<typeof createNotionStore>;

export type PublishSessionInput = {
  jobId?: string | null;
  rootPageId: string;
  course: { slug: string; name: string };
  sessionDate: string;
  summaryRelPath: string;
  summaryMarkdown: string;
  artifactRelPaths: string[];
  tasks: NotionPublishTask[];
};

export function createNotionPublisher(opts: {
  notion: NotionClient;
  store: NotionStore;
  logger: Logger;
}) {
  function summaryGeneratedAt(markdown: string): string {
    const match = markdown.match(/^\*\*Generated:\*\*\s*(.+)$/m);
    const value = match?.[1]?.trim();
    return value?.length ? value : "";
  }

  async function ensureCoursePage(input: {
    rootPageId: string;
    course: { slug: string; name: string };
  }): Promise<{ notionId: string }> {
    const entityType = "course_page" as const;
    const entityKey = `course:${input.course.slug}`;
    const existing = opts.store.getBinding({ entityType, entityKey });
    if (existing?.notion_id) return { notionId: existing.notion_id };

    const created = await opts.notion.createPage({
      parentPageId: input.rootPageId,
      title: `${input.course.name} (SyllabusOps)`,
    });
    const titleHash = sha256Hex(`${input.course.slug}:${input.course.name}`);
    opts.store.upsertBinding({
      entityType,
      entityKey,
      notionId: created.id,
      lastPublishedHash: titleHash,
    });
    return { notionId: created.id };
  }

  async function ensureSessionPage(input: {
    coursePageId: string;
    courseSlug: string;
    sessionDate: string;
  }): Promise<{ notionId: string; lastPublishedHash: string }> {
    const entityType = "session_page" as const;
    const entityKey = `session:${input.courseSlug}:${input.sessionDate}`;
    const existing = opts.store.getBinding({ entityType, entityKey });
    if (existing?.notion_id) {
      return {
        notionId: existing.notion_id,
        lastPublishedHash: existing.last_published_hash,
      };
    }

    const created = await opts.notion.createPage({
      parentPageId: input.coursePageId,
      title: `${input.sessionDate} Session`,
    });
    const row = opts.store.upsertBinding({
      entityType,
      entityKey,
      notionId: created.id,
      lastPublishedHash: "",
    });
    return {
      notionId: row.notion_id,
      lastPublishedHash: row.last_published_hash,
    };
  }

  async function ensureManagedBlock(input: {
    sessionPageId: string;
    courseSlug: string;
    sessionDate: string;
  }): Promise<{ notionId: string; lastPublishedHash: string }> {
    const entityType = "session_managed_block" as const;
    const entityKey = `session_managed:${input.courseSlug}:${input.sessionDate}`;
    const existing = opts.store.getBinding({ entityType, entityKey });
    if (existing?.notion_id) {
      return {
        notionId: existing.notion_id,
        lastPublishedHash: existing.last_published_hash,
      };
    }

    const createdIds = await opts.notion.appendBlockChildren({
      blockId: input.sessionPageId,
      children: [
        {
          object: "block",
          type: "toggle",
          toggle: {
            rich_text: [
              {
                type: "text",
                text: { content: "SyllabusOps Managed" },
              },
            ],
          },
        },
      ],
    });
    const managedId = createdIds[0];
    if (!managedId) throw new Error("NOTION_MANAGED_BLOCK_CREATE_FAILED");

    const row = opts.store.upsertBinding({
      entityType,
      entityKey,
      notionId: managedId,
      lastPublishedHash: "",
    });
    return {
      notionId: row.notion_id,
      lastPublishedHash: row.last_published_hash,
    };
  }

  async function replaceManagedChildren(input: {
    managedBlockId: string;
    blocks: Parameters<NotionClient["appendBlockChildren"]>[0]["children"];
  }): Promise<void> {
    const existing = await opts.notion.listBlockChildren(input.managedBlockId);
    for (const row of existing) {
      await opts.notion.archiveBlock(row.id);
    }
    await opts.notion.appendBlockChildren({
      blockId: input.managedBlockId,
      children: input.blocks,
    });
  }

  async function publishSession(input: PublishSessionInput): Promise<{
    changed: boolean;
    coursePageId: string;
    sessionPageId: string;
    managedBlockId: string;
    contentHash: string;
    blockCount: number;
    syncRunId: string;
  }> {
    const rootPageId = normalizeNotionId(input.rootPageId);
    if (!rootPageId) throw new Error("NOTION_ROOT_PAGE_REQUIRED");

    const run = opts.store.startSyncRun({
      jobId: input.jobId ?? null,
      courseSlug: input.course.slug,
      sessionDate: input.sessionDate,
    });

    try {
      const coursePage = await ensureCoursePage({
        rootPageId,
        course: input.course,
      });
      const sessionPage = await ensureSessionPage({
        coursePageId: coursePage.notionId,
        courseSlug: input.course.slug,
        sessionDate: input.sessionDate,
      });
      const managed = await ensureManagedBlock({
        sessionPageId: sessionPage.notionId,
        courseSlug: input.course.slug,
        sessionDate: input.sessionDate,
      });

      const payload = buildSessionManagedBlocks({
        courseSlug: input.course.slug,
        sessionDate: input.sessionDate,
        generatedAt:
          summaryGeneratedAt(input.summaryMarkdown) || input.sessionDate,
        summaryRelPath: input.summaryRelPath,
        artifactRelPaths: input.artifactRelPaths,
        summaryMarkdown: input.summaryMarkdown,
        tasks: input.tasks,
      });

      const unchanged = payload.contentHash === managed.lastPublishedHash;
      if (!unchanged) {
        await replaceManagedChildren({
          managedBlockId: managed.notionId,
          blocks: payload.blocks,
        });
      }

      opts.store.upsertBinding({
        entityType: "session_page",
        entityKey: `session:${input.course.slug}:${input.sessionDate}`,
        notionId: sessionPage.notionId,
        lastPublishedHash: payload.contentHash,
      });
      opts.store.upsertBinding({
        entityType: "session_managed_block",
        entityKey: `session_managed:${input.course.slug}:${input.sessionDate}`,
        notionId: managed.notionId,
        lastPublishedHash: payload.contentHash,
      });

      opts.store.finishSyncRun({ id: run.id, status: "succeeded" });
      opts.logger.info("notion.publish.success", {
        job_id: input.jobId ?? null,
        courseSlug: input.course.slug,
        sessionDate: input.sessionDate,
        changed: !unchanged,
        blockCount: payload.blocks.length,
      });

      return {
        changed: !unchanged,
        coursePageId: coursePage.notionId,
        sessionPageId: sessionPage.notionId,
        managedBlockId: managed.notionId,
        contentHash: payload.contentHash,
        blockCount: payload.blocks.length,
        syncRunId: run.id,
      };
    } catch (e: unknown) {
      const error = String((e as Error)?.message ?? e);
      const status =
        error === "NOTION_ROOT_PAGE_REQUIRED" ||
        error === "NOTION_TOKEN_REQUIRED"
          ? "blocked"
          : "failed";
      opts.store.finishSyncRun({ id: run.id, status, error });
      opts.logger.error("notion.publish.failed", {
        job_id: input.jobId ?? null,
        courseSlug: input.course.slug,
        sessionDate: input.sessionDate,
        error,
      });
      throw e;
    }
  }

  return {
    publishSession,
  };
}
