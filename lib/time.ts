// Small, dependency-free time helpers shared by server code and client
// components. Everything here is deterministic given its inputs (no locale
// lookups) so a label rendered on the server matches what React hydrates.

/** Deterministic relative-time label, e.g. "just now" / "5m ago" / "3d ago". */
export function relativeAge(seconds: number): string {
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Seconds elapsed since an ISO timestamp (clamped at 0). */
export function secondsSince(iso: string | Date, now: number = Date.now()): number {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((now - t) / 1000));
}

/** Postgres expression rendering an absolute label like "Aug 14, 3:12pm" in
 *  the business time zone. Interpolate the column name; no user input. */
export function sqlAbsoluteLabel(column: string): string {
  return `to_char(${column} AT TIME ZONE 'America/Chicago', 'Mon FMDD, FMHH12:MIam')`;
}
