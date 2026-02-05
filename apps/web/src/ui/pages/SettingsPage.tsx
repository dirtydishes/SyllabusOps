import { useEffect, useState } from "react";
import { type Settings, getSettings, saveSettings } from "../lib/api";

export function SettingsPage() {
  const [value, setValue] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setValue(s);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave() {
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      await saveSettings(value);
      setSavedAt(new Date().toISOString());
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
        <div className="muted">paths + ingestion controls</div>
      </div>

      {error ? <div className="card card-error">{error}</div> : null}

      <div className="card">
        <div className="card-title">Unified Library</div>
        <div className="field">
          <label htmlFor="unifiedDir">Unified directory</label>
          <input
            id="unifiedDir"
            value={value?.unifiedDir ?? ""}
            onChange={(e) =>
              setValue((v) => (v ? { ...v, unifiedDir: e.target.value } : v))
            }
            placeholder="/Users/kell/.../School/Unified"
            className="input mono"
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Watch Roots</div>
        <div className="muted">
          One per line (MVP; watcher wiring comes next).
        </div>
        <textarea
          className="textarea mono"
          value={(value?.watchRoots ?? []).join("\n")}
          onChange={(e) =>
            setValue((v) =>
              v
                ? {
                    ...v,
                    watchRoots: e.target.value.split("\n").filter(Boolean),
                  }
                : v
            )
          }
          rows={5}
        />
      </div>

      <div className="row">
        <button
          type="button"
          className="button primary"
          disabled={!value || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {savedAt ? <div className="muted mono">saved {savedAt}</div> : null}
      </div>
    </div>
  );
}
