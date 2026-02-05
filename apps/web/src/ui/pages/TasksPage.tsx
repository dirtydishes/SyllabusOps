import { useEffect, useMemo, useState } from "react";
import {
  type CourseSummary,
  type TaskRow,
  approveTask,
  dismissTask,
  getCourses,
  getTasks,
  markTaskDone,
} from "../lib/api";

type TaskBucket = {
  approved: TaskRow[];
  suggested: TaskRow[];
  done: TaskRow[];
  dismissed: TaskRow[];
};

function bucketTasks(tasks: TaskRow[]): TaskBucket {
  return {
    approved: tasks.filter((t) => t.status === "approved"),
    suggested: tasks.filter((t) => t.status === "suggested"),
    done: tasks.filter((t) => t.status === "done"),
    dismissed: tasks.filter((t) => t.status === "dismissed"),
  };
}

export function TasksPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCourses()
      .then((r) => {
        if (cancelled) return;
        setCourses(r.courses);
        if (!selectedCourse && r.courses[0]?.slug) setSelectedCourse(r.courses[0].slug);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (!selectedCourse) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getTasks({ courseSlug: selectedCourse, limit: 500 });
      setTasks(r.tasks);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourse]);

  async function setTaskStatus(id: string, action: "approve" | "dismiss" | "done") {
    setBusy(true);
    setError(null);
    try {
      if (action === "approve") await approveTask(id);
      if (action === "dismiss") await dismissTask(id);
      if (action === "done") await markTaskDone(id);
      await refresh();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const buckets = useMemo(() => bucketTasks(tasks ?? []), [tasks]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tasks</h1>
        <div className="muted">todo lists by course</div>
      </div>

      {error ? <div className="card card-error">{error}</div> : null}

      <div className="classes-grid">
        <div className="card">
          <div className="card-title">Courses</div>
          {!courses ? (
            <div className="muted">Loading…</div>
          ) : courses.length === 0 ? (
            <div className="muted">No courses yet.</div>
          ) : (
            <div className="session-list">
              {courses.map((c) => {
                const active = c.slug === selectedCourse;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    className={active ? "session-item active" : "session-item"}
                    onClick={() => setSelectedCourse(c.slug)}
                  >
                    <div className="row row-between" style={{ width: "100%" }}>
                      <div className="mono">{c.name}</div>
                      <div className="muted mono">{c.slug}</div>
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
              <div className="card-title">Course Tasks</div>
              <div className="muted mono">{selectedCourse || "—"}</div>
            </div>
            <div className="row">
              <button type="button" className="button" disabled={busy} onClick={() => void refresh()}>
                Refresh
              </button>
            </div>
          </div>

          {!tasks ? (
            <div className="muted" style={{ marginTop: 12 }}>
              Loading…
            </div>
          ) : (
            <>
              <div className="muted" style={{ marginTop: 10 }}>
                Approved tasks are your TODO list. Suggested tasks are waiting for approval.
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="row row-between">
                  <div className="mono">TODO (Approved)</div>
                  <span className="chip chip-ok">{buckets.approved.length}</span>
                </div>
                {buckets.approved.length === 0 ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    No approved tasks.
                  </div>
                ) : (
                  <div className="task-list" style={{ marginTop: 8 }}>
                    {buckets.approved.map((t) => (
                      <div key={t.id} className="task-item">
                        <div className="row row-between" style={{ width: "100%" }}>
                          <div>
                            <div className="mono">{t.title}</div>
                            <div className="muted" style={{ marginTop: 4 }}>
                              {t.description}
                            </div>
                            <div className="muted mono" style={{ marginTop: 6, fontSize: 12 }}>
                              {t.session_date ? `session: ${t.session_date}` : "no session"} •{" "}
                              {t.due ? `due: ${t.due}` : "no due"} • conf: {t.confidence.toFixed(2)}
                            </div>
                          </div>
                          <div className="row">
                            <button
                              type="button"
                              className="button primary"
                              disabled={busy}
                              onClick={() => void setTaskStatus(t.id, "done")}
                            >
                              Done
                            </button>
                            <button
                              type="button"
                              className="button"
                              disabled={busy}
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

              <div style={{ marginTop: 16 }}>
                <div className="row row-between">
                  <div className="mono">Suggested</div>
                  <span className="chip chip-neutral">{buckets.suggested.length}</span>
                </div>
                {buckets.suggested.length === 0 ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    No suggested tasks.
                  </div>
                ) : (
                  <div className="task-list" style={{ marginTop: 8 }}>
                    {buckets.suggested.map((t) => (
                      <div key={t.id} className="task-item">
                        <div className="row row-between" style={{ width: "100%" }}>
                          <div>
                            <div className="mono">{t.title}</div>
                            <div className="muted" style={{ marginTop: 4 }}>
                              {t.description}
                            </div>
                            <div className="muted mono" style={{ marginTop: 6, fontSize: 12 }}>
                              {t.session_date ? `session: ${t.session_date}` : "no session"} •{" "}
                              {t.due ? `due: ${t.due}` : "no due"} • conf: {t.confidence.toFixed(2)}
                            </div>
                          </div>
                          <div className="row">
                            <button
                              type="button"
                              className="button primary"
                              disabled={busy}
                              onClick={() => void setTaskStatus(t.id, "approve")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="button"
                              disabled={busy}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

