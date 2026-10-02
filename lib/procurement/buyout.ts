// Material buyout planning (A13, WORKFLOW W09 "Build a material buyout
// schedule backward from each need-on-site date"). Pure `run` module.
//
// Inputs: need-on-site items from an injected schedule reader (WS-field's
// plan when present) or, failing that, the project's open purchase orders
// with a need_by date. Each item's order deadline = need date − lead time −
// delivery window − buffer; deposit is due at the order deadline, the balance
// on delivery (or per stated terms). Outflows by date are compared with the
// cash available now plus FORECAST milestone collections; a gap is surfaced
// early as a 'funding' decision — it never loosens the commit-time cash guard.

import type { Run } from "../commands/core.ts";
import type { Principal } from "../commands/principal.ts";
import { escalateShortfall, projectFundingForecast, type ProjectFundingForecast } from "../funding/index.ts";
import { usd } from "./types.ts";

export interface NeedItem {
  key: string;
  label: string;
  needOnSite: string; // YYYY-MM-DD
  amountCents: number;
  leadTimeDays?: number | null;
  deliveryWindowDays?: number | null;
  bufferDays?: number | null;
  quoteValidUntil?: string | null;
  /** 0–1 share due at order (deposit); remainder due on delivery. */
  depositShare?: number | null;
  vendorName?: string | null;
  purchaseOrderId?: number | null;
}

export type NeedReader = (run: Run, projectId: string) => Promise<NeedItem[]>;

export interface BuyoutLine extends NeedItem {
  orderDeadline: string;
  depositCents: number;
  depositDueOn: string;
  balanceCents: number;
  balanceDueOn: string;
  leadTimeKnown: boolean;
  quoteExpiresBeforeOrder: boolean;
  overdue: boolean;
}

export interface BuyoutPlan {
  projectId: string;
  asOf: string;
  lines: BuyoutLine[];
  outflows: { date: string; label: string; amountCents: number }[];
  funding: ProjectFundingForecast;
  /** Running balance by date; first negative point is the gap. */
  timeline: { date: string; inflowCents: number; outflowCents: number; balanceCents: number }[];
  shortfall: { date: string; amountCents: number; decisionId: string | null } | null;
  warnings: string[];
}

const DAY = 86_400_000;
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shift(dateIso: string, days: number): string {
  return iso(new Date(new Date(`${dateIso}T00:00:00Z`).getTime() + days * DAY));
}

/** Default reader: open POs with a need_by date. */
export const purchaseOrderNeeds: NeedReader = async (run, projectId) => {
  const rows = await run<{ id: number; title: string; need_by: string; subtotal: number; tax_cents: number; shipping_cents: number; vendor_name: string; terms: string }>(
    `SELECT id, title, need_by::text AS need_by, subtotal, tax_cents, shipping_cents, vendor_name, terms
       FROM purchase_orders WHERE project_id = $1 AND status IN ('draft','queued') AND need_by IS NOT NULL ORDER BY need_by, id`,
    [projectId],
  );
  return rows.map((r) => ({
    key: `po:${r.id}`,
    label: r.title,
    needOnSite: r.need_by,
    amountCents: Number(r.subtotal) + Number(r.tax_cents) + Number(r.shipping_cents),
    vendorName: r.vendor_name,
    purchaseOrderId: Number(r.id),
    depositShare: /50%\s*deposit|half\s*down/i.test(r.terms) ? 0.5 : /deposit/i.test(r.terms) ? 0.3 : null,
  }));
};

export async function planBuyout(
  run: Run,
  projectId: string,
  opts: { needs?: NeedReader; today?: string; defaultBufferDays?: number; principal?: Principal; escalate?: boolean } = {},
): Promise<BuyoutPlan> {
  const today = opts.today ?? iso(new Date());
  const items = await (opts.needs ?? purchaseOrderNeeds)(run, projectId);
  const warnings: string[] = [];
  const lines: BuyoutLine[] = items.map((it) => {
    const leadKnown = it.leadTimeDays != null;
    const lead = it.leadTimeDays ?? 0;
    const window = it.deliveryWindowDays ?? 0;
    const buffer = it.bufferDays ?? opts.defaultBufferDays ?? 3;
    const orderDeadline = shift(it.needOnSite, -(lead + window + buffer));
    const share = it.depositShare ?? 0;
    const depositCents = Math.round(it.amountCents * share);
    const balanceCents = it.amountCents - depositCents;
    if (!leadKnown) warnings.push(`${it.label}: lead time unknown — order deadline assumes 0 days; confirm with ${it.vendorName ?? "the supplier"}.`);
    const quoteExpiresBeforeOrder = Boolean(it.quoteValidUntil && it.quoteValidUntil < orderDeadline);
    if (quoteExpiresBeforeOrder) warnings.push(`${it.label}: quote expires ${it.quoteValidUntil}, before the order deadline ${orderDeadline}.`);
    return {
      ...it,
      orderDeadline,
      depositCents,
      depositDueOn: orderDeadline,
      balanceCents,
      balanceDueOn: share > 0 ? it.needOnSite : orderDeadline,
      leadTimeKnown: leadKnown,
      quoteExpiresBeforeOrder,
      overdue: orderDeadline < today,
    };
  });
  const outflows: BuyoutPlan["outflows"] = [];
  for (const l of lines) {
    if (l.depositCents > 0) outflows.push({ date: l.depositDueOn, label: `${l.label} deposit`, amountCents: l.depositCents });
    if (l.balanceCents > 0) outflows.push({ date: l.balanceDueOn, label: `${l.label}${l.depositCents > 0 ? " balance" : ""}`, amountCents: l.balanceCents });
  }
  outflows.sort((a, b) => a.date.localeCompare(b.date));
  const funding = await projectFundingForecast(run, projectId);
  const dates = [...new Set([...outflows.map((o) => o.date), ...funding.expected.map((e) => e.date)])].sort();
  let balance = funding.availableCents;
  const timeline: BuyoutPlan["timeline"] = [];
  let shortfall: BuyoutPlan["shortfall"] = null;
  for (const date of dates) {
    const inflow = funding.expected.filter((e) => e.date === date).reduce((s, e) => s + e.amountCents, 0);
    const outflow = outflows.filter((o) => o.date === date).reduce((s, o) => s + o.amountCents, 0);
    balance += inflow - outflow;
    timeline.push({ date, inflowCents: inflow, outflowCents: outflow, balanceCents: balance });
    if (balance < 0 && !shortfall) shortfall = { date, amountCents: -balance, decisionId: null };
  }
  if (shortfall && opts.escalate && opts.principal) {
    const esc = await escalateShortfall(run, {
      projectId,
      amountCents: shortfall.amountCents,
      purpose: `material buyout gap on ${shortfall.date}`,
      effect: `Buyout outflows outrun cash + expected collections by ${usd(shortfall.amountCents)} on ${shortfall.date}. Options: shift order timing, bring the milestone forward, or approve company cash.`,
      principal: opts.principal,
    });
    shortfall.decisionId = esc.decision.id;
  }
  return { projectId, asOf: today, lines, outflows, funding, timeline, shortfall, warnings };
}
