import { useEffect, useMemo, useState } from "react";
import { formatLocalTimeOnYmd } from "../lib/time";

type LogEvent = {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  msg?: string;
  data?: Record<string, unknown>;
};

export function LogsPage() {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<LogEvent["level"] | "all">("all");
  const [q, setQ] = useState("");
  const levelId = "logs-level";
  const searchId = "logs-search";

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("open", () => {
      setConnected(true);
      setError(null);
    });
    es.addEventListener("error", () => {
      setConnected(false);
      setError("Disconnected");
    });
    es.addEventListener("log", (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as LogEvent;
        setLogs((prev) => {
          if (paused) return prev;
          return [...prev.slice(-499), payload];
        });
      } catch {
        // ignore
      }
    });
    return () => es.close();
  }, [paused]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = logs.filter((l) => {
      if (level !== "all" && l.level !== level) return false;
      if (!needle) return true;
      const hay = `${l.event} ${l.msg ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
    return filtered.slice().reverse();
  }, [logs, level, q]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Logs</h1>
        <div className="row">
          <span className={connected ? "chip chip-ok" : "chip chip-warn"}>
            {connected ? "Live" : "Offline"}
          </span>
          <span className="chip chip-neutral">
            {paused ? "Paused" : "Streaming"}
          </span>
          {error ? <span className="muted">• {error}</span> : null}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor={levelId}>Level</label>
            <select
              id={levelId}
              className="input"
              value={level}
              onChange={(e) =>
                setLevel((e.target.value as LogEvent["level"]) || "all")
              }
            >
              <option value="all">All</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: 280, flex: 1 }}>
            <label htmlFor={searchId}>Search</label>
            <input
              id={searchId}
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="event or message…"
            />
          </div>

          <div className="field" style={{ minWidth: 220 }}>
            <div className="field-label">Controls</div>
            <div className="row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="button"
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setLogs([])}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card logs-card">
        <div className="logs">
          {rows.length === 0 ? (
            <div className="muted">No logs yet.</div>
          ) : (
            rows.map((l, idx) => (
              <div
                key={`${l.ts}-${idx}`}
                className={`log-row level-${l.level}`}
              >
                <span className="mono log-ts">
                  {formatLocalTimeOnYmd(l.ts)}
                </span>
                <span className="log-level">{l.level}</span>
                <span className="mono log-event">{l.event}</span>
                <span className="log-msg">{l.msg ?? ""}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
