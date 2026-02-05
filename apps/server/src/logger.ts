import fs from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  ts: string;
  level: LogLevel;
  event: string;
  msg?: string;
  data?: Record<string, unknown>;
};

type Subscriber = (evt: LogEvent) => void;

export class Logger {
  private readonly logsDir: string;
  private readonly buffer: LogEvent[] = [];
  private readonly maxBuffer: number;
  private readonly subscribers = new Set<Subscriber>();

  constructor(opts: { logsDir: string; maxBuffer?: number }) {
    this.logsDir = opts.logsDir;
    this.maxBuffer = opts.maxBuffer ?? 500;
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  getRecent(limit = 200): LogEvent[] {
    return this.buffer.slice(Math.max(0, this.buffer.length - limit));
  }

  debug(event: string, data?: LogEvent["data"], msg?: string) {
    void this.write({ level: "debug", event, data, msg });
  }

  info(event: string, data?: LogEvent["data"], msg?: string) {
    void this.write({ level: "info", event, data, msg });
  }

  warn(event: string, data?: LogEvent["data"], msg?: string) {
    void this.write({ level: "warn", event, data, msg });
  }

  error(event: string, data?: LogEvent["data"], msg?: string) {
    void this.write({ level: "error", event, data, msg });
  }

  private async write(partial: Omit<LogEvent, "ts">): Promise<void> {
    const evt: LogEvent = { ts: new Date().toISOString(), ...partial };
    this.buffer.push(evt);
    if (this.buffer.length > this.maxBuffer)
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);

    for (const sub of this.subscribers) sub(evt);

    await fs.mkdir(this.logsDir, { recursive: true });
    const fileName = `app-${evt.ts.slice(0, 10)}.jsonl`;
    const filePath = path.join(this.logsDir, fileName);
    await fs.appendFile(filePath, `${JSON.stringify(evt)}\n`, "utf8");
  }
}
