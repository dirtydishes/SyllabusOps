import type { JobQueue } from "../jobs/queue";
import type { Logger } from "../logger";
import { scanOnce } from "./scan";
import { StabilityGate } from "./stability";

export type WatcherConfig = {
  roots: string[];
  stableWindowMs: number;
  scanIntervalMs: number;
};

export type WatcherState = {
  running: boolean;
  roots: string[];
  lastScanAt: string | null;
  lastScanFileCount: number;
  enqueuedTotal: number;
};

export type Watcher = {
  start: () => void;
  stop: () => void;
  updateRoots: (roots: string[]) => void;
  scanNow: () => Promise<void>;
  getState: () => WatcherState;
};

const DEFAULT_ALLOWED_EXTS = new Set([".vtt", ".txt", ".md", ".pptx", ".pdf"]);

export function createWatcher(opts: {
  config: WatcherConfig;
  queue: JobQueue;
  logger: Logger;
  shouldEnqueue: () => boolean;
}): Watcher {
  const gate = new StabilityGate({
    stableWindowMs: opts.config.stableWindowMs,
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let roots = [...opts.config.roots];
  let lastScanAt: string | null = null;
  let lastScanFileCount = 0;
  let enqueuedTotal = 0;
  let scanInFlight = false;

  // For now we only de-dupe within a single server session.
  const enqueued = new Set<string>();

  async function doScan() {
    if (scanInFlight) return;
    scanInFlight = true;
    try {
      const files = await scanOnce({
        roots,
        allowedExtensions: DEFAULT_ALLOWED_EXTS,
      });

      lastScanAt = new Date().toISOString();
      lastScanFileCount = files.length;

      const nowMs = Date.now();
      let stableCount = 0;
      for (const f of files) {
        const isStable = gate.observe(f.absolutePath, f.stat, nowMs);
        if (!isStable) continue;
        stableCount++;
        if (!opts.shouldEnqueue()) continue;
        if (enqueued.has(f.absolutePath)) continue;
        enqueued.add(f.absolutePath);
        enqueuedTotal++;
        opts.queue.enqueue({
          jobType: "ingest_file",
          priority: 2,
          payload: { sourcePath: f.absolutePath, detectedAt: lastScanAt },
        });
      }

      const pruned = gate.forgetOlderThan({ idleMs: 60 * 60 * 1000 }, nowMs);
      opts.logger.info("watch.scan", {
        rootsCount: roots.length,
        files: files.length,
        stable: stableCount,
        enqueued: enqueuedTotal,
        pruned,
      });
    } catch (e: unknown) {
      opts.logger.error("watch.scan_failed", {
        error: String((e as Error)?.message ?? e),
      });
    } finally {
      scanInFlight = false;
    }
  }

  return {
    start: () => {
      if (running) return;
      running = true;
      void doScan();
      timer = setInterval(() => {
        void doScan();
      }, opts.config.scanIntervalMs);
      opts.logger.info("watch.start", { rootsCount: roots.length });
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
      running = false;
      opts.logger.info("watch.stop");
    },
    updateRoots: (nextRoots: string[]) => {
      roots = [...nextRoots];
      opts.logger.info("watch.update_roots", { rootsCount: roots.length });
    },
    scanNow: async () => {
      await doScan();
    },
    getState: () => ({
      running,
      roots,
      lastScanAt,
      lastScanFileCount,
      enqueuedTotal,
    }),
  };
}
