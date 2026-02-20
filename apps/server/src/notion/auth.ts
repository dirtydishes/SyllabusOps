import { z } from "zod";
import type { Logger } from "../logger";
import type { SecretStore } from "../secrets/keychain";

const NOTION_TOKEN_KEY = "notion.integration_token";

export const NotionAuthStatusSchema = z.object({
  ok: z.literal(true),
  tokenSet: z.boolean(),
  reachable: z.boolean(),
  workspaceName: z.string().nullable(),
  botName: z.string().nullable(),
  error: z.string().nullable(),
});

export type NotionAuthStatus = z.infer<typeof NotionAuthStatusSchema>;

export function parseNotionIdentity(payload: unknown): {
  workspaceName: string | null;
  botName: string | null;
} {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const botName = typeof root.name === "string" ? root.name : null;

  let workspaceName: string | null = null;
  const bot =
    root.bot && typeof root.bot === "object"
      ? (root.bot as Record<string, unknown>)
      : null;
  if (bot) {
    if (typeof bot.workspace_name === "string") {
      workspaceName = bot.workspace_name;
    }
    const owner =
      bot.owner && typeof bot.owner === "object"
        ? (bot.owner as Record<string, unknown>)
        : null;
    const workspace =
      owner?.workspace && typeof owner.workspace === "object"
        ? (owner.workspace as Record<string, unknown>)
        : null;
    if (workspace && typeof workspace.name === "string") {
      workspaceName = workspace.name;
    }
  }

  return { workspaceName, botName };
}

export function createNotionAuth(opts: {
  secrets: SecretStore;
  logger: Logger;
}) {
  async function getToken(): Promise<string | null> {
    return await opts.secrets.get(NOTION_TOKEN_KEY);
  }

  async function setToken(token: string): Promise<void> {
    const t = token.trim();
    if (!t) throw new Error("Notion token cannot be empty.");
    await opts.secrets.set(NOTION_TOKEN_KEY, t);
    opts.logger.info("notion.token.set");
  }

  async function clearToken(): Promise<void> {
    await opts.secrets.del(NOTION_TOKEN_KEY);
    opts.logger.info("notion.token.cleared");
  }

  return {
    getToken,
    setToken,
    clearToken,
  };
}
