import type { OpenAiStatus } from "./openai-types";

export type { OpenAiStatus } from "./openai-types";

async function http<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getOpenAiStatus(): Promise<OpenAiStatus> {
  return await http<OpenAiStatus>("/api/auth/openai/status");
}

export async function startOpenAiOAuth(): Promise<{
  ok: true;
  authUrl: string;
}> {
  return await http<{ ok: true; authUrl: string }>("/api/auth/openai/start", {
    method: "POST",
  });
}

export async function disconnectOpenAiOAuth(): Promise<{ ok: true }> {
  return await http<{ ok: true }>("/api/auth/openai/disconnect", {
    method: "POST",
  });
}

export async function setOpenAiApiKey(apiKey: string): Promise<{ ok: true }> {
  return await http<{ ok: true }>("/api/auth/openai/apikey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
}

export async function clearOpenAiApiKey(): Promise<{ ok: true }> {
  return await http<{ ok: true }>("/api/auth/openai/apikey/clear", {
    method: "POST",
  });
}
