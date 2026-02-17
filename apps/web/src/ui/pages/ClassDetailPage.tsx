import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  type ArtifactSummary,
  type CourseDetail,
  type JobRecord,
  type TaskRow,
  approveTask,
  dismissTask,
  getCourseDetail,
  getExtractedText,
  getJobs,
  getTasks,
  markTaskDone,
  suggestTasks,
  summarizeSession,
} from "../lib/api";

type RunningAction = "suggest_tasks" | "generate_summary";
type RunningJob = {
  id: string;
  action: RunningAction;
  state: "running" | "complete";
  summaryPath?: string;
};

function toChip(kind: ArtifactSummary["kind"]): {
  className: string;
  label: string;
} {
  if (kind === "transcript")
    return { className: "chip chip-neutral", label: "Transcript" };
  if (kind === "slides")
    return { className: "chip chip-neutral", label: "Slides" };
  return { className: "chip chip-warn", label: "Unknown" };
}

export function ClassDetailPage() {
  const { courseSlug } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();

  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [tasksBusy, setTasksBusy] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);
  const [runningJobs, setRunningJobs] = useState<RunningJob[]>([]);

  const [preview, setPreview] = useState<{
    title: string;
    text: string;
    truncated: boolean;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const selectedDate = search.get("date");

  function addRunningJob(job: RunningJob) {
    setRunningJobs((prev) =>
      prev.some((j) => j.id === job.id) ? prev : [...prev, job]
    );
  }

  function removeRunningJob(jobId: string) {
    setRunningJobs((prev) => prev.filter((j) => j.id !== jobId));
  }

  function markRunningJobComplete(jobId: string) {
    setRunningJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, state: "complete" } : j))
    );
  }

  async function trackQueuedJob(opts: {
    job: JobRecord;
    action: RunningAction;
  }) {
    const pollMs = 1_500;
    const maxPolls = 400; // 10 minutes
    let missed = 0;

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));

      let next: JobRecord | null = null;
      try {
        const listed = await getJobs({ limit: 1000 });
        next = listed.jobs.find((j) => j.id === opts.job.id) ?? null;
      } catch (e: unknown) {
        const msg = String((e as Error)?.message ?? e);
        if (opts.action === "suggest_tasks") {
          setTasksError(`Failed to check job status: ${msg}`);
        } else {
          setSummaryError(`Failed to check job status: ${msg}`);
        }
        removeRunningJob(opts.job.id);
        return;
      }

      if (!next) {
        missed += 1;
        if (missed < 5) continue;
        removeRunningJob(opts.job.id);
        return;
      }
      missed = 0;

      if (next.status === "queued" || next.status === "running") continue;

      if (next.status === "succeeded") {
        if (opts.action === "generate_summary") {
          setSummaryMsg("Summary generated. Click the popup to open it.");
        }
        markRunningJobComplete(opts.job.id);
        return;
      }

      const reason = next.last_error?.trim()
        ? next.last_error
        : `Job ${next.status}`;
      if (opts.action === "suggest_tasks") {
        setTasksError(reason);
      } else {
        setSummaryError(reason);
      }
      removeRunningJob(opts.job.id);
      return;
    }

    if (opts.action === "suggest_tasks") {
      setTasksError("Timed out waiting for task job to finish.");
    } else {
      setSummaryError("Timed out waiting for summary job to finish.");
    }
    removeRunningJob(opts.job.id);
  }

  useEffect(() => {
    if (!courseSlug) return;
    let cancelled = false;
    setError(null);
    getCourseDetail(courseSlug)
      .then((r) => {
        if (cancelled) return;
        setDetail(r);
        if (!selectedDate && r.sessions[0]?.date) {
          setSearch((s) => {
            s.set("date", r.sessions[0]?.date);
            return s;
          });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(String((e as Error)?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [courseSlug, selectedDate, setSearch]);

  const session = useMemo(() => {
    if (!detail) return null;
    if (!selectedDate) return detail.sessions[0] ?? null;
    return (
      detail.sessions.find((s) => s.date === selectedDate) ??
      detail.sessions[0] ??
      null
    );
  }, [detail, selectedDate]);

  const refreshTasks = useCallback(async () => {
    if (!courseSlug || !session?.date) return;
    setTasksError(null);
    setTasksBusy(true);
    try {
      const r = await getTasks({
        courseSlug,
        sessionDate: session.date,
        limit: 500,
      });
      setTasks(r.tasks);
    } catch (e: unknown) {
      setTasksError(String((e as Error)?.message ?? e));
    } finally {
      setTasksBusy(false);
    }
  }, [courseSlug, session?.date]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  async function openPreview(a: ArtifactSummary) {
    if (!a.cache.type || !a.cache.extractedTextAvailable) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const r = await getExtractedText({
        cache: a.cache.type,
        sha: a.sha256,
        maxChars: 120_000,
      });
      setPreview({
        title: `${a.fileName} • extracted`,
        text: r.text,
        truncated: r.truncated,
      });
    } catch (e: unknown) {
      setPreviewError(String((e as Error)?.message ?? e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function onSuggestTasks() {
    if (!courseSlug || !session?.date) return;
    setTasksError(null);
    setTasksBusy(true);
    try {
      const queued = await suggestTasks({
        courseSlug,
        sessionDate: session.date,
      });
      addRunningJob({
        id: queued.job.id,
        action: "suggest_tasks",
        state: "running",
      });
      void trackQueuedJob({ job: queued.job, action: "suggest_tasks" });
    } catch (e: unknown) {
      setTasksError(String((e as Error)?.message ?? e));
    } finally {
      setTasksBusy(false);
    }
  }

  async function onSummarizeSession() {
    if (!courseSlug || !session?.date) return;
    setSummaryError(null);
    setSummaryMsg(null);
    setSummaryBusy(true);
    try {
      const queued = await summarizeSession({
        courseSlug,
        sessionDate: session.date,
      });
      addRunningJob({
        id: queued.job.id,
        action: "generate_summary",
        state: "running",
        summaryPath: session.generated.sessionSummaryPath,
      });
      setSummaryMsg(
        "Summary job queued. We will keep this indicator visible until it finishes."
      );
      void trackQueuedJob({ job: queued.job, action: "generate_summary" });
    } catch (e: unknown) {
      setSummaryError(String((e as Error)?.message ?? e));
    } finally {
      setSummaryBusy(false);
    }
  }

  async function setTaskStatus(
    id: string,
    action: "approve" | "dismiss" | "done"
  ) {
    setTasksError(null);
    setTasksBusy(true);
    try {
      if (action === "approve") await approveTask(id);
      if (action === "dismiss") await dismissTask(id);
      if (action === "done") await markTaskDone(id);
      await refreshTasks();
    } catch (e: unknown) {
      setTasksError(String((e as Error)?.message ?? e));
    } finally {
      setTasksBusy(false);
    }
  }

  const tasksByStatus = useMemo(() => {
    const all = tasks ?? [];
    return {
      approved: all.filter((t) => t.status === "approved"),
      suggested: all.filter((t) => t.status === "suggested"),
      done: all.filter((t) => t.status === "done"),
      dismissed: all.filter((t) => t.status === "dismissed"),
    };
  }, [tasks]);

  function onToastClick(job: RunningJob) {
    if (job.state !== "complete") return;
    if (job.action === "generate_summary" && job.summaryPath) {
      navigate(`/editor?path=${encodeURIComponent(job.summaryPath)}`);
      removeRunningJob(job.id);
      return;
    }
    if (job.action === "suggest_tasks") {
      void refreshTasks();
      removeRunningJob(job.id);
    }
  }

  if (!courseSlug) {
    return (
      <div className="page">
        <div className="card card-error">Missing course slug.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="row" style={{ gap: 12 }}>
          <h1 style={{ margin: 0 }}>Class</h1>
          <div className="muted mono">{courseSlug}</div>
        </div>
        <div className="row">
          <Link className="button" to="/classes">
            Back
          </Link>
        </div>
      </div>

      {error ? (
        <div className="card card-error">Failed to load: {error}</div>
      ) : null}

      {!detail ? (
        <div className="card">
          <div className="muted">Loading…</div>
        </div>
      ) : (
        <div className="classes-grid">
          <div className="card">
            <div className="card-title">Sessions</div>
            {detail.sessions.length === 0 ? (
              <div className="muted">No sessions found yet.</div>
            ) : (
              <div className="session-list">
                {detail.sessions.map((s) => {
                  const active = s.date === (session?.date ?? "");
                  const transcripts = s.artifacts.filter(
                    (a) => a.kind === "transcript"
                  ).length;
                  const slides = s.artifacts.filter(
                    (a) => a.kind === "slides"
                  ).length;
                  return (
                    <button
                      type="button"
                      key={s.date}
                      className={
                        active ? "session-item active" : "session-item"
                      }
                      onClick={() => {
                        setSearch((q) => {
                          q.set("date", s.date);
                          return q;
                        });
                      }}
                    >
                      <div
                        className="row row-between"
                        style={{ width: "100%" }}
                      >
                        <div className="mono">{s.date}</div>
                        <div className="row">
                          <span className="chip chip-neutral">
                            T {transcripts}
                          </span>
                          <span className="chip chip-neutral">S {slides}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row row-between">
              <div>
                <div className="card-title">Session</div>
                <div className="muted mono">{session?.date ?? "—"}</div>
              </div>
              {session ? (
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    disabled={tasksBusy || !detail}
                    onClick={() => void onSuggestTasks()}
                  >
                    Suggest Tasks
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={summaryBusy || !detail}
                    onClick={() => void onSummarizeSession()}
                  >
                    {summaryBusy ? "Generating…" : "Generate Summary"}
                  </button>
                  <Link
                    className="button"
                    to={`/editor?path=${encodeURIComponent(session.generated.sessionNotesPath)}`}
                  >
                    Notes
                  </Link>
                  <Link
                    className="button"
                    to={`/editor?path=${encodeURIComponent(session.generated.sessionSummaryPath)}`}
                  >
                    Summary
                  </Link>
                </div>
              ) : null}
            </div>

            {summaryError ? (
              <div className="muted">Summary error: {summaryError}</div>
            ) : null}
            {summaryMsg ? <div className="muted">{summaryMsg}</div> : null}

            {!session ? (
              <div className="muted">Select a session.</div>
            ) : session.artifacts.length === 0 ? (
              <div className="muted">No artifacts ingested for this date.</div>
            ) : (
              <div className="table artifacts">
                <div className="table-row table-head">
                  <div>Kind</div>
                  <div>File</div>
                  <div>Extract</div>
                  <div>Actions</div>
                </div>
                {session.artifacts.map((a) => {
                  const chip = toChip(a.kind);
                  return (
                    <div key={a.relPath} className="table-row">
                      <div>
                        <span className={chip.className}>{chip.label}</span>
                      </div>
                      <div className="mono">{a.fileName}</div>
                      <div>
                        {a.cache.extractedTextAvailable ? (
                          <span className="chip chip-ok">Cached</span>
                        ) : a.cache.type ? (
                          <span className="chip chip-warn">Missing</span>
                        ) : (
                          <span className="chip chip-warn">N/A</span>
                        )}
                      </div>
                      <div className="row">
                        <Link
                          className="button"
                          to={`/editor?path=${encodeURIComponent(`${a.relPath}.meta.json`)}`}
                        >
                          Meta
                        </Link>
                        <Link
                          className="button"
                          to={`/editor?path=${encodeURIComponent(a.generated.artifactSummaryPath)}`}
                        >
                          Summary
                        </Link>
                        <button
                          type="button"
                          className="button"
                          disabled={
                            !a.cache.type ||
                            !a.cache.extractedTextAvailable ||
                            previewBusy
                          }
                          onClick={() => void openPreview(a)}
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {previewError ? (
              <div className="muted">Preview error: {previewError}</div>
            ) : null}

            <div className="card" style={{ marginTop: 12 }}>
              <div className="row row-between">
                <div className="card-title">Tasks</div>
                <div className="row">
                  <button
                    type="button"
                    className="button"
                    disabled={tasksBusy}
                    onClick={() => void refreshTasks()}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {tasksError ? (
                <div className="muted">Tasks error: {tasksError}</div>
              ) : null}
              {!tasks ? (
                <div className="muted">Loading…</div>
              ) : tasks.length === 0 ? (
                <div className="muted">No tasks for this session yet.</div>
              ) : (
                <>
                  <div className="muted" style={{ marginTop: 4 }}>
                    Approved tasks become your TODO list. Suggested tasks are
                    waiting for approval.
                  </div>

                  {tasksByStatus.approved.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <div className="row row-between">
                        <div className="mono">TODO (Approved)</div>
                        <span className="chip chip-ok">
                          {tasksByStatus.approved.length}
                        </span>
                      </div>
                      <div className="task-list" style={{ marginTop: 8 }}>
                        {tasksByStatus.approved.map((t) => (
                          <div key={t.id} className="task-item">
                            <div
                              className="row row-between"
                              style={{ width: "100%" }}
                            >
                              <div>
                                <div className="mono">{t.title}</div>
                                <div className="muted" style={{ marginTop: 4 }}>
                                  {t.description}
                                </div>
                                <div
                                  className="muted mono"
                                  style={{ marginTop: 6, fontSize: 12 }}
                                >
                                  {t.due ? `due: ${t.due}` : "no due"} • conf:{" "}
                                  {t.confidence.toFixed(2)}
                                </div>
                              </div>
                              <div className="row">
                                <button
                                  type="button"
                                  className="button primary"
                                  disabled={tasksBusy}
                                  onClick={() =>
                                    void setTaskStatus(t.id, "done")
                                  }
                                >
                                  Done
                                </button>
                                <button
                                  type="button"
                                  className="button"
                                  disabled={tasksBusy}
                                  onClick={() =>
                                    void setTaskStatus(t.id, "dismiss")
                                  }
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {tasksByStatus.suggested.length > 0 ? (
                    <div style={{ marginTop: 14 }}>
                      <div className="row row-between">
                        <div className="mono">Suggested</div>
                        <span className="chip chip-neutral">
                          {tasksByStatus.suggested.length}
                        </span>
                      </div>
                      <div className="task-list" style={{ marginTop: 8 }}>
                        {tasksByStatus.suggested.map((t) => (
                          <div key={t.id} className="task-item">
                            <div
                              className="row row-between"
                              style={{ width: "100%" }}
                            >
                              <div>
                                <div className="mono">{t.title}</div>
                                <div className="muted" style={{ marginTop: 4 }}>
                                  {t.description}
                                </div>
                                <div
                                  className="muted mono"
                                  style={{ marginTop: 6, fontSize: 12 }}
                                >
                                  {t.due ? `due: ${t.due}` : "no due"} • conf:{" "}
                                  {t.confidence.toFixed(2)}
                                </div>
                              </div>
                              <div className="row">
                                <button
                                  type="button"
                                  className="button primary"
                                  disabled={tasksBusy}
                                  onClick={() =>
                                    void setTaskStatus(t.id, "approve")
                                  }
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="button"
                                  disabled={tasksBusy}
                                  onClick={() =>
                                    void setTaskStatus(t.id, "done")
                                  }
                                >
                                  Done
                                </button>
                                <button
                                  type="button"
                                  className="button"
                                  disabled={tasksBusy}
                                  onClick={() =>
                                    void setTaskStatus(t.id, "dismiss")
                                  }
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {tasksByStatus.approved.length === 0 &&
                  tasksByStatus.suggested.length === 0 ? (
                    <div className="muted" style={{ marginTop: 10 }}>
                      No suggested or approved tasks. (Done/dismissed tasks are
                      hidden here.)
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {runningJobs.length > 0 ? (
        <div className="job-toast-stack" aria-live="polite">
          {runningJobs.map((job) => (
            <div
              key={job.id}
              className={
                job.state === "complete"
                  ? "job-toast job-toast-complete"
                  : "job-toast job-toast-running"
              }
            >
              {job.state === "complete" ? (
                <>
                  <button
                    type="button"
                    className="job-toast-button"
                    onClick={() => onToastClick(job)}
                  >
                    <span
                      className="job-toast-complete-icon"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span className="mono">
                      Task complete:{" "}
                      {job.action === "suggest_tasks"
                        ? "Suggest Tasks"
                        : "Generate Summary"}
                      {" — "}
                      {job.action === "suggest_tasks"
                        ? "click to reload"
                        : "click to view"}
                    </span>
                  </button>
                  <div className="job-toast-progress" aria-hidden="true">
                    <span
                      className="job-toast-progress-fill"
                      onAnimationEnd={() => removeRunningJob(job.id)}
                    />
                  </div>
                </>
              ) : (
                <output className="job-toast-running-text">
                  <span className="job-toast-spinner" aria-hidden="true" />
                  <span className="mono">
                    Task running:{" "}
                    {job.action === "suggest_tasks"
                      ? "Suggest Tasks"
                      : "Generate Summary"}
                  </span>
                </output>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {preview ? (
        <div
          className="modal-backdrop"
          onClick={() => setPreview(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPreview(null);
          }}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPreview(null);
            }}
            role="presentation"
            tabIndex={-1}
          >
            <div className="row row-between">
              <div className="mono">{preview.title}</div>
              <button
                type="button"
                className="button"
                onClick={() => setPreview(null)}
              >
                Close
              </button>
            </div>
            {preview.truncated ? (
              <div className="muted" style={{ marginTop: 8 }}>
                Truncated for display.
              </div>
            ) : null}
            <pre className="preview-pre">{preview.text}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
