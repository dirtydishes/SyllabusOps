import crypto from "node:crypto";
import { z } from "zod";
import type { Logger } from "../logger";
import type { SecretStore } from "../secrets/keychain";

export const OpenAiOAuthConfigSchema = z.object({
  clientId: z.string().min(1),
  authorizeUrl: z.string().url(),
  tokenUrl: z.string().url(),
  redirectUri: z.string().url(),
  scopes: z.string().min(1),
});
export type OpenAiOAuthConfig = z.infer<typeof OpenAiOAuthConfigSchema>;

export const OpenAiOAuthStatusSchema = z.object({
  ok: z.literal(true),
  configured: z.boolean(),
  oauthConnected: z.boolean(),
  apiKeySet: z.boolean(),
  mode: z.enum(["oauth", "api_key", "none"]),
  lastError: z.string().nullable(),
});
export type OpenAiOAuthStatus = z.infer<typeof OpenAiOAuthStatusSchema>;

type PendingAuth = { codeVerifier: string; createdAtMs: number };

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

const OPENAI_REFRESH_TOKEN_KEY = "openai.refresh_token";
const OPENAI_ACCESS_TOKEN_KEY = "openai.access_token";
const OPENAI_ACCESS_TOKEN_EXP_KEY = "openai.access_token_expires_at";
const OPENAI_API_KEY_KEY = "openai.api_key";

function base64Url(input: Uint8Array): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomUrlSafeString(bytes = 32): string {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256Base64Url(s: string): string {
  const digest = crypto.createHash("sha256").update(s).digest();
  return base64Url(digest);
}

function formBody(obj: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) params.set(k, v);
  return params.toString();
}

export function createOpenAiAuth(opts: {
  getConfig: () => OpenAiOAuthConfig | null;
  secrets: SecretStore;
  logger: Logger;
  now: () => Date;
}) {
  const pending = new Map<string, PendingAuth>();
  let lastError: string | null = null;

  async function apiKeyStatus() {
    const apiKey = await opts.secrets.get(OPENAI_API_KEY_KEY);
    return { ok: true, set: Boolean(apiKey) };
  }

  async function status(): Promise<OpenAiOAuthStatus> {
    const cfg = opts.getConfig();
    const refresh = await opts.secrets.get(OPENAI_REFRESH_TOKEN_KEY);
    const apiKey = await opts.secrets.get(OPENAI_API_KEY_KEY);
    const oauthConnected = Boolean(cfg && refresh);
    const mode = oauthConnected ? "oauth" : apiKey ? "api_key" : "none";
    return {
      ok: true,
      configured: Boolean(cfg),
      oauthConnected,
      apiKeySet: Boolean(apiKey),
      mode,
      lastError,
    };
  }

  async function start() {
    const cfg = opts.getConfig();
    if (!cfg)
      return { ok: false as const, error: "OPENAI_OAUTH_NOT_CONFIGURED" };

    const state = randomUrlSafeString(16);
    const codeVerifier = randomUrlSafeString(32);
    const codeChallenge = sha256Base64Url(codeVerifier);
    pending.set(state, { codeVerifier, createdAtMs: Date.now() });

    // prune old
    for (const [k, v] of pending.entries()) {
      if (Date.now() - v.createdAtMs > 10 * 60 * 1000) pending.delete(k);
    }

    const url = new URL(cfg.authorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("scope", cfg.scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "consent");

    opts.logger.info("openai.oauth.start", { authorizeUrl: cfg.authorizeUrl });
    return { ok: true as const, authUrl: url.toString() };
  }

  async function tokenRequest(
    cfg: OpenAiOAuthConfig,
    body: Record<string, string>
  ): Promise<TokenResponse> {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Token exchange failed: ${res.status} ${text.slice(0, 400)}`
      );
    }

    try {
      return JSON.parse(text) as TokenResponse;
    } catch {
      throw new Error("Token response was not JSON.");
    }
  }

  async function getAuthHeaders(): Promise<{ Authorization: string }> {
    const cfg = opts.getConfig();
    const refresh = await opts.secrets.get(OPENAI_REFRESH_TOKEN_KEY);
    const apiKey = await opts.secrets.get(OPENAI_API_KEY_KEY);

    if (cfg && refresh) {
      const access = await opts.secrets.get(OPENAI_ACCESS_TOKEN_KEY);
      const expRaw = await opts.secrets.get(OPENAI_ACCESS_TOKEN_EXP_KEY);
      const expMs = expRaw ? Number(expRaw) : 0;

      if (access && expMs && Date.now() < expMs - 60_000) {
        return { Authorization: `Bearer ${access}` };
      }

      const token = await tokenRequest(cfg, {
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: cfg.clientId,
      });

      if (token.refresh_token) {
        await opts.secrets.set(OPENAI_REFRESH_TOKEN_KEY, token.refresh_token);
      }
      if (!token.access_token)
        throw new Error("Refresh did not return access_token.");

      await opts.secrets.set(OPENAI_ACCESS_TOKEN_KEY, token.access_token);
      const exp = token.expires_in
        ? Date.now() + token.expires_in * 1000
        : Date.now() + 10 * 60 * 1000;
      await opts.secrets.set(OPENAI_ACCESS_TOKEN_EXP_KEY, String(exp));

      return { Authorization: `Bearer ${token.access_token}` };
    }

    if (apiKey) return { Authorization: `Bearer ${apiKey}` };
    throw new Error("No OpenAI auth configured (OAuth or API key required).");
  }

  async function handleCallback(input: { code: string; state: string }) {
    const cfg = opts.getConfig();
    if (!cfg)
      return { ok: false as const, error: "OPENAI_OAUTH_NOT_CONFIGURED" };

    const pendingAuth = pending.get(input.state);
    if (!pendingAuth)
      return { ok: false as const, error: "Invalid or expired state." };
    pending.delete(input.state);

    try {
      const token = await tokenRequest(cfg, {
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
        code_verifier: pendingAuth.codeVerifier,
      });

      if (!token.refresh_token) {
        opts.logger.warn("openai.oauth.missing_refresh_token");
      }

      if (token.refresh_token) {
        await opts.secrets.set(OPENAI_REFRESH_TOKEN_KEY, token.refresh_token);
      }
      if (token.access_token) {
        await opts.secrets.set(OPENAI_ACCESS_TOKEN_KEY, token.access_token);
        const exp = token.expires_in
          ? Date.now() + token.expires_in * 1000
          : Date.now() + 10 * 60 * 1000;
        await opts.secrets.set(OPENAI_ACCESS_TOKEN_EXP_KEY, String(exp));
      }

      lastError = null;
      opts.logger.info("openai.oauth.connected", {
        hasRefresh: Boolean(token.refresh_token),
      });
      return { ok: true as const };
    } catch (e: unknown) {
      lastError = String((e as Error)?.message ?? e);
      opts.logger.error("openai.oauth.callback_failed", { error: lastError });
      return { ok: false as const, error: lastError };
    }
  }

  async function disconnect() {
    await opts.secrets.del(OPENAI_REFRESH_TOKEN_KEY);
    await opts.secrets.del(OPENAI_ACCESS_TOKEN_KEY);
    await opts.secrets.del(OPENAI_ACCESS_TOKEN_EXP_KEY);
    lastError = null;
    opts.logger.info("openai.oauth.disconnected");
  }

  async function setApiKey(apiKey: string) {
    await opts.secrets.set(OPENAI_API_KEY_KEY, apiKey.trim());
    opts.logger.info("openai.apikey.set");
  }

  async function clearApiKey() {
    await opts.secrets.del(OPENAI_API_KEY_KEY);
    opts.logger.info("openai.apikey.cleared");
  }

  return {
    status,
    start,
    handleCallback,
    disconnect,
    apiKeyStatus,
    setApiKey,
    clearApiKey,
    getAuthHeaders,
  };
}
