import type { Logger } from "../logger";
import type { JobQueue } from "./queue";
import type { JobRecord } from "./schemas";

export type JobRunner = {
  start: () => void;
  stop: () => void;
};

export function createJobRunner(opts: {
  queue: JobQueue;
  logger: Logger;
  runJob: (job: JobRecord) => Promise<"succeed" | "skip">;
  pollMs?: number;
}): JobRunner {
  const pollMs = opts.pollMs ?? 750;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const job = opts.queue.claimNext();
      if (!job) return;

      opts.logger.info("job.start", {
        job_id: job.id,
        job_type: job.job_type,
        attempts: job.attempts,
      });
      try {
        const disposition = await opts.runJob(job);
        if (disposition === "succeed") {
          opts.queue.succeed(job.id);
          opts.logger.info("job.succeeded", { job_id: job.id });
        } else {
          opts.logger.info("job.skipped", { job_id: job.id });
        }
      } catch (e: unknown) {
        const msg = String((e as Error)?.message ?? e);
        opts.queue.fail(job.id, msg);
        opts.logger.error("job.failed", { job_id: job.id, error: msg });
      }
    } finally {
      busy = false;
    }
  }

  return {
    start: () => {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, pollMs);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
