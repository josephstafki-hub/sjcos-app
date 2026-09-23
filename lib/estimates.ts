import "server-only";

// Estimate read layer (Phase-2 B2). Estimates are project-scoped, built from
// cost_items + free-form lines. Totals are stored on the estimate (recomputed by
// the actions on every line write) for fast display + the e-sign snapshot.

import { query, queryOne } from "./db";
import { type DrawLine, parseDrawSchedule } from "./draw-schedule";
import { scopeChangeContext, type EstimateKind, type ScopeChangeContext } from "./estimate-kinds";
import type { ProjectStatus } from "./types";

export type EstimateRail = "design_build" | "plans" | "merged";
export type EstimateStatus = "draft" | "sent" | "approved" | "declined";

export interface EstimateLineView {
  id: number;
  costItemId: number | null;
  description: string;
  section: string;
  unit: string;
  qty: number;
  /** cents */
  unitCost: number;
  /** % */
  markup: number;
  /** cents */
  extended: number;
}

export interface EstimateDetail {
  id: number;
  title: string;
  /** 'formal' = the job's base bid; 'precon_change' = a client addition or
   *  change priced before the contract is signed (lib/estimate-kinds.ts). */
  kind: EstimateKind;
  rail: EstimateRail;
  status: EstimateStatus;
  subtotal: number; // cents
  markupTotal: number; // cents
  total: number; // cents
  createdAtLabel: string;
  /** Persisted contract draw schedule (null until the owner edits it). */
  drawSchedule: DrawLine[] | null;
  lines: EstimateLineView[];
}

function dateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

interface EstRow {
  id: string;
  title: string;
  kind: EstimateKind;
  rail: EstimateRail;
  status: EstimateStatus;
  subtotal: number;
  markup_total: number;
  total: number;
  draw_schedule: unknown;
  created_at: Date;
}
interface LineRow {
  id: string;
  estimate_id: string;
  cost_item_id: string | null;
  description: string;
  section: string;
  unit: string;
  qty: string;
  unit_cost: number;
  markup: string;
  extended: number;
}

function lineToView(r: LineRow): EstimateLineView {
  return {
    id: Number(r.id),
    costItemId: r.cost_item_id == null ? null : Number(r.cost_item_id),
    description: r.description,
    section: r.section,
    unit: r.unit,
    qty: Number(r.qty),
    unitCost: r.unit_cost,
    markup: Number(r.markup),
    extended: r.extended,
  };
}

/** All estimates for a project, each with its lines (newest first). */
export async function getProjectEstimates(slug: string): Promise<EstimateDetail[]> {
  const { rows: ests } = await query<EstRow>(
    `SELECT e.id, e.title, e.kind, e.rail, e.status, e.subtotal, e.markup_total, e.total,
            e.draw_schedule, e.created_at
       FROM estimates e JOIN projects p ON p.id = e.project_id
      WHERE p.slug = $1
      ORDER BY e.created_at DESC`,
    [slug],
  );
  if (ests.length === 0) return [];

  const ids = ests.map((e) => Number(e.id));
  const { rows: lines } = await query<LineRow>(
    `SELECT id, estimate_id, cost_item_id, description, section, unit, qty, unit_cost, markup, extended
       FROM estimate_lines
      WHERE estimate_id = ANY($1::bigint[])
      ORDER BY section, sort_order, id`,
    [ids],
  );
  const byEst = new Map<number, EstimateLineView[]>();
  for (const l of lines) {
    const eid = Number(l.estimate_id);
    if (!byEst.has(eid)) byEst.set(eid, []);
    byEst.get(eid)!.push(lineToView(l));
  }

  return ests.map((e) => ({
    id: Number(e.id),
    title: e.title,
    kind: e.kind,
    rail: e.rail,
    status: e.status,
    subtotal: e.subtotal,
    markupTotal: e.markup_total,
    total: e.total,
    createdAtLabel: dateLabel(e.created_at),
    drawSchedule: parseDrawSchedule(e.draw_schedule),
    lines: byEst.get(Number(e.id)) ?? [],
  }));
}

/** Which record a client change becomes on this job right now — a pre-con
 *  change worksheet or a change order — as the DATABASE decides it
 *  (project_scope_change_path(), db/schema.sql; the same function the
 *  triggers enforce). Null when the project doesn't exist. */
export async function getScopeChangeContext(slug: string): Promise<ScopeChangeContext | null> {
  const row = await queryOne<{ status: ProjectStatus; signed: boolean; path: string }>(
    `SELECT p.status, project_has_signed_contract(p.id) AS signed, project_scope_change_path(p.id) AS path
       FROM projects p WHERE p.slug = $1`,
    [slug],
  );
  if (!row) return null;
  const ctx = scopeChangeContext(row.status, row.signed);
  // The SQL is authoritative; the pure mirror only supplies the labels. If they
  // ever disagree, trust the database and say so in the server log.
  if (ctx.path !== row.path) {
    console.error(`[estimates] scopeChangePath mismatch for ${slug}: sql=${row.path} ts=${ctx.path}`);
    ctx.path = row.path as ScopeChangeContext["path"];
  }
  return ctx;
}
