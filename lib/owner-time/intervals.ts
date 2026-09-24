// Time intervals: the reviewable record behind owner time (A19).
//
// Invariants:
//   • One running manual/site timer per user (confirmed, end_at NULL).
//   • Every clock action is replay-safe on client_event_id (time_events).
//   • Corrections append to correction_history; nothing is deleted.
//   • Overlapping intervals are flagged, and hours are counted as a UNION
//     (never summed twice) — see costing.ts.

import type { Run } from "../commands/core.ts";

export type Category = "site" | "design" | "estimating" | "admin" | "other";
export type Source = "manual" | "geofence_prompt" | "designer_activity" | "timer";
export type State = "inferred" | "confirmed" | "discarded" | "review";

export interface TimeInterval {
  id: string;
  user_id: string;
  project_id: string | null;
  category: Category;
  start_at: string;
  end_at: string | null;
  source: Source;
  state: State;
  review_reason: string | null;
  device_id: string;
  client_event_id: string | null;
  session_id: string | null;
  choices: { projectId: string; name: string; distanceM: number }[];
  suggested_end_at: string | null;
  correction_history: unknown[];
  note: string;
}

export const INTERVAL_COLS = `id, user_id, project_id, category, start_at::text AS start_at, end_at::text AS end_at, source, state, review_reason, device_id,
  client_event_id, session_id, choices, suggested_end_at::text AS suggested_end_at, correction_history, note`;

export class TimeConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TimeConflictError";
  }
}

/** Record a clock action once. Returns { applied: false } on replay. */
export async function recordTimeEvent(run: Run, userId: string, clientEventId: string, kind: string, payload: Record<string, unknown>, intervalId?: string | null): Promise<{ applied: boolean; intervalId: string | null }> {
  const [ins] = await run<{ id: string }>(
    `INSERT INTO time_events (user_id, client_event_id, kind, interval_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (client_event_id) DO NOTHING RETURNING id`,
    [userId, clientEventId, kind, intervalId ?? null, JSON.stringify(payload)],
  );
  if (ins) return { applied: true, intervalId: intervalId ?? null };
  const [prev] = await run<{ interval_id: string | null; user_id: string }>(`SELECT interval_id, user_id FROM time_events WHERE client_event_id = $1`, [clientEventId]);
  if (prev && prev.user_id !== userId) throw new TimeConflictError("This event id belongs to another user.");
  return { applied: false, intervalId: prev?.interval_id ?? null };
}

export async function getInterval(run: Run, id: string, userId: string): Promise<TimeInterval | null> {
  const [row] = await run<TimeInterval>(`SELECT ${INTERVAL_COLS} FROM time_intervals WHERE id = $1 AND user_id = $2`, [id, userId]);
  return row ?? null;
}

/** The user's running site/manual timer, if any. */
export async function runningTimer(run: Run, userId: string): Promise<TimeInterval | null> {
  const [row] = await run<TimeInterval>(
    `SELECT ${INTERVAL_COLS} FROM time_intervals WHERE user_id = $1 AND end_at IS NULL AND state = 'confirmed' AND source IN ('manual','geofence_prompt','timer') ORDER BY start_at DESC LIMIT 1`,
    [userId],
  );
  return row ?? null;
}

export interface StartTimerInput {
  userId: string;
  clientEventId: string;
  projectId: string | null;
  category?: Category;
  startAt?: string;
  source?: "manual" | "timer";
  deviceId?: string;
  note?: string;
}

/** Start a manual/job timer. Refuses if one is already running. */
export async function startTimer(run: Run, input: StartTimerInput): Promise<{ interval: TimeInterval; applied: boolean }> {
  const ev = await recordTimeEvent(run, input.userId, input.clientEventId, "start_timer", { projectId: input.projectId, category: input.category });
  if (!ev.applied) return { interval: (await getInterval(run, ev.intervalId!, input.userId))!, applied: false };
  const running = await runningTimer(run, input.userId);
  if (running) throw new TimeConflictError(`A timer is already running since ${running.start_at}${running.project_id ? " on another job" : ""}. Stop it first.`);
  if (input.projectId) {
    const [p] = await run(`SELECT 1 FROM projects WHERE id = $1`, [input.projectId]);
    if (!p) throw new Error("Unknown project.");
  }
  const [row] = await run<TimeInterval>(
    `INSERT INTO time_intervals (user_id, project_id, category, start_at, source, state, device_id, client_event_id, note)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, 'confirmed', $6, $7, $8) RETURNING ${INTERVAL_COLS}`,
    [input.userId, input.projectId, input.category ?? (input.projectId ? "site" : "admin"), input.startAt ?? null, input.source ?? "timer", input.deviceId ?? "", input.clientEventId, input.note ?? ""],
  );
  await run(`UPDATE time_events SET interval_id = $2 WHERE client_event_id = $1`, [input.clientEventId, row.id]);
  return { interval: row, applied: true };
}

/** Stop a running timer (or clock out). */
export async function stopTimer(run: Run, input: { userId: string; clientEventId: string; intervalId?: string | null; endAt?: string }): Promise<{ interval: TimeInterval | null; applied: boolean }> {
  const ev = await recordTimeEvent(run, input.userId, input.clientEventId, "stop_timer", { intervalId: input.intervalId ?? null, endAt: input.endAt ?? null });
  if (!ev.applied) return { interval: ev.intervalId ? await getInterval(run, ev.intervalId, input.userId) : null, applied: false };
  const target = input.intervalId ? await getInterval(run, input.intervalId, input.userId) : await runningTimer(run, input.userId);
  if (!target) return { interval: null, applied: true };
  if (target.end_at) return { interval: target, applied: true };
  const [row] = await run<TimeInterval>(
    `UPDATE time_intervals SET end_at = COALESCE($3::timestamptz, now()), suggested_end_at = NULL
      WHERE id = $1 AND user_id = $2 AND end_at IS NULL AND COALESCE($3::timestamptz, now()) > start_at RETURNING ${INTERVAL_COLS}`,
    [target.id, input.userId, input.endAt ?? null],
  );
  if (!row) throw new Error("End must be after the start.");
  await run(`UPDATE time_events SET interval_id = $2 WHERE client_event_id = $1`, [input.clientEventId, row.id]);
  return { interval: row, applied: true };
}

export interface CorrectionInput {
  userId: string;
  intervalId: string;
  clientEventId: string;
  by: string;
  startAt?: string;
  endAt?: string | null;
  projectId?: string | null;
  category?: Category;
  state?: "confirmed" | "discarded";
  note?: string;
}

/** Edit an interval with an audit entry. Keep / adjust / discard for a review
 *  or inferred row is the same call with state 'confirmed' or 'discarded'. */
export async function correctInterval(run: Run, input: CorrectionInput): Promise<{ interval: TimeInterval; applied: boolean }> {
  const ev = await recordTimeEvent(run, input.userId, input.clientEventId, "correct", { intervalId: input.intervalId }, input.intervalId);
  const before = await getInterval(run, input.intervalId, input.userId);
  if (!before) throw new Error("No such interval for this user.");
  if (!ev.applied) return { interval: before, applied: false };
  const after = {
    start_at: input.startAt ?? before.start_at,
    end_at: input.endAt === undefined ? before.end_at : input.endAt,
    project_id: input.projectId === undefined ? before.project_id : input.projectId,
    category: input.category ?? before.category,
    state: input.state ?? (before.state === "confirmed" ? "confirmed" : "confirmed"),
  };
  if (after.end_at && Date.parse(after.end_at) <= Date.parse(after.start_at)) throw new Error("End must be after the start.");
  if (after.state === "confirmed" && !after.end_at) {
    const running = await runningTimer(run, input.userId);
    if (running && running.id !== before.id) throw new TimeConflictError("Another timer is running; a second open confirmed interval would double count.");
  }
  const entry = { at: new Date().toISOString(), by: input.by, before: { start_at: before.start_at, end_at: before.end_at, project_id: before.project_id, category: before.category, state: before.state }, after, note: input.note ?? "" };
  const [row] = await run<TimeInterval>(
    `UPDATE time_intervals SET start_at = $3::timestamptz, end_at = $4::timestamptz, project_id = $5, category = $6, state = $7, review_reason = NULL,
            correction_history = correction_history || $8::jsonb
      WHERE id = $1 AND user_id = $2 RETURNING ${INTERVAL_COLS}`,
    [before.id, input.userId, after.start_at, after.end_at, after.project_id, after.category, after.state, JSON.stringify([entry])],
  );
  return { interval: row, applied: true };
}

export interface ReviewFlag {
  intervalId: string;
  flag: "overlap" | "long" | "missing_exit" | "inferred" | "review" | "no_project";
  detail: string;
}

export interface ReviewList {
  from: string;
  to: string;
  intervals: TimeInterval[];
  flags: ReviewFlag[];
  totals: { site: number; office: number; overhead: number };
}

/** Intervals overlapping [from, to) with flags. `long` = 10h+. */
export async function reviewRange(run: Run, userId: string, from: string, to: string): Promise<ReviewList> {
  const intervals = await run<TimeInterval>(
    `SELECT ${INTERVAL_COLS} FROM time_intervals
      WHERE user_id = $1 AND state <> 'discarded' AND start_at < $3::timestamptz AND COALESCE(end_at, now()) > $2::timestamptz
      ORDER BY start_at`,
    [userId, from, to],
  );
  const flags: ReviewFlag[] = [];
  const now = Date.now();
  for (const [i, a] of intervals.entries()) {
    const aS = Date.parse(a.start_at);
    const aE = a.end_at ? Date.parse(a.end_at) : now;
    if (!a.end_at && a.state === "confirmed" && now - aS > 14 * 3600_000) flags.push({ intervalId: a.id, flag: "missing_exit", detail: "running for more than 14 hours" });
    if (aE - aS >= 10 * 3600_000) flags.push({ intervalId: a.id, flag: "long", detail: `${((aE - aS) / 3600_000).toFixed(1)} h` });
    if (a.state === "inferred") flags.push({ intervalId: a.id, flag: "inferred", detail: `${a.source} — confirm, adjust or discard` });
    if (a.state === "review") flags.push({ intervalId: a.id, flag: "review", detail: a.review_reason ?? "needs review" });
    if (a.state === "confirmed" && !a.project_id && a.category === "site") flags.push({ intervalId: a.id, flag: "no_project", detail: "site time without a job" });
    for (const b of intervals.slice(i + 1)) {
      const bS = Date.parse(b.start_at);
      const bE = b.end_at ? Date.parse(b.end_at) : now;
      if (bS < aE && aS < bE && a.state !== "discarded" && b.state !== "discarded") {
        flags.push({ intervalId: a.id, flag: "overlap", detail: `overlaps ${b.id} (${a.source} vs ${b.source}); counted once` });
      }
    }
  }
  const totals = { site: 0, office: 0, overhead: 0 };
  for (const seg of unionSegments(intervals.filter((i) => i.state === "confirmed"), Date.parse(from), Date.parse(to), now)) {
    const h = (seg.end - seg.start) / 3600_000;
    if (!seg.projectId) totals.overhead += h;
    else if (seg.category === "site") totals.site += h;
    else totals.office += h;
  }
  return { from, to, intervals, flags, totals };
}

export interface Segment {
  start: number;
  end: number;
  projectId: string | null;
  category: Category;
  intervalId: string;
}

/** Union of confirmed intervals clipped to [from, to): where two overlap, the
 *  earlier-starting one keeps the time and the other yields it — the same
 *  wall-clock minute is never counted twice. */
export function unionSegments(intervals: TimeInterval[], from: number, to: number, now: number): Segment[] {
  const sorted = [...intervals].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const out: Segment[] = [];
  let cursor = from;
  for (const i of sorted) {
    const s = Math.max(Date.parse(i.start_at), from, cursor);
    const e = Math.min(i.end_at ? Date.parse(i.end_at) : now, to);
    if (e <= s) continue;
    out.push({ start: s, end: e, projectId: i.project_id, category: i.category, intervalId: i.id });
    cursor = e;
  }
  return out;
}

/** Stale open intervals: a designer interval closes at its last credible
 *  activity; a confirmed site timer open longer than `maxHours` moves to
 *  review (never silently clocked out). */
export async function closeStaleIntervals(run: Run, opts: { maxHours?: number } = {}): Promise<{ toReview: number }> {
  const rows = await run(
    `UPDATE time_intervals SET state = 'review', review_reason = 'no clock-out; running longer than ' || $1 || ' hours'
      WHERE end_at IS NULL AND state = 'confirmed' AND source IN ('manual','geofence_prompt','timer') AND start_at < now() - make_interval(hours => $1::int) RETURNING id`,
    [opts.maxHours ?? 14],
  );
  return { toReview: rows.length };
}
