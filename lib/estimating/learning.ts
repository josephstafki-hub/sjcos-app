// Closeout cost learning (A15, DESIGN "Cost learning and owner time"). Pure
// `run` style. Verified actuals are ingested idempotently per (project, scope,
// ingest revision); a late adjustment is a NEW revision that supersedes the
// earlier rows (never double-counted). Cost-book unit costs update
// automatically ONLY when policy `learning.cost_update` is active AND the
// outlier / small-sample guard passes; every change is a cost_learning_revisions
// row with the before values (rollback pointer). Markup / margin changes are
// never automatic: they go through a 'markup' decision.

import type { Run } from "../commands/core.ts";
import { consumeDecision, stageDecision } from "../commands/decisions.ts";
import { activePolicy, policyRef } from "../commands/policies.ts";
import type { Principal } from "../commands/principal.ts";
import { isOwner, principalLabel } from "../commands/principal.ts";
import { normalizeUnit, outlierGuard, type OutlierVerdict } from "./rules.ts";

export interface ActualInput {
  scope_key: string;
  cost_item_id?: number | null;
  unit: string;
  quantity: number;
  actual_cost_cents?: number | null;
  actual_hours?: number | null;
  source: string;
  observed_at?: string;
  completeness?: "complete" | "partial";
  classification?: "normal" | "rework" | "scope_change" | "unusual_conditions" | "bad_coding" | "inflation" | "geography";
}

export interface IngestResult {
  project_id: string;
  ingest_revision: number;
  inserted: number;
  duplicates: number;
  superseded: number;
  rejected: Array<{ scope_key: string; reason: string }>;
  learning: LearningResult;
}

export interface LearningChange {
  cost_item_id: number;
  name: string;
  unit: string;
  before_unit_cost: number;
  after_unit_cost: number | null;
  verdict: OutlierVerdict;
  applied: boolean;
}

export interface LearningResult {
  policy: string | null;
  mode: "applied" | "proposed" | "preview";
  revision_id: string | null;
  changes: LearningChange[];
}

/** Ingest verified actuals for a project. `ingest_revision` defaults to 1;
 *  pass a higher number for a late adjustment (earlier rows for the same
 *  scope are superseded). Re-sending the same revision is a no-op. */
export async function ingestCloseoutActuals(run: Run, projectId: string, actuals: ActualInput[], opts: { ingest_revision?: number; principal?: Principal; learn?: boolean } = {}): Promise<IngestResult> {
  const rev = opts.ingest_revision ?? 1;
  const res: IngestResult = { project_id: projectId, ingest_revision: rev, inserted: 0, duplicates: 0, superseded: 0, rejected: [], learning: { policy: null, mode: "preview", revision_id: null, changes: [] } };
  const [pv] = await run<{ version: number }>(`SELECT version FROM pricing_setups WHERE state = 'active'`);
  for (const a of actuals) {
    const unit = normalizeUnit(a.unit);
    if (!unit) {
      res.rejected.push({ scope_key: a.scope_key, reason: `unknown unit "${a.unit}"` });
      continue;
    }
    if (!(a.quantity > 0)) {
      res.rejected.push({ scope_key: a.scope_key, reason: "quantity must be positive" });
      continue;
    }
    if (a.actual_cost_cents != null && a.actual_cost_cents < 0) {
      res.rejected.push({ scope_key: a.scope_key, reason: "negative cost" });
      continue;
    }
    if (a.cost_item_id != null) {
      const [ci] = await run<{ unit: string }>(`SELECT unit FROM cost_items WHERE id = $1`, [a.cost_item_id]);
      if (ci && normalizeUnit(ci.unit) !== unit) {
        res.rejected.push({ scope_key: a.scope_key, reason: `unit ${unit} does not match cost item unit ${ci.unit} — not normalized, not learned` });
        continue;
      }
    }
    const unitCost = a.actual_cost_cents == null ? null : Math.round(a.actual_cost_cents / a.quantity);
    const rows = await run<{ id: string }>(
      `INSERT INTO cost_observations (project_id, scope_key, cost_item_id, unit, quantity, actual_cost_cents, actual_hours, unit_cost_cents, source, observed_at, completeness, classification, pricing_version, ingest_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, now()),$11,$12,$13,$14)
       ON CONFLICT (project_id, scope_key, ingest_revision) DO NOTHING RETURNING id`,
      [projectId, a.scope_key, a.cost_item_id ?? null, unit, a.quantity, a.actual_cost_cents ?? null, a.actual_hours ?? null, unitCost, a.source, a.observed_at ?? null, a.completeness ?? "complete", a.classification ?? "normal", pv ? `v${pv.version}` : null, rev],
    );
    if (!rows.length) {
      res.duplicates += 1;
      continue;
    }
    res.inserted += 1;
    if (rev > 1) {
      const sup = await run(`UPDATE cost_observations SET superseded_by = $3 WHERE project_id = $1 AND scope_key = $2 AND ingest_revision < $4 AND superseded_by IS NULL RETURNING id`, [projectId, a.scope_key, rows[0].id, rev]);
      res.superseded += sup.length;
    }
  }
  if (opts.learn !== false) res.learning = await learnFromObservations(run, { principal: opts.principal, apply: true });
  return res;
}

/** Recompute learning for every cost item that has live verified samples.
 *  `apply: false` previews; `apply: true` writes only under the active policy
 *  and the guard, always through a cost_learning_revisions row. */
export async function learnFromObservations(run: Run, opts: { principal?: Principal; apply: boolean; min_samples?: number; max_delta_pct?: number } = { apply: false }): Promise<LearningResult> {
  const policy = await activePolicy(run, "learning.cost_update");
  const cfg = (policy?.config ?? {}) as { min_samples?: number; max_delta_pct?: number; outlier_pct?: number };
  const items = await run<{ cost_item_id: string; name: string; unit: string; unit_cost: number; samples: number[] }>(
    `SELECT ci.id AS cost_item_id, ci.name, ci.unit, ci.unit_cost,
            array_agg(co.unit_cost_cents::int ORDER BY co.observed_at) AS samples
       FROM cost_observations co JOIN cost_items ci ON ci.id = co.cost_item_id
      WHERE co.superseded_by IS NULL AND co.actual_cost_cents IS NOT NULL AND co.completeness = 'complete' AND co.classification = 'normal' AND NOT co.outlier
      GROUP BY ci.id, ci.name, ci.unit, ci.unit_cost`,
  );
  const changes: LearningChange[] = [];
  for (const it of items) {
    const verdict = outlierGuard(it.unit_cost > 0 ? it.unit_cost : null, it.samples.map(Number), { min_samples: opts.min_samples ?? cfg.min_samples, max_delta_pct: opts.max_delta_pct ?? cfg.max_delta_pct, outlier_pct: cfg.outlier_pct });
    // flag detected outliers on the observations so they never feed the next pass silently
    if (verdict.outliers.length) await run(`UPDATE cost_observations SET outlier = true WHERE cost_item_id = $1 AND superseded_by IS NULL AND unit_cost_cents = ANY($2::bigint[])`, [it.cost_item_id, verdict.outliers]);
    const after = verdict.proposed_unit_cost;
    if (after == null) continue;
    if (after === it.unit_cost && !verdict.outliers.length) continue;
    if (after === it.unit_cost) verdict.apply = false; // nothing to change; the outlier flag is the record
    changes.push({ cost_item_id: Number(it.cost_item_id), name: it.name, unit: it.unit, before_unit_cost: it.unit_cost, after_unit_cost: after, verdict, applied: false });
  }
  if (!opts.apply) return { policy: policy ? policyRef(policy) : null, mode: "preview", revision_id: null, changes };
  const applicable = changes.filter((c) => c.verdict.apply);
  const held = changes.filter((c) => !c.verdict.apply);
  let revisionId: string | null = null;
  if (policy && applicable.length) {
    const [rev] = await run<{ id: string }>(
      `INSERT INTO cost_learning_revisions (kind, status, summary, changes, sample_support, reason, policy_ref) VALUES ('auto_cost_update','applied',$1,$2::jsonb,$3::jsonb,$4,$5) RETURNING id`,
      [`${applicable.length} cost item(s) updated from verified closeout actuals`, JSON.stringify(applicable.map((c) => ({ cost_item_id: c.cost_item_id, field: "unit_cost", before: c.before_unit_cost, after: c.after_unit_cost, sample_n: c.verdict.n, delta_pct: c.verdict.delta_pct }))), JSON.stringify(Object.fromEntries(applicable.map((c) => [c.cost_item_id, c.verdict]))), applicable.map((c) => `${c.name}: ${c.verdict.reason}`).join("\n"), policyRef(policy)],
    );
    revisionId = rev.id;
    for (const c of applicable) {
      await run(`UPDATE cost_items SET unit_cost = $2 WHERE id = $1 AND unit_cost = $3`, [c.cost_item_id, c.after_unit_cost, c.before_unit_cost]);
      await run(`UPDATE cost_observations SET learning_revision_id = $2 WHERE cost_item_id = $1 AND superseded_by IS NULL AND learning_revision_id IS NULL`, [c.cost_item_id, revisionId]);
      c.applied = true;
    }
  }
  if (held.length || (!policy && applicable.length)) {
    const proposed = policy ? held : changes;
    await run(
      `INSERT INTO cost_learning_revisions (kind, status, summary, changes, sample_support, reason, policy_ref) VALUES ('proposal','proposed',$1,$2::jsonb,$3::jsonb,$4,$5)`,
      [policy ? `${proposed.length} change(s) held for review (guard)` : `${proposed.length} change(s) proposed — policy learning.cost_update is not active`, JSON.stringify(proposed.map((c) => ({ cost_item_id: c.cost_item_id, field: "unit_cost", before: c.before_unit_cost, after: c.after_unit_cost, sample_n: c.verdict.n, delta_pct: c.verdict.delta_pct }))), JSON.stringify(Object.fromEntries(proposed.map((c) => [c.cost_item_id, c.verdict]))), proposed.map((c) => `${c.name}: ${c.verdict.reason}`).join("\n"), policy ? policyRef(policy) : null],
    );
  }
  void opts.principal;
  return { policy: policy ? policyRef(policy) : null, mode: policy && applicable.length ? "applied" : "proposed", revision_id: revisionId, changes };
}

export async function costLearningPreview(run: Run): Promise<LearningResult & { history: Array<Record<string, unknown>> }> {
  const r = await learnFromObservations(run, { apply: false });
  const history = await run(`SELECT id, kind, status, summary, changes, reason, policy_ref, rollback_of, rolled_back_by, created_at::text AS created_at FROM cost_learning_revisions ORDER BY created_at DESC LIMIT 20`);
  return { ...r, history };
}

/** Restore the `before` values of an applied revision (owner only). */
export async function rollbackLearningRevision(run: Run, revisionId: string, principal: Principal): Promise<{ ok: true; rollback_id: string; restored: number } | { ok: false; error: string }> {
  if (!isOwner(principal)) return { ok: false, error: "rolling back learned costs is Joe's call" };
  const [rev] = await run<{ id: string; status: string; changes: Array<{ cost_item_id: number; before: number; after: number }> }>(`SELECT id, status, changes FROM cost_learning_revisions WHERE id = $1 FOR UPDATE`, [revisionId]);
  if (!rev) return { ok: false, error: "no such revision" };
  if (rev.status !== "applied") return { ok: false, error: `revision is ${rev.status}, nothing to roll back` };
  let restored = 0;
  for (const c of rev.changes) restored += (await run(`UPDATE cost_items SET unit_cost = $2 WHERE id = $1 RETURNING id`, [c.cost_item_id, c.before])).length;
  const [rb] = await run<{ id: string }>(`INSERT INTO cost_learning_revisions (kind, status, summary, changes, reason, rollback_of) VALUES ('rollback','applied',$1,$2::jsonb,$3,$4) RETURNING id`, [`rolled back ${rev.id}`, JSON.stringify(rev.changes.map((c) => ({ cost_item_id: c.cost_item_id, field: "unit_cost", before: c.after, after: c.before }))), `by ${principalLabel(principal)}`, rev.id]);
  await run(`UPDATE cost_learning_revisions SET status = 'rolled_back', rolled_back_by = $2 WHERE id = $1`, [rev.id, rb.id]);
  return { ok: true, rollback_id: rb.id, restored };
}

/** Markup / profit-target changes are never automatic: stage a 'markup'
 *  decision with old/new value and reason. Applying it consumes the decision. */
export async function proposeMarkupChange(run: Run, input: { markup_pct: number; reason: string; principal: Principal; evidence?: Record<string, unknown> }): Promise<{ decision_id: string; created: boolean; current_pct: number | null }> {
  const [ps] = await run<{ version: number; config: { markup_pct?: number | null } }>(`SELECT version, config FROM pricing_setups WHERE state = 'active'`);
  const [legacy] = ps ? [] : await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`);
  const current = ps?.config?.markup_pct ?? (legacy ? Number(legacy.value) : null);
  const { decision, created } = await stageDecision(run, {
    kind: "markup",
    action: "change_markup",
    title: `Change default markup ${current ?? "?"}% → ${input.markup_pct}%`,
    summary: { changes: [`markup ${current ?? "unset"}% → ${input.markup_pct}%`], effect: "Approving changes the company default markup for NEW estimate pricing; sent offers keep their prices.", assumptions: [input.reason], ...(input.evidence ? { evidence: input.evidence } : {}) },
    targetKind: "pricing",
    targetId: "default_markup",
    content: { markup_pct: input.markup_pct, from: current },
    dedupeKey: "pricing:default_markup",
    requestedBy: input.principal,
  });
  await run(`INSERT INTO cost_learning_revisions (kind, status, summary, changes, reason, decision_id) VALUES ('markup_proposal','proposed',$1,$2::jsonb,$3,$4)`, [`markup ${current ?? "unset"}% → ${input.markup_pct}%`, JSON.stringify([{ field: "markup_pct", before: current, after: input.markup_pct }]), input.reason, decision.id]);
  return { decision_id: decision.id, created, current_pct: current == null ? null : Number(current) };
}

/** After Joe approves the markup decision: write the new default (as a fresh
 *  pricing setup version when one is active, else the legacy setting). */
export async function applyMarkupDecision(run: Run, decisionId: string, principal: Principal): Promise<{ ok: true; markup_pct: number } | { ok: false; error: string }> {
  const c = await consumeDecision(run, { id: decisionId, action: "change_markup", targetKind: "pricing", targetId: "default_markup", consumer: principalLabel(principal) });
  if (!c.ok) return { ok: false, error: c.reason };
  const [d] = await run<{ summary: { changes?: string[] } }>(`SELECT summary FROM decisions WHERE id = $1`, [decisionId]);
  const m = /→ ([\d.]+)%/.exec(d?.summary?.changes?.[0] ?? "");
  if (!m) return { ok: false, error: "decision does not carry a markup value" };
  const pct = Number(m[1]);
  const [ps] = await run<{ id: string; version: number; config: Record<string, unknown> }>(`SELECT id, version, config FROM pricing_setups WHERE state = 'active'`);
  if (ps) {
    await run(`UPDATE pricing_setups SET state = 'retired' WHERE id = $1`, [ps.id]);
    await run(`INSERT INTO pricing_setups (version, state, config, evidence, proposed_by, decision_id, activated_at, notes) VALUES ((SELECT COALESCE(max(version),0)+1 FROM pricing_setups), 'active', $1::jsonb, '{}'::jsonb, $2, $3, now(), $4)`, [JSON.stringify({ ...ps.config, markup_pct: pct }), principalLabel(principal), decisionId, `markup change via decision ${decisionId}`]);
  }
  await run(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(pct)]);
  await run(`UPDATE cost_learning_revisions SET status = 'applied' WHERE decision_id = $1 AND kind = 'markup_proposal'`, [decisionId]);
  return { ok: true, markup_pct: pct };
}
