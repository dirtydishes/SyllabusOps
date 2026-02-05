import { useEffect, useMemo, useState } from "react";

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
        setLogs((prev) => [...prev.slice(-499), payload]);
      } catch {
        // ignore
      }
    });
    return () => es.close();
  }, []);

  const rows = useMemo(() => logs.slice().reverse(), [logs]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Logs</h1>
        <div className="muted">
          {connected ? (
            <span className="chip chip-ok">Live</span>
          ) : (
            <span className="chip chip-warn">Offline</span>
          )}
          {error ? <span className="muted"> • {error}</span> : null}
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
                <span className="mono log-ts">{l.ts}</span>
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
