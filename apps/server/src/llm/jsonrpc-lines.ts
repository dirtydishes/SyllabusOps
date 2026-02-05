import type { Logger } from "../logger";

// Codex app-server uses JSON-RPC 2.0 semantics but omits the `jsonrpc` field.
type JsonRpcRequest = { id: number; method: string; params: unknown };
type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
  params?: unknown;
};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function parseJsonLine(line: string): JsonRpcResponse | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (!isObject(v)) return null;
    return v as JsonRpcResponse;
  } catch {
    return null;
  }
}

async function* readLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        yield line;
        idx = buf.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (buf.trim()) yield buf;
}

export class JsonRpcLineClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private writeToStdin: ((bytes: Uint8Array) => Promise<void>) | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly onNotify = new Set<
    (method: string, params: unknown) => void
  >();

  constructor(
    private readonly opts: {
      cmd: string[];
      logger: Logger;
      name: string;
    }
  ) {}

  subscribe(fn: (method: string, params: unknown) => void): () => void {
    this.onNotify.add(fn);
    return () => this.onNotify.delete(fn);
  }

  async start(): Promise<void> {
    if (this.proc && this.writeToStdin) return;
    if (this.proc && !this.writeToStdin) {
      // handle race where process exited and the exit handler cleared writer first
      this.proc = null;
    }

    try {
      this.proc = Bun.spawn(this.opts.cmd, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e: unknown) {
      throw new Error(
        `${this.opts.name} spawn failed: ${String((e as Error)?.message ?? e)}`
      );
    }

    if (!this.proc.stdin || !this.proc.stdout) {
      throw new Error(`${this.opts.name} missing stdio pipes.`);
    }

    const stdin: unknown = this.proc.stdin;
    if (stdin && typeof (stdin as { write?: unknown }).write === "function") {
      this.writeToStdin = async (bytes) => {
        // Bun FileSink / Node Writable-like
        (stdin as { write: (b: Uint8Array) => unknown }).write(bytes);
      };
    } else if (
      stdin &&
      typeof (stdin as { getWriter?: unknown }).getWriter === "function"
    ) {
      const writer = (stdin as WritableStream<Uint8Array>).getWriter();
      this.writeToStdin = async (bytes) => {
        await writer.write(bytes);
      };
    } else {
      throw new Error(`${this.opts.name} stdin is not writable.`);
    }

    void (async () => {
      if (!this.proc?.stdout) return;
      for await (const line of readLines(this.proc.stdout)) {
        const msg = parseJsonLine(line);
        if (!msg) continue;

        if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          if (msg.error) {
            const err = new Error(msg.error.message ?? "JSON-RPC error");
            p.reject(err);
          } else {
            p.resolve(msg.result);
          }
          continue;
        }

        if (typeof msg.method === "string") {
          for (const fn of this.onNotify) fn(msg.method, msg.params);
        }
      }
    })();

    void (async () => {
      if (!this.proc?.stderr) return;
      const reader = this.proc.stderr.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx = buf.indexOf("\n");
          while (idx >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line)
              this.opts.logger.warn(`${this.opts.name}.stderr`, { line });
            idx = buf.indexOf("\n");
          }
        }
      } finally {
        reader.releaseLock();
      }
      const tail = buf.trim();
      if (tail)
        this.opts.logger.warn(`${this.opts.name}.stderr`, { line: tail });
    })();

    void (async () => {
      const proc = this.proc;
      if (!proc) return;
      const code = await proc.exited;
      const err = new Error(`${this.opts.name} exited (${code})`);
      this.opts.logger.error(`${this.opts.name}.exit`, { code });
      for (const [id, p] of this.pending.entries()) {
        this.pending.delete(id);
        p.reject(err);
      }
      this.proc = null;
      this.writeToStdin = null;
    })();
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.start();
    if (!this.writeToStdin) throw new Error(`${this.opts.name} not started.`);
    const id = this.nextId++;
    const req: JsonRpcRequest = { id, method, params: params ?? {} };
    const line = `${JSON.stringify(req)}\n`;
    const bytes = new TextEncoder().encode(line);
    await this.writeToStdin(bytes);
    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.start();
    if (!this.writeToStdin) throw new Error(`${this.opts.name} not started.`);
    const msg = { method, params: params ?? {} };
    const line = `${JSON.stringify(msg)}\n`;
    const bytes = new TextEncoder().encode(line);
    await this.writeToStdin(bytes);
  }
}
