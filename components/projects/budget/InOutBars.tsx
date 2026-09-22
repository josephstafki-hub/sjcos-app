"use client";

// "Money in, money out" (plan §4.2): cost and billing as two bars on ONE axis
// that runs from $0 to the price. Flex divs, not SVG — it never scrolls
// sideways on a phone. The empty track after the cost bar IS the profit.

import { Card } from "@/components/ui";
import { fmtK, type BudgetTotals, type BudgetView } from "@/lib/budget-types";
import { Legend, RAMP, StackBar } from "./parts";

export function InOutBars({ view, t }: { view: BudgetView; t: BudgetTotals }) {
  const unknown = view.completeness.profit === "unknown";
  const cost = unknown ? t.costSoFarCents : t.projectedCostCents;
  const max = Math.max(t.priceCents, cost, 1);
  const overPrice = cost > t.priceCents ? cost - t.priceCents : 0;
  const budget = t.budgetCostCents + t.coBudgetCostCents;
  // In a ~340px column two tick labels closer than ~22% of the axis touch and
  // read as one phrase ("budget price"): keep "price"; the line below names both.
  const crowded = max > 0 && Math.abs(budget - t.priceCents) / max < 0.22;

  const tracked = t.billedCents != null;
  const unpaid = tracked ? Math.max(0, (t.billedCents ?? 0) - t.collectedCents) : 0;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <div className="mb-0.5 text-[12.5px] font-semibold text-ink">{unknown ? "What it has cost so far" : "What it costs"}</div>
        <StackBar
          max={max}
          segs={[
            { label: "Spent", cents: t.paidCents, className: RAMP.paid },
            { label: "Owed", cents: t.owedCents, className: RAMP.owed },
            { label: "On order", cents: t.orderedCents, className: RAMP.ordered },
            { label: "Still to spend", cents: unknown ? 0 : t.estToFinishCents, className: RAMP.est },
          ]}
          ticks={[
            ...(!unknown && budget > 0 ? [{ label: "budget", cents: budget, hideLabel: crowded }] : []),
            { label: "price", cents: t.priceCents },
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <Legend swatch={RAMP.paid} label="Spent" value={fmtK(t.paidCents)} />
          <Legend swatch={RAMP.owed} label="Owed" value={fmtK(t.owedCents)} cents={t.owedCents} />
          <Legend swatch={RAMP.ordered} label="On order" value={fmtK(t.orderedCents)} cents={t.orderedCents} />
          {!unknown && <Legend swatch={RAMP.est} label="Still to spend" value={fmtK(t.estToFinishCents)} cents={t.estToFinishCents} />}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-3">
          {unknown
            ? `Against a price of ${fmtK(t.priceCents)}. Until the budget covers the whole job there is no "still to spend", so no profit is drawn.`
            : overPrice > 0
              ? <>Budget {fmtK(budget)} · price {fmtK(t.priceCents)}. <span className="font-semibold text-flag">Cost runs {fmtK(overPrice)} past the price.</span></>
              : <>Budget {fmtK(budget)} · price {fmtK(t.priceCents)}. The space after the bar is your profit: <b className="font-semibold text-ink-2">{fmtK(t.priceCents - cost)}</b>.</>}
        </p>
      </div>

      <div className="border-t border-rule-soft pt-3.5">
        <div className="mb-0.5 text-[12.5px] font-semibold text-ink">{tracked ? "What you billed" : "What you collected"}</div>
        <StackBar
          max={max}
          segs={tracked
            ? [
                { label: "Collected", cents: t.collectedCents, className: RAMP.paid },
                { label: "Billed, not paid", cents: unpaid, className: RAMP.owed },
                { label: "Left to bill", cents: Math.max(0, t.leftToBillCents ?? 0), className: RAMP.est },
              ]
            : [
                { label: "Collected", cents: t.collectedCents, className: RAMP.paid },
                { label: "Left to collect", cents: Math.max(0, t.leftToCollectCents), className: RAMP.est },
              ]}
          ticks={tracked && t.earnedCents != null ? [{ label: "earned", cents: t.earnedCents }] : []}
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <Legend swatch={RAMP.paid} label="Collected" value={fmtK(t.collectedCents)} />
          {tracked && <Legend swatch={RAMP.owed} label="Billed, not paid" value={fmtK(unpaid)} cents={unpaid} />}
          {tracked
            ? <Legend swatch={RAMP.est} label="Left to bill" value={fmtK(Math.max(0, t.leftToBillCents ?? 0))} />
            : <Legend swatch={RAMP.est} label="Left to collect" value={fmtK(Math.max(0, t.leftToCollectCents))} />}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-3">
          {tracked
            ? t.earnedCents != null
              ? `"Earned" is the price times the work done: ${fmtK(t.earnedCents)}. Billing past that line is ahead of the work; short of it, there is work to invoice.`
              : "Billing is tracked from the invoices here."
            : `Collected is your hand-kept total; billing history isn't tracked here yet${t.unpaidInvoicesCents > 0 ? `, though ${fmtK(t.unpaidInvoicesCents)} of invoices are sent and unpaid` : ""}.`}
        </p>
      </div>
    </Card>
  );
}
