import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type FsEntry, fsList, fsRead, fsWrite } from "../lib/api";

function joinPath(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a.replace(/\/+$/g, "")}/${b.replace(/^\/+/g, "")}`;
}

export function EditorPage() {
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadedSha, setLoadedSha] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"split" | "edit" | "preview">("split");
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);

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

  async function openFile(relPath: string) {
    setError(null);
    setStatus("Reading…");
    try {
      const r = await fsRead(relPath);
      setSelectedPath(relPath);
      setContent(r.content);
      setLoadedSha(r.sha256);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStatus("Idle");
    }
  }

  async function saveFile() {
    if (!selectedPath) return;
    setError(null);
    setStatus("Saving…");
    try {
      const r = await fsWrite(selectedPath, content, loadedSha);
      setLoadedSha(r.sha256);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStatus("Idle");
    }
  }

  const breadcrumb = useMemo(
    () => (cwd ? cwd.split("/").filter(Boolean) : []),
    [cwd]
  );

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
              <button
                type="button"
                className="button primary"
                disabled={!selectedPath || status !== "Idle"}
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
                    extensions={[markdown()]}
                    onChange={(v) => setContent(v)}
                    theme="dark"
                  />
                </div>
              ) : null}
              {mode !== "edit" ? (
                <div className="pane preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                  </ReactMarkdown>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
