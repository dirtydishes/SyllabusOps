import { useContext, useEffect, useMemo, useState } from "react";
import { UNSAFE_NavigationContext, useBeforeUnload } from "react-router-dom";
import {
  type CodexModelInfo,
  type Settings,
  adminReset,
  getCodexModels,
  getOpenAiModels,
  getSettings,
  saveSettings,
} from "../lib/api";
import {
  type CodexStatus,
  codexLogout,
  getCodexStatus,
  startCodexChatgptLogin,
} from "../lib/codex";
import {
  type NotionStatus,
  clearNotionToken,
  getNotionStatus,
  setNotionToken,
} from "../lib/notion";
import {
  type OpenAiStatus,
  clearOpenAiApiKey,
  disconnectOpenAiOAuth,
  getOpenAiStatus,
  setOpenAiApiKey,
  startOpenAiOAuth,
} from "../lib/openai";
import { formatLocalTimeOnYmd } from "../lib/time";

function settingsFingerprint(value: Settings): string {
  return JSON.stringify(value);
}

export function SettingsPage() {
  const navigation = useContext(UNSAFE_NavigationContext);
  const [value, setValue] = useState<Settings | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [notionTokenDraft, setNotionTokenDraft] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [notionMsg, setNotionMsg] = useState<string | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [openAiModels, setOpenAiModels] = useState<string[]>([]);
  const [openAiModelsError, setOpenAiModelsError] = useState<string | null>(
    null
  );
  const [codexModelsBusy, setCodexModelsBusy] = useState(false);
  const [codexModels, setCodexModels] = useState<CodexModelInfo[]>([]);
  const [codexModelsError, setCodexModelsError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetScope, setResetScope] = useState<"state" | "state+unified">(
    "state"
  );
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) {
          setValue(s);
          setSavedFingerprint(settingsFingerprint(s));
        }
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
    getCodexStatus()
      .then((s) => {
        if (!cancelled) setCodexStatus(s);
      })
      .catch(() => {
        // ignore
      });
    getNotionStatus()
      .then((s) => {
        if (!cancelled) setNotionStatus(s);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUnsavedChanges =
    value !== null &&
    savedFingerprint !== null &&
    settingsFingerprint(value) !== savedFingerprint;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const navigator = navigation.navigator as {
      block?: (
        blocker: (tx: {
          retry: () => void;
        }) => void
      ) => () => void;
    };
    if (typeof navigator.block !== "function") return;

    const unblock = navigator.block((tx) => {
      const ok = window.confirm(
        "You have unsaved settings changes. Save before leaving this page?"
      );
      if (!ok) return;
      unblock();
      tx.retry();
    });
    return unblock;
  }, [hasUnsavedChanges, navigation.navigator]);

  useBeforeUnload((event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  });

  async function onSave() {
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      await saveSettings(value);
      setSavedFingerprint(settingsFingerprint(value));
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
    try {
      setCodexStatus(await getCodexStatus());
    } catch {
      // ignore
    }
    try {
      setNotionStatus(await getNotionStatus());
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

  async function onSaveNotionToken() {
    if (!notionTokenDraft.trim()) return;
    setNotionBusy(true);
    setError(null);
    setNotionMsg(null);
    try {
      await setNotionToken(notionTokenDraft.trim());
      setNotionTokenDraft("");
      setNotionStatus(await getNotionStatus());
      setNotionMsg("Notion token saved.");
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setNotionBusy(false);
    }
  }

  async function onClearNotionToken() {
    setNotionBusy(true);
    setError(null);
    setNotionMsg(null);
    try {
      await clearNotionToken();
      setNotionStatus(await getNotionStatus());
      setNotionMsg("Notion token cleared.");
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setNotionBusy(false);
    }
  }

  async function onTestNotion() {
    setNotionBusy(true);
    setError(null);
    setNotionMsg(null);
    try {
      const status = await getNotionStatus();
      setNotionStatus(status);
      setNotionMsg(
        status.reachable
          ? "Notion connection looks good."
          : (status.error ?? "Could not reach Notion with current token.")
      );
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setNotionBusy(false);
    }
  }

  async function onCodexConnect() {
    setAuthBusy(true);
    setError(null);
    try {
      const { authUrl } = await startCodexChatgptLogin();
      window.location.href = authUrl;
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function onCodexLogout() {
    setAuthBusy(true);
    setError(null);
    try {
      await codexLogout();
      await refreshAuthStatus();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function loadModels() {
    setOpenAiModelsError(null);
    setModelsBusy(true);
    try {
      const r = await getOpenAiModels();
      setOpenAiModels(r.models);
    } catch (e: unknown) {
      setOpenAiModelsError(String((e as Error)?.message ?? e));
    } finally {
      setModelsBusy(false);
    }
  }

  async function loadCodexModels() {
    setCodexModelsError(null);
    setCodexModelsBusy(true);
    try {
      const r = await getCodexModels();
      setCodexModels(r.models);
    } catch (e: unknown) {
      setCodexModelsError(String((e as Error)?.message ?? e));
    } finally {
      setCodexModelsBusy(false);
    }
  }

  async function onReset() {
    if (!value) return;
    if (resetConfirm.trim().toUpperCase() !== "RESET") return;
    setResetBusy(true);
    setError(null);
    setResetMsg(null);
    try {
      const res = await adminReset({
        scope: resetScope,
        confirm: "RESET",
        unifiedDir:
          resetScope === "state+unified" ? value.unifiedDir : undefined,
      });
      setResetConfirm("");
      setResetMsg(
        `Reset complete. Ingestion is now disabled. ${
          resetScope === "state+unified"
            ? `Unified items removed: ${res.unifiedDeleted}.`
            : ""
        }`
      );
      setValue(await getSettings());
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setResetBusy(false);
    }
  }

  const reasoningEffort = value?.openaiReasoningEffort ?? "";
  const modelOptions = useMemo(() => {
    const set = new Set(openAiModels);
    if (value?.openaiModel) set.add(value.openaiModel);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [openAiModels, value?.openaiModel]);

  const codexSelected = value?.codexModel ?? "";
  const codexSelectedModel = useMemo(
    () => codexModels.find((m) => m.id === codexSelected) ?? null,
    [codexModels, codexSelected]
  );
  const codexEffortOptions = useMemo(() => {
    const supported =
      codexSelectedModel?.supportedReasoningEfforts?.map(
        (e) => e.reasoningEffort
      ) ?? [];
    const set = new Set(supported);
    const current = value?.codexEffort;
    if (current) set.add(current);
    const def = codexSelectedModel?.defaultReasoningEffort;
    if (def) set.add(def);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [codexSelectedModel, value?.codexEffort]);

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
        <div className="card-title">LLM Provider</div>
        <div className="muted">
          Choose how SyllabusOps calls models. “Codex” uses your Codex/ChatGPT
          sign-in (no API key). “OpenAI API” uses OAuth/API key.
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="llmProvider">Provider</label>
          <select
            id="llmProvider"
            className="input"
            value={value?.llmProvider ?? "codex"}
            onChange={(e) =>
              setValue((v) =>
                v
                  ? {
                      ...v,
                      llmProvider: e.target.value as Settings["llmProvider"],
                    }
                  : v
              )
            }
          >
            <option value="codex">Codex (ChatGPT auth)</option>
            <option value="openai">OpenAI API</option>
          </select>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="llmMaxOutputTokens">Max output tokens</label>
          <input
            id="llmMaxOutputTokens"
            className="input mono"
            type="number"
            min={256}
            max={8000}
            value={value?.llmMaxOutputTokens ?? 1200}
            onChange={(e) =>
              setValue((v) =>
                v
                  ? {
                      ...v,
                      llmMaxOutputTokens: Number(e.target.value || "1200"),
                    }
                  : v
              )
            }
          />
          <div className="muted" style={{ marginTop: 6 }}>
            Used for JSON-schema jobs (tasks/summaries). Higher = slower/more
            expensive.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Codex</div>
        <div className="muted">
          Uses local <span className="mono">codex app-server</span> and your
          Codex/ChatGPT sign-in.
        </div>

        <div className="kv" style={{ marginTop: 10 }}>
          <div className="k">Available</div>
          <div className="v">
            {codexStatus?.available ? (
              <span className="chip chip-ok">Yes</span>
            ) : (
              <span className="chip chip-warn">No</span>
            )}
          </div>
        </div>
        <div className="kv">
          <div className="k">Auth</div>
          <div className="v">
            {codexStatus?.connected ? (
              <span className="chip chip-ok">
                Connected
                {codexStatus.accountLabel
                  ? ` (${codexStatus.accountLabel})`
                  : ""}
              </span>
            ) : (
              <span className="chip chip-warn">Not connected</span>
            )}
          </div>
        </div>

        {codexStatus?.lastError ? (
          <div className="card card-error" style={{ marginTop: 12 }}>
            {codexStatus.lastError}
          </div>
        ) : null}

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="codexModel">Model</label>
          <div className="row" style={{ gap: 10 }}>
            <input
              id="codexModel"
              className="input mono"
              value={value?.codexModel ?? ""}
              onChange={(e) =>
                setValue((v) => (v ? { ...v, codexModel: e.target.value } : v))
              }
              placeholder="gpt-5.2-codex"
              list="codex-models"
            />
            <button
              type="button"
              className="button"
              disabled={codexModelsBusy}
              onClick={() => void loadCodexModels()}
            >
              {codexModelsBusy ? "Loading…" : "Load models"}
            </button>
          </div>
          <datalist id="codex-models">
            {codexModels.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
          {codexSelectedModel?.description ? (
            <div className="muted" style={{ marginTop: 6 }}>
              {codexSelectedModel.description}
            </div>
          ) : null}
          {codexModelsError ? (
            <div className="muted" style={{ marginTop: 6 }}>
              Models error: {codexModelsError}
            </div>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="codexEffort">Reasoning effort</label>
          <select
            id="codexEffort"
            className="input"
            value={value?.codexEffort ?? ""}
            onChange={(e) =>
              setValue((v) =>
                v
                  ? {
                      ...v,
                      codexEffort: e.target.value
                        ? (e.target.value as Settings["codexEffort"])
                        : undefined,
                    }
                  : v
              )
            }
          >
            <option value="">Default</option>
            {codexEffortOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <div className="muted" style={{ marginTop: 6 }}>
            Uses Codex <span className="mono">turn/start</span> parameter{" "}
            <span className="mono">effort</span> when supported.
          </div>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="button primary"
            disabled={!codexStatus?.available || authBusy}
            onClick={onCodexConnect}
          >
            Connect Codex
          </button>
          <button
            type="button"
            className="button"
            disabled={!codexStatus?.connected || authBusy}
            onClick={onCodexLogout}
          >
            Logout
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
      </div>

      <div className="card">
        <div className="card-title">OpenAI</div>
        <div className="muted">
          OpenAI API calls typically use an API key (stored in macOS Keychain).
          OAuth is an advanced option.
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="openaiApiBaseUrl">API base URL</label>
          <input
            id="openaiApiBaseUrl"
            className="input mono"
            value={value?.openaiApiBaseUrl ?? ""}
            onChange={(e) =>
              setValue((v) =>
                v ? { ...v, openaiApiBaseUrl: e.target.value } : v
              )
            }
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className="field">
          <label htmlFor="openaiModel">Model</label>
          <div className="row" style={{ gap: 10 }}>
            <input
              id="openaiModel"
              className="input mono"
              value={value?.openaiModel ?? ""}
              onChange={(e) =>
                setValue((v) => (v ? { ...v, openaiModel: e.target.value } : v))
              }
              placeholder="gpt-4o-mini"
              list="openai-models"
            />
            <button
              type="button"
              className="button"
              disabled={modelsBusy}
              onClick={() => void loadModels()}
            >
              {modelsBusy ? "Loading…" : "Load models"}
            </button>
          </div>
          <datalist id="openai-models">
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {openAiModelsError ? (
            <div className="muted" style={{ marginTop: 6 }}>
              Models error: {openAiModelsError}
            </div>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="openaiReasoningEffort">Reasoning effort</label>
          <select
            id="openaiReasoningEffort"
            className="input"
            value={reasoningEffort}
            onChange={(e) =>
              setValue((v) =>
                v
                  ? {
                      ...v,
                      openaiReasoningEffort:
                        e.target.value === ""
                          ? undefined
                          : (e.target
                              .value as Settings["openaiReasoningEffort"]),
                    }
                  : v
              )
            }
          >
            <option value="">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <div className="muted" style={{ marginTop: 6 }}>
            Only applies to reasoning-capable models; others ignore or may
            reject it.
          </div>
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
            Connect OAuth (advanced)
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
            Advanced: configure an OAuth client and register the redirect URI.
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

      <div className="card">
        <div className="card-title">Notion</div>
        <div className="muted">
          One-way publish of session summaries and task states into your Notion
          workspace.
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={value?.notionEnabled ?? false}
              onChange={(e) =>
                setValue((v) =>
                  v ? { ...v, notionEnabled: e.target.checked } : v
                )
              }
            />
            <span>Enable Notion publishing</span>
          </label>
        </div>

        <div className="field">
          <label htmlFor="notionRootPageId">Root page ID (or URL)</label>
          <input
            id="notionRootPageId"
            className="input mono"
            value={value?.notionRootPageId ?? ""}
            onChange={(e) =>
              setValue((v) =>
                v ? { ...v, notionRootPageId: e.target.value } : v
              )
            }
            placeholder="https://www.notion.so/... or page id"
          />
        </div>

        <div className="field">
          <label htmlFor="notionApiVersion">Notion API version</label>
          <input
            id="notionApiVersion"
            className="input mono"
            value={value?.notionApiVersion ?? "2025-09-03"}
            onChange={(e) =>
              setValue((v) =>
                v ? { ...v, notionApiVersion: e.target.value } : v
              )
            }
            placeholder="2025-09-03"
          />
        </div>

        <div className="kv" style={{ marginTop: 10 }}>
          <div className="k">Token</div>
          <div className="v">
            {notionStatus?.tokenSet ? (
              <span className="chip chip-ok">Set</span>
            ) : (
              <span className="chip chip-warn">Missing</span>
            )}
          </div>
        </div>
        <div className="kv">
          <div className="k">Connection</div>
          <div className="v">
            {notionStatus?.reachable ? (
              <span className="chip chip-ok">Reachable</span>
            ) : (
              <span className="chip chip-warn">Not reachable</span>
            )}
            {notionStatus?.workspaceName ? (
              <span className="muted"> • {notionStatus.workspaceName}</span>
            ) : null}
            {notionStatus?.botName ? (
              <span className="muted"> • {notionStatus.botName}</span>
            ) : null}
          </div>
        </div>

        {notionStatus?.error ? (
          <div className="card card-error" style={{ marginTop: 12 }}>
            {notionStatus.error}
          </div>
        ) : null}

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="notionToken">Integration token</label>
          <input
            id="notionToken"
            className="input mono"
            value={notionTokenDraft}
            onChange={(e) => setNotionTokenDraft(e.target.value)}
            placeholder={
              notionStatus?.tokenSet ? "(set in Keychain)" : "secret_..."
            }
          />
        </div>

        <div className="row">
          <button
            type="button"
            className="button"
            disabled={!notionTokenDraft.trim() || notionBusy}
            onClick={() => void onSaveNotionToken()}
          >
            Save token
          </button>
          <button
            type="button"
            className="button"
            disabled={!notionStatus?.tokenSet || notionBusy}
            onClick={() => void onClearNotionToken()}
          >
            Clear token
          </button>
          <button
            type="button"
            className="button"
            disabled={notionBusy}
            onClick={() => void onTestNotion()}
          >
            {notionBusy ? "Testing…" : "Test connection"}
          </button>
        </div>

        {notionMsg ? <div className="muted">{notionMsg}</div> : null}
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
        {hasUnsavedChanges ? (
          <div className="muted">Unsaved changes</div>
        ) : null}
        {savedAt ? (
          <div className="muted">saved at {formatLocalTimeOnYmd(savedAt)}</div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Danger Zone</div>
        <div className="muted">
          Clean slate: clears local state (jobs/tasks/cache/logs/revisions) and
          disables ingestion. Optionally wipes the Unified library contents.
          Your original source files are not touched.
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="resetScope">Reset scope</label>
          <select
            id="resetScope"
            className="input"
            value={resetScope}
            onChange={(e) => setResetScope(e.target.value as typeof resetScope)}
          >
            <option value="state">Local state only</option>
            <option value="state+unified">Local state + Unified library</option>
          </select>
          {resetScope === "state+unified" ? (
            <div className="muted" style={{ marginTop: 6 }}>
              Will delete everything under{" "}
              <span className="mono">{value?.unifiedDir ?? "Unified"}</span>.
              SyllabusOps refuses to wipe a folder whose name doesn’t include
              “Unified”.
            </div>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="resetConfirm">Type RESET to confirm</label>
          <input
            id="resetConfirm"
            className="input mono"
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.target.value)}
            placeholder="RESET"
          />
        </div>

        <div className="row">
          <button
            type="button"
            className="button"
            disabled={
              !value ||
              resetBusy ||
              resetConfirm.trim().toUpperCase() !== "RESET"
            }
            onClick={onReset}
          >
            {resetBusy ? "Resetting…" : "Run reset"}
          </button>
          {resetMsg ? <div className="muted">{resetMsg}</div> : null}
        </div>
      </div>
    </div>
  );
}
