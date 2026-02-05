import { useEffect, useState } from "react";
import { type Settings, getSettings, saveSettings } from "../lib/api";
import {
  type OpenAiStatus,
  clearOpenAiApiKey,
  disconnectOpenAiOAuth,
  getOpenAiStatus,
  setOpenAiApiKey,
  startOpenAiOAuth,
} from "../lib/openai";

export function SettingsPage() {
  const [value, setValue] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiStatus | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setValue(s);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    getOpenAiStatus()
      .then((s) => {
        if (!cancelled) setOpenAiStatus(s);
      })
      .catch(() => {
        // ignore
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

  async function refreshAuthStatus() {
    try {
      setOpenAiStatus(await getOpenAiStatus());
    } catch {
      // ignore
    }
  }

  async function onConnect() {
    setAuthBusy(true);
    setError(null);
    try {
      const { authUrl } = await startOpenAiOAuth();
      window.location.href = authUrl;
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function onDisconnect() {
    setAuthBusy(true);
    setError(null);
    try {
      await disconnectOpenAiOAuth();
      await refreshAuthStatus();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function onSaveApiKey() {
    if (!apiKeyDraft.trim()) return;
    setAuthBusy(true);
    setError(null);
    try {
      await setOpenAiApiKey(apiKeyDraft.trim());
      setApiKeyDraft("");
      await refreshAuthStatus();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function onClearApiKey() {
    setAuthBusy(true);
    setError(null);
    try {
      await clearOpenAiApiKey();
      await refreshAuthStatus();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
        <div className="muted">paths • ingestion • auth</div>
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

      <div className="card">
        <div className="card-title">Ingestion</div>
        <div className="muted">
          Disabled by default. Enable only once your Unified path is correct.
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={value?.ingestEnabled ?? false}
              onChange={(e) =>
                setValue((v) =>
                  v ? { ...v, ingestEnabled: e.target.checked } : v
                )
              }
            />
            <span>Enable ingest (enqueue copy/extract jobs)</span>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-title">OpenAI</div>
        <div className="muted">
          OAuth is preferred; API key fallback is stored in macOS Keychain.
        </div>

        <div className="kv" style={{ marginTop: 10 }}>
          <div className="k">Mode</div>
          <div className="v mono">{openAiStatus?.mode ?? "…"}</div>
        </div>
        <div className="kv">
          <div className="k">OAuth</div>
          <div className="v">
            {openAiStatus?.oauthConnected ? (
              <span className="chip chip-ok">Connected</span>
            ) : (
              <span className="chip chip-warn">Not connected</span>
            )}
            {openAiStatus?.configured ? null : (
              <span className="muted"> • not configured</span>
            )}
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="button primary"
            disabled={!openAiStatus?.configured || authBusy}
            onClick={onConnect}
          >
            Connect OpenAI OAuth
          </button>
          <button
            type="button"
            className="button"
            disabled={!openAiStatus?.oauthConnected || authBusy}
            onClick={onDisconnect}
          >
            Disconnect
          </button>
          <button
            type="button"
            className="button"
            disabled={authBusy}
            onClick={() => void refreshAuthStatus()}
          >
            Refresh
          </button>
        </div>

        {openAiStatus?.lastError ? (
          <div className="card card-error" style={{ marginTop: 12 }}>
            {openAiStatus.lastError}
          </div>
        ) : null}

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title">OAuth configuration</div>
          <div className="muted">
            Create an OpenAI OAuth client and register the redirect URI.
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="openaiClientId">Client ID</label>
            <input
              id="openaiClientId"
              className="input mono"
              value={value?.openaiOAuth?.clientId ?? ""}
              onChange={(e) =>
                setValue((v) =>
                  v
                    ? {
                        ...v,
                        openaiOAuth: {
                          clientId: e.target.value,
                          authorizeUrl: v.openaiOAuth?.authorizeUrl ?? "",
                          tokenUrl: v.openaiOAuth?.tokenUrl ?? "",
                          redirectUri: v.openaiOAuth?.redirectUri ?? "",
                          scopes: v.openaiOAuth?.scopes ?? "",
                        },
                      }
                    : v
                )
              }
              placeholder="client_..."
            />
          </div>

          <div className="field">
            <label htmlFor="openaiAuthorizeUrl">Authorize URL</label>
            <input
              id="openaiAuthorizeUrl"
              className="input mono"
              value={value?.openaiOAuth?.authorizeUrl ?? ""}
              onChange={(e) =>
                setValue((v) =>
                  v
                    ? {
                        ...v,
                        openaiOAuth: {
                          clientId: v.openaiOAuth?.clientId ?? "",
                          authorizeUrl: e.target.value,
                          tokenUrl: v.openaiOAuth?.tokenUrl ?? "",
                          redirectUri: v.openaiOAuth?.redirectUri ?? "",
                          scopes: v.openaiOAuth?.scopes ?? "",
                        },
                      }
                    : v
                )
              }
              placeholder="https://…/authorize"
            />
          </div>

          <div className="field">
            <label htmlFor="openaiTokenUrl">Token URL</label>
            <input
              id="openaiTokenUrl"
              className="input mono"
              value={value?.openaiOAuth?.tokenUrl ?? ""}
              onChange={(e) =>
                setValue((v) =>
                  v
                    ? {
                        ...v,
                        openaiOAuth: {
                          clientId: v.openaiOAuth?.clientId ?? "",
                          authorizeUrl: v.openaiOAuth?.authorizeUrl ?? "",
                          tokenUrl: e.target.value,
                          redirectUri: v.openaiOAuth?.redirectUri ?? "",
                          scopes: v.openaiOAuth?.scopes ?? "",
                        },
                      }
                    : v
                )
              }
              placeholder="https://…/oauth/token"
            />
          </div>

          <div className="field">
            <label htmlFor="openaiRedirectUri">Redirect URI</label>
            <input
              id="openaiRedirectUri"
              className="input mono"
              value={value?.openaiOAuth?.redirectUri ?? ""}
              onChange={(e) =>
                setValue((v) =>
                  v
                    ? {
                        ...v,
                        openaiOAuth: {
                          clientId: v.openaiOAuth?.clientId ?? "",
                          authorizeUrl: v.openaiOAuth?.authorizeUrl ?? "",
                          tokenUrl: v.openaiOAuth?.tokenUrl ?? "",
                          redirectUri: e.target.value,
                          scopes: v.openaiOAuth?.scopes ?? "",
                        },
                      }
                    : v
                )
              }
              placeholder="http://localhost:4959/api/auth/openai/callback"
            />
          </div>

          <div className="field">
            <label htmlFor="openaiScopes">Scopes</label>
            <input
              id="openaiScopes"
              className="input mono"
              value={value?.openaiOAuth?.scopes ?? ""}
              onChange={(e) =>
                setValue((v) =>
                  v
                    ? {
                        ...v,
                        openaiOAuth: {
                          clientId: v.openaiOAuth?.clientId ?? "",
                          authorizeUrl: v.openaiOAuth?.authorizeUrl ?? "",
                          tokenUrl: v.openaiOAuth?.tokenUrl ?? "",
                          redirectUri: v.openaiOAuth?.redirectUri ?? "",
                          scopes: e.target.value,
                        },
                      }
                    : v
                )
              }
              placeholder="openid profile offline_access …"
            />
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="openaiApiKey">API key (fallback)</label>
          <input
            id="openaiApiKey"
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            placeholder={
              openAiStatus?.apiKeySet ? "(set in Keychain)" : "sk-..."
            }
            className="input mono"
          />
        </div>
        <div className="row">
          <button
            type="button"
            className="button"
            disabled={!apiKeyDraft.trim() || authBusy}
            onClick={onSaveApiKey}
          >
            Save API key
          </button>
          <button
            type="button"
            className="button"
            disabled={!openAiStatus?.apiKeySet || authBusy}
            onClick={onClearApiKey}
          >
            Clear API key
          </button>
        </div>
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
