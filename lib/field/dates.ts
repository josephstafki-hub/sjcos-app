// Central-time date helpers. All wall-clock math is done by Postgres against
// the tz database (AT TIME ZONE 'America/Chicago') so daylight-saving
// transitions are handled by the database, never by hand-rolled offsets.

import type { Run } from "../commands/core.ts";

export const TZ = "America/Chicago";

/** The Central-time Monday (YYYY-MM-DD) of the week containing `at`. */
export async function centralWeekStart(run: Run, at: Date | string = new Date()): Promise<string> {
  const [row] = await run<{ ws: string }>(
    `SELECT to_char(date_trunc('week', ($1::timestamptz AT TIME ZONE '${TZ}'))::date, 'YYYY-MM-DD') AS ws`,
    [at instanceof Date ? at.toISOString() : at],
  );
  return row.ws;
}

/** The Central-time calendar date (YYYY-MM-DD) of `at`. */
export async function centralDate(run: Run, at: Date | string = new Date()): Promise<string> {
  const [row] = await run<{ d: string }>(`SELECT to_char(($1::timestamptz AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS d`, [
    at instanceof Date ? at.toISOString() : at,
  ]);
  return row.d;
}

/** The absolute instant of `date` at hh:mm Central (DST-safe). */
export async function centralInstant(run: Run, date: string, hour: number, minute = 0): Promise<string> {
  const [row] = await run<{ at: string }>(
    `SELECT to_char((($1::date + make_interval(hours => $2::int, mins => $3::int)) AT TIME ZONE '${TZ}') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
    [date, hour, minute],
  );
  return row.at;
}

/** Central midnight at the start of `date` as an absolute instant (ISO UTC). */
export async function centralMidnight(run: Run, date: string): Promise<string> {
  return centralInstant(run, date, 0, 0);
}

/** The scheduled slot for a week: `weekStart` (Monday) + (weekday − 1) days at
 *  hh:mm Central. ISO weekday 1 = Monday … 7 = Sunday. */
export async function weeklySlotInstant(run: Run, weekStart: string, weekday: number, hour: number, minute: number): Promise<string> {
  const [row] = await run<{ at: string }>(
    `SELECT to_char(((($1::date + make_interval(days => $2::int - 1)) + make_interval(hours => $3::int, mins => $4::int)) AT TIME ZONE '${TZ}') AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
    [weekStart, weekday, hour, minute],
  );
  return row.at;
}

/** Add calendar days to a YYYY-MM-DD date (pure, no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Add business days (Mon–Fri) to a YYYY-MM-DD date. */
export function addBusinessDays(date: string, days: number): string {
  let cur = date;
  let left = Math.max(0, Math.trunc(days));
  while (left > 0) {
    cur = addDays(cur, 1);
    const dow = new Date(cur + "T00:00:00Z").getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return cur;
}

export function isoDateValid(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}
