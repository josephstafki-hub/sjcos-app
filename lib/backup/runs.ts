// backup_runs ledger (0019). Pure.
import type { Run } from "../commands/core.ts";

export type BackupKind = "db" | "files" | "config";
export type BackupState = "running" | "ok" | "failed" | "stale";

export interface BackupRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  kind: BackupKind;
  mode: "full" | "db-only";
  bytes: number | null;
  checksum: string | null;
  artifact: string | null;
  backup_set: string | null;
  destination: string | null;
  state: BackupState;
  error: string | null;
  host: string;
  code_version: string;
  restore_tested_at: string | null;
  restore_note: string | null;
}

const COLS = `id, started_at::text AS started_at, finished_at::text AS finished_at, kind, mode, bytes, checksum, artifact, backup_set,
  destination, state, error, host, code_version, restore_tested_at::text AS restore_tested_at, restore_note`;

export async function startBackupRun(run: Run, r: { kind: BackupKind; mode: "full" | "db-only"; backupSet: string; destination: string; host: string; codeVersion: string }): Promise<number> {
  const [row] = await run<{ id: number }>(
    `INSERT INTO backup_runs (kind, mode, backup_set, destination, host, code_version, state) VALUES ($1, $2, $3, $4, $5, $6, 'running') RETURNING id`,
    [r.kind, r.mode, r.backupSet, r.destination, r.host, r.codeVersion],
  );
  return row.id;
}

export async function finishBackupRun(
  run: Run,
  id: number,
  r: { ok: true; bytes: number; checksum: string; artifact: string; destination?: string } | { ok: false; error: string },
): Promise<void> {
  if (r.ok) {
    await run(
      `UPDATE backup_runs SET state = 'ok', finished_at = now(), bytes = $2, checksum = $3, artifact = $4, destination = COALESCE($5, destination), error = NULL WHERE id = $1`,
      [id, r.bytes, r.checksum, r.artifact, r.destination ?? null],
    );
  } else {
    await run(`UPDATE backup_runs SET state = 'failed', finished_at = now(), error = $2 WHERE id = $1`, [id, r.error.slice(0, 2000)]);
  }
}

/** Record a run that failed before it could start (no destination, no passphrase…). */
export async function recordFailedBackup(run: Run, r: { kind: BackupKind; mode: "full" | "db-only"; backupSet: string; error: string; host: string; codeVersion: string }): Promise<void> {
  await run(
    `INSERT INTO backup_runs (kind, mode, backup_set, destination, host, code_version, state, finished_at, error) VALUES ($1, $2, $3, 'none', $4, $5, 'failed', now(), $6)`,
    [r.kind, r.mode, r.backupSet, r.host, r.codeVersion, r.error.slice(0, 2000)],
  );
}

export async function markRestoreTested(run: Run, backupSet: string, note: string): Promise<number> {
  const rows = await run(`UPDATE backup_runs SET restore_tested_at = now(), restore_note = $2 WHERE backup_set = $1 AND state = 'ok' RETURNING id`, [backupSet, note.slice(0, 2000)]);
  return rows.length;
}

/** Recent runs (newest first), enough for status: last 30 per kind. */
export async function latestBackupRuns(run: Run, perKind = 30): Promise<BackupRun[]> {
  return run<BackupRun>(
    `SELECT ${COLS} FROM (SELECT *, row_number() OVER (PARTITION BY kind ORDER BY started_at DESC) AS rn FROM backup_runs) t WHERE rn <= $1 ORDER BY started_at DESC`,
    [perKind],
  );
}
