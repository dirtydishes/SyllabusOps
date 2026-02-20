import type { Logger } from "../logger";

export type NotionRichText = {
  type: "text";
  text: { content: string };
};

export type NotionBlockInput =
  | {
      object: "block";
      type: "paragraph";
      paragraph: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "heading_1";
      heading_1: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "heading_2";
      heading_2: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "heading_3";
      heading_3: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "bulleted_list_item";
      bulleted_list_item: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "to_do";
      to_do: { rich_text: NotionRichText[]; checked: boolean };
    }
  | {
      object: "block";
      type: "quote";
      quote: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "toggle";
      toggle: { rich_text: NotionRichText[] };
    };

export class NotionApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(opts: { status: number; retryable: boolean; message: string }) {
    super(opts.message);
    this.name = "NotionApiError";
    this.status = opts.status;
    this.retryable = opts.retryable;
  }
}

export function isRetryableNotionStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const s = Number(retryAfter);
    if (Number.isFinite(s) && s > 0) return Math.max(200, s * 1000);
  }
  return Math.min(500 * 2 ** attempt, 10_000);
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 10_000);
}

function textValue(content: string): NotionRichText[] {
  return [{ type: "text", text: { content } }];
}

export function normalizeNotionId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  let candidate = trimmed;
  try {
    const u = new URL(trimmed);
    candidate = u.pathname.split("/").filter(Boolean).at(-1) ?? trimmed;
  } catch {
    // keep as-is
  }
  candidate = candidate.split("?")[0]?.split("#")[0] ?? candidate;

  const dashedMatch = candidate.match(
    /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
  );
  if (dashedMatch?.[1]) return dashedMatch[1].toLowerCase();

  const compactMatch = candidate.match(/([0-9a-fA-F]{32})/);
  if (compactMatch?.[1]) {
    const h = compactMatch[1].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  return trimmed;
}

export function createNotionClient(opts: {
  getToken: () => Promise<string | null>;
  getApiVersion: () => string;
  fetchFn?: typeof fetch;
  minDelayMs?: number;
  maxRetries?: number;
  logger?: Logger;
}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const minDelayMs = opts.minDelayMs ?? 280;
  const maxRetries = opts.maxRetries ?? 4;
  let lastRequestAtMs = 0;

  async function pace(): Promise<void> {
    const now = Date.now();
    const waitMs = minDelayMs - (now - lastRequestAtMs);
    if (waitMs > 0) await delay(waitMs);
    lastRequestAtMs = Date.now();
  }

  async function requestJson<T>(input: {
    method: "GET" | "POST" | "PATCH";
    path: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
  }): Promise<T> {
    const token = await opts.getToken();
    if (!token) {
      throw new NotionApiError({
        status: 401,
        retryable: false,
        message: "NOTION_TOKEN_REQUIRED",
      });
    }

    const base = new URL(`https://api.notion.com/v1${input.path}`);
    for (const [k, v] of Object.entries(input.query ?? {})) {
      if (typeof v === "string" && v.length) base.searchParams.set(k, v);
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await pace();

      let res: Response;
      try {
        res = await fetchFn(base, {
          method: input.method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": opts.getApiVersion(),
            "Content-Type": "application/json",
          },
          body:
            input.body === undefined ? undefined : JSON.stringify(input.body),
        });
      } catch (e: unknown) {
        if (attempt < maxRetries) {
          await delay(backoffMs(attempt));
          continue;
        }
        throw new NotionApiError({
          status: 0,
          retryable: true,
          message: `NOTION_NETWORK_ERROR: ${String((e as Error)?.message ?? e)}`,
        });
      }

      const text = await res.text();
      if (res.ok) {
        if (!text.trim()) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new NotionApiError({
            status: res.status,
            retryable: false,
            message: "NOTION_NON_JSON_RESPONSE",
          });
        }
      }

      const retryable = isRetryableNotionStatus(res.status);
      if (retryable && attempt < maxRetries) {
        await delay(retryDelayMs(res, attempt));
        continue;
      }

      const message = `NOTION_HTTP_${res.status}: ${text.slice(0, 500)}`;
      opts.logger?.warn("notion.http.error", {
        status: res.status,
        retryable,
        path: input.path,
      });
      throw new NotionApiError({
        status: res.status,
        retryable,
        message,
      });
    }

    throw new NotionApiError({
      status: 0,
      retryable: true,
      message: "NOTION_RETRY_EXHAUSTED",
    });
  }

  return {
    async usersMe(): Promise<unknown> {
      return await requestJson<unknown>({ method: "GET", path: "/users/me" });
    },

    async createPage(optsIn: {
      parentPageId: string;
      title: string;
    }): Promise<{ id: string }> {
      const parentPageId = normalizeNotionId(optsIn.parentPageId);
      const title = optsIn.title.trim();
      if (!parentPageId) throw new Error("NOTION_ROOT_PAGE_REQUIRED");
      if (!title) throw new Error("NOTION_PAGE_TITLE_REQUIRED");

      const res = await requestJson<{ id?: unknown }>({
        method: "POST",
        path: "/pages",
        body: {
          parent: { page_id: parentPageId },
          properties: {
            title: {
              title: textValue(title),
            },
          },
        },
      });
      if (!res || typeof res.id !== "string" || !res.id.trim()) {
        throw new Error("NOTION_CREATE_PAGE_INVALID_RESPONSE");
      }
      return { id: res.id };
    },

    async listBlockChildren(blockId: string): Promise<Array<{ id: string }>> {
      const out: Array<{ id: string }> = [];
      const normalized = normalizeNotionId(blockId);
      let nextCursor: string | undefined;
      while (true) {
        const res = await requestJson<{
          results?: unknown;
          has_more?: unknown;
          next_cursor?: unknown;
        }>({
          method: "GET",
          path: `/blocks/${normalized}/children`,
          query: {
            page_size: "100",
            start_cursor: nextCursor,
          },
        });

        const rows = Array.isArray(res.results) ? res.results : [];
        for (const row of rows) {
          const id =
            row && typeof row === "object"
              ? (row as { id?: unknown }).id
              : undefined;
          if (typeof id === "string" && id.trim()) out.push({ id });
        }

        if (res.has_more !== true) break;
        if (typeof res.next_cursor !== "string" || !res.next_cursor) break;
        nextCursor = res.next_cursor;
      }
      return out;
    },

    async appendBlockChildren(optsIn: {
      blockId: string;
      children: NotionBlockInput[];
      chunkSize?: number;
    }): Promise<string[]> {
      if (optsIn.children.length === 0) return [];
      const blockId = normalizeNotionId(optsIn.blockId);
      const chunkSize = Math.max(1, Math.min(50, optsIn.chunkSize ?? 50));
      const ids: string[] = [];

      for (let i = 0; i < optsIn.children.length; i += chunkSize) {
        const chunk = optsIn.children.slice(i, i + chunkSize);
        const res = await requestJson<{ results?: unknown }>({
          method: "PATCH",
          path: `/blocks/${blockId}/children`,
          body: { children: chunk },
        });
        const rows = Array.isArray(res.results) ? res.results : [];
        for (const row of rows) {
          const id =
            row && typeof row === "object"
              ? (row as { id?: unknown }).id
              : undefined;
          if (typeof id === "string" && id.trim()) ids.push(id);
        }
      }

      return ids;
    },

    async archiveBlock(blockId: string): Promise<void> {
      const normalized = normalizeNotionId(blockId);
      await requestJson<unknown>({
        method: "PATCH",
        path: `/blocks/${normalized}`,
        body: { archived: true },
      });
    },

    textValue,
  };
}

export type NotionClient = ReturnType<typeof createNotionClient>;
