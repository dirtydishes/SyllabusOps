import fs from "node:fs/promises";
import path from "node:path";
import { cors } from "@elysiajs/cors";
import {
  ApiStatusSchema,
  FsReadResponseSchema,
  FsWriteRequestSchema,
} from "@syllabusops/core";
import { resolveWithinRoot } from "@syllabusops/core";
import { Elysia } from "elysia";
import { z } from "zod";
import {
  OpenAiOAuthConfigSchema,
  OpenAiOAuthStatusSchema,
  createOpenAiAuth,
} from "./auth/openai";
import { parseIcsEvents } from "./calendar/ics";
import { createCalendarStore } from "./calendar/store";
import { loadConfig } from "./config";
import {
  scanCourseDetailGrouped,
  scanCoursesGrouped,
  scanSessionGrouped,
} from "./courses/grouped-library";
import { createCourseRegistry } from "./courses/registry";
import { openDb } from "./db";
import { extractPdfToCache } from "./extract/pdf";
import { extractPptxToCache } from "./extract/pptx";
import { extractTranscriptToCache } from "./extract/transcript";
import {
  FsSchemas,
  getRevisionDir,
  listDir,
  parseRevisionStamp,
  readTextFile,
  writeTextFile,
} from "./fs-api";
import { ingestFile } from "./ingest/ingest-file";
import { createJobQueue } from "./jobs/queue";
import { createJobRunner } from "./jobs/runner";
import {
  EnqueueJobRequestSchema,
  JobStatusSchema,
  JobTypeSchema,
} from "./jobs/schemas";
import { createCodexAppServer } from "./llm/codex-app-server";
import { openAiJsonSchema } from "./llm/openai-responses";
import { Logger } from "./logger";
import { keychainStore } from "./secrets/keychain";
import { SseHub } from "./sse";
import { createTasksStore } from "./tasks/store";
import { indexPdfTextbookCache, listTextbookCatalog } from "./textbooks/index";
import { createWatcher } from "./watcher/watcher";

const config = loadConfig();

await fs.mkdir(config.stateDir, { recursive: true });
const logger = new Logger({ logsDir: path.join(config.stateDir, "logs") });
const sse = new SseHub();
const db = await openDb({ stateDir: config.stateDir });
const queue = createJobQueue(db);
const courseRegistry = createCourseRegistry({
  stateDir: config.stateDir,
  logger,
});

logger.subscribe((evt) => sse.broadcast({ type: "log", payload: evt }));

const SettingsSchema = z.object({
  unifiedDir: z.string().min(1),
  watchRoots: z.array(z.string()).default([]),
  ingestEnabled: z.boolean().default(false),
  llmProvider: z.enum(["openai", "codex"]).default("codex"),
  llmMaxOutputTokens: z.number().int().min(256).max(8000).default(1200),
  openaiOAuth: OpenAiOAuthConfigSchema.optional(),
  openaiApiBaseUrl: z.string().url().default("https://api.openai.com/v1"),
  openaiModel: z.string().min(1).default("gpt-4o-mini"),
  openaiReasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  codexModel: z.string().min(1).default("gpt-5.2-codex"),
  codexEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
});
type Settings = z.infer<typeof SettingsSchema>;

const settingsPath = path.join(config.stateDir, "settings.json");

function normalizeShellEscapedPath(p: string): string {
  // Common footgun: users paste shell-escaped paths like `Mobile\ Documents`.
  // On macOS, backslash is not a path separator; unescape only `\ `.
  return p.replaceAll("\\ ", " ").trim();
}

function normalizeSettings(s: Settings): Settings {
  return {
    ...s,
    unifiedDir: normalizeShellEscapedPath(s.unifiedDir),
    watchRoots: (s.watchRoots ?? [])
      .map(normalizeShellEscapedPath)
      .filter(Boolean),
  };
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return normalizeSettings(parsed.data);
  } catch {
    // ignore
  }
  return {
    unifiedDir: config.unifiedDir,
    watchRoots: config.watchRoots,
    ingestEnabled: false,
    llmProvider: "codex",
    llmMaxOutputTokens: 1200,
    openaiOAuth: undefined,
    openaiApiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "gpt-4o-mini",
    openaiReasoningEffort: undefined,
    codexModel: "gpt-5.2-codex",
    codexEffort: undefined,
  };
}

async function writeSettings(next: Settings): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(next, null, 2), "utf8");
}

let currentSettings = await readSettings();

const secrets = keychainStore({
  serviceName: "SyllabusOps",
  fallbackDir: path.join(config.stateDir, "secrets"),
  logger,
});

const openaiAuth = createOpenAiAuth({
  getConfig: () => currentSettings.openaiOAuth ?? null,
  secrets,
  logger,
  now: () => new Date(),
});

const codex = createCodexAppServer({ logger });

const watcher = createWatcher({
  config: {
    roots: currentSettings.watchRoots,
    stableWindowMs: 5_000,
    scanIntervalMs: 30_000,
  },
  queue,
  logger,
  shouldEnqueue: () => currentSettings.ingestEnabled,
  getIgnoredAbsPrefixes: () => [currentSettings.unifiedDir, config.stateDir],
});
watcher.start();

const runner = createJobRunner({
  queue,
  logger,
  runJob: async (job) => {
    switch (job.job_type) {
      case "noop":
        logger.info("job.noop", { job_id: job.id });
        return "succeed";
      case "ingest_file": {
        if (!currentSettings.ingestEnabled) {
          queue.block(job.id, "INGEST_DISABLED");
          logger.warn("job.blocked", {
            job_id: job.id,
            reason: "INGEST_DISABLED",
          });
          return "skip";
        }
        const payload = JSON.parse(job.payload_json) as {
          sourcePath?: unknown;
          watchRoot?: unknown;
        };
        const sourcePath =
          typeof payload.sourcePath === "string" ? payload.sourcePath : null;
        const watchRoot =
          typeof payload.watchRoot === "string" ? payload.watchRoot : null;
        if (!sourcePath)
          throw new Error("Invalid ingest_file payload: sourcePath required.");

        const res = await ingestFile({
          sourcePath,
          watchRoot,
          unifiedDir: currentSettings.unifiedDir,
          pipelineVersion: "0.0.0-dev",
          logger,
          resolveCourse: async (detected) => {
            const canonical = await courseRegistry.resolveCanonical(
              detected.courseSlug
            );
            const name = await courseRegistry.nameFor(canonical);
            return {
              courseSlug: canonical,
              courseShort: name ?? detected.courseShort,
            };
          },
        });
        if (!res.ok) throw new Error(res.error);

        if (res.kind === "transcript") {
          queue.enqueue({
            jobType: "extract_transcript",
            priority: 2,
            payload: { canonicalPath: res.copiedTo, sha256: res.sha256 },
          });
        }
        if (
          res.kind === "slides" &&
          path.extname(res.copiedTo).toLowerCase() === ".pptx"
        ) {
          queue.enqueue({
            jobType: "extract_pptx",
            priority: 2,
            payload: { canonicalPath: res.copiedTo, sha256: res.sha256 },
          });
        }
        if (
          res.kind === "slides" &&
          path.extname(res.copiedTo).toLowerCase() === ".pdf"
        ) {
          queue.enqueue({
            jobType: "extract_pdf",
            priority: 2,
            payload: { canonicalPath: res.copiedTo, sha256: res.sha256 },
          });
        }
        return "succeed";
      }
      case "extract_transcript": {
        const payload = JSON.parse(job.payload_json) as {
          canonicalPath?: unknown;
          sha256?: unknown;
        };
        const canonicalPath =
          typeof payload.canonicalPath === "string"
            ? payload.canonicalPath
            : null;
        const sha256 =
          typeof payload.sha256 === "string" ? payload.sha256 : null;
        if (!canonicalPath || !sha256) {
          throw new Error(
            "Invalid extract_transcript payload: canonicalPath and sha256 required."
          );
        }
        const out = await extractTranscriptToCache({
          canonicalPath,
          sha256,
          stateDir: config.stateDir,
        });
        logger.info("extract.transcript.cached", {
          canonicalPath,
          sha256,
          textPath: out.textPath,
        });
        return "succeed";
      }
      case "extract_pptx": {
        const payload = JSON.parse(job.payload_json) as {
          canonicalPath?: unknown;
          sha256?: unknown;
        };
        const canonicalPath =
          typeof payload.canonicalPath === "string"
            ? payload.canonicalPath
            : null;
        const sha256 =
          typeof payload.sha256 === "string" ? payload.sha256 : null;
        if (!canonicalPath || !sha256) {
          throw new Error(
            "Invalid extract_pptx payload: canonicalPath and sha256 required."
          );
        }
        const out = await extractPptxToCache({
          canonicalPath,
          sha256,
          stateDir: config.stateDir,
        });
        logger.info("extract.pptx.cached", {
          canonicalPath,
          sha256,
          jsonPath: out.jsonPath,
        });
        return "succeed";
      }
      case "extract_pdf": {
        const payload = JSON.parse(job.payload_json) as {
          canonicalPath?: unknown;
          sha256?: unknown;
        };
        const canonicalPath =
          typeof payload.canonicalPath === "string"
            ? payload.canonicalPath
            : null;
        const sha256 =
          typeof payload.sha256 === "string" ? payload.sha256 : null;
        if (!canonicalPath || !sha256) {
          throw new Error(
            "Invalid extract_pdf payload: canonicalPath and sha256 required."
          );
        }
        const out = await extractPdfToCache({
          canonicalPath,
          sha256,
          stateDir: config.stateDir,
        });
        const indexed = await indexPdfTextbookCache({
          canonicalPath,
          sha256,
          stateDir: config.stateDir,
          unifiedDir: currentSettings.unifiedDir,
        });
        logger.info("extract.pdf.cached", {
          canonicalPath,
          sha256,
          textPath: out.textPath,
        });
        logger.info("textbook.indexed", {
          canonicalPath,
          sha256,
          relPath: indexed.relPath,
          courseSlug: indexed.courseSlug,
          chunkCount: indexed.chunkCount,
          fromCache: indexed.fromCache,
          indexPath: indexed.indexPath,
        });
        return "succeed";
      }
      case "suggest_tasks": {
        const payload = JSON.parse(job.payload_json) as {
          courseSlug?: unknown;
          sessionDate?: unknown;
        };
        const courseSlug =
          typeof payload.courseSlug === "string" ? payload.courseSlug : null;
        const sessionDate =
          typeof payload.sessionDate === "string" ? payload.sessionDate : null;
        if (!courseSlug || !sessionDate) {
          throw new Error(
            "Invalid suggest_tasks payload: courseSlug and sessionDate required."
          );
        }

        if (currentSettings.llmProvider === "openai") {
          if (!currentSettings.openaiModel?.trim()) {
            queue.block(job.id, "OPENAI_MODEL_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "OPENAI_MODEL_REQUIRED",
            });
            return "skip";
          }
        } else {
          if (!currentSettings.codexModel?.trim()) {
            queue.block(job.id, "CODEX_MODEL_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "CODEX_MODEL_REQUIRED",
            });
            return "skip";
          }
        }

        const scanned = await scanSessionGrouped({
          unifiedDir: currentSettings.unifiedDir,
          stateDir: config.stateDir,
          registry: courseRegistry,
          courseSlug,
          sessionDate,
        });
        if (!scanned.ok) {
          queue.block(job.id, scanned.error);
          logger.warn("job.blocked", {
            job_id: job.id,
            reason: scanned.error,
          });
          return "skip";
        }
        const canonicalCourseSlug = scanned.course.slug;

        const maxCharsPerArtifact = 35_000;
        const contextParts: string[] = [];
        for (const a of scanned.session.artifacts) {
          if (!a.cache.type || !a.cache.extractedTextAvailable) continue;
          const p = path.join(
            config.stateDir,
            "cache",
            a.cache.type,
            `${a.sha256}.txt`
          );
          let text = await fs.readFile(p, "utf8");
          if (text.length > maxCharsPerArtifact)
            text = `${text.slice(0, maxCharsPerArtifact)}\n`;
          contextParts.push(
            `=== ${a.kind.toUpperCase()} (${a.fileName}) ===\n${text.trim()}\n`
          );
        }

        if (contextParts.length === 0) {
          queue.block(job.id, "NO_EXTRACTED_TEXT");
          logger.warn("job.blocked", {
            job_id: job.id,
            reason: "NO_EXTRACTED_TEXT",
          });
          return "skip";
        }

        const TaskSuggestionsSchema = z.object({
          tasks: z.array(
            z.object({
              title: z.string().min(1),
              description: z.string().default(""),
              due: z.string().nullable().optional(),
              confidence: z.number().min(0).max(1).default(0.5),
            })
          ),
        });

        const tasksJsonSchema = {
          type: "object",
          additionalProperties: false,
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  due: { type: ["string", "null"] },
                  confidence: { type: "number" },
                },
                required: ["title", "description", "confidence", "due"],
              },
            },
          },
          required: ["tasks"],
        } as const;

        const system =
          "You extract actionable school tasks from class materials. " +
          "Return only JSON that matches the provided schema. " +
          "Tasks should be specific and student-actionable (read, review, practice, homework, follow-up questions). " +
          'If no tasks are present, return {"tasks": []}.';

        const user = `Course: ${scanned.course.name} (${canonicalCourseSlug})\nSession date: ${sessionDate}\n\n${contextParts.join("\n")}`;

        let raw: unknown;
        if (currentSettings.llmProvider === "openai") {
          let headers: { Authorization: string };
          try {
            headers = await openaiAuth.getAuthHeaders();
          } catch {
            queue.block(job.id, "OPENAI_AUTH_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "OPENAI_AUTH_REQUIRED",
            });
            return "skip";
          }
          raw = await openAiJsonSchema<unknown>({
            apiBaseUrl: currentSettings.openaiApiBaseUrl,
            model: currentSettings.openaiModel,
            headers,
            schemaName: "syllabusops_task_suggestions_v1",
            schema: tasksJsonSchema,
            system,
            user,
            reasoningEffort: currentSettings.openaiReasoningEffort,
            maxOutputTokens: currentSettings.llmMaxOutputTokens,
          });
        } else {
          const st = await codex.status();
          if (!st.available) {
            queue.block(job.id, "CODEX_UNAVAILABLE");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "CODEX_UNAVAILABLE",
            });
            return "skip";
          }
          if (st.requiresOpenaiAuth && !st.connected) {
            queue.block(job.id, "CODEX_AUTH_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "CODEX_AUTH_REQUIRED",
            });
            return "skip";
          }
          raw = await codex.jsonSchemaTurn<unknown>({
            model: currentSettings.codexModel,
            effort: currentSettings.codexEffort,
            system,
            user,
            schemaName: "syllabusops_task_suggestions_v1",
            schema: tasksJsonSchema,
          });
        }

        const parsed = TaskSuggestionsSchema.parse(raw);
        const tasksStore = createTasksStore(db);
        const inserted = tasksStore.insertSuggested(
          parsed.tasks.map((t) => ({
            courseSlug: canonicalCourseSlug,
            sessionDate,
            artifactSha: null,
            title: t.title,
            description: t.description ?? "",
            due: t.due ?? null,
            confidence: t.confidence ?? 0.5,
          }))
        );

        logger.info("tasks.suggested", {
          courseSlug: canonicalCourseSlug,
          sessionDate,
          inserted: inserted.inserted,
        });

        return "succeed";
      }
      case "summarize_session": {
        const payload = JSON.parse(job.payload_json) as {
          courseSlug?: unknown;
          sessionDate?: unknown;
        };
        const courseSlug =
          typeof payload.courseSlug === "string" ? payload.courseSlug : null;
        const sessionDate =
          typeof payload.sessionDate === "string" ? payload.sessionDate : null;
        if (!courseSlug || !sessionDate) {
          throw new Error(
            "Invalid summarize_session payload: courseSlug and sessionDate required."
          );
        }

        if (currentSettings.llmProvider === "openai") {
          if (!currentSettings.openaiModel?.trim()) {
            queue.block(job.id, "OPENAI_MODEL_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "OPENAI_MODEL_REQUIRED",
            });
            return "skip";
          }
        } else {
          if (!currentSettings.codexModel?.trim()) {
            queue.block(job.id, "CODEX_MODEL_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "CODEX_MODEL_REQUIRED",
            });
            return "skip";
          }
        }

        const scanned = await scanSessionGrouped({
          unifiedDir: currentSettings.unifiedDir,
          stateDir: config.stateDir,
          registry: courseRegistry,
          courseSlug,
          sessionDate,
        });
        if (!scanned.ok) {
          queue.block(job.id, scanned.error);
          logger.warn("job.blocked", {
            job_id: job.id,
            reason: scanned.error,
          });
          return "skip";
        }
        const canonicalCourseSlug = scanned.course.slug;

        const maxCharsPerArtifact = 45_000;
        const contextParts: string[] = [];
        for (const a of scanned.session.artifacts) {
          if (!a.cache.type || !a.cache.extractedTextAvailable) continue;
          const p = path.join(
            config.stateDir,
            "cache",
            a.cache.type,
            `${a.sha256}.txt`
          );
          let text = await fs.readFile(p, "utf8");
          if (text.length > maxCharsPerArtifact)
            text = `${text.slice(0, maxCharsPerArtifact)}\n`;
          contextParts.push(
            `=== ${a.kind.toUpperCase()} (${a.fileName}) ===\n${text.trim()}\n`
          );
        }

        if (contextParts.length === 0) {
          queue.block(job.id, "NO_EXTRACTED_TEXT");
          logger.warn("job.blocked", {
            job_id: job.id,
            reason: "NO_EXTRACTED_TEXT",
          });
          return "skip";
        }

        const SummarySchema = z.object({
          title: z.string().min(1),
          date: z.string().min(1),
          overview: z.string().default(""),
          keyPoints: z.array(z.string()).default([]),
          vocabulary: z
            .array(
              z.object({
                term: z.string().min(1),
                definition: z.string().min(1),
              })
            )
            .default([]),
          actionItems: z.array(z.string()).default([]),
          questions: z.array(z.string()).default([]),
        });

        const summaryJsonSchema = {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            date: { type: "string" },
            overview: { type: "string" },
            keyPoints: { type: "array", items: { type: "string" } },
            vocabulary: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  term: { type: "string" },
                  definition: { type: "string" },
                },
                required: ["term", "definition"],
              },
            },
            actionItems: { type: "array", items: { type: "string" } },
            questions: { type: "array", items: { type: "string" } },
          },
          required: [
            "title",
            "date",
            "overview",
            "keyPoints",
            "vocabulary",
            "actionItems",
            "questions",
          ],
        } as const;

        const system =
          "You generate a concise, student-friendly session summary from class materials. " +
          "Return only JSON that matches the provided schema. " +
          "Do not include anything not grounded in the provided context.";

        const user = `Course: ${scanned.course.name} (${canonicalCourseSlug})\nSession date: ${sessionDate}\n\n${contextParts.join("\n")}`;

        let raw: unknown;
        if (currentSettings.llmProvider === "openai") {
          let headers: { Authorization: string };
          try {
            headers = await openaiAuth.getAuthHeaders();
          } catch {
            queue.block(job.id, "OPENAI_AUTH_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "OPENAI_AUTH_REQUIRED",
            });
            return "skip";
          }
          raw = await openAiJsonSchema<unknown>({
            apiBaseUrl: currentSettings.openaiApiBaseUrl,
            model: currentSettings.openaiModel,
            headers,
            schemaName: "syllabusops_session_summary_v1",
            schema: summaryJsonSchema,
            system,
            user,
            reasoningEffort: currentSettings.openaiReasoningEffort,
            maxOutputTokens: currentSettings.llmMaxOutputTokens,
          });
        } else {
          const st = await codex.status();
          if (!st.available) {
            queue.block(job.id, "CODEX_UNAVAILABLE");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "CODEX_UNAVAILABLE",
            });
            return "skip";
          }
          if (st.requiresOpenaiAuth && !st.connected) {
            queue.block(job.id, "CODEX_AUTH_REQUIRED");
            logger.warn("job.blocked", {
              job_id: job.id,
              reason: "CODEX_AUTH_REQUIRED",
            });
            return "skip";
          }
          raw = await codex.jsonSchemaTurn<unknown>({
            model: currentSettings.codexModel,
            effort: currentSettings.codexEffort,
            system,
            user,
            schemaName: "syllabusops_session_summary_v1",
            schema: summaryJsonSchema,
          });
        }

        const parsed = SummarySchema.parse(raw);

        const md: string[] = [];
        md.push(`# ${parsed.title}`);
        md.push("");
        md.push(`**Session:** ${parsed.date}`);
        md.push(`**Generated:** ${new Date().toISOString()}`);
        md.push("");
        md.push(
          "> This file is generated by SyllabusOps. If you want to keep manual edits, put them in session Notes."
        );
        md.push("");
        md.push("## Overview");
        md.push(
          parsed.overview?.trim() ? parsed.overview.trim() : "_(no overview)_"
        );
        md.push("");
        md.push("## Key points");
        if (parsed.keyPoints.length === 0) md.push("_(none)_");
        for (const kp of parsed.keyPoints) md.push(`- ${kp}`);
        md.push("");
        md.push("## Vocabulary");
        if (parsed.vocabulary.length === 0) md.push("_(none)_");
        for (const v of parsed.vocabulary)
          md.push(`- **${v.term}**: ${v.definition}`);
        md.push("");
        md.push("## Action items");
        if (parsed.actionItems.length === 0) md.push("_(none)_");
        for (const it of parsed.actionItems) md.push(`- ${it}`);
        md.push("");
        md.push("## Questions to ask");
        if (parsed.questions.length === 0) md.push("_(none)_");
        for (const q of parsed.questions) md.push(`- ${q}`);
        md.push("");

        const relPath = `${canonicalCourseSlug}/generated/sessions/${sessionDate}/session-summary.md`;
        const resolved = resolveWithinRoot(currentSettings.unifiedDir, relPath);
        if (!resolved.ok) throw new Error("SUMMARY_PATH_DENIED");
        await fs.mkdir(path.dirname(resolved.absolutePath), {
          recursive: true,
        });
        await fs.writeFile(resolved.absolutePath, `${md.join("\n")}\n`, "utf8");

        logger.info("summary.session.generated", {
          courseSlug: canonicalCourseSlug,
          sessionDate,
          relPath,
        });

        return "succeed";
      }
    }
  },
});
runner.start();

function countRunningJobs(): number {
  const row = db
    .query("SELECT COUNT(*) AS n FROM jobs WHERE status = 'running'")
    .get() as { n?: number } | null;
  return Number(row?.n ?? 0);
}

async function rmDirContents(absDir: string): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(absDir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    await fs.rm(path.join(absDir, name), { recursive: true, force: true });
  }
  return entries.length;
}

function looksSafeUnifiedDirForWipe(
  unifiedDir: string
): { ok: true } | { ok: false; error: string } {
  const resolved = path.resolve(unifiedDir);
  const root = path.parse(resolved).root;
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;
  const base = path.basename(resolved).toLowerCase();

  if (resolved === root) return { ok: false, error: "RESET_REFUSED_ROOT" };
  if (home && resolved === home)
    return { ok: false, error: "RESET_REFUSED_HOME" };
  if (base.length < 3) return { ok: false, error: "RESET_REFUSED_TOO_SHORT" };
  if (!base.includes("unified"))
    return { ok: false, error: "RESET_REFUSED_NOT_UNIFIED" };
  return { ok: true };
}

const app = new Elysia()
  .use(cors())
  .get("/api/status", async () => {
    const payload = {
      ok: true as const,
      version: "0.0.0-dev",
      now: new Date().toISOString(),
      stateDir: config.stateDir,
      unifiedDir: currentSettings.unifiedDir,
    };
    return ApiStatusSchema.parse(payload);
  })
  .get("/api/events", () => {
    const stream = sse.connect();
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  })
  .get("/api/logs", () => ({ logs: logger.getRecent(300) }))
  .get("/api/codex/models", async () => {
    const st = await codex.status();
    if (!st.available) {
      return new Response(JSON.stringify({ error: "CODEX_UNAVAILABLE" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const list = await codex.listModels();
      return list;
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      return new Response(
        JSON.stringify({ error: "CODEX_MODELS_FAILED", detail: msg }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  })
  .get("/api/openai/models", async () => {
    let headers: { Authorization: string };
    try {
      headers = await openaiAuth.getAuthHeaders();
    } catch {
      return new Response(JSON.stringify({ error: "OPENAI_AUTH_REQUIRED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL("/models", currentSettings.openaiApiBaseUrl);
    const res = await fetch(url, {
      headers: { Authorization: headers.Authorization },
    });
    const text = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: `OPENAI_MODELS_FAILED: ${res.status}`,
          detail: text.slice(0, 400),
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: "OPENAI_MODELS_NON_JSON" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ModelsSchema = z.object({
      data: z
        .array(z.object({ id: z.string().min(1) }).passthrough())
        .default([]),
    });
    const models = ModelsSchema.parse(parsed)
      .data.map((m) => m.id)
      .sort((a, b) => a.localeCompare(b));
    return { models };
  })
  .get("/api/auth/codex/status", async () => await codex.status())
  .post("/api/auth/codex/start", async () => {
    const res = await codex.loginStartChatgpt();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: res.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return res;
  })
  .post("/api/auth/codex/logout", async () => {
    await codex.logout();
    return { ok: true };
  })
  .get("/api/calendar", async ({ query }) => {
    const q = z
      .object({
        courseSlug: z.string().min(1).optional(),
        limit: z.coerce.number().int().positive().max(1000).optional(),
      })
      .parse(query);

    const courseSlug = q.courseSlug
      ? await courseRegistry.resolveCanonical(q.courseSlug)
      : undefined;
    const calendarStore = createCalendarStore(db);
    return calendarStore.list({
      courseSlug,
      limit: q.limit ?? 300,
    });
  })
  .post("/api/calendar", async ({ body }) => {
    const b = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("upsert_schedule"),
          courseSlug: z.string().min(1),
          dayOfWeek: z.number().int().min(0).max(6),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          timezone: z.string().min(1),
          zoomJoinUrl: z.string().optional(),
          zoomMeetingId: z.string().optional(),
          zoomPasscode: z.string().optional(),
        }),
        z.object({
          action: z.literal("delete_schedule"),
          id: z.string().min(1),
        }),
        z.object({
          action: z.literal("import_ics"),
          courseSlug: z.string().min(1),
          icsText: z.string().min(1),
        }),
      ])
      .parse(body);

    const calendarStore = createCalendarStore(db);
    if (b.action === "upsert_schedule") {
      const canonical = await courseRegistry.resolveCanonical(b.courseSlug);
      const schedule = calendarStore.upsertSchedule({
        courseSlug: canonical,
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
        timezone: b.timezone,
        zoomJoinUrl: b.zoomJoinUrl,
        zoomMeetingId: b.zoomMeetingId,
        zoomPasscode: b.zoomPasscode,
      });
      logger.info("calendar.schedule.upsert", {
        courseSlug: canonical,
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
      });
      return { ok: true as const, schedule };
    }

    if (b.action === "delete_schedule") {
      const result = calendarStore.deleteSchedule(b.id);
      logger.info("calendar.schedule.delete", {
        id: b.id,
        changed: result.changed,
      });
      return result;
    }

    const canonical = await courseRegistry.resolveCanonical(b.courseSlug);
    const parsedEvents = parseIcsEvents(b.icsText);
    const result = calendarStore.upsertEvents({
      courseSlug: canonical,
      events: parsedEvents.map((ev) => ({
        ...ev,
        source: "ics",
      })),
    });
    logger.info("calendar.ics.import", {
      courseSlug: canonical,
      inserted: result.inserted,
      updated: result.updated,
      total: result.total,
    });
    return { ok: true as const, ...result };
  })
  .get("/api/tasks", async ({ query }) => {
    const q = z
      .object({
        courseSlug: z.string().min(1),
        sessionDate: z.string().optional(),
        status: z
          .enum(["suggested", "approved", "done", "dismissed"])
          .optional(),
        limit: z.coerce.number().int().positive().optional(),
      })
      .parse(query);
    const canonical = await courseRegistry.resolveCanonical(q.courseSlug);
    const tasksStore = createTasksStore(db);
    const tasks = tasksStore.list({
      courseSlug: canonical,
      sessionDate: q.sessionDate,
      status: q.status,
      limit: q.limit,
    });
    return { tasks };
  })
  .post("/api/tasks/suggest", ({ body }) => {
    const b = z
      .object({
        courseSlug: z.string().min(1),
        sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(body);
    const job = queue.enqueue({
      jobType: "suggest_tasks",
      payload: { courseSlug: b.courseSlug, sessionDate: b.sessionDate },
      priority: 2,
    });
    logger.info("tasks.suggest_job_enqueued", {
      job_id: job.id,
      courseSlug: b.courseSlug,
      sessionDate: b.sessionDate,
    });
    return { job };
  })
  .post("/api/sessions/summarize", ({ body }) => {
    const b = z
      .object({
        courseSlug: z.string().min(1),
        sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(body);
    const job = queue.enqueue({
      jobType: "summarize_session",
      payload: { courseSlug: b.courseSlug, sessionDate: b.sessionDate },
      priority: 2,
    });
    logger.info("summary.session.job_enqueued", {
      job_id: job.id,
      courseSlug: b.courseSlug,
      sessionDate: b.sessionDate,
    });
    return { job };
  })
  .post("/api/tasks/:id/approve", ({ params }) => {
    const id = z.object({ id: z.string().min(1) }).parse(params).id;
    const tasksStore = createTasksStore(db);
    return tasksStore.setStatus({ id, status: "approved" });
  })
  .post("/api/tasks/:id/dismiss", ({ params }) => {
    const id = z.object({ id: z.string().min(1) }).parse(params).id;
    const tasksStore = createTasksStore(db);
    return tasksStore.setStatus({ id, status: "dismissed" });
  })
  .post("/api/tasks/:id/done", ({ params }) => {
    const id = z.object({ id: z.string().min(1) }).parse(params).id;
    const tasksStore = createTasksStore(db);
    return tasksStore.setStatus({ id, status: "done" });
  })
  .get("/api/courses", async () => ({
    courses: await scanCoursesGrouped({
      unifiedDir: currentSettings.unifiedDir,
      stateDir: config.stateDir,
      registry: courseRegistry,
    }),
  }))
  .get("/api/textbooks", async ({ query }) => {
    const q = z
      .object({
        courseSlug: z.string().min(1).optional(),
      })
      .parse(query);
    const courseSlug = q.courseSlug
      ? await courseRegistry.resolveCanonical(q.courseSlug)
      : undefined;
    const textbooks = await listTextbookCatalog({
      stateDir: config.stateDir,
      courseSlug,
    });
    return { textbooks };
  })
  .get("/api/courses/:courseSlug", async ({ params }) => {
    const courseSlug = z
      .object({ courseSlug: z.string().min(1) })
      .parse(params).courseSlug;
    const res = await scanCourseDetailGrouped({
      unifiedDir: currentSettings.unifiedDir,
      stateDir: config.stateDir,
      registry: courseRegistry,
      courseSlug,
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: res.error }), {
        status: 404,
      });
    }

    return {
      course: res.course,
      sessions: res.sessions.map((s) => ({
        date: s.date,
        artifacts: s.artifacts,
        generated: {
          sessionSummaryPath: `${res.course.slug}/generated/sessions/${s.date}/session-summary.md`,
          sessionNotesPath: `${res.course.slug}/notes/sessions/${s.date}/notes.md`,
        },
      })),
    };
  })
  .post("/api/courses/:courseSlug/rename", async ({ params, body }) => {
    const courseSlug = z
      .object({ courseSlug: z.string().min(1) })
      .parse(params).courseSlug;
    const b = z.object({ name: z.string().min(1) }).parse(body);
    const canonical = await courseRegistry.resolveCanonical(courseSlug);
    await courseRegistry.setName(canonical, b.name);
    return { ok: true };
  })
  .post("/api/courses/merge", async ({ body }) => {
    const b = z
      .object({
        destinationSlug: z.string().min(1),
        sourceSlugs: z.array(z.string().min(1)).min(1),
        name: z.string().optional(),
      })
      .parse(body);
    const destination = await courseRegistry.resolveCanonical(
      b.destinationSlug
    );
    const sources = Array.from(
      new Set(b.sourceSlugs.map((s) => s.trim()).filter(Boolean))
    );
    await fs.mkdir(path.join(currentSettings.unifiedDir, destination), {
      recursive: true,
    });
    await courseRegistry.mergeInto({
      destinationSlug: destination,
      sourceSlugs: sources,
      name: b.name,
    });

    // Move tasks over so TODO lists stay unified.
    const placeholders = sources.map(() => "?").join(",");
    if (placeholders) {
      db.query(
        `UPDATE tasks SET course_slug = ? WHERE course_slug IN (${placeholders})`
      ).run(destination, ...sources);
      db.query(
        `UPDATE OR IGNORE calendar_schedules SET course_slug = ? WHERE course_slug IN (${placeholders})`
      ).run(destination, ...sources);
      db.query(
        `DELETE FROM calendar_schedules WHERE course_slug IN (${placeholders})`
      ).run(...sources);
      db.query(
        `UPDATE OR IGNORE calendar_events SET course_slug = ? WHERE course_slug IN (${placeholders})`
      ).run(destination, ...sources);
      db.query(
        `DELETE FROM calendar_events WHERE course_slug IN (${placeholders})`
      ).run(...sources);
    }
    return { ok: true, destinationSlug: destination };
  })
  .get("/api/artifacts/extracted", async ({ query }) => {
    const q = z
      .object({
        cache: z.enum(["transcripts", "pptx", "pdf"]),
        sha: z.string().min(10),
        maxChars: z.coerce.number().int().positive().optional(),
      })
      .parse(query);

    const p = path.join(config.stateDir, "cache", q.cache, `${q.sha}.txt`);
    let text: string;
    try {
      text = await fs.readFile(p, "utf8");
    } catch (e: unknown) {
      const code = (e as { code?: unknown })?.code;
      if (code === "ENOENT") {
        return new Response(JSON.stringify({ error: "EXTRACT_NOT_FOUND" }), {
          status: 404,
        });
      }
      throw e;
    }

    const maxChars = q.maxChars ?? 80_000;
    const truncated = text.length > maxChars;
    const out = truncated ? text.slice(0, maxChars) : text;
    return { ok: true, truncated, text: out };
  })
  .get("/api/auth/openai/status", async () =>
    OpenAiOAuthStatusSchema.parse(await openaiAuth.status())
  )
  .post("/api/auth/openai/start", async () => {
    const res = await openaiAuth.start();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: res.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return res;
  })
  .get("/api/auth/openai/callback", async ({ query }) => {
    const q = z.object({ code: z.string(), state: z.string() }).parse(query);
    const result = await openaiAuth.handleCallback({
      code: q.code,
      state: q.state,
    });
    if (!result.ok) {
      return new Response(
        `<html><body><h1>OpenAI Auth Failed</h1><pre>${escapeHtml(result.error)}</pre></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 400 }
      );
    }
    return new Response(
      "<html><body><h1>Connected</h1><p>OpenAI OAuth connected. You can close this tab.</p></body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  })
  .post("/api/auth/openai/disconnect", async () => {
    await openaiAuth.disconnect();
    return { ok: true };
  })
  .get(
    "/api/auth/openai/apikey/status",
    async () => await openaiAuth.apiKeyStatus()
  )
  .post("/api/auth/openai/apikey", async ({ body }) => {
    const b = z.object({ apiKey: z.string().min(1) }).parse(body);
    await openaiAuth.setApiKey(b.apiKey);
    return { ok: true };
  })
  .post("/api/auth/openai/apikey/clear", async () => {
    await openaiAuth.clearApiKey();
    return { ok: true };
  })
  .get("/api/watch", () => watcher.getState())
  .post("/api/watch/scan", async () => {
    await watcher.scanNow();
    return { ok: true };
  })
  .get("/api/jobs", ({ query }) => {
    const parsed = z
      .object({
        status: JobStatusSchema.optional(),
        type: JobTypeSchema.optional(),
        limit: z.coerce.number().int().optional(),
      })
      .parse(query);
    const list = queue.list({
      limit: parsed.limit ?? 200,
      status: parsed.status,
      jobType: parsed.type,
    });
    return { jobs: list };
  })
  .get("/api/jobs/stats", () => queue.stats())
  .post("/api/jobs/enqueue", ({ body }) => {
    const parsed = EnqueueJobRequestSchema.parse(body);
    const job = queue.enqueue({
      jobType: parsed.jobType,
      payload: parsed.payload,
      priority: parsed.priority,
    });
    logger.info("job.enqueued", { job_id: job.id, job_type: job.job_type });
    return { job };
  })
  .get("/api/settings", () => currentSettings)
  .post("/api/admin/reset", async ({ body }) => {
    const b = z
      .object({
        scope: z.enum(["state", "state+unified"]).default("state"),
        confirm: z.literal("RESET"),
        unifiedDir: z.string().optional(),
      })
      .parse(body);

    // Stop new work while we reset.
    const watcherWasRunning = watcher.getState().running;
    watcher.stop();
    runner.stop();

    // Wait briefly for any in-flight job to finish.
    const startedAt = Date.now();
    while (countRunningJobs() > 0 && Date.now() - startedAt < 10_000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (countRunningJobs() > 0) {
      if (watcherWasRunning) watcher.start();
      runner.start();
      return new Response(
        JSON.stringify({ error: "RESET_BUSY_RUNNING_JOBS" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Disable ingestion after reset by default (safer).
    const nextSettings = { ...currentSettings, ingestEnabled: false };
    await writeSettings(nextSettings);
    currentSettings = nextSettings;
    watcher.updateRoots(nextSettings.watchRoots);

    // Clear DB state (jobs/tasks/calendar).
    db.exec("DELETE FROM jobs;");
    db.exec("DELETE FROM tasks;");
    db.exec("DELETE FROM calendar_schedules;");
    db.exec("DELETE FROM calendar_events;");

    // Clear local caches/logs/revisions.
    await fs.rm(path.join(config.stateDir, "cache"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(config.stateDir, "logs"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(config.stateDir, "revisions"), {
      recursive: true,
      force: true,
    });

    // Optionally wipe the Unified library.
    let unifiedDeleted = 0;
    if (b.scope === "state+unified") {
      if (
        typeof b.unifiedDir !== "string" ||
        b.unifiedDir !== currentSettings.unifiedDir
      ) {
        return new Response(
          JSON.stringify({ error: "RESET_UNIFIED_DIR_MISMATCH" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const safe = looksSafeUnifiedDirForWipe(currentSettings.unifiedDir);
      if (!safe.ok) {
        return new Response(JSON.stringify({ error: safe.error }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      unifiedDeleted = await rmDirContents(currentSettings.unifiedDir);
    }

    watcher.resetSession();

    if (watcherWasRunning) watcher.start();
    runner.start();

    logger.warn("admin.reset", {
      scope: b.scope,
      unifiedDeleted,
      stateDir: config.stateDir,
      unifiedDir: currentSettings.unifiedDir,
    });

    return {
      ok: true,
      unifiedDeleted,
      ingestEnabled: currentSettings.ingestEnabled,
    };
  })
  .post("/api/settings", async ({ body }) => {
    const parsed = normalizeSettings(SettingsSchema.parse(body));
    await writeSettings(parsed);
    currentSettings = parsed;
    watcher.updateRoots(parsed.watchRoots);
    logger.info("settings.update", {
      unifiedDir: parsed.unifiedDir,
      watchRoots: parsed.watchRoots,
      ingestEnabled: parsed.ingestEnabled,
      llmProvider: parsed.llmProvider,
      llmMaxOutputTokens: parsed.llmMaxOutputTokens,
      openaiOAuthConfigured: Boolean(parsed.openaiOAuth?.clientId),
      codexModel: parsed.codexModel,
      codexEffort: parsed.codexEffort ?? null,
      openaiModel: parsed.openaiModel,
      openaiReasoningEffort: parsed.openaiReasoningEffort ?? null,
    });
    return { ok: true };
  })
  .get("/api/fs/list", async ({ query }) => {
    const parsed = z.object({ path: z.string().default("") }).parse(query);
    const res = await listDir({
      unifiedDir: currentSettings.unifiedDir,
      relPath: parsed.path,
    });
    if (!res.ok)
      return new Response(JSON.stringify({ error: res.error }), {
        status: res.status,
      });
    return res;
  })
  .get("/api/fs/read", async ({ query }) => {
    const parsed = z.object({ path: z.string() }).parse(query);
    const res = await readTextFile({
      unifiedDir: currentSettings.unifiedDir,
      relPath: parsed.path,
    });
    if (!res.ok)
      return new Response(JSON.stringify({ error: res.error }), {
        status: res.status,
      });
    return FsReadResponseSchema.parse(res);
  })
  .put("/api/fs/write", async ({ query, body }) => {
    const q = z.object({ path: z.string() }).parse(query);
    const b = FsWriteRequestSchema.parse(body);
    const res = await writeTextFile({
      unifiedDir: currentSettings.unifiedDir,
      stateDir: config.stateDir,
      relPath: q.path,
      content: b.content,
      expectedSha256: b.expectedSha256,
      logger,
    });
    if (!res.ok)
      return new Response(JSON.stringify({ error: res.error }), {
        status: res.status,
      });
    return res;
  })
  .get("/api/fs/revisions", async ({ query }) => {
    const q = z.object({ path: z.string() }).parse(query);
    const dir = getRevisionDir(config.stateDir, q.path);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).sort().reverse();
    } catch {
      files = [];
    }
    return {
      path: q.path,
      revisions: files.map((file) => ({
        file,
        savedAt: parseRevisionStamp(file) ?? null,
      })),
    };
  })
  .post("/api/fs/restore", async ({ body }) => {
    const b = FsSchemas.FsRestoreBody.parse(body);
    const dir = getRevisionDir(config.stateDir, b.path);
    if (b.revisionFile.includes("/") || b.revisionFile.includes("\\")) {
      return new Response(JSON.stringify({ error: "Invalid revisionFile" }), {
        status: 400,
      });
    }
    const src = path.join(dir, b.revisionFile);
    const content = await fs.readFile(src, "utf8");

    const res = await writeTextFile({
      unifiedDir: currentSettings.unifiedDir,
      stateDir: config.stateDir,
      relPath: b.path,
      content,
      expectedSha256: undefined,
      logger,
    });
    if (!res.ok)
      return new Response(JSON.stringify({ error: res.error }), {
        status: res.status,
      });
    logger.info("editor.restore", {
      path: b.path,
      revisionFile: b.revisionFile,
    });
    return res;
  });

app.listen(config.port);
logger.info("server.start", { port: config.port, stateDir: config.stateDir });
console.log(`SyllabusOps server listening on http://localhost:${config.port}`);

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
