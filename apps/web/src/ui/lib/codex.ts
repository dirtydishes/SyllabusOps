import type { CodexStatus } from "./codex-types";

export type { CodexStatus } from "./codex-types";

async function http<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getCodexStatus(): Promise<CodexStatus> {
  return await http<CodexStatus>("/api/auth/codex/status");
}

export async function startCodexChatgptLogin(): Promise<{ ok: true; authUrl: string }> {
  return await http<{ ok: true; authUrl: string }>("/api/auth/codex/start", {
    method: "POST",
  });
}

export async function codexLogout(): Promise<{ ok: true }> {
  return await http<{ ok: true }>("/api/auth/codex/logout", { method: "POST" });
}

