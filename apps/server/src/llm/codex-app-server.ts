import { z } from "zod";
import type { Logger } from "../logger";
import { JsonRpcLineClient } from "./jsonrpc-lines";

const AccountSchema = z
  .object({
    email: z.string().optional(),
    username: z.string().optional(),
    plan: z.string().optional(),
  })
  .passthrough();

const AccountReadResultSchema = z
  .object({
    account: AccountSchema.nullable(),
    requiresOpenaiAuth: z.boolean(),
  })
  .passthrough();

const LoginStartResultSchema = z.object({
  authUrl: z.string().url(),
}).passthrough();

function extractThreadId(raw: unknown): string {
  const a = z
    .object({ threadId: z.string().min(1) })
    .passthrough()
    .safeParse(raw);
  if (a.success) return a.data.threadId;

  const b = z
    .object({ thread: z.object({ id: z.string().min(1) }).passthrough() })
    .passthrough()
    .safeParse(raw);
  if (b.success) return b.data.thread.id;

  const c = z
    .object({ thread: z.string().min(1) })
    .passthrough()
    .safeParse(raw);
  if (c.success) return c.data.thread;

  throw new Error("Unexpected thread/start response shape.");
}

function extractTurnId(raw: unknown): string {
  const a = z.object({ turnId: z.string().min(1) }).passthrough().safeParse(raw);
  if (a.success) return a.data.turnId;

  const b = z
    .object({ turn: z.object({ id: z.string().min(1) }).passthrough() })
    .passthrough()
    .safeParse(raw);
  if (b.success) return b.data.turn.id;

  const c = z.object({ id: z.string().min(1) }).passthrough().safeParse(raw);
  if (c.success) return c.data.id;

  throw new Error("Unexpected turn/start response shape.");
}

export type CodexStatus = {
  ok: true;
  available: boolean;
  requiresOpenaiAuth: boolean;
  connected: boolean;
  accountLabel: string | null;
  lastError: string | null;
};

function maybeCodexCmd(): string[] {
  const bin = process.env.SYLLABUSOPS_CODEX_BIN?.trim();
  return [bin || "codex", "app-server"];
}

export function createCodexAppServer(opts: { logger: Logger }) {
  const rpc = new JsonRpcLineClient({
    cmd: maybeCodexCmd(),
    logger: opts.logger,
    name: "codex.app_server",
  });

  let initialized = false;
  let lastError: string | null = null;

  async function ensureInitialized() {
    if (initialized) return;
    await rpc.start();
    await rpc.request("initialize", {
      clientInfo: { name: "syllabusops", version: "0.0.0-dev" },
    });
    await rpc.notify("initialized");
    initialized = true;
  }

  async function listModels(): Promise<{
    models: Array<{
      id: string;
      displayName?: string;
      description?: string;
      isDefault?: boolean;
      defaultReasoningEffort?: string;
      supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
    }>;
  }> {
    await ensureInitialized();
    const raw = await rpc.request("model/list", {});
    const parsed = z
      .object({
        data: z
          .array(
            z
              .object({
                id: z.string().min(1),
                displayName: z.string().optional(),
                description: z.string().optional(),
                isDefault: z.boolean().optional(),
                defaultReasoningEffort: z.string().optional(),
                supportedReasoningEfforts: z
                  .array(
                    z
                      .object({
                        reasoningEffort: z.string().min(1),
                        description: z.string().optional(),
                      })
                      .passthrough()
                  )
                  .optional(),
              })
              .passthrough()
          )
          .default([]),
      })
      .passthrough()
      .parse(raw);

    const models = parsed.data
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        description: m.description,
        isDefault: m.isDefault,
        defaultReasoningEffort: m.defaultReasoningEffort,
        supportedReasoningEfforts: m.supportedReasoningEfforts,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { models };
  }

  async function accountRead() {
    await ensureInitialized();
    const raw = await rpc.request("account/read");
    return AccountReadResultSchema.parse(raw);
  }

  async function status(): Promise<CodexStatus> {
    try {
      const r = await accountRead();
      lastError = null;
      const acct = r.account;
      const label =
        (acct?.email as string | undefined) ??
        (acct?.username as string | undefined) ??
        null;
      return {
        ok: true,
        available: true,
        requiresOpenaiAuth: r.requiresOpenaiAuth,
        connected: Boolean(r.account),
        accountLabel: label,
        lastError,
      };
    } catch (e: unknown) {
      lastError = String((e as Error)?.message ?? e);
      return {
        ok: true,
        available: false,
        requiresOpenaiAuth: true,
        connected: false,
        accountLabel: null,
        lastError,
      };
    }
  }

  async function loginStartChatgpt(): Promise<{ ok: true; authUrl: string } | { ok: false; error: string }> {
    try {
      await ensureInitialized();
      const raw = await rpc.request("account/login/start", { type: "chatgpt" });
      // codex app-server returns { type, authUrl, loginId, ... }
      const parsed = LoginStartResultSchema.parse(raw);
      return { ok: true, authUrl: parsed.authUrl };
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      lastError = msg;
      return { ok: false, error: msg };
    }
  }

  async function logout(): Promise<void> {
    await ensureInitialized();
    try {
      await rpc.request("account/logout");
      lastError = null;
    } catch (e: unknown) {
      lastError = String((e as Error)?.message ?? e);
      throw e;
    }
  }

  async function jsonSchemaTurn<T>(input: {
    model: string;
    effort?: string;
    system: string;
    user: string;
    schema: unknown; // JSON schema
    schemaName: string;
  }): Promise<T> {
    await ensureInitialized();

    const itemTextParts = new Map<string, string>();
    const completedAssistantTexts: string[] = [];
    let completed: { ok: true } | { ok: false; error: string } | null = null;

    function appendDelta(itemId: string, text: string) {
      const prev = itemTextParts.get(itemId) ?? "";
      itemTextParts.set(itemId, `${prev}${text}`);
    }

    function extractItemText(item: unknown): string {
      const parsed = z
        .object({
          id: z.string().min(1),
          type: z.string().min(1),
          content: z
            .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
            .optional(),
          text: z.string().optional(),
        })
        .passthrough()
        .safeParse(item);
      if (!parsed.success) return "";

      const fromContent =
        parsed.data.content
          ?.map((c) => (typeof c.text === "string" ? c.text : ""))
          .filter(Boolean)
          .join("\n") ?? "";
      const fromDelta = itemTextParts.get(parsed.data.id) ?? "";
      const fromText = parsed.data.text ?? "";
      return `${fromContent || fromText || fromDelta}`.trim();
    }

    const unsub = rpc.subscribe((method, params) => {
      if (method === "item/delta") {
        const p = z
          .object({
            itemId: z.string().min(1).optional(),
            item: z.object({ id: z.string().min(1) }).passthrough().optional(),
            delta: z.object({ text: z.string().optional() }).passthrough().optional(),
          })
          .passthrough()
          .safeParse(params);
        if (!p.success) return;
        const id = p.data.itemId ?? p.data.item?.id;
        const text = p.data.delta?.text;
        if (id && typeof text === "string") appendDelta(id, text);
        return;
      }

      if (method === "item/completed") {
        const p = z
          .object({
            item: z.object({ id: z.string().min(1), type: z.string().min(1) }).passthrough(),
          })
          .passthrough()
          .safeParse(params);
        if (!p.success) return;
        const t = p.data.item.type.toLowerCase();
        if (!t.includes("assistant")) return;
        const txt = extractItemText(p.data.item);
        if (txt) completedAssistantTexts.push(txt);
        return;
      }

      if (method === "turn/completed") {
        const p = z
          .object({
            turn: z
              .object({
                id: z.string().min(1),
                status: z.string().min(1),
                error: z
                  .object({
                    message: z.string().optional(),
                    additionalDetails: z.string().nullable().optional(),
                  })
                  .passthrough()
                  .nullable()
                  .optional(),
              })
              .passthrough(),
          })
          .passthrough()
          .safeParse(params);
        if (!p.success) return;
        const status = p.data.turn.status.toLowerCase();
        if (status === "failed") {
          const msg =
            p.data.turn.error?.message ??
            p.data.turn.error?.additionalDetails ??
            "Codex turn failed.";
          completed = { ok: false, error: msg };
        } else {
          completed = { ok: true };
        }
      }
    });

    try {
      const threadStart = await rpc.request("thread/start", { model: input.model });
      const threadId = extractThreadId(threadStart);

      const fullPrompt =
        `SYSTEM:\n${input.system.trim()}\n\n` +
        `USER:\n${input.user.trim()}\n`;

      const turnStart = await rpc.request("turn/start", {
        threadId,
        input: [{ type: "text", text: fullPrompt }],
        // Codex app-server expects the JSON Schema object directly here (it uses
        // an internal name like `codex_output_schema` when forwarding).
        outputSchema: input.schema,
        ...(input.effort ? { effort: input.effort } : {}),
      });

      const turnId = extractTurnId(turnStart);

      // Wait for turn completion.
      const startedAt = Date.now();
      while (!completed && Date.now() - startedAt < 120_000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!completed) throw new Error("Codex turn timed out.");
      if (!completed.ok) throw new Error(completed.error);

      const text = completedAssistantTexts.at(-1)?.trim();
      if (!text) throw new Error("Codex returned no agentMessage text.");

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Codex agentMessage was not valid JSON.");
      }
      return z.any().parse(json) as T;
    } finally {
      unsub();
    }
  }

  return { status, loginStartChatgpt, logout, listModels, jsonSchemaTurn };
}
