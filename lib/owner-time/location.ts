// Location events → arrival prompts (A19). Location suggests attendance; it
// never establishes work. Rules:
//   • the server matches the event to job_sites (haversine, radius_m);
//   • several nearby jobs → ONE prompt carrying the choices; never auto-pick;
//   • a prompt is an 'inferred' interval; only confirmClockIn makes it count;
//   • enter→exit inside dwell_s (drive-by) discards the prompt;
//   • repeated enter/exit inside cooldown_s (boundary flapping) creates no
//     second prompt;
//   • exit suggests an end time on a confirmed interval; it never clocks out.

import type { Run } from "../commands/core.ts";
import { getInterval, INTERVAL_COLS, recordTimeEvent, runningTimer, TimeConflictError, type Category, type TimeInterval } from "./intervals.ts";

export interface LocationEventInput {
  userId: string;
  deviceId: string;
  clientEventId: string;
  kind: "enter" | "exit" | "heartbeat";
  lat: number;
  lng: number;
  accuracyM?: number | null;
  at: string;
}

export interface Candidate {
  projectId: string;
  name: string;
  distanceM: number;
  dwellS: number;
  cooldownS: number;
}

export async function nearbyJobSites(run: Run, lat: number, lng: number): Promise<Candidate[]> {
  return run<Candidate>(
    `SELECT s.project_id AS "projectId", p.name, round(d.dist)::int AS "distanceM", s.dwell_s AS "dwellS", s.cooldown_s AS "cooldownS"
       FROM job_sites s JOIN projects p ON p.id = s.project_id,
       LATERAL (SELECT 2 * 6371000 * asin(sqrt(power(sin(radians(($1 - s.lat) / 2)), 2) + cos(radians(s.lat)) * cos(radians($1)) * power(sin(radians(($2 - s.lng) / 2)), 2))) AS dist) d
      WHERE s.enabled AND d.dist <= s.radius_m
      ORDER BY d.dist`,
    [lat, lng],
  );
}

export type LocationOutcome =
  | { kind: "duplicate" }
  | { kind: "ignored"; reason: string }
  | { kind: "prompt"; interval: TimeInterval; choices: Candidate[] }
  | { kind: "discarded_drive_by"; intervalId: string }
  | { kind: "exit_suggested"; interval: TimeInterval }
  | { kind: "exit_review"; interval: TimeInterval };

export async function ingestLocationEvent(run: Run, input: LocationEventInput): Promise<LocationOutcome> {
  const [u] = await run<{ role: string }>(`SELECT role FROM users WHERE id = $1 AND active`, [input.userId]);
  if (!u || u.role !== "owner") throw new TimeConflictError("Location tracking is owner-only.");
  const candidates = await nearbyJobSites(run, input.lat, input.lng);
  const [ins] = await run<{ id: string }>(
    `INSERT INTO location_events (user_id, device_id, client_event_id, kind, project_candidates, lat, lng, accuracy_m, at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::timestamptz) ON CONFLICT (client_event_id) DO NOTHING RETURNING id`,
    [input.userId, input.deviceId, input.clientEventId, input.kind, JSON.stringify(candidates.map((c) => ({ project_id: c.projectId, distance_m: c.distanceM }))), input.lat, input.lng, input.accuracyM ?? null, input.at],
  );
  if (!ins) return { kind: "duplicate" };
  if (input.kind === "heartbeat") return { kind: "ignored", reason: "heartbeat recorded" };
  if (input.kind === "exit") return handleExit(run, input, candidates);
  if (!candidates.length) return { kind: "ignored", reason: "no job site within range" };
  if ((input.accuracyM ?? 0) > 500) return { kind: "ignored", reason: "location accuracy too poor to suggest a job" };

  // A running confirmed timer on one of these jobs: nothing to prompt.
  const running = await runningTimer(run, input.userId);
  if (running && candidates.some((c) => c.projectId === running.project_id)) return { kind: "ignored", reason: "already clocked in here" };

  // Cooldown / flapping: an existing prompt or a session that ended recently
  // for any of the candidate jobs suppresses a new prompt.
  const cooldown = Math.max(...candidates.map((c) => c.cooldownS));
  const [recent] = await run<{ id: string }>(
    `SELECT id FROM time_intervals
      WHERE user_id = $1 AND source = 'geofence_prompt'
        AND (project_id = ANY($2::uuid[]) OR choices @> ANY(SELECT jsonb_build_array(jsonb_build_object('projectId', x)) FROM unnest($2::uuid[]) x))
        AND COALESCE(end_at, start_at) > $3::timestamptz - make_interval(secs => $4::int)
      ORDER BY start_at DESC LIMIT 1`,
    [input.userId, candidates.map((c) => c.projectId), input.at, cooldown],
  );
  if (recent) return { kind: "ignored", reason: "inside cooldown of an earlier prompt/session for this job" };

  const single = candidates.length === 1 ? candidates[0] : null;
  const [row] = await run<TimeInterval>(
    `INSERT INTO time_intervals (user_id, project_id, category, start_at, source, state, device_id, client_event_id, choices, note)
     VALUES ($1, $2, 'site', $3::timestamptz, 'geofence_prompt', 'inferred', $4, $5, $6::jsonb, $7) RETURNING ${INTERVAL_COLS}`,
    [input.userId, single?.projectId ?? null, input.at, input.deviceId, input.clientEventId, JSON.stringify(candidates.map((c) => ({ projectId: c.projectId, name: c.name, distanceM: c.distanceM }))), single ? `At ${single.name}? Clock in.` : "Several jobs nearby — pick one."],
  );
  // An earlier arrival prompt that was never answered is not the current
  // one any more: park it for review instead of leaving it open forever.
  await run(`UPDATE time_intervals SET state = 'review', review_reason = 'arrival prompt not answered; a newer arrival was detected' WHERE user_id = $1 AND source = 'geofence_prompt' AND state = 'inferred' AND end_at IS NULL AND id <> $2`, [input.userId, row.id]);
  return { kind: "prompt", interval: row, choices: candidates };
}

async function handleExit(run: Run, input: LocationEventInput, candidates: Candidate[]): Promise<LocationOutcome> {
  // Open prompt for this device/user? Inside dwell → drive-by → discard.
  const running = await runningTimer(run, input.userId);
  if (running && running.source === "geofence_prompt" && candidates.some((c) => c.projectId === running.project_id)) {
    const [row] = await run<TimeInterval>(`UPDATE time_intervals SET suggested_end_at = $2::timestamptz WHERE id = $1 RETURNING ${INTERVAL_COLS}`, [running.id, input.at]);
    return { kind: "exit_suggested", interval: row };
  }
  const [prompt] = await run<TimeInterval & { dwell_s: number }>(
    `SELECT ${INTERVAL_COLS}, COALESCE((SELECT max(dwell_s) FROM job_sites WHERE project_id = t.project_id OR project_id IN (SELECT (c->>'projectId')::uuid FROM jsonb_array_elements(t.choices) c)), 300) AS dwell_s
       FROM time_intervals t WHERE user_id = $1 AND source = 'geofence_prompt' AND state = 'inferred' AND end_at IS NULL ORDER BY start_at DESC LIMIT 1`,
    [input.userId],
  );
  if (prompt) {
    const dwelled = (Date.parse(input.at) - Date.parse(prompt.start_at)) / 1000;
    if (dwelled < prompt.dwell_s) {
      await run(`UPDATE time_intervals SET state = 'discarded', end_at = $2::timestamptz, review_reason = 'drive-by: left inside the dwell window' WHERE id = $1`, [prompt.id, input.at]);
      return { kind: "discarded_drive_by", intervalId: prompt.id };
    }
    // Stayed long enough but never confirmed → leave the prompt with a
    // suggested end so the review shows a bounded interval, not an open one.
    const [row] = await run<TimeInterval>(`UPDATE time_intervals SET suggested_end_at = $2::timestamptz, state = 'review', review_reason = 'arrival prompt not answered; departure detected' WHERE id = $1 RETURNING ${INTERVAL_COLS}`, [prompt.id, input.at]);
    return { kind: "exit_review", interval: row };
  }
  return { kind: "ignored", reason: "no session to end" };
}

/** Manual "I'm at <job>" without a geofence: same inferred prompt shape. */
export async function proposeClockIn(run: Run, input: { userId: string; clientEventId: string; projectId: string; at?: string; deviceId?: string }): Promise<{ interval: TimeInterval; applied: boolean }> {
  const ev = await recordTimeEvent(run, input.userId, input.clientEventId, "propose_clock_in", { projectId: input.projectId });
  if (!ev.applied) return { interval: (await getInterval(run, ev.intervalId!, input.userId))!, applied: false };
  const [p] = await run<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [input.projectId]);
  if (!p) throw new Error("Unknown project.");
  const [row] = await run<TimeInterval>(
    `INSERT INTO time_intervals (user_id, project_id, category, start_at, source, state, device_id, client_event_id, choices, note)
     VALUES ($1, $2, 'site', COALESCE($3::timestamptz, now()), 'geofence_prompt', 'inferred', $4, $5, $6::jsonb, $7) RETURNING ${INTERVAL_COLS}`,
    [input.userId, input.projectId, input.at ?? null, input.deviceId ?? "", input.clientEventId, JSON.stringify([{ projectId: input.projectId, name: p.name, distanceM: 0 }]), `At ${p.name}? Clock in.`],
  );
  await run(`UPDATE time_events SET interval_id = $2 WHERE client_event_id = $1`, [input.clientEventId, row.id]);
  return { interval: row, applied: true };
}

/** Joe answers the prompt. With several choices he must name the job. The
 *  observed arrival time is editable. One running site timer at a time. */
export async function confirmClockIn(
  run: Run,
  input: { userId: string; clientEventId: string; intervalId: string; projectId?: string | null; startAt?: string; category?: Category },
): Promise<{ interval: TimeInterval; applied: boolean }> {
  const ev = await recordTimeEvent(run, input.userId, input.clientEventId, "confirm_clock_in", { intervalId: input.intervalId, projectId: input.projectId ?? null }, input.intervalId);
  const cur = await getInterval(run, input.intervalId, input.userId);
  if (!cur) throw new Error("No such prompt for this user.");
  if (!ev.applied || cur.state === "confirmed") return { interval: cur, applied: false };
  if (cur.state === "discarded") throw new TimeConflictError("That prompt was discarded (drive-by).");
  const projectId = input.projectId ?? cur.project_id;
  if (!projectId) throw new TimeConflictError("Several jobs were nearby — pick which one.");
  if (cur.choices.length && !cur.choices.some((c) => c.projectId === projectId)) throw new TimeConflictError("That job was not among the nearby choices.");
  const running = await runningTimer(run, input.userId);
  if (running && running.id !== cur.id) throw new TimeConflictError(`A timer is already running since ${running.start_at}. Stop it before clocking in here.`);
  const [row] = await run<TimeInterval>(
    `UPDATE time_intervals SET state = 'confirmed', project_id = $3, start_at = COALESCE($4::timestamptz, start_at), category = COALESCE($5, category), review_reason = NULL,
            correction_history = correction_history || $6::jsonb
      WHERE id = $1 AND user_id = $2 RETURNING ${INTERVAL_COLS}`,
    [cur.id, input.userId, projectId, input.startAt ?? null, input.category ?? null, JSON.stringify([{ at: new Date().toISOString(), by: "owner", note: "confirmed arrival", before: { state: cur.state, start_at: cur.start_at, project_id: cur.project_id }, after: { state: "confirmed", start_at: input.startAt ?? cur.start_at, project_id: projectId } }])],
  );
  return { interval: row, applied: true };
}

/** Clock out (or accept the suggested departure). */
export async function clockOut(run: Run, input: { userId: string; clientEventId: string; intervalId?: string | null; endAt?: string; acceptSuggested?: boolean }): Promise<{ interval: TimeInterval | null; applied: boolean }> {
  const ev = await recordTimeEvent(run, input.userId, input.clientEventId, "clock_out", { intervalId: input.intervalId ?? null, endAt: input.endAt ?? null });
  if (!ev.applied) return { interval: ev.intervalId ? await getInterval(run, ev.intervalId, input.userId) : null, applied: false };
  const target = input.intervalId ? await getInterval(run, input.intervalId, input.userId) : await runningTimer(run, input.userId);
  if (!target) return { interval: null, applied: true };
  if (target.end_at) return { interval: target, applied: true };
  const end = input.endAt ?? (input.acceptSuggested ? target.suggested_end_at : null);
  const [row] = await run<TimeInterval>(
    `UPDATE time_intervals SET end_at = COALESCE($3::timestamptz, now()), suggested_end_at = NULL, state = CASE WHEN state = 'review' THEN 'confirmed' ELSE state END, review_reason = NULL
      WHERE id = $1 AND user_id = $2 AND end_at IS NULL AND COALESCE($3::timestamptz, now()) > start_at RETURNING ${INTERVAL_COLS}`,
    [target.id, input.userId, end],
  );
  if (!row) throw new Error("End must be after the start.");
  await run(`UPDATE time_events SET interval_id = $2 WHERE client_event_id = $1`, [input.clientEventId, row.id]);
  return { interval: row, applied: true };
}

/** Delete raw location events older than the retention setting (default 30 days). */
export async function pruneLocationEvents(run: Run): Promise<number> {
  const [s] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'owner_time.location_retention_days'`);
  const days = Math.max(1, Number(s?.value) || 30);
  const rows = await run(`DELETE FROM location_events WHERE at < now() - make_interval(days => $1::int) RETURNING id`, [days]);
  return rows.length;
}
