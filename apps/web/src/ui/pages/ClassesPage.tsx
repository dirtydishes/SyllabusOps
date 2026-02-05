import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type CourseSummary, getCourses, mergeCourses, renameCourse } from "../lib/api";
import { formatLocalTimeOnYmd } from "../lib/time";

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  return formatLocalTimeOnYmd(iso);
}

export function ClassesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [mergeDest, setMergeDest] = useState("");
  const [mergeName, setMergeName] = useState("");

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const r = await getCourses();
      setCourses(r.courses);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = useMemo(() => {
    if (!courses || courses.length === 0) return false;
    return courses.every((c) => selectedSet.has(c.slug));
  }, [courses, selectedSet]);

  const selectedCourses = useMemo(() => {
    if (!courses) return [];
    return courses.filter((c) => selectedSet.has(c.slug));
  }, [courses, selectedSet]);

  useEffect(() => {
    if (selectedCourses.length === 1) setRenameDraft(selectedCourses[0]!.name);
    if (selectedCourses.length >= 2 && !selectedSet.has(mergeDest)) setMergeDest(selectedCourses[0]!.slug);
    if (selectedCourses.length < 2) setMergeDest("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourses.map((c) => c.slug).join("|")]);

  function toggle(slug: string) {
    setSelected((prev) => {
      const set = new Set(prev);
      if (set.has(slug)) set.delete(slug);
      else set.add(slug);
      return Array.from(set);
    });
  }

  function toggleAll() {
    if (!courses) return;
    setSelected(allSelected ? [] : courses.map((c) => c.slug));
  }

  async function doRename() {
    if (selected.length !== 1) return;
    const slug = selected[0]!;
    if (!renameDraft.trim()) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await renameCourse(slug, renameDraft.trim());
      await refresh();
    } catch (e: unknown) {
      setActionError(String((e as Error)?.message ?? e));
    } finally {
      setActionBusy(false);
    }
  }

  async function doMerge() {
    if (selected.length < 2) return;
    if (!mergeDest) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await mergeCourses({
        destinationSlug: mergeDest,
        sourceSlugs: selected,
        name: mergeName.trim() ? mergeName.trim() : undefined,
      });
      setSelected([res.destinationSlug]);
      setMergeDest(res.destinationSlug);
      setMergeName("");
      await refresh();
    } catch (e: unknown) {
      setActionError(String((e as Error)?.message ?? e));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Classes</h1>
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

      {error ? <div className="card card-error">Failed to load: {error}</div> : null}

      <div className="card">
        <div className="card-title">Courses</div>
        {selectedCourses.length > 0 ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row row-between">
              <div className="mono">Selected: {selectedCourses.length}</div>
              <button type="button" className="button" onClick={() => setSelected([])} disabled={actionBusy}>
                Clear
              </button>
            </div>
            {actionError ? <div className="muted" style={{ marginTop: 8 }}>{actionError}</div> : null}

            {selectedCourses.length === 1 ? (
              <div style={{ marginTop: 10 }}>
                <div className="muted">Rename (display name only)</div>
                <div className="row" style={{ marginTop: 8, gap: 10 }}>
                  <input
                    className="input"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    placeholder="New name"
                  />
                  <button type="button" className="button primary" disabled={actionBusy || !renameDraft.trim()} onClick={() => void doRename()}>
                    {actionBusy ? "Saving…" : "Rename"}
                  </button>
                </div>
              </div>
            ) : null}

            {selectedCourses.length >= 2 ? (
              <div style={{ marginTop: 12 }}>
                <div className="muted">Merge / alias courses into one canonical course</div>
                <div className="field" style={{ marginTop: 8 }}>
                  <label htmlFor="mergeDest">Destination</label>
                  <select
                    id="mergeDest"
                    className="input"
                    value={mergeDest}
                    onChange={(e) => setMergeDest(e.target.value)}
                  >
                    {selectedCourses.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name} ({c.slug})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="mergeName">Optional name override</label>
                  <input
                    id="mergeName"
                    className="input"
                    value={mergeName}
                    onChange={(e) => setMergeName(e.target.value)}
                    placeholder="(leave blank to keep destination name)"
                  />
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="button primary"
                    disabled={actionBusy || !mergeDest}
                    onClick={() => void doMerge()}
                  >
                    {actionBusy ? "Merging…" : "Merge"}
                  </button>
                  <div className="muted">
                    New ingests will route into the destination course to prevent future duplicates.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!courses ? (
          <div className="muted">Loading…</div>
        ) : courses.length === 0 ? (
          <div className="muted">No courses found in Unified.</div>
        ) : (
          <div className="table courses">
            <div className="table-row table-head">
              <div>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  <span className="muted">Select</span>
                </label>
              </div>
              <div>Name</div>
              <div>Slug</div>
              <div>Sources</div>
              <div>Sessions</div>
              <div>Artifacts</div>
              <div>Last ingest</div>
            </div>
            {courses.map((c) => {
              const checked = selectedSet.has(c.slug);
              return (
                <div key={c.slug} className="table-row table-link">
                  <div>
                    <input type="checkbox" checked={checked} onChange={() => toggle(c.slug)} />
                  </div>
                  <div className="mono">
                    <Link className="table-link" to={`/classes/${c.slug}`}>
                      {c.name}
                    </Link>
                  </div>
                  <div className="muted mono">{c.slug}</div>
                  <div className="muted mono">{Math.max(1, c.memberSlugs?.length ?? 1)}</div>
                  <div>{c.sessionsCount}</div>
                  <div>{c.artifactsCount}</div>
                  <div className="muted mono">{fmtIso(c.lastIngestedAt)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
