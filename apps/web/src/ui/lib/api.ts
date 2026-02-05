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
  llmProvider: "openai" | "codex";
  llmMaxOutputTokens: number;
  openaiApiBaseUrl: string;
  openaiModel: string;
  openaiReasoningEffort?: "low" | "medium" | "high";
  codexModel: string;
  openaiOAuth?: {
    clientId: string;
    authorizeUrl: string;
    tokenUrl: string;
    redirectUri: string;
    scopes: string;
  };
};

export type CourseSummary = {
  slug: string;
  name: string;
  sessionsCount: number;
  artifactsCount: number;
  lastIngestedAt: string | null;
};

export type ArtifactSummary = {
  id: string;
  kind: "transcript" | "slides" | "unknown";
  fileName: string;
  relPath: string;
  sha256: string;
  ingestedAt: string;
  sourcePath: string;
  ext: string;
  cache: { type: "transcripts" | "pptx" | "pdf" | null; extractedTextAvailable: boolean };
  generated: { artifactSummaryPath: string };
};

export type SessionSummary = {
  date: string;
  artifacts: ArtifactSummary[];
  generated: { sessionSummaryPath: string; sessionNotesPath: string };
};

export type CourseDetail = {
  course: { slug: string; name: string };
  sessions: SessionSummary[];
};

export type TaskStatus = "suggested" | "approved" | "done" | "dismissed";

export type TaskRow = {
  id: string;
  course_slug: string;
  session_date: string | null;
  artifact_sha: string | null;
  title: string;
  description: string;
  due: string | null;
  confidence: number;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "blocked";
export type JobType =
  | "noop"
  | "ingest_file"
  | "extract_transcript"
  | "extract_pptx"
  | "extract_pdf"
  | "suggest_tasks";

export type JobRecord = {
  id: string;
  job_type: JobType;
  status: JobStatus;
  priority: number;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
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

export async function getCourses(): Promise<{ courses: CourseSummary[] }> {
  return await http<{ courses: CourseSummary[] }>("/api/courses");
}

export async function getCourseDetail(courseSlug: string): Promise<CourseDetail> {
  return await http<CourseDetail>(`/api/courses/${encodeURIComponent(courseSlug)}`);
}

export async function getExtractedText(input: {
  cache: "transcripts" | "pptx" | "pdf";
  sha: string;
  maxChars?: number;
}): Promise<{ ok: true; truncated: boolean; text: string }> {
  const url = new URL("/api/artifacts/extracted", window.location.origin);
  url.searchParams.set("cache", input.cache);
  url.searchParams.set("sha", input.sha);
  if (input.maxChars) url.searchParams.set("maxChars", String(input.maxChars));
  return await http<{ ok: true; truncated: boolean; text: string }>(url);
}

export async function getTasks(input: {
  courseSlug: string;
  sessionDate?: string;
  status?: TaskStatus;
  limit?: number;
}): Promise<{ tasks: TaskRow[] }> {
  const url = new URL("/api/tasks", window.location.origin);
  url.searchParams.set("courseSlug", input.courseSlug);
  if (input.sessionDate) url.searchParams.set("sessionDate", input.sessionDate);
  if (input.status) url.searchParams.set("status", input.status);
  if (input.limit) url.searchParams.set("limit", String(input.limit));
  return await http<{ tasks: TaskRow[] }>(url);
}

export async function suggestTasks(input: {
  courseSlug: string;
  sessionDate: string;
}): Promise<{ job: unknown }> {
  return await http<{ job: unknown }>("/api/tasks/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function approveTask(id: string): Promise<{ ok: true; changed: number }> {
  return await http<{ ok: true; changed: number }>(`/api/tasks/${encodeURIComponent(id)}/approve`, {
    method: "POST",
  });
}

export async function dismissTask(id: string): Promise<{ ok: true; changed: number }> {
  return await http<{ ok: true; changed: number }>(`/api/tasks/${encodeURIComponent(id)}/dismiss`, {
    method: "POST",
  });
}

export async function markTaskDone(id: string): Promise<{ ok: true; changed: number }> {
  return await http<{ ok: true; changed: number }>(`/api/tasks/${encodeURIComponent(id)}/done`, {
    method: "POST",
  });
}

export async function getJobs(input: {
  status?: JobStatus;
  type?: JobType;
  limit?: number;
}): Promise<{ jobs: JobRecord[] }> {
  const url = new URL("/api/jobs", window.location.origin);
  if (input.status) url.searchParams.set("status", input.status);
  if (input.type) url.searchParams.set("type", input.type);
  if (input.limit) url.searchParams.set("limit", String(input.limit));
  return await http<{ jobs: JobRecord[] }>(url);
}

export async function getJobStats(): Promise<{ counts: Record<JobStatus, number> }> {
  return await http<{ counts: Record<JobStatus, number> }>("/api/jobs/stats");
}

export async function getOpenAiModels(): Promise<{ models: string[] }> {
  return await http<{ models: string[] }>("/api/openai/models");
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
