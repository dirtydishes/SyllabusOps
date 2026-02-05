import path from "node:path";

export function detectSessionDate(opts: {
  sourcePath: string;
  mtimeMs: number;
  tz?: string;
}): string {
  const fromName = detectDateInFileName(path.basename(opts.sourcePath));
  if (fromName) return fromName;

  // Fallback: local time from mtime
  const d = new Date(opts.mtimeMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function detectDateInFileName(name: string): string | null {
  // Common patterns: YYYY-MM-DD / YYYY_MM_DD / YYYY.MM.DD
  const m1 = name.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;

  // Also handle MM-DD-YYYY (Zoom exports sometimes)
  const m2 = name.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/);
  if (m2) return `${m2[3]}-${m2[1]}-${m2[2]}`;

  return null;
}
