import fs from "node:fs/promises";
import path from "node:path";
import { cors } from "@elysiajs/cors";
import {
  ApiStatusSchema,
  FsReadResponseSchema,
  FsWriteRequestSchema,
} from "@syllabusops/core";
import { Elysia } from "elysia";
import { z } from "zod";
import {
  OpenAiOAuthConfigSchema,
  OpenAiOAuthStatusSchema,
  createOpenAiAuth,
} from "./auth/openai";
import { loadConfig } from "./config";
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
import { EnqueueJobRequestSchema, JobStatusSchema, JobTypeSchema } from "./jobs/schemas";
import { scanCourseDetail, scanCourses, scanSession } from "./library/library";
import { createCodexAppServer } from "./llm/codex-app-server";
import { openAiJsonSchema } from "./llm/openai-responses";
import { Logger } from "./logger";
import { keychainStore } from "./secrets/keychain";
import { SseHub } from "./sse";
import { createTasksStore } from "./tasks/store";
import { createWatcher } from "./watcher/watcher";

const config = loadConfig();

await fs.mkdir(config.stateDir, { recursive: true });
const logger = new Logger({ logsDir: path.join(config.stateDir, "logs") });
const sse = new SseHub();
const db = await openDb({ stateDir: config.stateDir });
const queue = createJobQueue(db);

logger.subscribe((evt) => sse.broadcast({ type: "log", payload: evt }));

const SettingsSchema = z.object({
  unifiedDir: z.string().min(1),
  watchRoots: z.array(z.string()).default([]),
  ingestEnabled: z.boolean().default(false),
  llmProvider: z.enum(["openai", "codex"]).default("openai"),
  llmMaxOutputTokens: z.number().int().min(256).max(8000).default(1200),
  openaiOAuth: OpenAiOAuthConfigSchema.optional(),
  openaiApiBaseUrl: z.string().url().default("https://api.openai.com/v1"),
  openaiModel: z.string().min(1).default("gpt-4o-mini"),
  openaiReasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  codexModel: z.string().min(1).default("gpt-5.1-codex"),
  codexEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
});
type Settings = z.infer<typeof SettingsSchema>;

const settingsPath = path.join(config.stateDir, "settings.json");

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // ignore
  }
  return {
    unifiedDir: config.unifiedDir,
    watchRoots: config.watchRoots,
    ingestEnabled: false,
    llmProvider: "openai",
    llmMaxOutputTokens: 1200,
    openaiOAuth: undefined,
    openaiApiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "gpt-4o-mini",
    openaiReasoningEffort: undefined,
    codexModel: "gpt-5.1-codex",
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
        };
        const sourcePath =
          typeof payload.sourcePath === "string" ? payload.sourcePath : null;
        if (!sourcePath)
          throw new Error("Invalid ingest_file payload: sourcePath required.");

        const res = await ingestFile({
          sourcePath,
          unifiedDir: currentSettings.unifiedDir,
          pipelineVersion: "0.0.0-dev",
          logger,
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
        logger.info("extract.pdf.cached", {
          canonicalPath,
          sha256,
          textPath: out.textPath,
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

        const scanned = await scanSession({
          unifiedDir: currentSettings.unifiedDir,
          stateDir: config.stateDir,
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
          logger.warn("job.blocked", { job_id: job.id, reason: "NO_EXTRACTED_TEXT" });
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
          "If no tasks are present, return {\"tasks\": []}.";

        const user =
          `Course: ${scanned.course.name} (${courseSlug})\n` +
          `Session date: ${sessionDate}\n\n` +
          contextParts.join("\n");

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
            logger.warn("job.blocked", { job_id: job.id, reason: "CODEX_UNAVAILABLE" });
            return "skip";
          }
          if (st.requiresOpenaiAuth && !st.connected) {
            queue.block(job.id, "CODEX_AUTH_REQUIRED");
            logger.warn("job.blocked", { job_id: job.id, reason: "CODEX_AUTH_REQUIRED" });
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
            courseSlug,
            sessionDate,
            artifactSha: null,
            title: t.title,
            description: t.description ?? "",
            due: t.due ?? null,
            confidence: t.confidence ?? 0.5,
          }))
        );

        logger.info("tasks.suggested", {
          courseSlug,
          sessionDate,
          inserted: inserted.inserted,
        });

        return "succeed";
      }
    }
  },
});
runner.start();

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
      return new Response(JSON.stringify({ error: "CODEX_MODELS_FAILED", detail: msg }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
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
        JSON.stringify({ error: `OPENAI_MODELS_FAILED: ${res.status}`, detail: text.slice(0, 400) }),
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
      data: z.array(z.object({ id: z.string().min(1) }).passthrough()).default([]),
    });
    const models = ModelsSchema.parse(parsed).data.map((m) => m.id).sort((a, b) => a.localeCompare(b));
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
  .get("/api/tasks", ({ query }) => {
    const q = z
      .object({
        courseSlug: z.string().min(1),
        sessionDate: z.string().optional(),
        status: z.enum(["suggested", "approved", "done", "dismissed"]).optional(),
        limit: z.coerce.number().int().positive().optional(),
      })
      .parse(query);
    const tasksStore = createTasksStore(db);
    const tasks = tasksStore.list({
      courseSlug: q.courseSlug,
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
    courses: await scanCourses({
      unifiedDir: currentSettings.unifiedDir,
      stateDir: config.stateDir,
    }),
  }))
  .get("/api/courses/:courseSlug", async ({ params }) => {
    const courseSlug = z
      .object({ courseSlug: z.string().min(1) })
      .parse(params).courseSlug;
    const res = await scanCourseDetail({
      unifiedDir: currentSettings.unifiedDir,
      stateDir: config.stateDir,
      courseSlug,
      limitSessions: 0,
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: res.error }), { status: 404 });
    }

    return {
      course: res.course,
      sessions: res.sessions.map((s) => ({
        date: s.date,
        artifacts: s.artifacts,
        generated: {
          sessionSummaryPath: `${courseSlug}/generated/sessions/${s.date}/session-summary.md`,
          sessionNotesPath: `${courseSlug}/notes/sessions/${s.date}/notes.md`,
        },
      })),
    };
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
  .post("/api/settings", async ({ body }) => {
    const parsed = SettingsSchema.parse(body);
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
