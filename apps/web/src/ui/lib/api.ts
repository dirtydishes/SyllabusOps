export type ApiStatus = {
  ok: true;
  version: string;
  now: string;
  stateDir: string;
  unifiedDir: string;
};

export type Settings = {
  unifiedDir: string;
  watchRoots: string[];
  ingestEnabled: boolean;
  openaiOAuth?: {
    clientId: string;
    authorizeUrl: string;
    tokenUrl: string;
    redirectUri: string;
    scopes: string;
  };
};

export type FsEntry = { name: string; type: "file" | "dir" };
export type FsListResponse = { path: string; entries: FsEntry[] };
export type FsReadResponse = { path: string; content: string; sha256: string };
export type FsWriteResponse = { path: string; sha256: string; savedAt: string };
export type FsRevision = { file: string; savedAt: string | null };
export type FsRevisionsResponse = { path: string; revisions: FsRevision[] };

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

export async function getStatus(): Promise<ApiStatus> {
  return await http<ApiStatus>("/api/status");
}

export async function getSettings(): Promise<Settings> {
  return await http<Settings>("/api/settings");
}

export async function saveSettings(next: Settings): Promise<{ ok: true }> {
  return await http<{ ok: true }>("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
}

export async function fsList(relPath: string): Promise<FsListResponse> {
  const url = new URL("/api/fs/list", window.location.origin);
  url.searchParams.set("path", relPath);
  return await http<FsListResponse>(url);
}

export async function fsRead(relPath: string): Promise<FsReadResponse> {
  const url = new URL("/api/fs/read", window.location.origin);
  url.searchParams.set("path", relPath);
  return await http<FsReadResponse>(url);
}

export async function fsWrite(
  relPath: string,
  content: string,
  expectedSha256?: string
): Promise<FsWriteResponse> {
  const url = new URL("/api/fs/write", window.location.origin);
  url.searchParams.set("path", relPath);
  return await http<FsWriteResponse>(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, expectedSha256 }),
  });
}

export async function fsRevisions(
  relPath: string
): Promise<FsRevisionsResponse> {
  const url = new URL("/api/fs/revisions", window.location.origin);
  url.searchParams.set("path", relPath);
  return await http<FsRevisionsResponse>(url);
}

export async function fsRestore(
  relPath: string,
  revisionFile: string
): Promise<FsWriteResponse> {
  return await http<FsWriteResponse>("/api/fs/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, revisionFile }),
  });
}
