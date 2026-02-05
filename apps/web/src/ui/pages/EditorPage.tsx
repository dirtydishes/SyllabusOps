import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import {
  type FsEntry,
  type FsRevision,
  fsList,
  fsRead,
  fsRestore,
  fsRevisions,
  fsWrite,
} from "../lib/api";

function joinPath(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a.replace(/\/+$/g, "")}/${b.replace(/^\/+/g, "")}`;
}

function isMarkdownPath(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".md");
}

function isSummaryMarkdown(relPath: string): boolean {
  const p = relPath.replaceAll("\\", "/").toLowerCase();
  if (!p.endsWith(".md")) return false;
  if (!p.includes("/generated/")) return false;
  return p.includes("summary");
}

function safeUrlTransform(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  // Allow relative URLs (no protocol) - keep as-is.
  const looksRelative =
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    !trimmed.includes(":");
  if (looksRelative) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:")
      return trimmed;
    return "";
  } catch {
    return "";
  }
}

export function EditorPage() {
  const [searchParams] = useSearchParams();
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadedSha, setLoadedSha] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"split" | "edit" | "preview">("split");
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<FsRevision[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("Listing…");
    fsList(cwd)
      .then((r) => {
        if (cancelled) return;
        setEntries(r.entries);
        setStatus("Idle");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e?.message ?? e));
        setStatus("Idle");
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const openFile = useCallback(async (relPath: string) => {
    setError(null);
    setStatus("Reading…");
    let finalStatus = "Idle";
    try {
      const r = await fsRead(relPath);
      setSelectedPath(relPath);
      setContent(r.content);
      setLoadedSha(r.sha256);
      setMode((current) => {
        if (isSummaryMarkdown(relPath)) return "preview";
        if (isMarkdownPath(relPath) && current === "preview") return "split";
        return current;
      });
      const rev = await fsRevisions(relPath);
      setRevisions(rev.revisions);
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes("FS_NOT_FOUND")) {
        setSelectedPath(relPath);
        setContent("");
        setLoadedSha(undefined);
        setRevisions([]);
        setMode((current) =>
          isSummaryMarkdown(relPath) ? "preview" : current
        );
        finalStatus = "New file";
      } else {
        setError(msg);
      }
    } finally {
      setStatus(finalStatus);
    }
  }, []);

  async function saveFile() {
    if (!selectedPath) return;
    setError(null);
    setStatus("Saving…");
    try {
      const r = await fsWrite(selectedPath, content, loadedSha);
      setLoadedSha(r.sha256);
      const rev = await fsRevisions(selectedPath);
      setRevisions(rev.revisions);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStatus("Idle");
    }
  }

  async function restoreRevision(revisionFile: string) {
    if (!selectedPath) return;
    const ok = window.confirm(
      `Restore revision ${revisionFile}? This will overwrite the current file.`
    );
    if (!ok) return;

    setError(null);
    setRestoring(revisionFile);
    setStatus("Restoring…");
    try {
      await fsRestore(selectedPath, revisionFile);
      await openFile(selectedPath);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setRestoring(null);
      setStatus("Idle");
    }
  }

  const breadcrumb = useMemo(
    () => (cwd ? cwd.split("/").filter(Boolean) : []),
    [cwd]
  );

  const selectedIsSummary = useMemo(
    () => (selectedPath ? isSummaryMarkdown(selectedPath) : false),
    [selectedPath]
  );

  useEffect(() => {
    const p = searchParams.get("path");
    if (!p) return;
    const dir = p.split("/").slice(0, -1).join("/");
    setCwd(dir);
    void openFile(p);
  }, [openFile, searchParams]);

  return (
    <div className="page editor-page">
      <div className="page-header">
        <h1>Editor</h1>
        <div className="muted">
          <span className="chip chip-neutral">{status}</span>
          {error ? <span className="muted"> • {error}</span> : null}
        </div>
      </div>

      <div className="card">
        <div className="breadcrumbs">
          <button type="button" className="link" onClick={() => setCwd("")}>
            Unified
          </button>
          {breadcrumb.map((seg, idx) => {
            const p = breadcrumb.slice(0, idx + 1).join("/");
            return (
              <span key={p}>
                <span className="muted"> / </span>
                <button
                  type="button"
                  className="link"
                  onClick={() => setCwd(p)}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <div className="editor-grid">
        <div className="card filetree">
          <div className="card-title">Files</div>
          <div className="filetree-list">
            {entries.length === 0 ? (
              <div className="muted">Empty folder.</div>
            ) : (
              entries.map((e) => (
                <button
                  type="button"
                  key={e.name}
                  className={`filetree-item ${selectedPath === joinPath(cwd, e.name) ? "active" : ""}`}
                  onClick={() => {
                    if (e.type === "dir") setCwd(joinPath(cwd, e.name));
                    else void openFile(joinPath(cwd, e.name));
                  }}
                >
                  <span className="mono">
                    {e.type === "dir" ? "dir " : "file"}
                  </span>
                  <span className="filetree-name">{e.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="card editorpane">
          <div className="row row-between">
            <div className="card-title mono">
              {selectedPath ?? "(no file selected)"}
            </div>
            <div className="row">
              {selectedIsSummary ? (
                mode === "edit" ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => setMode("preview")}
                  >
                    Preview
                  </button>
                ) : null
              ) : (
                <div className="segmented">
                  <button
                    type="button"
                    className={mode === "edit" ? "seg active" : "seg"}
                    onClick={() => setMode("edit")}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={mode === "preview" ? "seg active" : "seg"}
                    onClick={() => setMode("preview")}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className={mode === "split" ? "seg active" : "seg"}
                    onClick={() => setMode("split")}
                  >
                    Split
                  </button>
                </div>
              )}
              <button
                type="button"
                className="button primary"
                disabled={!selectedPath || status !== "Idle" || mode !== "edit"}
                onClick={() => void saveFile()}
              >
                Save
              </button>
            </div>
          </div>

          {!selectedPath ? (
            <div className="muted">
              Select a `.md`, `.txt`, `.json`, `.yaml` file from the left.
            </div>
          ) : (
            <div className={`split ${mode}`}>
              {mode !== "preview" ? (
                <div className="pane">
                  <CodeMirror
                    value={content}
                    height="70vh"
                    extensions={[markdown(), EditorView.lineWrapping]}
                    onChange={(v) => setContent(v)}
                    theme="dark"
                  />
                </div>
              ) : null}
              {mode !== "edit" ? (
                <div className="pane preview">
                  {selectedIsSummary && mode === "preview" ? (
                    <button
                      type="button"
                      className="button editor-edit-fab"
                      onClick={() => setMode("edit")}
                      title="Edit markdown"
                    >
                      Edit
                    </button>
                  ) : null}
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    skipHtml
                    urlTransform={safeUrlTransform}
                    components={{
                      a: (props) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noreferrer noopener"
                        />
                      ),
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="card revisions">
          <div className="card-title">Revisions</div>
          {!selectedPath ? (
            <div className="muted">Open a file to see snapshots.</div>
          ) : revisions.length === 0 ? (
            <div className="muted">No revisions yet.</div>
          ) : (
            <div className="revisions-list">
              {revisions.slice(0, 30).map((r) => (
                <div key={r.file} className="revision-row">
                  <div className="mono">{r.file}</div>
                  <div className="muted mono">{r.savedAt ?? ""}</div>
                  <button
                    type="button"
                    className="button"
                    disabled={status !== "Idle" || restoring === r.file}
                    onClick={() => void restoreRevision(r.file)}
                  >
                    {restoring === r.file ? "Restoring…" : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
