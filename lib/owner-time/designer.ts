// Designer activity → bounded office intervals (A19 / A21 contract).
//
//   • Events are (session_id, seq)-unique; replays are no-ops.
//   • The project is resolved SERVER-SIDE from plan_designs.project_id; a
//     client-supplied project id is ignored.
//   • Active time = runs of focus/heartbeat events with gaps under the idle
//     threshold (default 5 min). A longer gap closes the run at the last
//     credible event and opens a 'review' gap row (keep / adjust / discard).
//   • blur / idle / end close the run at that instant.
//   • Two tabs/devices on the same job: intervals are merged per (user,
//     project, category) so the same minute is never counted twice.
//   • A designer interval overlapping a confirmed site timer is flagged as a
//     conflict in review and counted once in costing (union).

import type { Run } from "../commands/core.ts";
import { INTERVAL_COLS, type TimeInterval } from "./intervals.ts";

export interface DesignerEventInput {
  userId: string;
  designId: number;
  sessionId: string;
  seq: number;
  kind: "focus" | "heartbeat" | "blur" | "idle" | "end";
  at: string;
  deviceId?: string;
}

export async function ingestDesignerActivity(run: Run, input: DesignerEventInput, opts: { idleThresholdSec?: number } = {}): Promise<{ recorded: boolean; projectId: string | null }> {
  const [u] = await run<{ role: string }>(`SELECT role FROM users WHERE id = $1 AND active`, [input.userId]);
  if (!u || u.role !== "owner") throw new Error("Designer time capture is owner-only.");
  const [d] = await run<{ project_id: string | null }>(`SELECT project_id FROM plan_designs WHERE id = $1`, [input.designId]);
  if (!d) throw new Error("Unknown design.");
  const [ins] = await run<{ id: string }>(
    `INSERT INTO designer_activity_events (user_id, design_id, project_id, session_id, seq, kind, device_id, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz) ON CONFLICT (session_id, seq) DO NOTHING RETURNING id`,
    [input.userId, input.designId, d.project_id, input.sessionId, input.seq, input.kind, input.deviceId ?? "", input.at],
  );
  if (!ins) return { recorded: false, projectId: d.project_id };
  await materializeDesignerIntervals(run, input.userId, input.sessionId, opts);
  return { recorded: true, projectId: d.project_id };
}

interface Ev {
  seq: number;
  kind: string;
  at: string;
  project_id: string | null;
  design_id: number | null;
}

/** Rebuild the intervals for one session from its events (idempotent). */
export async function materializeDesignerIntervals(run: Run, userId: string, sessionId: string, opts: { idleThresholdSec?: number } = {}): Promise<TimeInterval[]> {
  const idle = (opts.idleThresholdSec ?? (await configuredIdleSeconds(run))) * 1000;
  const events = await run<Ev>(`SELECT seq, kind, at::text AS at, project_id, design_id FROM designer_activity_events WHERE user_id = $1 AND session_id = $2 ORDER BY at, seq`, [userId, sessionId]);
  // Compute runs.
  const runs: { start: string; end: string; projectId: string | null; gapAfter: boolean }[] = [];
  let cur: { start: string; last: string; projectId: string | null } | null = null;
  for (const e of events) {
    const t = Date.parse(e.at);
    if (cur && t - Date.parse(cur.last) > idle) {
      runs.push({ start: cur.start, end: cur.last, projectId: cur.projectId, gapAfter: e.kind === "focus" || e.kind === "heartbeat" });
      cur = null;
    }
    if (e.kind === "focus" || e.kind === "heartbeat") {
      if (!cur) cur = { start: e.at, last: e.at, projectId: e.project_id };
      else cur.last = e.at;
    } else if (cur) {
      runs.push({ start: cur.start, end: e.at, projectId: cur.projectId, gapAfter: false });
      cur = null;
    }
  }
  if (cur) runs.push({ start: cur.start, end: cur.last, projectId: cur.projectId, gapAfter: false });

  // Replace this session's rows (keep any the owner already corrected).
  await run(`DELETE FROM time_intervals WHERE user_id = $1 AND session_id = $2 AND source = 'designer_activity' AND correction_history = '[]'::jsonb`, [userId, sessionId]);
  const out: TimeInterval[] = [];
  for (const [i, r] of runs.entries()) {
    if (Date.parse(r.end) <= Date.parse(r.start)) continue;
    const [row] = await run<TimeInterval>(
      `INSERT INTO time_intervals (user_id, project_id, category, start_at, end_at, source, state, session_id, client_event_id, note)
       VALUES ($1, $2, 'design', $3::timestamptz, $4::timestamptz, 'designer_activity', 'inferred', $5, $6, 'active designer work') RETURNING ${INTERVAL_COLS}`,
      [userId, r.projectId, r.start, r.end, sessionId, `${sessionId}:run${i}`],
    );
    if (row) out.push(row);
    // A long gap followed by more activity: reviewable gap row (keep / adjust / discard).
    const next = runs[i + 1];
    if (r.gapAfter && next) {
      const [gap] = await run<TimeInterval>(
        `INSERT INTO time_intervals (user_id, project_id, category, start_at, end_at, source, state, review_reason, session_id, client_event_id, note)
         VALUES ($1, $2, 'design', $3::timestamptz, $4::timestamptz, 'designer_activity', 'review', 'idle gap — were you thinking, or away?', $5, $6, 'gap') RETURNING ${INTERVAL_COLS}`,
        [userId, r.projectId, r.end, next.start, sessionId, `${sessionId}:gap${i}`],
      );
      if (gap) out.push(gap);
    }
  }
  await mergeDuplicateDesignerIntervals(run, userId);
  return out;
}

async function configuredIdleSeconds(run: Run): Promise<number> {
  const [s] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'owner_time.idle_threshold_seconds'`);
  const n = Number(s?.value);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/** Two devices/tabs on the same job at the same time: keep the earlier row,
 *  extend it, drop the overlapping duplicate (inferred rows only). */
export async function mergeDuplicateDesignerIntervals(run: Run, userId: string): Promise<number> {
  const rows = await run<TimeInterval>(
    `SELECT ${INTERVAL_COLS} FROM time_intervals WHERE user_id = $1 AND source = 'designer_activity' AND state = 'inferred' AND end_at IS NOT NULL ORDER BY project_id, start_at`,
    [userId],
  );
  let merged = 0;
  let keepId: string | null = null;
  let keepProject: string | null = null;
  let keepEnd = 0;
  for (const r of rows) {
    const rStart = Date.parse(r.start_at);
    const rEnd = Date.parse(r.end_at!);
    if (keepId && keepProject === r.project_id && rStart < keepEnd) {
      const newEnd: number = Math.max(rEnd, keepEnd);
      await run(`UPDATE time_intervals SET end_at = $2::timestamptz, note = note || ' (merged overlapping session)' WHERE id = $1`, [keepId, new Date(newEnd).toISOString()]);
      await run(`DELETE FROM time_intervals WHERE id = $1`, [r.id]);
      keepEnd = newEnd;
      merged++;
      continue;
    }
    keepId = r.id;
    keepProject = r.project_id;
    keepEnd = rEnd;
  }
  return merged;
}

/** Sessions with no event for longer than the idle threshold are closed at
 *  their last credible activity (already the case by construction — this
 *  re-materializes any session that still has an open run). */
export async function closeStaleDesignerSessions(run: Run, userId: string, opts: { idleThresholdSec?: number } = {}): Promise<number> {
  const rows = await run<{ session_id: string }>(
    `SELECT DISTINCT session_id FROM designer_activity_events WHERE user_id = $1 AND at > now() - interval '2 days'`,
    [userId],
  );
  for (const r of rows) await materializeDesignerIntervals(run, userId, r.session_id, opts);
  return rows.length;
}
