// Versioned routine policies + lane kill switches (A10 base).
//
// A policy is a named, versioned config block (key + version, one active
// version per key). Code that acts automatically reads the ACTIVE version and
// records "policy:<key>@<version>" as its auth_ref. Missing or disabled
// policy → the automatic action is held, not silently taken. A lane pause
// stops new dispatch on that lane (and 'all') without losing anything.

import type { Run } from "./core.ts";

export interface Policy {
  id: string;
  key: string;
  version: number;
  config: Record<string, unknown>;
  state: "draft" | "active" | "disabled" | "retired";
  effective_from: string | null;
  notes: string;
}

export async function activePolicy(run: Run, key: string): Promise<Policy | null> {
  const [row] = await run<Policy>(
    `SELECT id, key, version, config, state, effective_from::text AS effective_from, notes FROM policies
      WHERE key = $1 AND state = 'active' AND (effective_from IS NULL OR effective_from <= now())`,
    [key],
  );
  return row ?? null;
}

export function policyRef(p: Policy): string {
  return `policy:${p.key}@${p.version}`;
}

/** Insert a new draft version (next number) for a key. Activation is a
 *  separate owner action (activatePolicy) so nothing goes live by writing. */
export async function proposePolicyVersion(run: Run, key: string, config: Record<string, unknown>, createdBy: string, notes = ""): Promise<Policy> {
  const [row] = await run<Policy>(
    `INSERT INTO policies (key, version, config, state, created_by, notes)
     VALUES ($1, COALESCE((SELECT max(version) FROM policies WHERE key = $1), 0) + 1, $2::jsonb, 'draft', $3, $4)
     RETURNING id, key, version, config, state, effective_from::text AS effective_from, notes`,
    [key, JSON.stringify(config), createdBy, notes],
  );
  return row;
}

/** Make one version active; any previously active version is retired. */
export async function activatePolicy(run: Run, key: string, version: number): Promise<Policy | null> {
  await run(`UPDATE policies SET state = 'retired' WHERE key = $1 AND state = 'active' AND version <> $2`, [key, version]);
  const [row] = await run<Policy>(
    `UPDATE policies SET state = 'active', effective_from = COALESCE(effective_from, now()) WHERE key = $1 AND version = $2
     RETURNING id, key, version, config, state, effective_from::text AS effective_from, notes`,
    [key, version],
  );
  return row ?? null;
}

export async function disablePolicy(run: Run, key: string): Promise<number> {
  const rows = await run(`UPDATE policies SET state = 'disabled' WHERE key = $1 AND state = 'active' RETURNING id`, [key]);
  return rows.length;
}

// ── Lanes ────────────────────────────────────────────────────────────────────

export const LANES = ["all", "sends", "payments", "square", "qbo", "routine_followup", "weekly_summary", "purchases", "publication", "agents"] as const;
export type Lane = (typeof LANES)[number];

export async function laneOpen(run: Run, lane: Lane): Promise<{ open: true } | { open: false; reason: string; lane: string }> {
  const rows = await run<{ lane: string; reason: string }>(`SELECT lane, reason FROM lane_pauses WHERE lane IN ('all', $1)`, [lane]);
  if (!rows.length) return { open: true };
  const r = rows.find((x) => x.lane === "all") ?? rows[0];
  return { open: false, reason: r.reason || "paused by owner", lane: r.lane };
}

export async function pauseLane(run: Run, lane: Lane, by: string, reason: string): Promise<void> {
  await run(
    `INSERT INTO lane_pauses (lane, paused_by, reason) VALUES ($1, $2, $3)
     ON CONFLICT (lane) DO UPDATE SET paused_at = now(), paused_by = EXCLUDED.paused_by, reason = EXCLUDED.reason`,
    [lane, by, reason],
  );
}

export async function resumeLane(run: Run, lane: Lane): Promise<boolean> {
  const rows = await run(`DELETE FROM lane_pauses WHERE lane = $1 RETURNING lane`, [lane]);
  return rows.length === 1;
}

export async function listLanePauses(run: Run): Promise<{ lane: string; paused_at: string; paused_by: string; reason: string }[]> {
  return run(`SELECT lane, paused_at::text AS paused_at, paused_by, reason FROM lane_pauses ORDER BY paused_at DESC`);
}
