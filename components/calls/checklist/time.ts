// Times on the checklist screens are America/Chicago (plan §6), whatever the
// device or server clock zone is.

const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // Postgres ::text gives "2026-11-02 16:00:00.12+00"; make it ISO first.
  const d = new Date(iso.trim().replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "10:42 AM" */
export function chicagoTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? TIME.format(d) : "";
}

/** "Nov 2 · 10:42 AM" */
export function chicagoWhen(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? `${DAY.format(d)} · ${TIME.format(d)}` : "";
}

/** "04:21" since `iso`, or "1:04:21" past an hour. */
export function elapsed(iso: string | null | undefined, now: number): string {
  const d = parse(iso);
  if (!d) return "";
  const s = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Whole minutes between two instants, for "12 min". */
export function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = parse(from), b = parse(to);
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

/** "under 1 min" / "12 min" between two instants, for the summary title. */
export function durationWords(from: string | null | undefined, to: string | null | undefined): string | null {
  const a = parse(from), b = parse(to);
  if (!a || !b) return null;
  const s = Math.max(0, (b.getTime() - a.getTime()) / 1000);
  return s < 60 ? "under 1 min" : `${Math.round(s / 60)} min`;
}
