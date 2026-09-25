// Worker registration + heartbeat on the `workers` table (0001). One row per
// worker NAME; the instance id fences a superseded process: when a newer
// instance registers under the same name, the old instance's heartbeats
// return false and it must stop claiming work. Pure.

import type { Run } from "../commands/core.ts";

export interface WorkerRow {
  name: string;
  instance_id: string;
  version: string;
  state: string;
  note: string;
  started_at: string;
  heartbeat_at: string;
  last_run_at: string | null;
  last_result: Record<string, unknown> | null;
}

const COLS = `name, instance_id, version, state, note, started_at::text AS started_at, heartbeat_at::text AS heartbeat_at,
  last_run_at::text AS last_run_at, last_result`;

export async function registerWorker(run: Run, w: { name: string; instanceId: string; version: string }): Promise<WorkerRow> {
  const [row] = await run<WorkerRow>(
    `INSERT INTO workers (name, instance_id, version, state, note, started_at, heartbeat_at)
     VALUES ($1, $2, $3, 'starting', '', now(), now())
     ON CONFLICT (name) DO UPDATE SET instance_id = EXCLUDED.instance_id, version = EXCLUDED.version,
       state = 'starting', note = '', started_at = now(), heartbeat_at = now()
     RETURNING ${COLS}`,
    [w.name, w.instanceId, w.version],
  );
  return row;
}

/** Heartbeat fenced on instance id. False → another instance took over. */
export async function heartbeatWorker(run: Run, w: { name: string; instanceId: string }, state: string, note = ""): Promise<boolean> {
  const rows = await run(
    `UPDATE workers SET heartbeat_at = now(), state = $3, note = $4 WHERE name = $1 AND instance_id = $2 RETURNING name`,
    [w.name, w.instanceId, state, note.slice(0, 500)],
  );
  return rows.length === 1;
}

/** Record the outcome of one iteration (fenced on instance id). */
export async function recordIteration(run: Run, w: { name: string; instanceId: string }, result: Record<string, unknown>, state: string): Promise<boolean> {
  const rows = await run(
    `UPDATE workers SET last_run_at = now(), heartbeat_at = now(), last_result = $3::jsonb, state = $4
      WHERE name = $1 AND instance_id = $2 RETURNING name`,
    [w.name, w.instanceId, JSON.stringify(result), state],
  );
  return rows.length === 1;
}

export async function getWorker(run: Run, name: string): Promise<WorkerRow | null> {
  const [row] = await run<WorkerRow>(`SELECT ${COLS} FROM workers WHERE name = $1`, [name]);
  return row ?? null;
}

export async function listWorkers(run: Run): Promise<(WorkerRow & { heartbeat_age_s: number })[]> {
  return run(`SELECT ${COLS}, EXTRACT(EPOCH FROM (now() - heartbeat_at))::int AS heartbeat_age_s FROM workers ORDER BY name`);
}
