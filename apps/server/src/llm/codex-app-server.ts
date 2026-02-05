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

const AccountReadResultSchema = z.object({
  account: AccountSchema.nullable(),
  requiresOpenaiAuth: z.boolean(),
});

const LoginStartResultSchema = z.object({
  authUrl: z.string().url(),
});

const ThreadStartResultSchema = z.object({ threadId: z.string().min(1) });

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
      const thread = ThreadStartResultSchema.parse(
        await rpc.request("thread/start", { model: input.model })
      );

      const fullPrompt =
        `SYSTEM:\n${input.system.trim()}\n\n` +
        `USER:\n${input.user.trim()}\n`;

      const turn = await rpc.request("turn/start", {
        threadId: thread.threadId,
        input: [{ type: "text", text: fullPrompt }],
        outputSchema: { name: input.schemaName, schema: input.schema },
      });

      const turnId = z
        .object({ turnId: z.string().min(1) })
        .parse(turn).turnId;

      // Wait for turn completion.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Codex turn timed out."));
        }, 120_000);

        const unsub2 = rpc.subscribe((method, params) => {
          if (method !== "turn/completed") return;
          const p = z
            .object({ turnId: z.string().min(1) })
            .passthrough()
            .safeParse(params as TurnCompletedPayload);
          if (!p.success) return;
          if (p.data.turnId !== turnId) return;
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

  return { status, loginStartChatgpt, logout, jsonSchemaTurn };
}

