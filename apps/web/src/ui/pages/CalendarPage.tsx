import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CalendarEventRow,
  type CalendarScheduleRow,
  type CourseSummary,
  deleteCalendarSchedule,
  getCalendar,
  getCourses,
  importCalendarIcs,
  saveCalendarSchedule,
} from "../lib/api";

const DAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function formatEventWindow(ev: CalendarEventRow): string {
  const s = new Date(ev.starts_at);
  const e = new Date(ev.ends_at);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `${ev.starts_at} → ${ev.ends_at}`;
  }
  const date = s.toLocaleDateString();
  const start = s.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const end = e.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} • ${start} - ${end}`;
}

function sortSchedules(
  schedules: CalendarScheduleRow[]
): CalendarScheduleRow[] {
  return [...schedules].sort((a, b) => {
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    return a.start_time.localeCompare(b.start_time);
  });
}

export function CalendarPage() {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [schedules, setSchedules] = useState<CalendarScheduleRow[]>([]);
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );
  const [zoomJoinUrl, setZoomJoinUrl] = useState("");
  const [zoomMeetingId, setZoomMeetingId] = useState("");
  const [zoomPasscode, setZoomPasscode] = useState("");
  const [icsText, setIcsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCourses()
      .then((r) => {
        if (cancelled) return;
        setCourses(r.courses);
        setSelectedCourse((prev) => prev || r.courses[0]?.slug || "");
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!selectedCourse) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getCalendar({ courseSlug: selectedCourse, limit: 500 });
      setSchedules(sortSchedules(res.schedules));
      setEvents(res.events);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [selectedCourse]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedCourseName = useMemo(() => {
    const match = courses?.find((c) => c.slug === selectedCourse);
    return match?.name ?? selectedCourse;
  }, [courses, selectedCourse]);

  async function submitSchedule() {
    if (!selectedCourse) return;
    setBusy(true);
    setError(null);
    setImportInfo(null);
    try {
      await saveCalendarSchedule({
        courseSlug: selectedCourse,
        dayOfWeek,
        startTime,
        endTime,
        timezone,
        zoomJoinUrl,
        zoomMeetingId,
        zoomPasscode,
      });
      await refresh();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function removeSchedule(id: string) {
    setBusy(true);
    setError(null);
    setImportInfo(null);
    try {
      await deleteCalendarSchedule(id);
      await refresh();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function submitImport() {
    if (!selectedCourse) return;
    if (!icsText.trim()) {
      setError("Paste .ics content first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await importCalendarIcs({
        courseSlug: selectedCourse,
        icsText,
      });
      setImportInfo(
        `Imported ${r.total} event(s): ${r.inserted} new, ${r.updated} updated.`
      );
      await refresh();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Calendar</h1>
        <div className="muted">course schedule + zoom + .ics import</div>
      </div>

      {error ? <div className="card card-error">{error}</div> : null}
      {importInfo ? <div className="card">{importInfo}</div> : null}

      <div className="classes-grid">
        <div className="card">
          <div className="card-title">Courses</div>
          {!courses ? (
            <div className="muted">Loading…</div>
          ) : courses.length === 0 ? (
            <div className="muted">No courses yet.</div>
          ) : (
            <div className="session-list">
              {courses.map((c) => {
                const active = c.slug === selectedCourse;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    className={active ? "session-item active" : "session-item"}
                    onClick={() => setSelectedCourse(c.slug)}
                  >
                    <div className="row row-between" style={{ width: "100%" }}>
                      <div className="mono">{c.name}</div>
                      <div className="muted mono">{c.slug}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="page" style={{ gap: 14 }}>
          <div className="card">
            <div className="row row-between">
              <div>
                <div className="card-title">Recurring Schedule</div>
                <div className="muted mono">{selectedCourseName || "—"}</div>
              </div>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Refresh
              </button>
            </div>

            <div className="grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="day">Day</label>
                <select
                  id="day"
                  className="input"
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                >
                  {DAY_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="tz">Timezone</label>
                <input
                  id="tz"
                  className="input mono"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="America/New_York"
                />
              </div>

              <div className="field">
                <label htmlFor="start">Start</label>
                <input
                  id="start"
                  className="input mono"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="end">End</label>
                <input
                  id="end"
                  className="input mono"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="grid" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="zoom-url">Zoom Join URL</label>
                <input
                  id="zoom-url"
                  className="input mono"
                  value={zoomJoinUrl}
                  onChange={(e) => setZoomJoinUrl(e.target.value)}
                  placeholder="https://school.zoom.us/j/..."
                />
              </div>

              <div className="field">
                <label htmlFor="zoom-id">Meeting ID</label>
                <input
                  id="zoom-id"
                  className="input mono"
                  value={zoomMeetingId}
                  onChange={(e) => setZoomMeetingId(e.target.value)}
                  placeholder="123 456 7890"
                />
              </div>

              <div className="field">
                <label htmlFor="zoom-pass">Passcode</label>
                <input
                  id="zoom-pass"
                  className="input mono"
                  value={zoomPasscode}
                  onChange={(e) => setZoomPasscode(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="button primary"
                disabled={busy || !selectedCourse}
                onClick={() => void submitSchedule()}
              >
                Save Schedule
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="row row-between">
                <div className="mono">Current Recurring Blocks</div>
                <span className="chip chip-neutral">{schedules.length}</span>
              </div>
              {schedules.length === 0 ? (
                <div className="muted" style={{ marginTop: 8 }}>
                  No recurring blocks yet.
                </div>
              ) : (
                <div className="task-list" style={{ marginTop: 8 }}>
                  {schedules.map((s) => (
                    <div key={s.id} className="task-item">
                      <div
                        className="row row-between"
                        style={{ width: "100%" }}
                      >
                        <div>
                          <div className="mono">
                            {DAY_OPTIONS.find((d) => d.value === s.day_of_week)
                              ?.label ?? "Day"}{" "}
                            • {s.start_time}-{s.end_time}
                          </div>
                          <div className="muted mono" style={{ marginTop: 4 }}>
                            {s.timezone}
                          </div>
                          {s.zoom_join_url ? (
                            <div
                              className="muted mono"
                              style={{ marginTop: 4, fontSize: 12 }}
                            >
                              {s.zoom_join_url}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => void removeSchedule(s.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Import .ics</div>
            <div className="muted" style={{ marginBottom: 10 }}>
              Paste an `.ics` file body to create/update events for this course.
            </div>
            <textarea
              className="textarea mono"
              rows={10}
              placeholder="BEGIN:VCALENDAR..."
              value={icsText}
              onChange={(e) => setIcsText(e.target.value)}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="button primary"
                disabled={busy || !selectedCourse}
                onClick={() => void submitImport()}
              >
                Import ICS
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="row row-between">
                <div className="mono">Imported Events</div>
                <span className="chip chip-neutral">{events.length}</span>
              </div>
              {events.length === 0 ? (
                <div className="muted" style={{ marginTop: 8 }}>
                  No imported events.
                </div>
              ) : (
                <div className="task-list" style={{ marginTop: 8 }}>
                  {events.map((ev) => (
                    <div key={ev.id} className="task-item">
                      <div className="mono">{ev.title}</div>
                      <div className="muted mono" style={{ marginTop: 4 }}>
                        {formatEventWindow(ev)} • {ev.timezone}
                      </div>
                      {ev.zoom_join_url ? (
                        <div
                          className="muted mono"
                          style={{ marginTop: 4, fontSize: 12 }}
                        >
                          {ev.zoom_join_url}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
