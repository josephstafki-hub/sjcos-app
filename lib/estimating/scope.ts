// Scope register, allocation and site findings (WORKFLOW W02/W03). Pure `run`
// style: no server-only import, so tests drive it against the harness and
// app code calls it inside withTransaction().

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { principalLabel } from "../commands/principal.ts";
import { breakdownScope, siteVisitPlanFor } from "./rules.ts";
import type { InstallBy, LeadFacts, PriceBasis, Responsibility, ScopeItem, ScopeItemDraft, SiteFindingInput, SiteVisitPlanItem, SupplyBy } from "./types.ts";

export const SCOPE_ITEM_COLS = `id, project_id, key, title, trade, work_package, room, responsibility, supply_by, install_by, supplier_categories,
  exclusions, assumptions, dependencies, required_finishes, quantities, status, revision, source_refs,
  dedicated_price_cents::bigint AS dedicated_price_cents, price_basis, price_scope_note, unverified, notes`;

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}

function rowToItem(r: Record<string, unknown>): ScopeItem {
  return { ...(r as unknown as ScopeItem), dedicated_price_cents: num(r.dedicated_price_cents) };
}

export interface ScopeRegisterView {
  register: { id: string; revision: number; status: string; prepared_from: Record<string, unknown>; enrichment: Record<string, unknown>; reviewed_at: string | null } | null;
  items: ScopeItem[];
  plan: { id: string; revision: number; status: string; items: SiteVisitPlanItem[] } | null;
  findings: Array<Record<string, unknown>>;
  /** Labor still to solicit (install not retained by Joe) and material needs (never removed by retention). */
  solicitation: { labor: string[]; materials: Array<{ key: string; categories: string[] }> };
}

export async function getScopeRegister(run: Run, projectId: string): Promise<ScopeRegisterView> {
  const [register] = await run<ScopeRegisterView["register"] & object>(
    `SELECT id, revision, status, prepared_from, enrichment, reviewed_at::text AS reviewed_at FROM scope_registers WHERE project_id = $1`,
    [projectId],
  );
  const rows = await run(`SELECT ${SCOPE_ITEM_COLS} FROM scope_items WHERE project_id = $1 ORDER BY room, key`, [projectId]);
  const items = rows.map(rowToItem);
  const [plan] = await run<{ id: string; revision: number; status: string; items: SiteVisitPlanItem[] }>(
    `SELECT id, revision, status, items FROM site_visit_plans WHERE project_id = $1 AND status <> 'superseded' ORDER BY revision DESC LIMIT 1`,
    [projectId],
  );
  const findings = await run(
    `SELECT id, scope_key, fact_key, kind, statement, measurement, unit, source_note, media_ref, impacts, status, resolution, targets_price, applied_at::text AS applied_at, created_at::text AS created_at
       FROM site_visit_findings WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  const live = items.filter((i) => i.status !== "superseded" && i.status !== "excluded");
  return {
    register: register ?? null,
    items,
    plan: plan ?? null,
    findings,
    solicitation: {
      labor: live.filter((i) => i.install_by !== "joe" && i.install_by !== "none").map((i) => i.key),
      materials: live.filter((i) => i.supplier_categories.length > 0 && i.supply_by !== "client").map((i) => ({ key: i.key, categories: i.supplier_categories })),
    },
  };
}

/** Lead facts for a project's lead (intake answers, qualification, rough
 *  estimate, scope text). Returns an empty fact set when the project has no lead. */
export async function loadLeadFacts(run: Run, projectId: string): Promise<LeadFacts> {
  const [p] = await run<{ lead_id: string | null; name: string; address: string | null }>(`SELECT lead_id, name, address FROM projects WHERE id = $1`, [projectId]);
  if (!p) throw new Error("project not found");
  if (!p.lead_id) return { lead_id: null, name: p.name, scope: p.name, address: p.address, intake: [] };
  const [lead] = await run<{ id: string; name: string; scope: string; address: string | null }>(`SELECT id, name, scope, address FROM leads WHERE id = $1`, [p.lead_id]);
  const intake = await run<{ question: string; answer: string }>(`SELECT question, answer FROM lead_intake WHERE lead_id = $1 ORDER BY sort_order, id`, [p.lead_id]);
  const [qual] = await run<{ verdict: string; rationale: string }>(`SELECT verdict, rationale FROM lead_qualification WHERE lead_id = $1`, [p.lead_id]);
  const [rough] = await run<{ notes: string; line_items: { label: string; value: string }[] }>(`SELECT notes, line_items FROM lead_estimates WHERE lead_id = $1`, [p.lead_id]);
  return {
    lead_id: lead?.id ?? p.lead_id,
    name: lead?.name ?? p.name,
    scope: lead?.scope ?? "",
    address: lead?.address ?? p.address,
    intake,
    qualification: qual ?? null,
    rough_estimate: rough ?? null,
  };
}

async function insertItems(run: Run, projectId: string, drafts: ScopeItemDraft[]): Promise<number> {
  let created = 0;
  for (const d of drafts) {
    const rows = await run(
      `INSERT INTO scope_items (project_id, key, title, trade, work_package, room, supplier_categories, exclusions, assumptions, dependencies,
                                required_finishes, quantities, source_refs, unverified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14)
       ON CONFLICT (project_id, key) DO NOTHING RETURNING id`,
      [projectId, d.key, d.title, d.trade, d.work_package, d.room, d.supplier_categories, d.exclusions, JSON.stringify(d.assumptions), d.dependencies, JSON.stringify(d.required_finishes), JSON.stringify(d.quantities), JSON.stringify(d.source_refs), d.unverified],
    );
    created += rows.length;
  }
  return created;
}

/** W02: build (or resume) the preliminary scope register + site-visit plan
 *  from lead facts. Idempotent: a repeated trigger resumes the same register
 *  and never duplicates items. `enrich` is the agent hook — structured items
 *  an agent adds later, merged the same way. */
export async function prepareScopeRegisterFromLead(
  run: Run,
  projectId: string,
  leadFacts: LeadFacts,
  opts: { principal?: Principal; enrich?: ScopeItemDraft[] } = {},
): Promise<{ register_id: string; created: boolean; items_created: number; plan_id: string; plan_created: boolean; matched_rules: string[]; unmatched_text: boolean }> {
  const breakdown = breakdownScope(leadFacts);
  const [existing] = await run<{ id: string }>(`SELECT id FROM scope_registers WHERE project_id = $1 FOR UPDATE`, [projectId]);
  let registerId = existing?.id;
  let created = false;
  if (!registerId) {
    const [r] = await run<{ id: string }>(
      `INSERT INTO scope_registers (project_id, prepared_from) VALUES ($1, $2::jsonb) RETURNING id`,
      [projectId, JSON.stringify({ lead_id: leadFacts.lead_id ?? null, prepared_by: opts.principal ? principalLabel(opts.principal) : "system", at: new Date().toISOString(), matched_rules: breakdown.matched_rules })],
    );
    registerId = r.id;
    created = true;
  }
  let itemsCreated = await insertItems(run, projectId, breakdown.items);
  if (opts.enrich?.length) {
    itemsCreated += await insertItems(run, projectId, opts.enrich.map((e) => ({ ...e, unverified: true, source_refs: [...(e.source_refs ?? []), { kind: "agent", ref: "enrichment" }] })));
    await run(`UPDATE scope_registers SET enrichment = enrichment || $2::jsonb WHERE id = $1`, [registerId, JSON.stringify({ applied_at: new Date().toISOString(), items: opts.enrich.map((e) => e.key) })]);
  }
  // Site-visit plan: one open plan per project; build from the CURRENT items.
  const items = (await run(`SELECT ${SCOPE_ITEM_COLS} FROM scope_items WHERE project_id = $1 AND status NOT IN ('superseded','excluded') ORDER BY room, key`, [projectId])).map(rowToItem);
  const [plan] = await run<{ id: string }>(`SELECT id FROM site_visit_plans WHERE project_id = $1 AND status = 'open' ORDER BY revision DESC LIMIT 1`, [projectId]);
  let planId = plan?.id;
  let planCreated = false;
  if (!planId) {
    const [pl] = await run<{ id: string }>(
      `INSERT INTO site_visit_plans (project_id, revision, items)
       VALUES ($1, COALESCE((SELECT max(revision) FROM site_visit_plans WHERE project_id = $1), 0) + 1, $2::jsonb) RETURNING id`,
      [projectId, JSON.stringify(siteVisitPlanFor(items))],
    );
    planId = pl.id;
    planCreated = true;
  } else if (itemsCreated > 0) {
    // New scope items → extend the open plan with their checklist items (keep answered ones).
    const [cur] = await run<{ items: SiteVisitPlanItem[] }>(`SELECT items FROM site_visit_plans WHERE id = $1`, [planId]);
    const have = new Set(cur.items.map((i) => `${i.scope_key}|${i.kind}|${i.prompt}`));
    const merged = [...cur.items, ...siteVisitPlanFor(items).filter((i) => !have.has(`${i.scope_key}|${i.kind}|${i.prompt}`)).map((i, n) => ({ ...i, id: `p${cur.items.length + n + 1}` }))];
    await run(`UPDATE site_visit_plans SET items = $2::jsonb WHERE id = $1`, [planId, JSON.stringify(merged)]);
  }
  return { register_id: registerId, created, items_created: itemsCreated, plan_id: planId, plan_created: planCreated, matched_rules: breakdown.matched_rules, unmatched_text: breakdown.unmatched_text };
}

export interface AllocateInput {
  key: string;
  responsibility?: Responsibility;
  supply_by?: SupplyBy;
  install_by?: InstallBy;
  dedicated_price_cents?: number | null;
  price_basis?: PriceBasis | null;
  price_scope_note?: string;
  notes?: string;
  principal: Principal;
}

export type AllocateResult = { ok: true; item: ScopeItem; labor_solicited: boolean; materials_still_needed: boolean } | { ok: false; error: string; ask?: string };

/** W03: Joe retains work with dedicated pricing. Retaining removes the LABOR
 *  from sub solicitation; material needs stay. The price basis must be
 *  known — an established field meaning is preserved, an ambiguous one is a
 *  question back to Joe, never a guess. Never marks a price up twice (the
 *  basis is applied by priceLine). */
export async function allocateScope(run: Run, projectId: string, input: AllocateInput): Promise<AllocateResult> {
  const [cur] = await run(`SELECT ${SCOPE_ITEM_COLS} FROM scope_items WHERE project_id = $1 AND key = $2 FOR UPDATE`, [projectId, input.key]);
  if (!cur) return { ok: false, error: `No scope item "${input.key}" on this project.` };
  const item = rowToItem(cur);
  const responsibility = input.responsibility ?? item.responsibility;
  let installBy = input.install_by ?? item.install_by;
  const supplyBy = input.supply_by ?? item.supply_by;
  if (responsibility === "joe" && !input.install_by) installBy = "joe";
  if (responsibility === "sub" && !input.install_by) installBy = "sub";

  let price = input.dedicated_price_cents === undefined ? item.dedicated_price_cents : input.dedicated_price_cents;
  let basis = input.price_basis === undefined ? item.price_basis : input.price_basis;
  if (price != null && basis == null) {
    return { ok: false, error: "A dedicated price needs its basis.", ask: `Is ${input.key}'s ${(price / 100).toFixed(2)} your internal cost (markup gets added once) or the client's price (used as-is)?` };
  }
  if (price != null && responsibility !== "joe") return { ok: false, error: "A dedicated price applies to work Joe retains; set responsibility to 'joe' first." };
  if (price == null) basis = null;
  if (price != null && price <= 0) {
    price = null;
    basis = null;
  }
  const [row] = await run(
    `UPDATE scope_items
        SET responsibility = $3, supply_by = $4, install_by = $5, dedicated_price_cents = $6, price_basis = $7,
            price_scope_note = COALESCE($8, price_scope_note), notes = COALESCE($9, notes),
            status = CASE WHEN $6::bigint IS NOT NULL THEN 'priced' WHEN $3 <> 'unassigned' THEN 'allocated' ELSE status END,
            revision = revision + 1,
            source_refs = source_refs || $10::jsonb
      WHERE project_id = $1 AND key = $2 RETURNING ${SCOPE_ITEM_COLS}`,
    [projectId, input.key, responsibility, supplyBy, installBy, price, basis, input.price_scope_note ?? null, input.notes ?? null, JSON.stringify([{ kind: "owner", ref: `allocation by ${principalLabel(input.principal)}`, at: new Date().toISOString() }])],
  );
  const out = rowToItem(row);
  return { ok: true, item: out, labor_solicited: out.install_by !== "joe" && out.install_by !== "none", materials_still_needed: out.supplier_categories.length > 0 && out.supply_by !== "client" };
}

export interface FindingsResult {
  recorded: number;
  duplicates: number;
  changes: string[];
  clarifications: string[];
  new_scope_keys: string[];
  price_protected: string[];
}

/** W03: apply uploaded site findings. Each finding is source-linked and
 *  idempotent by fact_key. Quantities update with basis 'site_measurement';
 *  new work becomes a separate unpriced scope item; Joe's allocations and
 *  dedicated prices are preserved unless a finding explicitly targets them. */
export async function applySiteFindings(run: Run, projectId: string, findings: SiteFindingInput[], opts: { principal?: Principal } = {}): Promise<FindingsResult> {
  const res: FindingsResult = { recorded: 0, duplicates: 0, changes: [], clarifications: [], new_scope_keys: [], price_protected: [] };
  const [plan] = await run<{ id: string; items: SiteVisitPlanItem[] }>(`SELECT id, items FROM site_visit_plans WHERE project_id = $1 AND status = 'open' ORDER BY revision DESC LIMIT 1`, [projectId]);
  const planItems = plan?.items ?? [];
  for (const f of findings) {
    const [ins] = await run<{ id: string }>(
      `INSERT INTO site_visit_findings (project_id, plan_id, scope_key, fact_key, kind, statement, measurement, unit, source_note, media_ref, targets_price, impacts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'[]'::jsonb)
       ON CONFLICT (project_id, fact_key) DO NOTHING RETURNING id`,
      [projectId, plan?.id ?? null, f.scope_key ?? null, f.fact_key, f.kind, f.statement, f.measurement ?? null, f.unit ?? null, f.source_note, f.media_ref ?? null, !!f.targets_price],
    );
    if (!ins) {
      res.duplicates += 1;
      continue;
    }
    res.recorded += 1;
    const impacts: Array<Record<string, unknown>> = [];
    let status: "applied" | "needs_clarification" = "applied";
    const scope = f.scope_key ? rowToItemOrNull(await run(`SELECT ${SCOPE_ITEM_COLS} FROM scope_items WHERE project_id = $1 AND key = $2 FOR UPDATE`, [projectId, f.scope_key])) : null;
    if (f.scope_key && !scope) {
      status = "needs_clarification";
      res.clarifications.push(`Finding "${f.statement}" names scope "${f.scope_key}", which does not exist.`);
    }

    if (f.kind === "measurement" && scope) {
      if (f.measurement == null || !f.unit) {
        status = "needs_clarification";
        res.clarifications.push(`Measurement for ${scope.key} is missing a value or unit: "${f.statement}"`);
      } else {
        const quantities = [...scope.quantities];
        const label = f.quantity_label ?? quantities.find((q) => q.unit === f.unit)?.label ?? f.statement.slice(0, 60);
        const idx = quantities.findIndex((q) => q.label === label);
        const q = { label, qty: Number(f.measurement), unit: f.unit, basis: "site_measurement" as const, source: `finding:${ins.id}` };
        if (idx >= 0) quantities[idx] = q;
        else quantities.push(q);
        await run(`UPDATE scope_items SET quantities = $3::jsonb, unverified = false, revision = revision + 1, source_refs = source_refs || $4::jsonb WHERE project_id = $1 AND key = $2`, [
          projectId,
          scope.key,
          JSON.stringify(quantities),
          JSON.stringify([{ kind: "site_finding", ref: ins.id, at: new Date().toISOString() }]),
        ]);
        impacts.push({ target: "quantity", ref: scope.key, change: `${label} = ${f.measurement} ${f.unit} (site measurement)` });
        res.changes.push(`${scope.key}: ${label} = ${f.measurement} ${f.unit}`);
        if (scope.dedicated_price_cents != null && !f.targets_price) {
          impacts.push({ target: "estimate", ref: scope.key, change: "quantity changed on owner-priced scope; dedicated price NOT expanded — review" });
          res.price_protected.push(scope.key);
        }
      }
    } else if (f.kind === "new_work") {
      const ns = f.new_scope;
      if (!ns?.key || !ns.title) {
        status = "needs_clarification";
        res.clarifications.push(`New work "${f.statement}" needs a scope key and title.`);
      } else {
        const rows = await run(
          `INSERT INTO scope_items (project_id, key, title, trade, work_package, room, supplier_categories, exclusions, assumptions, dependencies, required_finishes, quantities, source_refs, unverified, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,false,'open')
           ON CONFLICT (project_id, key) DO NOTHING RETURNING key`,
          [projectId, ns.key, ns.title, ns.trade ?? "General", ns.work_package ?? "", ns.room ?? "", ns.supplier_categories ?? [], ns.exclusions ?? [], JSON.stringify(ns.assumptions ?? []), ns.dependencies ?? [], JSON.stringify(ns.required_finishes ?? []), JSON.stringify(ns.quantities ?? []), JSON.stringify([{ kind: "site_finding", ref: ins.id, at: new Date().toISOString() }])],
        );
        if (rows.length) {
          res.new_scope_keys.push(ns.key);
          res.changes.push(`new scope ${ns.key}: ${ns.title} (unpriced)`);
          impacts.push({ target: "scope", ref: ns.key, change: "added as separate unpriced scope item" });
          // Existing checklist gets the new item's prompts.
          const extra = siteVisitPlanFor([{ key: ns.key, title: ns.title, trade: ns.trade ?? "General", work_package: ns.work_package ?? "", room: ns.room ?? "", supplier_categories: ns.supplier_categories ?? [], exclusions: [], assumptions: [], dependencies: [], required_finishes: ns.required_finishes ?? [], quantities: ns.quantities ?? [], source_refs: [], unverified: false }]);
          planItems.push(...extra.map((i, n) => ({ ...i, id: `p${planItems.length + n + 1}` })));
        }
        if (scope && scope.dedicated_price_cents != null) res.price_protected.push(scope.key);
      }
    } else if (f.kind === "price_instruction") {
      if (!scope || !f.price || !f.targets_price) {
        status = "needs_clarification";
        res.clarifications.push(`Price instruction "${f.statement}" must name a scope, a price and its basis, and be marked as targeting the price.`);
      } else {
        await run(`UPDATE scope_items SET dedicated_price_cents = $3, price_basis = $4, responsibility = 'joe', install_by = 'joe', status = 'priced', revision = revision + 1, source_refs = source_refs || $5::jsonb WHERE project_id = $1 AND key = $2`, [
          projectId,
          scope.key,
          f.price.cents,
          f.price.basis,
          JSON.stringify([{ kind: "site_finding", ref: ins.id, at: new Date().toISOString() }]),
        ]);
        impacts.push({ target: "estimate", ref: scope.key, change: `owner price set to ${f.price.cents} (${f.price.basis})` });
        res.changes.push(`${scope.key}: Joe's price ${f.price.cents} (${f.price.basis})`);
      }
    } else if (scope) {
      // observation / photo / client_answer / decision / issue: attach as verified source; unverified assumptions get their evidence
      await run(`UPDATE scope_items SET source_refs = source_refs || $3::jsonb, revision = revision + 1 WHERE project_id = $1 AND key = $2`, [projectId, scope.key, JSON.stringify([{ kind: "site_finding", ref: ins.id, at: new Date().toISOString() }])]);
      impacts.push({ target: "scope", ref: scope.key, change: `${f.kind}: ${f.statement}` });
      res.changes.push(`${scope.key}: ${f.kind} recorded`);
      if (f.kind === "issue") res.clarifications.push(`Issue on ${scope.key}: ${f.statement}`);
    }

    // Mark matching checklist items answered (do not blanket-complete the list).
    for (const pi of planItems) {
      if (pi.status !== "open" || pi.scope_key !== (f.scope_key ?? "")) continue;
      const kindMatch = (f.kind === "measurement" && pi.kind === "measure") || (f.kind === "photo" && pi.kind === "photo") || (f.kind === "client_answer" && pi.kind === "question") || (f.kind === "observation" && pi.kind === "inspect");
      if (kindMatch && (pi.unit == null || f.unit == null || pi.unit === f.unit) && !planItems.some((o) => o.finding_id === ins.id)) {
        pi.status = "answered";
        pi.finding_id = ins.id;
        break;
      }
    }
    await run(`UPDATE site_visit_findings SET status = $2, impacts = $3::jsonb, applied_at = CASE WHEN $2 = 'applied' THEN now() END WHERE id = $1`, [ins.id, status, JSON.stringify(impacts)]);
  }
  if (plan) await run(`UPDATE site_visit_plans SET items = $2::jsonb WHERE id = $1`, [plan.id, JSON.stringify(planItems)]);
  void opts;
  return res;
}

function rowToItemOrNull(rows: Record<string, unknown>[]): ScopeItem | null {
  return rows[0] ? rowToItem(rows[0]) : null;
}

/** The site-visit plan with what is still open, grouped by scope. */
export async function getSiteVisitPlan(run: Run, projectId: string) {
  const [plan] = await run<{ id: string; revision: number; status: string; items: SiteVisitPlanItem[] }>(`SELECT id, revision, status, items FROM site_visit_plans WHERE project_id = $1 AND status <> 'superseded' ORDER BY revision DESC LIMIT 1`, [projectId]);
  if (!plan) return null;
  const open = plan.items.filter((i) => i.status === "open");
  return { ...plan, open_count: open.length, answered_count: plan.items.length - open.length, by_scope: groupBy(plan.items, (i) => i.scope_key) };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}
