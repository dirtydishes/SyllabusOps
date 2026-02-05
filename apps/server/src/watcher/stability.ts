export type StabilityObservation = {
  size: number;
  mtimeMs: number;
};

type FileState = {
  last: StabilityObservation;
  lastSeenAtMs: number;
  stableSinceMs: number;
};

export class StabilityGate {
  private readonly stableWindowMs: number;
  private readonly states = new Map<string, FileState>();

  constructor(opts: { stableWindowMs: number }) {
    this.stableWindowMs = opts.stableWindowMs;
  }

  observe(
    filePath: string,
    obs: StabilityObservation,
    nowMs = Date.now()
  ): boolean {
    const existing = this.states.get(filePath);
    if (!existing) {
      this.states.set(filePath, {
        last: obs,
        lastSeenAtMs: nowMs,
        stableSinceMs: nowMs,
      });
      return false;
    }

    existing.lastSeenAtMs = nowMs;
    const changed =
      existing.last.size !== obs.size || existing.last.mtimeMs !== obs.mtimeMs;
    if (changed) {
      existing.last = obs;
      existing.stableSinceMs = nowMs;
      return false;
    }

    return nowMs - existing.stableSinceMs >= this.stableWindowMs;
  }

  forgetOlderThan(opts: { idleMs: number }, nowMs = Date.now()): number {
    let removed = 0;
    for (const [k, v] of this.states.entries()) {
      if (nowMs - v.lastSeenAtMs > opts.idleMs) {
        this.states.delete(k);
        removed++;
      }
    }
    return removed;
  }
}
