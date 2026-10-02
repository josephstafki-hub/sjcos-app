// Verified hours → closeout / estimate learning (A19 "Job costing").
//
// Only CONFIRMED intervals count. Overlaps are unioned. Each segment is
// valued with the owner_labor_rates row effective on its date; a category
// with no rate reports "cost not configured" — never zero. Nothing here
// creates payroll, a QBO expense or a client charge.

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { getDecision } from "../commands/decisions.ts";
import { INTERVAL_COLS, unionSegments, type Category, type TimeInterval } from "./intervals.ts";

export interface CategoryHours {
  category: Category;
  hours: number;
  rateCents: number | null;
  rateEffectiveFrom: string | null;
  costCents: number | null;
  costStatus: "valued" | "cost not configured";
}

export interface VerifiedHours {
  projectId: string;
  asOf: string;
  categories: CategoryHours[];
  totalHours: number;
  totalCostCents: number | null;
  unresolved: { inferred: number; review: number };
  /** Hash of the counted interval ids + rates, for provenance on the learning side. */
  provenance: string;
  intervalIds: string[];
}

export async function verifiedHoursForCloseout(run: Run, projectId: string, now: Date = new Date()): Promise<VerifiedHours> {
  const intervals = await run<TimeInterval>(`SELECT ${INTERVAL_COLS} FROM time_intervals WHERE project_id = $1 AND state = 'confirmed' AND end_at IS NOT NULL ORDER BY start_at`, [projectId]);
  const [unres] = await run<{ inferred: number; review: number }>(
    `SELECT count(*) FILTER (WHERE state = 'inferred')::int AS inferred, count(*) FILTER (WHERE state = 'review')::int AS review FROM time_intervals WHERE project_id = $1`,
    [projectId],
  );
  const rates = await run<{ category: Category; rate_cents: number; effective_from: string }>(`SELECT category, rate_cents, to_char(effective_from, 'YYYY-MM-DD') AS effective_from FROM owner_labor_rates ORDER BY effective_from DESC`);
  const segs = unionSegments(intervals, 0, now.getTime(), now.getTime());
  const byCat = new Map<Category, { hours: number; cost: number | null; rate: number | null; from: string | null; configured: boolean }>();
  for (const s of segs) {
    const hours = (s.end - s.start) / 3600_000;
    const day = new Date(s.start).toISOString().slice(0, 10);
    const rate = rates.find((r) => r.category === s.category && r.effective_from <= day) ?? null;
    const cur = byCat.get(s.category) ?? { hours: 0, cost: 0, rate: null, from: null, configured: true };
    cur.hours += hours;
    if (rate) {
      cur.cost = (cur.cost ?? 0) + Math.round(hours * rate.rate_cents);
      cur.rate = rate.rate_cents;
      cur.from = rate.effective_from;
    } else {
      cur.configured = false;
      cur.cost = null;
    }
    byCat.set(s.category, cur);
  }
  const categories: CategoryHours[] = [...byCat.entries()].map(([category, v]) => ({
    category,
    hours: Math.round(v.hours * 100) / 100,
    rateCents: v.configured ? v.rate : null,
    rateEffectiveFrom: v.configured ? v.from : null,
    costCents: v.configured ? v.cost : null,
    costStatus: v.configured ? "valued" : "cost not configured",
  }));
  const allValued = categories.length > 0 && categories.every((c) => c.costStatus === "valued");
  const intervalIds = intervals.map((i) => i.id);
  return {
    projectId,
    asOf: now.toISOString(),
    categories,
    totalHours: Math.round(categories.reduce((s, c) => s + c.hours, 0) * 100) / 100,
    totalCostCents: allValued ? categories.reduce((s, c) => s + (c.costCents ?? 0), 0) : null,
    unresolved: { inferred: unres?.inferred ?? 0, review: unres?.review ?? 0 },
    provenance: hashInput({ intervalIds, rates }),
    intervalIds,
  };
}

/** Record an owner labour rate. Requires an approved 'owner_rate' (or
 *  'markup') decision — rates are dated assumptions Joe approved. */
export async function setOwnerLaborRate(run: Run, input: { category: Category; rateCents: number; effectiveFrom: string; decisionId: string; approvedBy: string | null; note?: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const d = await getDecision(run, input.decisionId);
  if (!d) return { ok: false, reason: "No such decision." };
  if (!["owner_rate", "markup"].includes(d.kind)) return { ok: false, reason: `Decision kind ${d.kind} cannot approve a labour rate.` };
  if (d.status !== "approved" && d.status !== "consumed") return { ok: false, reason: `Decision is ${d.status}.` };
  if (Number(d.amount_cents ?? -1) !== input.rateCents) return { ok: false, reason: "Decision amount does not match the rate." };
  await run(
    `INSERT INTO owner_labor_rates (category, rate_cents, effective_from, decision_id, approved_by, note) VALUES ($1, $2, $3::date, $4, $5, $6)
     ON CONFLICT (category, effective_from) DO UPDATE SET rate_cents = EXCLUDED.rate_cents, decision_id = EXCLUDED.decision_id, approved_by = EXCLUDED.approved_by, note = EXCLUDED.note`,
    [input.category, input.rateCents, input.effectiveFrom, input.decisionId, input.approvedBy, input.note ?? ""],
  );
  return { ok: true };
}
