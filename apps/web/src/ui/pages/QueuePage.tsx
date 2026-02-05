import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type JobRecord,
  type JobStatus,
  type JobType,
  getJobStats,
  getJobs,
} from "../lib/api";

const Statuses: Array<JobStatus> = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
];
const Types: Array<JobType> = [
  "ingest_file",
  "extract_transcript",
  "extract_pptx",
  "extract_pdf",
  "suggest_tasks",
  "noop",
];

function clip(s: string | null, n = 120): string {
  if (!s) return "";
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function QueuePage() {
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [type, setType] = useState<JobType | "all">("all");
  const [limit, setLimit] = useState(200);
  const [auto, setAuto] = useState(true);
  const statusId = "queue-status";
  const typeId = "queue-type";
  const limitId = "queue-limit";

  const [stats, setStats] = useState<Record<JobStatus, number> | null>(null);
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [s, j] = await Promise.all([
        getJobStats(),
        getJobs({
          status: status === "all" ? undefined : status,
          type: type === "all" ? undefined : type,
          limit,
        }),
      ]);
      setStats(s.counts);
      setJobs(j.jobs);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [limit, status, type]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(t);
  }, [auto, refresh]);

  const rows = useMemo(() => jobs ?? [], [jobs]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Queue</h1>
        <div className="row">
          <button
            type="button"
            className="button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="card card-error">Failed to load: {error}</div>
      ) : null}

      <div className="grid">
        <div className="card">
          <div className="card-title">Stats</div>
          {!stats ? (
            <div className="muted">Loading…</div>
          ) : (
            <>
              {Statuses.map((s) => (
                <div className="kv" key={s}>
                  <div className="k mono">{s}</div>
                  <div className="v">
                    <span className="chip chip-neutral">{stats[s] ?? 0}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">Filters</div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <div className="field" style={{ minWidth: 200 }}>
              <label htmlFor={statusId}>Status</label>
              <select
                id={statusId}
                className="input"
                value={status}
                onChange={(e) =>
                  setStatus((e.target.value as JobStatus) || "all")
                }
              >
                <option value="all">All</option>
                {Statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ minWidth: 240 }}>
              <label htmlFor={typeId}>Type</label>
              <select
                id={typeId}
                className="input"
                value={type}
                onChange={(e) => setType((e.target.value as JobType) || "all")}
              >
                <option value="all">All</option>
                {Types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ minWidth: 160 }}>
              <label htmlFor={limitId}>Limit</label>
              <input
                id={limitId}
                className="input"
                type="number"
                min={10}
                max={500}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value || "200"))}
              />
            </div>

            <div className="field" style={{ minWidth: 160 }}>
              <div className="field-label">Auto refresh</div>
              <label className="row" style={{ gap: 8, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                />
                <span className="muted">every 2s</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Jobs</div>
        {!jobs ? (
          <div className="muted">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="muted">No jobs.</div>
        ) : (
          <div className="table queue">
            <div className="table-row table-head">
              <div>ID</div>
              <div>Type</div>
              <div>Status</div>
              <div>Attempts</div>
              <div>Updated</div>
              <div>Error</div>
            </div>
            {rows.map((j) => (
              <div key={j.id} className="table-row">
                <div className="mono">{j.id}</div>
                <div className="mono">{j.job_type}</div>
                <div className="mono">{j.status}</div>
                <div className="mono">
                  {j.attempts}/{j.max_attempts}
                </div>
                <div className="muted mono">{j.updated_at}</div>
                <div className="muted">{clip(j.last_error)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
