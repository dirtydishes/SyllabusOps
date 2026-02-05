import { useEffect, useState } from "react";
import { type ApiStatus, getStatus } from "../lib/api";

export function OverviewPage() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Overview</h1>
        <div className="muted">local control plane</div>
      </div>

      {error ? (
        <div className="card card-error">Failed to load: {error}</div>
      ) : null}

      <div className="grid">
        <div className="card">
          <div className="card-title">Service</div>
          {status ? (
            <>
              <div className="kv">
                <div className="k">Status</div>
                <div className="v">
                  <span className="chip chip-ok">OK</span>
                </div>
              </div>
              <div className="kv">
                <div className="k">Version</div>
                <div className="v">{status.version}</div>
              </div>
              <div className="kv">
                <div className="k">Now</div>
                <div className="v mono">{status.now}</div>
              </div>
            </>
          ) : (
            <div className="muted">Loading…</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Paths</div>
          {status ? (
            <>
              <div className="kv">
                <div className="k">Unified</div>
                <div className="v mono">{status.unifiedDir}</div>
              </div>
              <div className="kv">
                <div className="k">State</div>
                <div className="v mono">{status.stateDir}</div>
              </div>
            </>
          ) : (
            <div className="muted">Loading…</div>
          )}
        </div>
      </div>
    </div>
  );
}
