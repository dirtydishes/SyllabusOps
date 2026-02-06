import { sha256Hex } from "@syllabusops/core";

export type ParsedIcsEvent = {
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: string | null;
  description: string | null;
  zoomJoinUrl: string | null;
  zoomMeetingId: string | null;
  zoomPasscode: string | null;
};

type DateField = {
  value: string;
  tzid: string | null;
};

type RawIcsEvent = {
  uid: string | null;
  recurrenceId: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  dtstart: DateField | null;
  dtend: DateField | null;
};

type ParsedDateTime = {
  iso: string;
  timezone: string;
};

function unfoldIcsLines(icsText: string): string[] {
  const out: string[] = [];
  const lines = icsText
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  for (const line of lines) {
    if (!line.length) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseIcsProperty(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const lhs = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const parts = lhs.split(";");
  const name = parts[0]?.trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const k = p.slice(0, eq).trim().toUpperCase();
    const v = p.slice(eq + 1).trim();
    if (!k || !v) continue;
    params[k] = v;
  }

  return { name, params, value };
}

function unescapeIcsText(value: string): string {
  return value
    .replaceAll("\\n", "\n")
    .replaceAll("\\N", "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\")
    .trim();
}

function parseDateParts(raw: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
  isUtc: boolean;
} | null {
  const m = raw.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/i
  );
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
    hasTime: Boolean(m[4]),
    isUtc: Boolean(m[7]),
  };
}

function resolveTimeZone(timeZone: string | null): string | null {
  if (!timeZone) return null;
  const tz = timeZone.trim();
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

function offsetMinutesForTz(timeZone: string, epochMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));

  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
    else if (p.type === "hour") hour = Number(p.value);
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "second") second = Number(p.value);
  }

  const zonedEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  return (zonedEpoch - epochMs) / 60_000;
}

function zonedLocalToUtcIso(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  },
  timeZone: string
): string {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const offset1 = offsetMinutesForTz(timeZone, localAsUtc);
  let utcMs = localAsUtc - offset1 * 60_000;
  const offset2 = offsetMinutesForTz(timeZone, utcMs);
  if (offset2 !== offset1) utcMs = localAsUtc - offset2 * 60_000;
  return new Date(utcMs).toISOString();
}

function parseIcsDateTime(
  raw: string,
  tzid: string | null
): ParsedDateTime | null {
  const parsed = parseDateParts(raw);
  if (!parsed) return null;

  const timeZone = resolveTimeZone(tzid) ?? "UTC";
  if (!parsed.hasTime) {
    const iso = new Date(
      Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0)
    ).toISOString();
    return { iso, timezone: timeZone };
  }

  if (parsed.isUtc) {
    const iso = new Date(
      Date.UTC(
        parsed.year,
        parsed.month - 1,
        parsed.day,
        parsed.hour,
        parsed.minute,
        parsed.second
      )
    ).toISOString();
    return { iso, timezone: "UTC" };
  }

  const iso = zonedLocalToUtcIso(parsed, timeZone);
  return { iso, timezone: timeZone };
}

function detectZoomJoinUrl(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s]*zoom\.us\/[^\s)>"']+/i);
  return m?.[0]?.trim() ?? null;
}

function detectZoomMeetingId(text: string | null): string | null {
  if (!text) return null;
  const byLabel = text.match(
    /(?:meeting\s*id|meetingid|id)\s*[:#]?\s*([0-9][0-9 ]{7,})/i
  );
  if (byLabel?.[1]) {
    const digits = byLabel[1].replaceAll(/\D/g, "");
    if (digits.length >= 9) return digits;
  }

  const byPattern = text.match(/\b\d{3}\s?\d{3}\s?\d{4}\b/);
  if (byPattern?.[0]) return byPattern[0].replaceAll(/\D/g, "");
  return null;
}

function detectZoomPasscode(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/(?:passcode|password)\s*[:#]?\s*([A-Za-z0-9._-]{3,})/i);
  return m?.[1] ?? null;
}

function normalizeRawEvent(raw: RawIcsEvent): ParsedIcsEvent | null {
  if (!raw.dtstart?.value) return null;
  const start = parseIcsDateTime(raw.dtstart.value, raw.dtstart.tzid);
  if (!start) return null;

  const parsedEnd = raw.dtend?.value
    ? parseIcsDateTime(raw.dtend.value, raw.dtend.tzid)
    : null;
  const end =
    parsedEnd ??
    ({
      iso: new Date(
        new Date(start.iso).getTime() + 60 * 60 * 1000
      ).toISOString(),
      timezone: start.timezone,
    } satisfies ParsedDateTime);

  if (!end) return null;

  const title = raw.summary?.trim() || "Untitled Event";
  const location = raw.location?.trim() || null;
  const description = raw.description?.trim() || null;
  const zoomSource = [raw.url, location, description]
    .filter(Boolean)
    .join("\n");
  const zoomJoinUrl =
    detectZoomJoinUrl(zoomSource) ?? detectZoomJoinUrl(raw.url);
  const zoomMeetingId = detectZoomMeetingId(zoomSource);
  const zoomPasscode = detectZoomPasscode(zoomSource);

  const uidBase =
    raw.uid?.trim() ||
    `autogen-${sha256Hex(`${title}:${start.iso}:${end.iso}`).slice(0, 16)}`;
  const uid = raw.recurrenceId
    ? `${uidBase}#${raw.recurrenceId.trim()}`
    : uidBase;

  return {
    uid,
    title,
    startsAt: start.iso,
    endsAt: end.iso,
    timezone: start.timezone,
    location,
    description,
    zoomJoinUrl,
    zoomMeetingId,
    zoomPasscode,
  };
}

function blankRawEvent(): RawIcsEvent {
  return {
    uid: null,
    recurrenceId: null,
    summary: null,
    description: null,
    location: null,
    url: null,
    dtstart: null,
    dtend: null,
  };
}

export function parseIcsEvents(icsText: string): ParsedIcsEvent[] {
  const lines = unfoldIcsLines(icsText);
  const out: ParsedIcsEvent[] = [];

  let inVevent = false;
  let current = blankRawEvent();
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inVevent = true;
      current = blankRawEvent();
      continue;
    }
    if (upper === "END:VEVENT") {
      if (inVevent) {
        const normalized = normalizeRawEvent(current);
        if (normalized) out.push(normalized);
      }
      inVevent = false;
      current = blankRawEvent();
      continue;
    }
    if (!inVevent) continue;

    const parsed = parseIcsProperty(line);
    if (!parsed) continue;

    const value = unescapeIcsText(parsed.value);
    const tzid = parsed.params.TZID ?? null;
    if (parsed.name === "UID") current.uid = value;
    else if (parsed.name === "RECURRENCE-ID") current.recurrenceId = value;
    else if (parsed.name === "SUMMARY") current.summary = value;
    else if (parsed.name === "DESCRIPTION") current.description = value;
    else if (parsed.name === "LOCATION") current.location = value;
    else if (parsed.name === "URL") current.url = value;
    else if (parsed.name === "DTSTART") current.dtstart = { value, tzid };
    else if (parsed.name === "DTEND") current.dtend = { value, tzid };
  }

  return out;
}
