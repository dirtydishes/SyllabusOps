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

type TurnCompletedPayload = {
  turnId?: string;
  status?: string;
};

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

    const turnTextParts = new Map<string, string>();
    const completedAgentTexts: string[] = [];

    const unsub = rpc.subscribe((method, params) => {
      if (method === "item/agentMessage/delta") {
        const p = z
          .object({
            itemId: z.string().min(1),
            delta: z.object({ text: z.string().optional() }).passthrough(),
          })
          .safeParse(params);
        if (!p.success) return;
        const prev = turnTextParts.get(p.data.itemId) ?? "";
        const next = `${prev}${p.data.delta.text ?? ""}`;
        turnTextParts.set(p.data.itemId, next);
        return;
      }
      if (method === "item/completed") {
        const p = z
          .object({
            itemId: z.string().min(1),
            item: z
              .object({
                type: z.string(),
                text: z.string().optional(),
              })
              .passthrough(),
          })
          .safeParse(params);
        if (!p.success) return;
        if (p.data.item.type !== "agentMessage") return;
        const fromDelta = turnTextParts.get(p.data.itemId);
        const txt = (p.data.item.text ?? fromDelta ?? "").trim();
        if (txt) completedAgentTexts.push(txt);
        return;
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
        outputSchema: { name: input.schemaName, schema: input.schema },
        ...(input.effort ? { effort: input.effort } : {}),
      });

      const turnId = extractTurnId(turnStart);

      // Wait for turn completion.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Codex turn timed out."));
        }, 120_000);

        const unsub2 = rpc.subscribe((method, params) => {
          if (method !== "turn/completed") return;
          const p1 = z
            .object({ turnId: z.string().min(1) })
            .passthrough()
            .safeParse(params as TurnCompletedPayload);
          const completedId = p1.success
            ? p1.data.turnId
            : z
                .object({ turn: z.object({ id: z.string().min(1) }) })
                .passthrough()
                .safeParse(params).success
              ? z
                  .object({ turn: z.object({ id: z.string().min(1) }) })
                  .parse(params).turn.id
              : null;
          if (!completedId) return;
          if (completedId !== turnId) return;
          clearTimeout(timeout);
          unsub2();
          resolve();
        });
      });

      const text = completedAgentTexts.at(-1)?.trim();
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
