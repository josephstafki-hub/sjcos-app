"use server";

// Estimate from the plan (docs/floor-plan-designer-plan.md §11): measures
// computed from the design (lib/plan-measures.ts) map through plan_cost_rules
// to cost-book items and become estimate lines via the same snapshotting
// insert the takeoff panel uses. Placed catalog products with a price become
// product lines, and their paired install cost item adds labour. Regenerating
// replaces only the lines this generator wrote (recognisable by their section
// names) and leaves hand-added lines alone.

import { revalidatePath } from "next/cache";
import {ensurePlanSnapshot,lockPlanDesign} from "@/lib/plan-version-writes";
import {assertFloorAccess} from "@/lib/canvas-floor";
import { pool, query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { getDefaultMarkup } from "@/lib/cost-book";
import type { PoolClient, QueryResultRow } from "pg";
import { migrateDoc } from "@/lib/plan-doc";
import { computeMeasures, productLines, type Measure } from "@/lib/plan-measures";
import type { Run } from "@/lib/commands/core";
import { pinDesignVersion } from "@/lib/designer-contract";

type Result = { ok: boolean; error?: string };

const PLAN_SECTION_PREFIX = "From plan";

/** Upsert a measure → cost item rule (null cost item removes it). */
export async function setPlanCostRule(measure: string, materialTag: string, costItemId: number | null): Promise<Result> {
  await requireAccess("estimates");
  const m = measure.trim().slice(0, 64);
  const tag = materialTag.trim().slice(0, 64);
  if (!m) return { ok: false, error: "Pick a measure." };
  if (costItemId == null) {
    await query(`DELETE FROM plan_cost_rules WHERE measure = $1 AND material_tag = $2`, [m, tag]);
  } else {
    const exists = await queryOne<{ id: string }>(`SELECT id FROM cost_items WHERE id = $1`, [costItemId]);
    if (!exists) return { ok: false, error: "Cost item not found." };
    await query(
      `INSERT INTO plan_cost_rules (measure, material_tag, cost_item_id, enabled)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (measure, material_tag) DO UPDATE SET cost_item_id = EXCLUDED.cost_item_id, enabled = true`,
      [m, tag, costItemId],
    );
  }
  revalidatePath("/cost-book");
  revalidatePath("/floor");
  return { ok: true };
}

export async function setPlanCostRuleEnabled(id: number, enabled: boolean): Promise<Result> {
  await requireAccess("estimates");
  await query(`UPDATE plan_cost_rules SET enabled = $2 WHERE id = $1`, [id, enabled]);
  revalidatePath("/cost-book");
  return { ok: true };
}

export interface GenerateResult {
  estimateId: number;
  linesAdded: number;
  unmapped: { key: string; label: string; unit: string; qty: number; materialTag: string }[];
  unpriced: { label: string; tag: string; qty: number }[];
  delta: { added: string[]; removed: string[] };
  /** The pinned design version the lines came from ("design:<id>@v<n>#<hash>"). */
  revision: string;
  versionNumber: number;
}

/** Pin validation and revision writes must share the estimate transaction. */
async function pinnedVersionFor(tx: PoolClient, design: {id:string;rev:number}, estimateTitle: string, actorId: string) {
  const snapshot = await ensurePlanSnapshot(tx, design.id, design.rev, actorId, undefined, `Estimate: ${estimateTitle}`);
  const run: Run = async (sql, params) => (await tx.query(sql, params)).rows as never;
  const pinned = await pinDesignVersion(run, Number(snapshot.id), "estimate-from-plan");
  if ("error" in pinned) throw new Error(pinned.error);
  return { doc: migrateDoc(snapshot.doc), revision: pinned.ref.revision, versionNumber: pinned.ref.versionNumber ?? 0 };
}

/** Pick the rule for a measure: exact material tag first, then the blank tag. */
function ruleFor(
  rules: { measure: string; material_tag: string; cost_item_id: string; enabled: boolean }[],
  m: Measure,
): number | null {
  const exact = rules.find((r) => r.enabled && r.measure === m.key && r.material_tag === m.materialTag);
  if (exact) return Number(exact.cost_item_id);
  const blank = rules.find((r) => r.enabled && r.measure === m.key && r.material_tag === "");
  return blank ? Number(blank.cost_item_id) : null;
}

/** Generate (or regenerate) estimate lines from a design. `target` is an
 *  existing estimate id or a title for a new one on the same project / lead. */
export async function generateEstimateFromDesign(
  designId: number,
  target: { estimateId?: number; newTitle?: string },
): Promise<{ ok: true; result: GenerateResult } | { ok: false; error: string }> {
  const user = await requireAccess("estimates");
  const tx = await pool.connect();
  // Every generator write (including cost-item lines and revision pins) uses
  // this client. A failure cannot leave a draft, snapshot or partial lines.
  const query = <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => tx.query<T>(sql, params);
  const queryOne = async <T extends QueryResultRow>(sql: string, params?: unknown[]) => (await query<T>(sql, params)).rows[0] ?? null;
  let design: {id:string;name:string;rev:number;project_id:string|null;lead_slug:string|null;project_slug:string|null};
  let result: GenerateResult;
  try {
    await tx.query("BEGIN");
    design = await lockPlanDesign(tx, String(designId));
    assertFloorAccess(user, design, true);
    let estimateId = target.estimateId ?? 0;
    let estTitle: string;
    if (!estimateId) {
      estTitle = (target.newTitle ?? "").trim().slice(0, 120) || `${design.name} — from plan`;
      const row = await queryOne<{ id: string }>(
        `INSERT INTO estimates (project_id, lead_slug, title, rail, status) VALUES ($1, $2, $3, 'design_build', 'draft') RETURNING id`,
        [design.project_id, design.project_id ? null : design.lead_slug, estTitle],
      );
      estimateId = Number(row!.id);
    } else {
      const est = await queryOne<{ id: string; title: string; status: string; out: string | null }>(`SELECT id, title, status, estimate_out_to_client(id) AS out FROM estimates WHERE id = $1 FOR UPDATE`, [estimateId]);
      if (!est) throw new Error("Estimate not found.");
      if (est.status === "approved") throw new Error("That estimate is approved — generate into a new one.");
      if (est.out) throw new Error(`That estimate is ${est.out === "signed" ? "signed" : "out with the client"}, so its lines are locked. Generate into a new one.`);
      estTitle = est.title;
    }
    const { doc, revision, versionNumber } = await pinnedVersionFor(tx, design, estTitle, user.id);

    // Same cost-book snapshot/pricing as the takeoff panel, on this transaction
    // instead of its standalone server action (which uses an autocommit pool).
    const addPlanLines = async (section: string, entries: {costItemId:number;qty:number}[]) => {
      if (entries.some(e => !Number.isFinite(e.qty) || e.qty < 0)) throw new Error("Enter a quantity of zero or more for every item.");
      const valid = entries.filter(e => e.costItemId && e.qty > 0);
      const def = await getDefaultMarkup();
      const {rows} = await query<{id:string;name:string;unit:string;unit_cost:number;default_markup:string|null}>(
        "SELECT id, name, unit, unit_cost, default_markup FROM cost_items WHERE id = ANY($1::bigint[])", [valid.map(e=>e.costItemId)],
      );
      const byId = new Map(rows.map(r=>[Number(r.id),r]));
      let added = 0;
      for (const e of valid) {
        const item = byId.get(e.costItemId); if (!item) continue;
        const markup = item.default_markup == null ? def : Number(item.default_markup);
        await query(`INSERT INTO estimate_lines
          (estimate_id,cost_item_id,description,section,unit,qty,unit_cost,markup,extended,sort_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE((SELECT max(sort_order)+1 FROM estimate_lines WHERE estimate_id=$1),0))`,
          [estimateId,item.id,item.name,section,item.unit,e.qty,item.unit_cost,markup,Math.round(e.qty*item.unit_cost*(1+markup/100))]);
        added++;
      }
      return added;
    };

    // Snapshot what the generator wrote last time (for the delta), then clear it.
    const { rows: before } = await query<{ description: string; qty: string; section: string }>(
      `SELECT description, qty, section FROM estimate_lines WHERE estimate_id = $1 AND section LIKE $2`,
      [estimateId, `${PLAN_SECTION_PREFIX}%`],
    );
    await query(`DELETE FROM estimate_lines WHERE estimate_id = $1 AND section LIKE $2`, [estimateId, `${PLAN_SECTION_PREFIX}%`]);

    const { rows: rules } = await query<{ measure: string; material_tag: string; cost_item_id: string; enabled: boolean }>(
      `SELECT measure, material_tag, cost_item_id, enabled FROM plan_cost_rules`,
    );
    const measures = computeMeasures(doc).filter((m) => m.qty > 0);
    const sectionFor = (phase: Measure["phase"]) =>
      `${PLAN_SECTION_PREFIX} · ${design.name} v${versionNumber} · ${phase === "remove" ? "Demo" : phase === "existing" ? "Existing" : "New"}`;

    // Group measure lines by section before snapshotting cost-book prices.
    const bySection = new Map<string, { costItemId: number; qty: number }[]>();
    const unmapped: GenerateResult["unmapped"] = [];
    for (const m of measures) {
      if (m.key === "room_sf") continue; // informational only
      const costItemId = ruleFor(rules, m);
      if (!costItemId) {
        unmapped.push({ key: m.key, label: m.label, unit: m.unit, qty: Math.round(m.qty * 100) / 100, materialTag: m.materialTag });
        continue;
      }
      const sec = sectionFor(m.phase);
      const list = bySection.get(sec) ?? [];
      const existing = list.find((e) => e.costItemId === costItemId);
      if (existing) existing.qty += m.qty;
      else list.push({ costItemId, qty: m.qty });
      bySection.set(sec, list);
    }
    let linesAdded = 0;
    for (const [sec, entries] of bySection) {
      const rounded = entries.map((e) => ({ costItemId: e.costItemId, qty: Math.round(e.qty * 100) / 100 }));
      linesAdded += await addPlanLines(sec, rounded);
    }

    // Product lines from placed catalog items.
    const products = productLines(doc).filter((p) => p.catalogId);
    const unpriced: GenerateResult["unpriced"] = [];
    if (products.length) {
      const ids = [...new Set(products.map((p) => p.catalogId!))];
      const { rows: cat } = await query<{ id: string; name: string; price_cents: number | null; cost_item_id: string | null; sku: string }>(
        `SELECT id, name, price_cents, cost_item_id, sku FROM catalog_items WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      const byId = new Map(cat.map((c) => [Number(c.id), c]));
      const def = await getDefaultMarkup();
      const sec = `${PLAN_SECTION_PREFIX} · ${design.name} v${versionNumber} · Products`;
      const install: { costItemId: number; qty: number }[] = [];
      for (const p of products) {
        const c = byId.get(p.catalogId!);
        if (!c) continue;
        if (c.price_cents == null) {
          unpriced.push({ label: p.label, tag: p.tag, qty: p.qty });
        } else {
          const extended = Math.round(p.qty * c.price_cents * (1 + def / 100));
          await query(
            `INSERT INTO estimate_lines (estimate_id, cost_item_id, description, section, unit, qty, unit_cost, markup, extended, sort_order)
             VALUES ($1, NULL, $2, $3, 'ea', $4, $5, $6, $7,
               COALESCE((SELECT max(sort_order)+1 FROM estimate_lines WHERE estimate_id = $1), 0))`,
            [estimateId, `${c.name}${c.sku ? ` · ${c.sku}` : ""}${p.tag ? ` (${p.tag})` : ""}`, sec, p.qty, c.price_cents, def, extended],
          );
          linesAdded++;
        }
        if (c.cost_item_id) {
          const id = Number(c.cost_item_id);
          const e = install.find((x) => x.costItemId === id);
          if (e) e.qty += p.qty;
          else install.push({ costItemId: id, qty: p.qty });
        }
      }
      if (install.length) {
        linesAdded += await addPlanLines(`${sec} · Install`, install);
      }
    }

    // Recompute totals after all measure, product and installation lines.
    await query(
      `UPDATE estimates e SET
         subtotal = COALESCE((SELECT sum(round(qty * unit_cost)) FROM estimate_lines l WHERE l.estimate_id = e.id), 0),
         total = COALESCE((SELECT sum(extended) FROM estimate_lines l WHERE l.estimate_id = e.id), 0),
         markup_total = COALESCE((SELECT sum(extended) - sum(round(qty * unit_cost)) FROM estimate_lines l WHERE l.estimate_id = e.id), 0)
       WHERE e.id = $1`,
      [estimateId],
    );

    const { rows: after } = await query<{ description: string; qty: string; section: string }>(
      `SELECT description, qty, section FROM estimate_lines WHERE estimate_id = $1 AND section LIKE $2`,
      [estimateId, `${PLAN_SECTION_PREFIX}%`],
    );
    const key = (r: { description: string; qty: string }) => `${r.description} × ${Number(r.qty)}`;
    const b = new Set(before.map(key));
    const a = new Set(after.map(key));
    const delta = { added: [...a].filter((k) => !b.has(k)), removed: [...b].filter((k) => !a.has(k)) };

    result = { estimateId, linesAdded, unmapped, unpriced, delta, revision, versionNumber };
    await tx.query("COMMIT");
  } catch (e) {
    await tx.query("ROLLBACK");
    return { ok: false, error: e instanceof Error ? e.message : "Could not generate estimate." };
  } finally { tx.release(); }
  if (design.project_slug) revalidatePath(`/projects/${design.project_slug}`);
  if (design.lead_slug) revalidatePath(`/leads/${design.lead_slug}`);
  revalidatePath(`/floor/${designId}`);
  return { ok: true, result };
}

/** Estimates a design could generate into (same project / lead, not approved). */
export async function listEstimateTargets(designId: number): Promise<{ id: number; title: string; status: string; total: number }[]> {
  await requireAccess("estimates");
  const d = await queryOne<{ project_id: string | null; lead_slug: string | null }>(`SELECT project_id, lead_slug FROM plan_designs WHERE id = $1`, [designId]);
  if (!d) return [];
  const { rows } = await query<{ id: string; title: string; status: string; total: number }>(
    d.project_id
      ? `SELECT id, title, status, total FROM estimates WHERE project_id = $1 AND status <> 'approved' ORDER BY created_at DESC`
      : `SELECT id, title, status, total FROM estimates WHERE lead_slug = $1 AND status <> 'approved' ORDER BY created_at DESC`,
    [d.project_id ?? d.lead_slug],
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, status: r.status, total: Number(r.total) }));
}
