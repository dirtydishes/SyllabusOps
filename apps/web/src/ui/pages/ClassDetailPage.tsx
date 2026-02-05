import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  type ArtifactSummary,
  type CourseDetail,
  type TaskRow,
  approveTask,
  dismissTask,
  getCourseDetail,
  getExtractedText,
  getTasks,
  markTaskDone,
  suggestTasks,
} from "../lib/api";

function toChip(kind: ArtifactSummary["kind"]): { className: string; label: string } {
  if (kind === "transcript") return { className: "chip chip-neutral", label: "Transcript" };
  if (kind === "slides") return { className: "chip chip-neutral", label: "Slides" };
  return { className: "chip chip-warn", label: "Unknown" };
}

export function ClassDetailPage() {
  const { courseSlug } = useParams();
  const [search, setSearch] = useSearchParams();

  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [tasksBusy, setTasksBusy] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{
    title: string;
    text: string;
    truncated: boolean;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const selectedDate = search.get("date");

  useEffect(() => {
    if (!courseSlug) return;
    let cancelled = false;
    setError(null);
    getCourseDetail(courseSlug)
      .then((r) => {
        if (cancelled) return;
        setDetail(r);
        if (!search.get("date") && r.sessions[0]?.date) {
          setSearch((s) => {
            s.set("date", r.sessions[0]!.date);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseSlug]);

  const session = useMemo(() => {
    if (!detail) return null;
    if (!selectedDate) return detail.sessions[0] ?? null;
    return detail.sessions.find((s) => s.date === selectedDate) ?? (detail.sessions[0] ?? null);
  }, [detail, selectedDate]);

  async function refreshTasks() {
    if (!courseSlug || !session?.date) return;
    setTasksError(null);
    setTasksBusy(true);
    try {
      const r = await getTasks({
        courseSlug,
        sessionDate: session.date,
        status: "suggested",
        limit: 200,
      });
      setTasks(r.tasks);
    } catch (e: unknown) {
      setTasksError(String((e as Error)?.message ?? e));
    } finally {
      setTasksBusy(false);
    }
  }

  useEffect(() => {
    void refreshTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseSlug, session?.date]);

  async function openPreview(a: ArtifactSummary) {
    if (!a.cache.type || !a.cache.extractedTextAvailable) return;
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const r = await getExtractedText({ cache: a.cache.type, sha: a.sha256, maxChars: 120_000 });
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
      await suggestTasks({ courseSlug, sessionDate: session.date });
    } catch (e: unknown) {
      setTasksError(String((e as Error)?.message ?? e));
    } finally {
      setTasksBusy(false);
    }
  }

  async function setTaskStatus(id: string, action: "approve" | "dismiss" | "done") {
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

      {error ? <div className="card card-error">Failed to load: {error}</div> : null}

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
                  const transcripts = s.artifacts.filter((a) => a.kind === "transcript").length;
                  const slides = s.artifacts.filter((a) => a.kind === "slides").length;
                  return (
                    <button
                      type="button"
                      key={s.date}
                      className={active ? "session-item active" : "session-item"}
                      onClick={() => {
                        setSearch((q) => {
                          q.set("date", s.date);
                          return q;
                        });
                      }}
                    >
                      <div className="row row-between" style={{ width: "100%" }}>
                        <div className="mono">{s.date}</div>
                        <div className="row">
                          <span className="chip chip-neutral">T {transcripts}</span>
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
                  <Link
                    className="button"
                    to={`/editor?path=${encodeURIComponent(session.generated.sessionNotesPath)}`}
                  >
                    Notes
                  </Link>
                  <Link
                    className="button primary"
                    to={`/editor?path=${encodeURIComponent(session.generated.sessionSummaryPath)}`}
                  >
                    Summary
                  </Link>
                </div>
              ) : null}
            </div>

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
                          disabled={!a.cache.type || !a.cache.extractedTextAvailable || previewBusy}
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

            {previewError ? <div className="muted">Preview error: {previewError}</div> : null}

            <div className="card" style={{ marginTop: 12 }}>
              <div className="row row-between">
                <div className="card-title">Suggested Tasks</div>
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
              {tasksError ? <div className="muted">Tasks error: {tasksError}</div> : null}
              {!tasks ? (
                <div className="muted">Loading…</div>
              ) : tasks.length === 0 ? (
                <div className="muted">No suggested tasks for this session yet.</div>
              ) : (
                <div className="task-list">
                  {tasks.map((t) => (
                    <div key={t.id} className="task-item">
                      <div className="row row-between" style={{ width: "100%" }}>
                        <div>
                          <div className="mono">{t.title}</div>
                          <div className="muted" style={{ marginTop: 4 }}>
                            {t.description}
                          </div>
                          <div className="muted mono" style={{ marginTop: 6, fontSize: 12 }}>
                            {t.due ? `due: ${t.due}` : "no due"} • conf: {t.confidence.toFixed(2)}
                          </div>
                        </div>
                        <div className="row">
                          <button
                            type="button"
                            className="button primary"
                            disabled={tasksBusy}
                            onClick={() => void setTaskStatus(t.id, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="button"
                            disabled={tasksBusy}
                            onClick={() => void setTaskStatus(t.id, "done")}
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            className="button"
                            disabled={tasksBusy}
                            onClick={() => void setTaskStatus(t.id, "dismiss")}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {preview ? (
        <div className="modal-backdrop" onClick={() => setPreview(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="row row-between">
              <div className="mono">{preview.title}</div>
              <button type="button" className="button" onClick={() => setPreview(null)}>
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
