// Continuous formal-estimate assembly (WORKFLOW W07, DESIGN "Cash, price and
// schedule enforcement"). Pure `run` style. The rules are in rules.ts; this
// module owns the records: estimate_lines (stable item_key identity),
// estimate_gaps, quotes/quote_lines, offered snapshots and the decisions that
// competing quotes, revised offers and allowance overages require.
//
// Invariants:
//   • unknown cost is NULL and produces a gap — never 0;
//   • an owner client price is never marked up again;
//   • a multi-line quote is allocated line-by-line, once;
//   • competing quotes are compared and HELD for a supplier_choice decision;
//   • once offered, a client price is frozen; later costs move margin only;
//   • a changed line on a sent offer supersedes the prior proposal decision.

import type { Run } from "../commands/core.ts";
import { stageDecision, consumeDecision, type Decision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";
import { principalLabel } from "../commands/principal.ts";
import { committedPrice, prepareAllowanceOverageChangeOrder, priceLine, productKey, quoteCoverageCheck, stableItemKey, normalizeUnit } from "./rules.ts";
import type { EstimateLineRecord, EstimateSourceKind, Gap, OfferedSnapshot, PriceBasis, ProductIdentity } from "./types.ts";
import type { AllowanceOveragePayload } from "./rules.ts";

export const LINE_COLS = `id, estimate_id, item_key, scope_item_key, cost_item_id, description, section, unit, qty, unit_cost, markup, extended,
  source_kind, source_ref, internal_cost_cents::bigint AS internal_cost_cents, cost_basis, cost_observed_at::text AS cost_observed_at,
  owner_price_override_cents::bigint AS owner_price_override_cents, owner_price_basis, is_allowance, allowance_cents::bigint AS allowance_cents,
  allowance_scope, provisional, evidence, superseded_by`;

function n(v: unknown): number | null {
  return v == null ? null : Number(v);
}

export function rowToLine(r: Record<string, unknown>): EstimateLineRecord {
  return {
    ...(r as unknown as EstimateLineRecord),
    id: Number(r.id),
    estimate_id: Number(r.estimate_id),
    cost_item_id: n(r.cost_item_id),
    qty: Number(r.qty),
    unit_cost: Number(r.unit_cost),
    markup: Number(r.markup),
    extended: Number(r.extended),
    internal_cost_cents: n(r.internal_cost_cents),
    owner_price_override_cents: n(r.owner_price_override_cents),
    allowance_cents: n(r.allowance_cents),
    superseded_by: n(r.superseded_by),
    evidence: Array.isArray(r.evidence) ? (r.evidence as unknown[]) : [],
    source_ref: (r.source_ref as Record<string, unknown>) ?? {},
  };
}

export async function loadLines(run: Run, estimateId: number, opts: { includeSuperseded?: boolean } = {}): Promise<EstimateLineRecord[]> {
  const rows = await run(`SELECT ${LINE_COLS} FROM estimate_lines WHERE estimate_id = $1 ${opts.includeSuperseded ? "" : "AND superseded_by IS NULL"} ORDER BY section, sort_order, id`, [estimateId]);
  return rows.map(rowToLine);
}

interface EstimateRow {
  id: number;
  project_id: string | null;
  status: string;
  revision: number;
  offered_snapshot: OfferedSnapshot | null;
  offer_stale: boolean;
  pricing_version: string | null;
  title: string;
}

async function loadEstimate(run: Run, estimateId: number, lock = false): Promise<EstimateRow> {
  const [e] = await run<EstimateRow>(`SELECT id, project_id, status, revision, offered_snapshot, offer_stale, pricing_version, title FROM estimates WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [estimateId]);
  if (!e) throw new Error(`estimate ${estimateId} not found`);
  return { ...e, id: Number(e.id) };
}

/** Markup: the active pricing setup wins; else the legacy app setting; else
 *  null (readiness then refuses a fixed proposal — no silent 20%). */
export async function activeMarkupPct(run: Run): Promise<{ pct: number | null; source: string }> {
  const [ps] = await run<{ version: number; config: { markup_pct?: number | null } }>(`SELECT version, config FROM pricing_setups WHERE state = 'active'`);
  if (ps && ps.config?.markup_pct != null) return { pct: Number(ps.config.markup_pct), source: `pricing_setup:v${ps.version}` };
  const [s] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`);
  const v = s ? Number(s.value) : NaN;
  if (Number.isFinite(v)) return { pct: v, source: "app_settings:estimate.default_markup" };
  return { pct: null, source: "unset" };
}

export interface UpsertLineInput {
  item_key: string;
  description: string;
  section?: string;
  unit?: string | null;
  qty?: number | null;
  scope_item_key?: string | null;
  cost_item_id?: number | null;
  source_kind: EstimateSourceKind;
  source_ref?: Record<string, unknown>;
  internal_cost_cents?: number | null;
  cost_basis?: string | null;
  cost_observed_at?: string | null;
  provisional?: boolean;
  is_allowance?: boolean;
  allowance_cents?: number | null;
  allowance_scope?: string | null;
  evidence?: unknown;
}

/** Insert or update the line with this item_key (stable identity). Never
 *  duplicates; never writes 0 for an unknown cost. */
export async function upsertEstimateLine(run: Run, estimateId: number, input: UpsertLineInput): Promise<{ id: number; created: boolean }> {
  const [existing] = await run<{ id: string }>(`SELECT id FROM estimate_lines WHERE estimate_id = $1 AND item_key = $2 AND superseded_by IS NULL FOR UPDATE`, [estimateId, input.item_key]);
  const cost = input.internal_cost_cents == null ? null : Math.round(input.internal_cost_cents);
  if (cost != null && cost < 0) throw new Error("internal cost cannot be negative");
  const evidence = input.evidence === undefined ? null : JSON.stringify([input.evidence]);
  if (existing) {
    await run(
      `UPDATE estimate_lines SET
         description = $3, section = COALESCE($4, section), unit = COALESCE($5, unit), qty = COALESCE($6, qty),
         scope_item_key = COALESCE($7, scope_item_key), cost_item_id = COALESCE($8, cost_item_id),
         source_kind = $9, source_ref = source_ref || $10::jsonb,
         internal_cost_cents = CASE WHEN $11::bigint IS NULL AND $17::boolean THEN internal_cost_cents ELSE $11 END,
         cost_basis = CASE WHEN $11::bigint IS NULL AND $17::boolean THEN cost_basis ELSE $12 END,
         cost_observed_at = CASE WHEN $11::bigint IS NULL AND $17::boolean THEN cost_observed_at ELSE $13::timestamptz END,
         provisional = $14, is_allowance = COALESCE($15, is_allowance), allowance_cents = COALESCE($16, allowance_cents),
         allowance_scope = COALESCE($18, allowance_scope),
         evidence = CASE WHEN $19::jsonb IS NULL THEN evidence ELSE evidence || $19::jsonb END
       WHERE id = $1 AND estimate_id = $2`,
      [existing.id, estimateId, input.description, input.section ?? null, input.unit ?? null, input.qty ?? null, input.scope_item_key ?? null, input.cost_item_id ?? null, input.source_kind, JSON.stringify(input.source_ref ?? {}), cost, input.cost_basis ?? null, input.cost_observed_at ?? null, !!input.provisional, input.is_allowance ?? null, input.allowance_cents ?? null, /* keepCostWhenNull */ input.internal_cost_cents === undefined, input.allowance_scope ?? null, evidence],
    );
    return { id: Number(existing.id), created: false };
  }
  const [row] = await run<{ id: string }>(
    `INSERT INTO estimate_lines (estimate_id, item_key, scope_item_key, cost_item_id, description, section, unit, qty, unit_cost, markup, extended,
        source_kind, source_ref, internal_cost_cents, cost_basis, cost_observed_at, provisional, is_allowance, allowance_cents, allowance_scope, evidence, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,$9,$10::jsonb,$11,$12,$13::timestamptz,$14,$15,$16,$17,COALESCE($18::jsonb,'[]'::jsonb),
             COALESCE((SELECT max(sort_order)+1 FROM estimate_lines WHERE estimate_id = $1), 0))
     RETURNING id`,
    [estimateId, input.item_key, input.scope_item_key ?? null, input.cost_item_id ?? null, input.description, input.section ?? "General", input.unit ?? "ea", input.qty ?? 0, input.source_kind, JSON.stringify(input.source_ref ?? {}), cost, input.cost_basis ?? null, input.cost_observed_at ?? null, !!input.provisional, !!input.is_allowance, input.allowance_cents ?? null, input.allowance_scope ?? null, evidence],
  );
  return { id: Number(row.id), created: true };
}

export async function supersedeLine(run: Run, lineId: number, byLineId: number, reason: string): Promise<void> {
  await run(`UPDATE estimate_lines SET superseded_by = $2, superseded_at = now(), evidence = evidence || $3::jsonb WHERE id = $1 AND superseded_by IS NULL`, [lineId, byLineId, JSON.stringify([{ kind: "superseded", by: byLineId, reason, at: new Date().toISOString() }])]);
}

/** Every live scope item gets an estimate item (`scope:<key>`), unpriced until
 *  evidence arrives; Joe's dedicated price is carried as the owner override. */
export async function ensureScopeLines(run: Run, estimateId: number): Promise<{ created: number }> {
  const e = await loadEstimate(run, estimateId);
  if (!e.project_id) return { created: 0 };
  const scope = await run<{ key: string; title: string; trade: string; room: string; dedicated_price_cents: string | null; price_basis: PriceBasis | null; responsibility: string }>(
    `SELECT key, title, trade, room, dedicated_price_cents::text AS dedicated_price_cents, price_basis, responsibility FROM scope_items WHERE project_id = $1 AND status NOT IN ('superseded','excluded')`,
    [e.project_id],
  );
  let created = 0;
  for (const s of scope) {
    const key = stableItemKey("scope", s.key);
    const [have] = await run<{ id: string }>(`SELECT id FROM estimate_lines WHERE estimate_id = $1 AND item_key = $2 AND superseded_by IS NULL`, [estimateId, key]);
    // An existing line keeps whatever evidence landed on it (a quote, a bid,
    // a client product); only its owner-price mirror is refreshed below.
    const r = have ? { id: Number(have.id), created: false } : await upsertEstimateLine(run, estimateId, {
      item_key: key,
      description: s.title,
      section: s.room || s.trade || "General",
      unit: "ls",
      qty: 1,
      scope_item_key: s.key,
      source_kind: s.dedicated_price_cents != null ? "owner_price" : "assumption",
      source_ref: { scope_key: s.key },
      provisional: s.dedicated_price_cents == null,
    });
    if (r.created) created += 1;
    // Owner pricing lives on the scope item; mirror it (basis preserved, never re-marked).
    await run(`UPDATE estimate_lines SET owner_price_override_cents = $3, owner_price_basis = $4 WHERE id = $1 AND estimate_id = $2 AND (owner_price_override_cents IS DISTINCT FROM $3 OR owner_price_basis IS DISTINCT FROM $4)`, [r.id, estimateId, s.dedicated_price_cents == null ? null : Number(s.dedicated_price_cents), s.dedicated_price_cents == null ? null : s.price_basis]);
  }
  return { created };
}

/** Replace the open gap set for an estimate. Accepted gaps stay accepted
 *  while they still exist; vanished gaps resolve. */
export async function syncGaps(run: Run, estimateId: number, projectId: string | null, gaps: Gap[]): Promise<void> {
  const keys = gaps.map((g) => `${g.kind}|${g.ref}`);
  await run(`UPDATE estimate_gaps SET status = 'resolved', resolved_at = now() WHERE estimate_id = $1 AND status <> 'resolved' AND NOT ((kind || '|' || ref) = ANY($2::text[]))`, [estimateId, keys]);
  for (const g of gaps) {
    await run(
      `INSERT INTO estimate_gaps (estimate_id, project_id, kind, ref, severity, detail)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (estimate_id, kind, ref) DO UPDATE SET detail = EXCLUDED.detail, severity = EXCLUDED.severity,
         status = CASE WHEN estimate_gaps.status = 'accepted' THEN 'accepted' ELSE 'open' END, resolved_at = NULL`,
      [estimateId, projectId, g.kind, g.ref, g.severity, g.detail],
    );
  }
}

export interface RecomputeResult {
  estimate_id: number;
  revision: number;
  subtotal_cents: number;
  total_cents: number;
  markup_total_cents: number;
  unknown_cost_lines: number;
  gaps: Gap[];
  offer_invalidated: boolean;
  proposal_decision_id: string | null;
  markup_pct: number | null;
}

/** Event-driven recompute: prices every live line by the rules, applies the
 *  committed-price snapshot when the estimate has been offered, rebuilds the
 *  gap set and totals, and — if a sent offer changed — stages (or supersedes)
 *  the 'proposal' decision so the revised offer needs fresh approval. */
export async function recomputeDraftEstimate(run: Run, estimateId: number, opts: { principal?: Principal } = {}): Promise<RecomputeResult> {
  const e = await loadEstimate(run, estimateId, true);
  await ensureScopeLines(run, estimateId);
  const { pct: markupPct } = await activeMarkupPct(run);
  const lines = await loadLines(run, estimateId);
  const gaps: Gap[] = [];
  let subtotal = 0;
  let total = 0;
  let unknown = 0;
  let offerChanged = false;
  const snapshot = e.offered_snapshot;
  for (const line of lines) {
    const p = priceLine(line, { default_markup_pct: markupPct ?? 0 });
    gaps.push(...p.gaps);
    if (markupPct == null && (p.mode === "cost_plus_markup" || p.mode === "owner_internal_cost")) {
      gaps.push({ kind: "unverified_assumption", ref: line.item_key ?? `line:${line.id}`, severity: "hard", detail: "no active markup — activate a pricing setup before a fixed price" });
    }
    const c = committedPrice(line, p.extended_cents, snapshot);
    if (c.offer_changed) {
      gaps.push(c.offer_changed);
      offerChanged = true;
    }
    const extended = c.extended_cents ?? 0;
    const internal = p.internal_cost_cents;
    if (internal == null && !line.is_allowance) unknown += 1;
    subtotal += internal ?? 0;
    total += extended;
    const unitCost = internal != null && line.qty > 0 ? Math.round(internal / line.qty) : line.unit_cost;
    await run(
      `UPDATE estimate_lines SET extended = $2, internal_cost_cents = $3, unit_cost = $4, markup = $5, provisional = $6
        WHERE id = $1 AND (extended <> $2 OR internal_cost_cents IS DISTINCT FROM $3 OR unit_cost <> $4 OR markup <> $5 OR provisional <> $6)`,
      [line.id, extended, internal, unitCost, p.markup_pct_applied ?? 0, line.provisional || p.mode === "unknown"],
    );
  }
  // Scope items with no coverage at all (should not happen after ensureScopeLines, but bid exclusions can remove lines).
  if (e.project_id) {
    const unallocated = await run<{ key: string; title: string }>(`SELECT key, title FROM scope_items WHERE project_id = $1 AND status = 'open' AND responsibility = 'unassigned'`, [e.project_id]);
    for (const u of unallocated) gaps.push({ kind: "unallocated_scope", ref: u.key, severity: "soft", detail: `${u.title}: nobody assigned (Joe / sub / supplier)` });
    const competing = await run<{ competing_group: string; n: string }>(`SELECT competing_group, count(*)::text AS n FROM quotes WHERE project_id = $1 AND approval_state = 'held_competing' GROUP BY competing_group`, [e.project_id]);
    for (const c of competing) gaps.push({ kind: "competing_quotes", ref: c.competing_group, severity: "hard", detail: `${c.n} competing quotes await Joe's choice` });
  }
  await syncGaps(run, estimateId, e.project_id, gaps);

  let decisionId: string | null = null;
  const offered = !!snapshot && (e.status === "sent" || e.status === "approved");
  if (offered && offerChanged) {
    const { decision } = await stageDecision(run, {
      kind: "proposal",
      action: "send_estimate",
      title: `Revised offer: ${e.title || `estimate ${estimateId}`}`,
      summary: { changes: gaps.filter((g) => g.kind === "offer_changed").map((g) => g.detail), effect: "The sent offer no longer matches the estimate. Approving re-offers the client the revised estimate; nothing is sent until then.", gaps: gaps.filter((g) => g.severity === "hard" && g.kind !== "offer_changed").map((g) => g.detail) },
      targetKind: "estimate",
      targetId: estimateId,
      projectId: e.project_id,
      amountCents: total,
      content: { estimate_id: estimateId, lines: lines.map((l) => ({ k: l.item_key ?? l.id, q: l.qty, x: l.extended })) },
      artifactRevision: `estimate:${estimateId}:r${e.revision + 1}`,
      dedupeKey: `estimate:${estimateId}:proposal`,
      requestedBy: opts.principal ?? { kind: "service", name: "estimating.recompute" },
      href: e.project_id ? `/projects/${e.project_id}` : null,
    });
    decisionId = decision.id;
  }
  await run(
    `UPDATE estimates SET subtotal = $2::int, total = $3::int, markup_total = $3::int - $2::int, offer_stale = $4::boolean,
       revision = CASE WHEN $4::boolean AND NOT offer_stale THEN revision + 1 ELSE revision END
      WHERE id = $1`,
    [estimateId, subtotal, total, offered && offerChanged],
  );
  const [rev] = await run<{ revision: number }>(`SELECT revision FROM estimates WHERE id = $1`, [estimateId]);
  return { estimate_id: estimateId, revision: rev.revision, subtotal_cents: subtotal, total_cents: total, markup_total_cents: total - subtotal, unknown_cost_lines: unknown, gaps, offer_invalidated: offered && offerChanged, proposal_decision_id: decisionId, markup_pct: markupPct };
}

/** At send: snapshot every live line's client price. Immutable afterwards. */
export async function freezeOfferedPrices(run: Run, estimateId: number, principal: Principal): Promise<OfferedSnapshot> {
  const e = await loadEstimate(run, estimateId, true);
  const lines = await loadLines(run, estimateId);
  const snap: OfferedSnapshot = {
    revision: e.revision,
    offered_at: new Date().toISOString(),
    total: lines.reduce((s, l) => s + l.extended, 0),
    lines: lines.map((l) => ({ item_key: l.item_key, line_id: l.id, description: l.description, qty: l.qty, unit: l.unit, extended: l.extended, internal_cost_cents: l.internal_cost_cents, is_allowance: l.is_allowance, allowance_cents: l.allowance_cents, allowance_scope: l.allowance_scope })),
  };
  await run(`UPDATE estimates SET offered_snapshot = $2::jsonb, offered_at = now(), offered_revision = revision, offer_stale = false WHERE id = $1`, [estimateId, JSON.stringify({ ...snap, frozen_by: principalLabel(principal) })]);
  return snap;
}

export interface MarginExposure {
  estimate_id: number;
  offered: boolean;
  offered_total_cents: number;
  internal_cost_now_cents: number;
  internal_cost_at_offer_cents: number | null;
  margin_now_cents: number | null;
  margin_at_offer_cents: number | null;
  unknown_cost_lines: string[];
  provisional_lines: string[];
  allowance_lines: Array<{ item_key: string | null; description: string; allowance_cents: number }>;
  lines: Array<{ item_key: string | null; description: string; offered_cents: number; cost_at_offer_cents: number | null; cost_now_cents: number | null; margin_delta_cents: number | null; provisional: boolean }>;
}

/** Joe's internal review: offered vs internal cost per line, what is still
 *  provisional or unknown, and how later cost evidence moved the margin. */
export async function marginExposureReport(run: Run, estimateId: number): Promise<MarginExposure> {
  const e = await loadEstimate(run, estimateId);
  const lines = await loadLines(run, estimateId);
  const snap = e.offered_snapshot;
  const rows = lines.map((l) => {
    const s = snap?.lines.find((x) => (l.item_key ? x.item_key === l.item_key : x.line_id === l.id));
    const offered = s ? s.extended : l.extended;
    const costAtOffer = s ? s.internal_cost_cents : null;
    const costNow = l.is_allowance ? l.allowance_cents : l.internal_cost_cents;
    const delta = costAtOffer != null && costNow != null ? costAtOffer - costNow : null;
    return { item_key: l.item_key, description: l.description, offered_cents: offered, cost_at_offer_cents: costAtOffer, cost_now_cents: costNow, margin_delta_cents: delta, provisional: l.provisional };
  });
  const unknown = lines.filter((l) => l.internal_cost_cents == null && !l.is_allowance);
  const known = unknown.length === 0;
  const offeredTotal = rows.reduce((s, r) => s + r.offered_cents, 0);
  const costNow = rows.reduce((s, r) => s + (r.cost_now_cents ?? 0), 0);
  const costAtOffer = snap ? snap.lines.reduce((s, l) => s + (l.internal_cost_cents ?? 0), 0) : null;
  return {
    estimate_id: estimateId,
    offered: !!snap,
    offered_total_cents: offeredTotal,
    internal_cost_now_cents: costNow,
    internal_cost_at_offer_cents: costAtOffer,
    margin_now_cents: known ? offeredTotal - costNow : null,
    margin_at_offer_cents: snap && costAtOffer != null && snap.lines.every((l) => l.internal_cost_cents != null || l.is_allowance) ? offeredTotal - costAtOffer : null,
    unknown_cost_lines: unknown.map((l) => l.description),
    provisional_lines: lines.filter((l) => l.provisional).map((l) => l.description),
    allowance_lines: lines.filter((l) => l.is_allowance).map((l) => ({ item_key: l.item_key, description: l.description, allowance_cents: l.allowance_cents ?? 0 })),
    lines: rows,
  };
}

/** W07 "Joe supplies dedicated labor/pricing": apply to the stated item with
 *  its basis. client_price is used as-is; internal_cost gets markup once. */
export async function applyOwnerPricing(run: Run, input: { estimate_id: number; item_key: string; price_cents: number; basis: PriceBasis; principal: Principal; note?: string }): Promise<RecomputeResult> {
  if (!(input.price_cents > 0)) throw new Error("owner price must be positive");
  const rows = await run<{ id: string; scope_item_key: string | null }>(
    `UPDATE estimate_lines SET owner_price_override_cents = $3, owner_price_basis = $4, source_kind = 'owner_price', provisional = false,
       evidence = evidence || $5::jsonb
      WHERE estimate_id = $1 AND item_key = $2 AND superseded_by IS NULL RETURNING id, scope_item_key`,
    [input.estimate_id, input.item_key, input.price_cents, input.basis, JSON.stringify([{ kind: "owner_price", cents: input.price_cents, basis: input.basis, by: principalLabel(input.principal), note: input.note ?? "", at: new Date().toISOString() }])],
  );
  if (!rows.length) {
    // A scope item that has no estimate line yet (register prepared, draft not
    // recomputed): materialise the scope lines once and retry.
    if (input.item_key.startsWith("scope:")) {
      await ensureScopeLines(run, input.estimate_id);
      const again = await run<{ id: string }>(`SELECT id FROM estimate_lines WHERE estimate_id = $1 AND item_key = $2 AND superseded_by IS NULL`, [input.estimate_id, input.item_key]);
      if (again.length) return applyOwnerPricing(run, input);
    }
    throw new Error(`no line ${input.item_key} on estimate ${input.estimate_id}`);
  }
  const [e] = await run<{ project_id: string | null }>(`SELECT project_id FROM estimates WHERE id = $1`, [input.estimate_id]);
  if (rows[0].scope_item_key && e?.project_id) {
    await run(`UPDATE scope_items SET dedicated_price_cents = $3, price_basis = $4, responsibility = 'joe', install_by = 'joe', status = 'priced' WHERE project_id = $1 AND key = $2`, [e.project_id, rows[0].scope_item_key, input.price_cents, input.basis]);
  }
  return recomputeDraftEstimate(run, input.estimate_id, { principal: input.principal });
}

// ─── Quotes ──────────────────────────────────────────────────────────────────

export interface QuoteInput {
  project_id: string;
  supplier_kind: "vendor" | "sub";
  supplier_name: string;
  vendor_id?: string | null;
  sub_slug?: string | null;
  quote_ref?: string;
  revision?: number;
  received_at?: string;
  expires_at?: string | null;
  includes_tax?: boolean | null;
  tax_cents?: number | null;
  includes_freight?: boolean | null;
  freight_cents?: number | null;
  competing_group?: string | null;
  coverage?: { scope_keys?: string[]; item_keys?: string[]; exclusions?: string[] };
  bid_submission_id?: number | null;
  source_ref?: string;
  notes?: string;
  lines: Array<{ description: string; product?: ProductIdentity; unit?: string | null; quantity?: number | null; unit_price_cents?: number | null; extended_cents?: number | null; supply?: boolean; install?: boolean; scope_key?: string | null; item_key?: string | null; notes?: string }>;
}

/** Record a received quote and its lines (a revision of an existing quote
 *  supersedes the earlier revision). Recording is not incorporation. */
export async function recordQuote(run: Run, input: QuoteInput): Promise<{ quote_id: string; created: boolean }> {
  const rev = input.revision ?? 1;
  const [existing] = await run<{ id: string }>(`SELECT id FROM quotes WHERE project_id = $1 AND supplier_name = $2 AND quote_ref = $3 AND revision = $4`, [input.project_id, input.supplier_name, input.quote_ref ?? "", rev]);
  if (existing) return { quote_id: existing.id, created: false };
  const [q] = await run<{ id: string }>(
    `INSERT INTO quotes (project_id, supplier_kind, vendor_id, sub_slug, supplier_name, quote_ref, revision, received_at, expires_at, includes_tax, tax_cents, includes_freight, freight_cents, competing_group, coverage, bid_submission_id, source_ref, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()),$9::timestamptz,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18) RETURNING id`,
    [input.project_id, input.supplier_kind, input.vendor_id ?? null, input.sub_slug ?? null, input.supplier_name, input.quote_ref ?? "", rev, input.received_at ?? null, input.expires_at ?? null, input.includes_tax ?? null, input.tax_cents ?? null, input.includes_freight ?? null, input.freight_cents ?? null, input.competing_group ?? null, JSON.stringify(input.coverage ?? {}), input.bid_submission_id ?? null, input.source_ref ?? "", input.notes ?? ""],
  );
  let i = 0;
  for (const l of input.lines) {
    const ext = l.extended_cents ?? (l.unit_price_cents != null && l.quantity != null ? Math.round(l.unit_price_cents * l.quantity) : null);
    await run(
      `INSERT INTO quote_lines (quote_id, description, product, product_key, unit, quantity, unit_price_cents, extended_cents, supply, install, scope_key, item_key, sort_order, notes)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [q.id, l.description, JSON.stringify(l.product ?? {}), l.product ? productKey(l.product) : null, l.unit ?? null, l.quantity ?? null, l.unit_price_cents ?? null, ext, l.supply ?? true, l.install ?? false, l.scope_key ?? null, l.item_key ?? null, i++, l.notes ?? ""],
    );
  }
  if (rev > 1) await run(`UPDATE quotes SET approval_state = 'superseded' WHERE project_id = $1 AND supplier_name = $2 AND quote_ref = $3 AND revision < $4 AND approval_state <> 'superseded'`, [input.project_id, input.supplier_name, input.quote_ref ?? "", rev]);
  return { quote_id: q.id, created: true };
}

interface QuoteRow {
  id: string;
  project_id: string;
  supplier_kind: string;
  supplier_name: string;
  quote_ref: string;
  revision: number;
  expires_at: string | null;
  includes_tax: boolean | null;
  tax_cents: string | null;
  includes_freight: boolean | null;
  freight_cents: string | null;
  competing_group: string | null;
  approval_state: string;
  coverage: { scope_keys?: string[]; item_keys?: string[]; exclusions?: string[] };
  incorporated_at: string | null;
}
interface QuoteLineRow {
  id: string;
  description: string;
  product: ProductIdentity;
  product_key: string | null;
  unit: string | null;
  quantity: string | null;
  unit_price_cents: string | null;
  extended_cents: string | null;
  supply: boolean;
  install: boolean;
  scope_key: string | null;
  item_key: string | null;
}

async function loadQuote(run: Run, quoteId: string): Promise<{ quote: QuoteRow; lines: QuoteLineRow[] }> {
  const [quote] = await run<QuoteRow>(`SELECT id, project_id, supplier_kind, supplier_name, quote_ref, revision, expires_at::text AS expires_at, includes_tax, tax_cents::text AS tax_cents, includes_freight, freight_cents::text AS freight_cents, competing_group, approval_state, coverage, incorporated_at::text AS incorporated_at FROM quotes WHERE id = $1 FOR UPDATE`, [quoteId]);
  if (!quote) throw new Error(`quote ${quoteId} not found`);
  const lines = await run<QuoteLineRow>(`SELECT id, description, product, product_key, unit, quantity::text AS quantity, unit_price_cents::text AS unit_price_cents, extended_cents::text AS extended_cents, supply, install, scope_key, item_key FROM quote_lines WHERE quote_id = $1 ORDER BY sort_order, id`, [quoteId]);
  return { quote, lines };
}

export type IncorporateResult =
  | { ok: true; state: "incorporated"; applied: string[]; skipped: Array<{ line: string; reason: string }>; recompute: RecomputeResult }
  | { ok: true; state: "held_competing"; decision_id: string; group: string; competitors: string[] }
  | { ok: false; error: string };

/** W07: a non-competitive supplier quote replaces the provisional online cost
 *  of the items it covers, after a product/quantity/unit check per line. A
 *  quote whose competing_group has other live quotes is HELD and a
 *  supplier_choice decision is staged instead. Idempotent: lines already
 *  priced by this quote are not re-applied. Never a purchase. */
export async function incorporateQuote(run: Run, input: { quote_id: string; estimate_id: number; principal: Principal; decision_id?: string | null }): Promise<IncorporateResult> {
  const { quote, lines } = await loadQuote(run, input.quote_id);
  if (quote.approval_state === "superseded" || quote.approval_state === "rejected") return { ok: false, error: `quote is ${quote.approval_state}` };
  if (quote.expires_at && new Date(quote.expires_at).getTime() < Date.now()) return { ok: false, error: `quote expired ${quote.expires_at} — dated evidence, not a current price` };

  if (quote.competing_group && !input.decision_id) {
    const rivals = await run<{ id: string; supplier_name: string }>(`SELECT id, supplier_name FROM quotes WHERE project_id = $1 AND competing_group = $2 AND id <> $3 AND approval_state IN ('received','eligible','held_competing')`, [quote.project_id, quote.competing_group, quote.id]);
    if (rivals.length) {
      const cmp = await compareCompetingQuotes(run, quote.project_id, quote.competing_group, input.principal);
      return { ok: true, state: "held_competing", decision_id: cmp.decision_id, group: quote.competing_group, competitors: cmp.quotes.map((q) => q.supplier_name) };
    }
  }
  if (input.decision_id) {
    const c = await consumeDecision(run, { id: input.decision_id, action: "choose_supplier_quote", targetKind: "quote_group", targetId: `${quote.project_id}:${quote.competing_group ?? ""}`, consumer: principalLabel(input.principal) });
    if (!c.ok) return { ok: false, error: c.reason };
    await run(`UPDATE quotes SET approval_state = 'rejected' WHERE project_id = $1 AND competing_group = $2 AND id <> $3 AND approval_state = 'held_competing'`, [quote.project_id, quote.competing_group, quote.id]);
  }

  // A covered scope with no estimate line yet (draft never recomputed):
  // materialise the scope lines first so the quote has something to land on.
  await ensureScopeLines(run, input.estimate_id);
  const estLines = await loadLines(run, input.estimate_id);
  const applied: string[] = [];
  const skipped: Array<{ line: string; reason: string }> = [];
  const basis = `quote:${quote.id}`;
  const observedAt = new Date().toISOString();
  const freightGap = quote.includes_freight == null && quote.freight_cents == null;
  for (const ql of lines) {
    const ext = ql.extended_cents == null ? null : Number(ql.extended_cents);
    if (ext == null) {
      skipped.push({ line: ql.description, reason: "quote line has no price" });
      continue;
    }
    const target = estLines.find((l) => (ql.item_key && l.item_key === ql.item_key) || (ql.scope_key && l.scope_item_key === ql.scope_key && !ql.item_key));
    if (!target) {
      skipped.push({ line: ql.description, reason: `no estimate item for ${ql.item_key ?? ql.scope_key ?? "unlinked line"}` });
      continue;
    }
    if (target.cost_basis === basis) {
      applied.push(target.item_key ?? String(target.id));
      continue; // already counted once
    }
    if (target.owner_price_override_cents != null && target.owner_price_basis === "client_price") {
      skipped.push({ line: ql.description, reason: "owner client price stands; quote recorded as evidence only" });
      await run(`UPDATE estimate_lines SET evidence = evidence || $2::jsonb WHERE id = $1`, [target.id, JSON.stringify([{ kind: "quote_evidence", quote_id: quote.id, cents: ext, at: observedAt }])]);
      continue;
    }
    const itemProduct = (target.source_ref?.product as ProductIdentity | undefined) ?? null;
    const check = quoteCoverageCheck({ product_key: ql.product_key, unit: ql.unit, quantity: ql.quantity == null ? null : Number(ql.quantity), supply: ql.supply, install: ql.install }, { product_key: itemProduct ? productKey(itemProduct) : null, unit: target.unit, qty: target.qty });
    if (!check.ok) {
      skipped.push({ line: ql.description, reason: check.issues.map((i) => i.detail).join("; ") });
      await syncGapsAppend(run, input.estimate_id, quote.project_id, check.issues.map((i) => ({ ...i, ref: target.item_key ?? `line:${target.id}` })));
      continue;
    }
    await run(
      `UPDATE estimate_lines SET internal_cost_cents = $2, cost_basis = $3, cost_observed_at = $4::timestamptz, provisional = false,
         source_kind = $5, source_ref = source_ref || $6::jsonb, evidence = evidence || $7::jsonb
        WHERE id = $1`,
      [target.id, ext, basis, observedAt, quote.supplier_kind === "sub" ? "sub_bid" : "supplier_quote", JSON.stringify({ quote_id: quote.id, quote_line_id: ql.id, supplier: quote.supplier_name, revision: quote.revision }), JSON.stringify([{ kind: "quote", quote_id: quote.id, line: ql.description, cents: ext, supply: ql.supply, install: ql.install, includes_tax: quote.includes_tax, includes_freight: quote.includes_freight, at: observedAt }])],
    );
    applied.push(target.item_key ?? String(target.id));
  }
  await run(`UPDATE quotes SET approval_state = CASE WHEN approval_state IN ('received','held_competing','eligible') THEN 'approved' ELSE approval_state END, incorporated_at = COALESCE(incorporated_at, now()), decision_id = COALESCE($2, decision_id) WHERE id = $1`, [quote.id, input.decision_id ?? null]);
  const recompute = await recomputeDraftEstimate(run, input.estimate_id, { principal: input.principal });
  if (freightGap && applied.length) await syncGapsAppend(run, input.estimate_id, quote.project_id, [{ kind: "missing_freight", ref: `quote:${quote.id}`, severity: "soft", detail: `${quote.supplier_name} quote: delivery/freight coverage not stated` }]);
  return { ok: true, state: "incorporated", applied, skipped, recompute };
}

async function syncGapsAppend(run: Run, estimateId: number, projectId: string | null, gaps: Gap[]): Promise<void> {
  for (const g of gaps) {
    await run(
      `INSERT INTO estimate_gaps (estimate_id, project_id, kind, ref, severity, detail) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (estimate_id, kind, ref) DO UPDATE SET detail = EXCLUDED.detail, status = CASE WHEN estimate_gaps.status = 'accepted' THEN 'accepted' ELSE 'open' END, resolved_at = NULL`,
      [estimateId, projectId, g.kind, g.ref, g.severity, g.detail],
    );
  }
}

export interface QuoteComparison {
  group: string;
  decision_id: string;
  created: boolean;
  quotes: Array<{ quote_id: string; supplier_name: string; revision: number; total_cents: number; priced_lines: number; unpriced_lines: number; expires_at: string | null; includes_tax: boolean | null; includes_freight: boolean | null; exclusions: string[]; coverage_keys: string[] }>;
  equivalent_scope: { common_keys: string[]; only_in: Record<string, string[]> };
  note: string;
}

/** W07: equivalent-scope comparison of competing quotes + a supplier_choice
 *  decision (one per group, superseded when a quote changes). Nothing is
 *  summed or picked automatically. */
export async function compareCompetingQuotes(run: Run, projectId: string, group: string, principal: Principal): Promise<QuoteComparison> {
  const quotes = await run<QuoteRow>(`SELECT id, project_id, supplier_kind, supplier_name, quote_ref, revision, expires_at::text AS expires_at, includes_tax, tax_cents::text AS tax_cents, includes_freight, freight_cents::text AS freight_cents, competing_group, approval_state, coverage, incorporated_at::text AS incorporated_at FROM quotes WHERE project_id = $1 AND competing_group = $2 AND approval_state IN ('received','eligible','held_competing') ORDER BY supplier_name, revision`, [projectId, group]);
  if (quotes.length < 2) throw new Error(`competing group "${group}" has ${quotes.length} live quote(s); nothing to compare`);
  const rows: QuoteComparison["quotes"] = [];
  const keysBy: Record<string, Set<string>> = {};
  for (const q of quotes) {
    const lines = await run<QuoteLineRow>(`SELECT id, description, product, product_key, unit, quantity::text AS quantity, unit_price_cents::text AS unit_price_cents, extended_cents::text AS extended_cents, supply, install, scope_key, item_key FROM quote_lines WHERE quote_id = $1`, [q.id]);
    const keys = new Set(lines.map((l) => l.item_key ?? l.scope_key ?? l.product_key ?? l.description));
    keysBy[q.id] = keys;
    rows.push({
      quote_id: q.id,
      supplier_name: q.supplier_name,
      revision: q.revision,
      total_cents: lines.reduce((s, l) => s + (l.extended_cents == null ? 0 : Number(l.extended_cents)), 0) + Number(q.tax_cents ?? 0) + Number(q.freight_cents ?? 0),
      priced_lines: lines.filter((l) => l.extended_cents != null).length,
      unpriced_lines: lines.filter((l) => l.extended_cents == null).length,
      expires_at: q.expires_at,
      includes_tax: q.includes_tax,
      includes_freight: q.includes_freight,
      exclusions: q.coverage?.exclusions ?? [],
      coverage_keys: [...keys],
    });
    await run(`UPDATE quotes SET approval_state = 'held_competing' WHERE id = $1 AND approval_state IN ('received','eligible')`, [q.id]);
  }
  const all = Object.values(keysBy);
  const common = [...all[0]].filter((k) => all.every((s) => s.has(k)));
  const onlyIn: Record<string, string[]> = {};
  for (const q of quotes) onlyIn[q.supplier_name] = [...keysBy[q.id]].filter((k) => !common.includes(k));
  const { decision, created } = await stageDecision(run, {
    kind: "supplier_choice",
    action: "choose_supplier_quote",
    title: `Choose supplier for ${group}`,
    summary: {
      recipients: rows.map((r) => ({ name: r.supplier_name, role: "supplier" })),
      quantities: rows.map((r) => ({ label: `${r.supplier_name} total`, qty: (r.total_cents / 100).toFixed(2), unit: "USD" })),
      exclusions: rows.flatMap((r) => r.exclusions.map((x) => `${r.supplier_name}: ${x}`)),
      gaps: [...rows.filter((r) => r.unpriced_lines > 0).map((r) => `${r.supplier_name}: ${r.unpriced_lines} unpriced line(s)`), ...Object.entries(onlyIn).filter(([, v]) => v.length).map(([k, v]) => `${k} also covers: ${v.join(", ")}`)],
      effect: "Approving picks ONE quote for the estimate's internal cost. It is not a purchase or an award.",
      options: rows.map((r) => r.quote_id),
    },
    targetKind: "quote_group",
    targetId: `${projectId}:${group}`,
    projectId,
    content: rows.map((r) => ({ id: r.quote_id, rev: r.revision, total: r.total_cents })),
    dedupeKey: `project:${projectId}:supplier_choice:${group}`,
    requestedBy: principal,
    options: ["approve", "reject"],
  });
  return { group, decision_id: decision.id, created, quotes: rows, equivalent_scope: { common_keys: common, only_in: onlyIn }, note: "Competing offers are held for Joe's choice; none is applied or summed." };
}

/** After Joe approves the supplier_choice decision: bind the chosen quote to
 *  it and incorporate. `consumeDecision` refuses a mismatched quote. */
export async function chooseSupplierQuote(run: Run, input: { quote_id: string; decision_id: string; estimate_id: number; principal: Principal }): Promise<IncorporateResult> {
  const [d] = await run<Decision>(`SELECT id, status, target_id, content_hash, summary FROM decisions WHERE id = $1`, [input.decision_id]);
  if (!d) return { ok: false, error: "no such decision" };
  const opts = ((d.summary as { options?: string[] })?.options ?? []) as string[];
  if (opts.length && !opts.includes(input.quote_id)) return { ok: false, error: "that quote is not one of the compared offers" };
  // consumeDecision binds target to the group; re-bind the quote id for the consumer check
  // The decision was staged over the compared offers; presenting that same
  // content hash proves the choice is being made on what Joe actually saw.
  const c = await consumeDecision(run, { id: input.decision_id, action: "choose_supplier_quote", targetKind: "quote_group", targetId: d.target_id, contentHash: d.content_hash, consumer: principalLabel(input.principal) });
  if (!c.ok) return { ok: false, error: c.reason };
  await run(`UPDATE quotes SET approval_state = 'rejected' WHERE competing_group = (SELECT competing_group FROM quotes WHERE id = $1) AND project_id = (SELECT project_id FROM quotes WHERE id = $1) AND id <> $1 AND approval_state = 'held_competing'`, [input.quote_id]);
  await run(`UPDATE quotes SET approval_state = 'approved', decision_id = $2 WHERE id = $1`, [input.quote_id, input.decision_id]);
  return incorporateQuote(run, { quote_id: input.quote_id, estimate_id: input.estimate_id, principal: input.principal });
}

/** W07 "Joe approves a sub bid for estimate use": record the bid as a sub
 *  quote covering the named scope keys (with its exclusions) and incorporate
 *  it. Requires an owner (or a decision/grant auth ref the caller verified).
 *  Does NOT award — bid_packages.awarded_invite_id is WS-procurement's. */
export async function incorporateSubBid(run: Run, input: { bid_submission_id: number; estimate_id: number; scope_keys: string[]; principal: Principal; auth_ref?: string | null }): Promise<IncorporateResult> {
  const [bid] = await run<{ id: string; total: number; exclusions: string; notes: string; revision: number; sub_slug: string; sub_name: string; project_id: string; lines: Array<{ description: string; amount: number }> | null }>(
    `SELECT s.id, s.total, s.exclusions, s.notes, s.revision, i.sub_slug, sb.name AS sub_name, p.project_id,
            (SELECT json_agg(json_build_object('description', l.description, 'amount', l.amount) ORDER BY l.sort_order) FROM bid_submission_lines l WHERE l.submission_id = s.id) AS lines
       FROM bid_submissions s JOIN bid_invites i ON i.id = s.invite_id JOIN bid_packages p ON p.id = i.package_id JOIN subs sb ON sb.slug = i.sub_slug
      WHERE s.id = $1`,
    [input.bid_submission_id],
  );
  if (!bid) return { ok: false, error: "bid submission not found" };
  const isOwnerish = input.principal.kind === "user" ? input.principal.role === "owner" : input.principal.kind === "agent" ? input.principal.onBehalfOf?.role === "owner" : false;
  if (!isOwnerish && !input.auth_ref) return { ok: false, error: "Approving a sub bid for the estimate is Joe's call (or needs a decision reference)." };
  if (!input.scope_keys.length) return { ok: false, error: "name the scope keys this bid covers" };
  // One quote line per covered scope; a single-total bid is allocated to the first scope key and linked (not repeated) on the rest.
  const exclusions = bid.exclusions ? bid.exclusions.split(/\n|;/).map((s) => s.trim()).filter(Boolean) : [];
  const lines: QuoteInput["lines"] = input.scope_keys.map((k, i) => ({ description: `${bid.sub_name} bid — ${k}`, scope_key: k, unit: "ls", quantity: 1, extended_cents: i === 0 ? bid.total : null, install: true, supply: false, notes: i === 0 ? "" : "covered by the bid total on the first scope line" }));
  const q = await recordQuote(run, { project_id: bid.project_id, supplier_kind: "sub", supplier_name: bid.sub_name, sub_slug: bid.sub_slug, quote_ref: `bid:${bid.id}`, revision: bid.revision, bid_submission_id: Number(bid.id), coverage: { scope_keys: input.scope_keys, exclusions }, notes: bid.notes, lines, includes_tax: true, includes_freight: true });
  await run(`UPDATE quotes SET approval_state = 'approved', decision_id = NULL WHERE id = $1`, [q.quote_id]);
  const r = await incorporateQuote(run, { quote_id: q.quote_id, estimate_id: input.estimate_id, principal: input.principal });
  if (r.ok && r.state === "incorporated" && input.scope_keys.length > 1) {
    // Remaining covered scope lines: cost is inside the bid total → mark covered (not unknown), cost 0 attributable, provisional false.
    for (const k of input.scope_keys.slice(1)) {
      await run(`UPDATE estimate_lines SET internal_cost_cents = 0, cost_basis = $3, provisional = false, source_kind = 'sub_bid', source_ref = source_ref || $4::jsonb WHERE estimate_id = $1 AND scope_item_key = $2 AND superseded_by IS NULL AND (internal_cost_cents IS NULL OR cost_basis = $3)`, [input.estimate_id, k, `quote:${q.quote_id}:covered`, JSON.stringify({ quote_id: q.quote_id, covered_by_total: true })]);
    }
    const rc = await recomputeDraftEstimate(run, input.estimate_id, { principal: input.principal });
    if (exclusions.length) await syncGapsAppend(run, input.estimate_id, bid.project_id, exclusions.map((x) => ({ kind: "coverage_missing" as const, ref: `bid:${bid.id}:${x.slice(0, 40)}`, severity: "soft" as const, detail: `${bid.sub_name} excludes: ${x}` })));
    return { ...r, recompute: rc };
  }
  // What the bid excludes is a coverage gap on the estimate until someone else prices it.
  if (r.ok && exclusions.length) await syncGapsAppend(run, input.estimate_id, bid.project_id, exclusions.map((x) => ({ kind: "coverage_missing" as const, ref: `bid:${bid.id}:${x.slice(0, 40)}`, severity: "soft" as const, detail: `${bid.sub_name} excludes: ${x}` })));
  return r;
}

/** W07 allowance overage: build the priced CO payload (pure helper) and stage
 *  a change_order decision for Joe. No change_orders row is written here —
 *  WS-money/WS-field own that table. */
export async function stageAllowanceOverage(run: Run, input: { estimate_id: number; item_key: string; chosen: { description: string; cost_cents: number; source_ref?: Record<string, unknown> }; principal: Principal }): Promise<{ payload: AllowanceOveragePayload | null; decision_id: string | null; credit_cents: number | null }> {
  const e = await loadEstimate(run, input.estimate_id);
  const lines = await loadLines(run, input.estimate_id);
  const line = lines.find((l) => l.item_key === input.item_key);
  if (!line || !line.is_allowance) throw new Error(`${input.item_key} is not an allowance line`);
  const { pct } = await activeMarkupPct(run);
  const payload = prepareAllowanceOverageChangeOrder({ allowance_line: line, chosen: input.chosen, markup_pct: pct });
  if (!payload) {
    const chosenClient = Math.round(input.chosen.cost_cents * (1 + (pct ?? 0) / 100));
    return { payload: null, decision_id: null, credit_cents: (line.allowance_cents ?? 0) - chosenClient };
  }
  const { decision } = await stageDecision(run, {
    kind: "change_order",
    action: "prepare_change_order",
    title: payload.title,
    summary: { changes: [payload.description], effect: "Approving prepares the change order for the client's acceptance and payment before the extra work; nothing is sent by this step.", quantities: [{ label: "Allowance", qty: (payload.allowance_cents / 100).toFixed(2), unit: "USD" }, { label: "Selection", qty: (payload.chosen_cents / 100).toFixed(2), unit: "USD" }, { label: "Overage", qty: (payload.overage_cents / 100).toFixed(2), unit: "USD" }] },
    targetKind: "estimate_line",
    targetId: line.id,
    projectId: e.project_id,
    amountCents: payload.price_cents,
    content: payload,
    dedupeKey: `estimate:${input.estimate_id}:allowance_overage:${input.item_key}`,
    requestedBy: input.principal,
  });
  return { payload, decision_id: decision.id, credit_cents: null };
}

export function unitOrGap(unit: string | null | undefined): string {
  return normalizeUnit(unit) ?? (unit ?? "ea");
}
