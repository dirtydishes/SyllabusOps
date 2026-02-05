import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type CourseSummary, getCourses } from "../lib/api";

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").replace("Z", "Z");
}

export function ClassesPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        {!courses ? (
          <div className="muted">Loading…</div>
        ) : courses.length === 0 ? (
          <div className="muted">No courses found in Unified.</div>
        ) : (
          <div className="table courses">
            <div className="table-row table-head">
              <div>Name</div>
              <div>Slug</div>
              <div>Sessions</div>
              <div>Artifacts</div>
              <div>Last ingest</div>
            </div>
            {courses.map((c) => (
              <Link key={c.slug} to={`/classes/${c.slug}`} className="table-row table-link">
                <div className="mono">{c.name}</div>
                <div className="muted mono">{c.slug}</div>
                <div>{c.sessionsCount}</div>
                <div>{c.artifactsCount}</div>
                <div className="muted mono">{fmtIso(c.lastIngestedAt)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
