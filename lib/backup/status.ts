// Backup health (A09a): last OK per kind, staleness against the expected
// cadence, recent failures, restore proof. Pure compute over backup_runs rows
// so /api/health/deep, the monitor and the alert path agree. The alert path
// (alertOnBackupHealth) goes through WS-approvals' notifyOwner with a dedupe
// window so a stale backup pages once, not every 5 minutes.

import type { BackupKind, BackupRun } from "./runs.ts";

export interface BackupCadence {
  /** Expected max age of a good backup, per kind (seconds). */
  db: number;
  files: number;
  config: number;
}

// Nightly 02:30 for everything; the optional 4-hourly DB-only timer tightens
// db to 6h when Joe enables it (BACKUP_DB_CADENCE_S).
export const DEFAULT_CADENCE: BackupCadence = { db: 30 * 3600, files: 30 * 3600, config: 30 * 3600 };

export interface KindHealth {
  kind: BackupKind;
  last_ok_at: string | null;
  last_ok_age_s: number | null;
  last_ok_destination: string | null;
  last_ok_bytes: number | null;
  last_run_at: string | null;
  last_run_state: string | null;
  last_error: string | null;
  consecutive_failures: number;
  restore_tested_at: string | null;
  stale: boolean;
  configured: boolean;
}

export interface BackupHealth {
  generated_at: string;
  configured: boolean;
  kinds: KindHealth[];
  problems: string[];
}

/** Postgres `timestamptz::text` ("2026-09-23 21:10:02.5-04") → epoch ms; ISO passes through. */
export function parsePgTime(text: string | null | undefined): number | null {
  if (!text) return null;
  const norm = text.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const t = Date.parse(norm);
  return Number.isFinite(t) ? t : null;
}

function ageS(iso: string | null, now: Date): number | null {
  const t = parsePgTime(iso);
  return t == null ? null : Math.max(0, Math.round((now.getTime() - t) / 1000));
}

export function backupHealth(runs: BackupRun[], opts: { cadence?: Partial<BackupCadence>; now?: Date } = {}): BackupHealth {
  const now = opts.now ?? new Date();
  const cadence = { ...DEFAULT_CADENCE, ...(opts.cadence ?? {}) };
  const problems: string[] = [];
  const kinds: KindHealth[] = [];
  let anyConfigured = false;
  for (const kind of ["db", "files", "config"] as BackupKind[]) {
    const mine = runs.filter((r) => r.kind === kind).sort((a, b) => (parsePgTime(b.started_at) ?? 0) - (parsePgTime(a.started_at) ?? 0));
    const lastOk = mine.find((r) => r.state === "ok") ?? null;
    let failures = 0;
    for (const r of mine) {
      if (r.state === "ok") break;
      if (r.state === "failed") failures++;
    }
    const last = mine[0] ?? null;
    const configured = mine.some((r) => r.destination && r.destination !== "none");
    anyConfigured = anyConfigured || configured;
    const lastOkAge = ageS(lastOk?.finished_at ?? lastOk?.started_at ?? null, now);
    // A failed latest run means protection is stale even inside the cadence window.
    const stale = lastOk === null || (lastOkAge ?? Infinity) > cadence[kind] || failures > 0;
    const tested = mine.find((r) => r.restore_tested_at)?.restore_tested_at ?? null;
    kinds.push({
      kind,
      last_ok_at: lastOk?.finished_at ?? null,
      last_ok_age_s: lastOkAge,
      last_ok_destination: lastOk?.destination ?? null,
      last_ok_bytes: lastOk?.bytes ?? null,
      last_run_at: last?.started_at ?? null,
      last_run_state: last?.state ?? null,
      last_error: last?.state === "failed" ? (last.error ?? null) : null,
      consecutive_failures: failures,
      restore_tested_at: tested,
      stale,
      configured,
    });
    if (!mine.length) problems.push(`backup ${kind}: never run`);
    else if (last?.state === "failed") problems.push(`backup ${kind}: last run FAILED — ${(last.error ?? "").slice(0, 160)}`);
    if (mine.length && stale) problems.push(lastOk ? `backup ${kind}: last good backup is ${Math.round((lastOkAge ?? 0) / 3600)}h old (limit ${Math.round(cadence[kind] / 3600)}h)` : `backup ${kind}: no successful backup on record`);
  }
  if (!anyConfigured) problems.push("off-host backup destination NOT CONFIGURED (BACKUP_RCLONE_REMOTE / BACKUP_SSH_TARGET / BACKUP_DIR)");
  return { generated_at: now.toISOString(), configured: anyConfigured, kinds, problems };
}

export interface AlertSink {
  /** WS-approvals' notifyOwner shape (kind fixed to 'comms'). */
  (input: { kind: "comms"; title: string; body?: string; href?: string }): Promise<void>;
}

/** Push one deduped alert when backup health has problems. `seen` is the
 *  caller's memory of the last alert (fingerprint + time) so the same
 *  condition pages at most once per `repeatAfterS`. Returns the new memory. */
export async function alertOnBackupHealth(
  health: BackupHealth,
  notify: AlertSink,
  seen: { fingerprint: string; at: number } | null,
  opts: { now?: Date; repeatAfterS?: number } = {},
): Promise<{ fingerprint: string; at: number } | null> {
  if (!health.problems.length) return null;
  const now = (opts.now ?? new Date()).getTime();
  const fingerprint = health.problems.join("\n");
  const repeat = (opts.repeatAfterS ?? 6 * 3600) * 1000;
  if (seen && seen.fingerprint === fingerprint && now - seen.at < repeat) return seen;
  await notify({
    kind: "comms",
    title: health.configured ? "Backup problem" : "Backups are not going off-host",
    body: health.problems.slice(0, 4).join(" · ").slice(0, 600),
    href: "/engine/monitoring",
  });
  return { fingerprint, at: now };
}
