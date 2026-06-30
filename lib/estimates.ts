import "server-only";

// Estimate read layer (Phase-2 B2). Estimates are project-scoped, built from
// cost_items + free-form lines. Totals are stored on the estimate (recomputed by
// the actions on every line write) for fast display + the e-sign snapshot.

import { query } from "./db";
import { type DrawLine, parseDrawSchedule } from "./draw-schedule";

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
    `SELECT e.id, e.title, e.rail, e.status, e.subtotal, e.markup_total, e.total,
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
