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
import { loadConfig } from "./config";
import { openDb } from "./db";
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
import { EnqueueJobRequestSchema, JobStatusSchema } from "./jobs/schemas";
import { Logger } from "./logger";
import { SseHub } from "./sse";
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
  };
}

async function writeSettings(next: Settings): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(next, null, 2), "utf8");
}

let currentSettings = await readSettings();

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
  .get("/api/watch", () => watcher.getState())
  .post("/api/watch/scan", async () => {
    await watcher.scanNow();
    return { ok: true };
  })
  .get("/api/jobs", ({ query }) => {
    const parsed = z
      .object({
        status: JobStatusSchema.optional(),
        limit: z.coerce.number().int().optional(),
      })
      .parse(query);
    const list = queue.list({
      limit: parsed.limit ?? 200,
      status: parsed.status,
    });
    return { jobs: list };
  })
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
