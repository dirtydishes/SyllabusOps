import type { NotionStatus } from "./notion-types";

export type { NotionStatus } from "./notion-types";

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

export async function getNotionStatus(): Promise<NotionStatus> {
  return await http<NotionStatus>("/api/auth/notion/status");
}

export async function setNotionToken(token: string): Promise<{ ok: true }> {
  return await http<{ ok: true }>("/api/auth/notion/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export async function clearNotionToken(): Promise<{ ok: true }> {
  return await http<{ ok: true }>("/api/auth/notion/token/clear", {
    method: "POST",
  });
}
