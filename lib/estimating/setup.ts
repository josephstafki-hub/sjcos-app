// Initial pricing setup (DECISIONS "Initial pricing": rates, markup/margin
// distinction, allowances, uncertainty). Proposals are evidence-backed drafts
// with NULL (and a reason) wherever the evidence does not exist; only the
// owner activates, through a 'markup' decision (profit policy), so nothing
// goes live by writing a row.

import type { Run } from "../commands/core.ts";
import { resolveDecision, stageDecision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import { humanOf, isOwner, principalLabel } from "../commands/principal.ts";
import { COST_CATEGORIES } from "../cost-book-units.ts";

export interface PricingSetupConfig {
  labor_rates: Record<string, { cents_per_hour: number | null; reason: string }>;
  markup_pct: number | null;
  margin_target_pct: number | null;
  default_allowances: Record<string, { cents: number | null; reason: string }>;
  uncertainty_rules: { rough_range_low_pct: number; rough_range_high_pct: number; stale_after_days: number; fixed_requires: string[] };
}

export interface PricingSetupRow {
  id: string;
  version: number;
  state: "draft" | "active" | "retired";
  config: PricingSetupConfig;
  evidence: Record<string, unknown>;
  proposed_by: string;
  decision_id: string | null;
  activated_at: string | null;
  notes: string;
  created_at: string;
}

const COLS = `id, version, state, config, evidence, proposed_by, decision_id, activated_at::text AS activated_at, notes, created_at::text AS created_at`;

export async function listPricingSetups(run: Run): Promise<PricingSetupRow[]> {
  return run<PricingSetupRow>(`SELECT ${COLS} FROM pricing_setups ORDER BY version DESC`);
}

export async function activePricingSetup(run: Run): Promise<PricingSetupRow | null> {
  const [r] = await run<PricingSetupRow>(`SELECT ${COLS} FROM pricing_setups WHERE state = 'active'`);
  return r ?? null;
}

/** Evidence-backed proposal: labor rates from cost-book 'hr' items and
 *  closeout hours; markup from the current setting (evidence: it is what Joe
 *  has been using); allowances from chosen selection prices per category;
 *  unsupported values stay NULL with the reason. */
export async function proposePricingSetup(run: Run, principal: Principal, opts: { notes?: string } = {}): Promise<PricingSetupRow> {
  const evidence: Record<string, unknown> = {};
  const labor: PricingSetupConfig["labor_rates"] = {};
  const hrItems = await run<{ category: string; name: string; unit_cost: number; n: string }>(
    `SELECT category, name, unit_cost, (SELECT count(*)::text FROM cost_observations co WHERE co.cost_item_id = ci.id AND co.superseded_by IS NULL AND co.actual_cost_cents IS NOT NULL) AS n
       FROM cost_items ci WHERE unit = 'hr' AND NOT archived ORDER BY category, name`,
  );
  for (const cat of COST_CATEGORIES) {
    const hits = hrItems.filter((i) => i.category === cat && i.unit_cost > 0);
    if (hits.length) {
      const rate = Math.round(hits.reduce((s, h) => s + h.unit_cost, 0) / hits.length);
      labor[cat] = { cents_per_hour: rate, reason: `average of ${hits.length} hourly cost-book item(s): ${hits.map((h) => h.name).join(", ")}` };
      evidence[`labor_rates.${cat}`] = { source: "cost_items unit=hr", sample_n: hits.length, verified_observations: hits.reduce((s, h) => s + Number(h.n), 0) };
    } else {
      labor[cat] = { cents_per_hour: null, reason: "no hourly cost-book item and no verified closeout hours for this category" };
    }
  }
  const [setting] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`);
  const markup = setting && Number.isFinite(Number(setting.value)) ? Number(setting.value) : null;
  evidence.markup_pct = markup == null ? { source: "none", reason: "estimate.default_markup is not set" } : { source: "app_settings estimate.default_markup (the value Joe has been using)", sample_n: 1 };
  const closed = await run<{ n: string; margin_pct: string | null }>(
    `SELECT count(*)::text AS n, avg(CASE WHEN p.contract_value > 0 AND c.cost > 0 THEN (p.contract_value - c.cost)::numeric / p.contract_value * 100 END)::text AS margin_pct
       FROM projects p JOIN (SELECT project_id, sum(actual_cost_cents) AS cost FROM cost_observations WHERE superseded_by IS NULL AND actual_cost_cents IS NOT NULL GROUP BY project_id) c ON c.project_id = p.id
      WHERE p.status IN ('closeout','warranty')`,
  );
  const marginN = Number(closed[0]?.n ?? 0);
  const margin = marginN >= 3 && closed[0].margin_pct != null ? Math.round(Number(closed[0].margin_pct) * 10) / 10 : null;
  evidence.margin_target_pct = margin == null ? { source: "closed jobs with verified costs", sample_n: marginN, reason: marginN < 3 ? `only ${marginN} closed job(s) with verified costs (need 3)` : "no margin computable" } : { source: "closed jobs with verified costs (actual margin, not a target)", sample_n: marginN };
  const allowances: PricingSetupConfig["default_allowances"] = {};
  const sel = await run<{ area: string; median_price: string; n: string }>(
    `SELECT lower(split_part(s.area, ' — ', 2)) AS area, percentile_cont(0.5) WITHIN GROUP (ORDER BY o.price)::text AS median_price, count(*)::text AS n
       FROM project_selections s JOIN project_selection_options o ON o.id = s.chosen_option_id WHERE s.status = 'approved' AND o.price > 0 GROUP BY 1 HAVING count(*) >= 3`,
  );
  for (const s of sel) if (s.area) allowances[s.area] = { cents: Math.round(Number(s.median_price) * 100), reason: `median of ${s.n} client-chosen options` };
  if (!Object.keys(allowances).length) allowances["*"] = { cents: null, reason: "fewer than 3 client choices per finish type on record — no default allowance proposed" };
  const config: PricingSetupConfig = {
    labor_rates: labor,
    markup_pct: markup,
    margin_target_pct: margin,
    default_allowances: allowances,
    uncertainty_rules: { rough_range_low_pct: 10, rough_range_high_pct: 25, stale_after_days: 90, fixed_requires: ["no hard gaps", "readiness ≥ 75", "active markup", "quantities with a basis", "sub quotes for sub trades"] },
  };
  const [row] = await run<PricingSetupRow>(
    `INSERT INTO pricing_setups (version, state, config, evidence, proposed_by, notes)
     VALUES ((SELECT COALESCE(max(version),0)+1 FROM pricing_setups), 'draft', $1::jsonb, $2::jsonb, $3, $4) RETURNING ${COLS}`,
    [JSON.stringify(config), JSON.stringify(evidence), principalLabel(principal), opts.notes ?? "Proposed from cost book, settings, closeout actuals and client choices. NULL = no evidence."],
  );
  return row;
}

export async function updatePricingSetupDraft(run: Run, version: number, patch: Partial<PricingSetupConfig>, principal: Principal): Promise<PricingSetupRow> {
  const [cur] = await run<PricingSetupRow>(`SELECT ${COLS} FROM pricing_setups WHERE version = $1 FOR UPDATE`, [version]);
  if (!cur) throw new Error(`no pricing setup v${version}`);
  if (cur.state !== "draft") throw new Error(`v${version} is ${cur.state}; propose a new version`);
  const config = { ...cur.config, ...patch };
  const [row] = await run<PricingSetupRow>(`UPDATE pricing_setups SET config = $2::jsonb, evidence = evidence || $3::jsonb WHERE version = $1 RETURNING ${COLS}`, [version, JSON.stringify(config), JSON.stringify({ edited_by: principalLabel(principal), at: new Date().toISOString(), fields: Object.keys(patch) })]);
  return row;
}

export type ActivateResult = { ok: true; state: "active"; version: number; decision_id: string } | { ok: true; state: "pending_decision"; version: number; decision_id: string } | { ok: false; error: string };

/** Activation is a profit-policy change: a 'markup' decision. The owner in
 *  the app resolves it on the spot (one tap, recorded); anyone else only
 *  stages it. */
export async function activatePricingSetup(run: Run, version: number, principal: Principal, via: "app" | "mcp" = "app"): Promise<ActivateResult> {
  const [row] = await run<PricingSetupRow>(`SELECT ${COLS} FROM pricing_setups WHERE version = $1 FOR UPDATE`, [version]);
  if (!row) return { ok: false, error: `no pricing setup v${version}` };
  if (row.state === "active") return { ok: true, state: "active", version, decision_id: row.decision_id ?? "" };
  if (row.state === "retired") return { ok: false, error: `v${version} is retired; propose a new version` };
  const active = await activePricingSetup(run);
  const { decision } = await stageDecision(run, {
    kind: "markup",
    action: "activate_pricing_setup",
    title: `Activate pricing setup v${version}`,
    summary: {
      changes: [`markup ${active?.config.markup_pct ?? "unset"}% → ${row.config.markup_pct ?? "unset"}%`, `margin target ${active?.config.margin_target_pct ?? "unset"}% → ${row.config.margin_target_pct ?? "unset"}%`, ...Object.entries(row.config.labor_rates).filter(([, v]) => v.cents_per_hour != null).map(([k, v]) => `${k}: ${(v.cents_per_hour! / 100).toFixed(2)}/hr`)],
      assumptions: Object.entries(row.config.labor_rates).filter(([, v]) => v.cents_per_hour == null).map(([k, v]) => `${k}: no rate (${v.reason})`),
      effect: "Approving makes these the rates, markup and allowances new estimate pricing uses. Sent offers are unchanged.",
    },
    targetKind: "pricing_setup",
    targetId: version,
    content: row.config,
    artifactRevision: `pricing_setup:v${version}`,
    dedupeKey: `pricing_setup:activate`,
    requestedBy: principal,
  });
  await run(`UPDATE pricing_setups SET decision_id = $2 WHERE id = $1`, [row.id, decision.id]);
  if (!isOwner(principal)) return { ok: true, state: "pending_decision", version, decision_id: decision.id };
  const r = await resolveDecision(run, { id: decision.id, outcome: "approved", principal, via });
  if (!r.ok) return { ok: false, error: r.reason };
  await run(`UPDATE pricing_setups SET state = 'retired' WHERE state = 'active'`);
  await run(`UPDATE pricing_setups SET state = 'active', activated_at = now(), activated_by = $2 WHERE id = $1`, [row.id, humanOf(principal)?.userId ?? null]);
  await run(`UPDATE decisions SET status = 'consumed', uses = 1 WHERE id = $1 AND status = 'approved'`, [decision.id]);
  if (row.config.markup_pct != null) await run(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(row.config.markup_pct)]);
  return { ok: true, state: "active", version, decision_id: decision.id };
}

/** Apply an approved activation decision later (staff/agent staged it, Joe tapped it elsewhere). */
export async function applyPricingSetupDecision(run: Run, decisionId: string, principal: Principal): Promise<ActivateResult> {
  const [d] = await run<{ status: string; target_id: string }>(`SELECT status, target_id FROM decisions WHERE id = $1 AND action = 'activate_pricing_setup'`, [decisionId]);
  if (!d) return { ok: false, error: "no such activation decision" };
  if (d.status !== "approved") return { ok: false, error: `decision is ${d.status}` };
  const version = Number(d.target_id);
  await run(`UPDATE decisions SET status = 'consumed', uses = uses + 1 WHERE id = $1 AND status = 'approved'`, [decisionId]);
  await run(`UPDATE pricing_setups SET state = 'retired' WHERE state = 'active'`);
  const [row] = await run<PricingSetupRow>(`UPDATE pricing_setups SET state = 'active', activated_at = now(), activated_by = $2 WHERE version = $1 RETURNING ${COLS}`, [version, humanOf(principal)?.userId ?? null]);
  if (row?.config.markup_pct != null) await run(`INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(row.config.markup_pct)]);
  return { ok: true, state: "active", version, decision_id: decisionId };
}
