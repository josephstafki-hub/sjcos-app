"use client";

// Cost by trade, change orders, who pays (plan §4.3–§4.5). Rows of flex bars:
// the label stacks above the bar on a phone instead of forcing a sideways
// scroll. Over / under is always a signed number AND a word, never color alone.

import { fmtK, fmtSigned, isCoCounted, type BudgetTotals, type BudgetView } from "@/lib/budget-types";
import { Legend, RAMP, StackBar } from "./parts";

// Narrow: name and number on one line, the bar beneath. Wide: name | bar | number.
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-0 @2xl:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_7.5rem] @2xl:items-center";

export function TradeChart({ view, t }: { view: BudgetView; t: BudgetTotals }) {
  const rows = view.lines
    .map((line, i) => ({ line, lt: t.lines[i] }))
    .filter((r) => !r.lt.credited && (r.line.budgetCents > 0 || r.lt.projectedCents !== 0));
  if (!rows.length) return <p className="text-[13px] text-ink-3">No trades to draw yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.line.budgetCents, r.lt.projectedCents)));
  const byVariance = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    Math.abs(b.lt.varianceCents) - Math.abs(a.lt.varianceCents) || b.line.budgetCents - a.line.budgetCents;
  const trades = rows.filter((r) => r.line.kind === "trade").sort(byVariance);
  const others = rows.filter((r) => r.line.kind !== "trade").sort(byVariance);

  const row = ({ line, lt }: (typeof rows)[number]) => {
    const v = lt.varianceCents;
    const word = Math.abs(v) <= 100 ? "on budget" : `${fmtSigned(v)} ${v > 0 ? "over" : "under"}`;
    return (
      <div key={line.id} className={ROW}>
        <div className="min-w-0 truncate text-[12.5px] font-semibold text-ink" title={line.trade}>{line.trade}</div>
        <div className={`whitespace-nowrap text-right font-mono text-[11.5px] @2xl:order-3 ${Math.abs(v) <= 100 ? "text-ink-3" : v > 0 ? "text-flag" : "text-money"}`}>{word}</div>
        <div className="col-span-2 min-w-0 @2xl:order-2 @2xl:col-span-1">
          <StackBar
            max={max}
            segs={[
              { label: "Spent", cents: line.paidCents, className: RAMP.paid },
              { label: "Owed", cents: line.owedCents, className: RAMP.owed },
              { label: "On order", cents: line.orderedCents, className: RAMP.ordered },
              { label: "Still to spend", cents: lt.estCents, className: RAMP.est },
            ]}
            ticks={line.budgetCents > 0 ? [{ label: `budget ${fmtK(line.budgetCents)}`, cents: line.budgetCents, hideLabel: true }] : []}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {trades.map(row)}
      {others.length > 0 && <div className="mt-1 border-t border-rule-soft pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">Not trades</div>}
      {others.map(row)}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Legend swatch={RAMP.paid} label="Spent" />
        <Legend swatch={RAMP.owed} label="Owed" />
        <Legend swatch={RAMP.ordered} label="On order" />
        <Legend swatch={RAMP.est} label="Still to spend" />
        <span className="inline-flex items-center gap-1.5 text-ink-2"><i className="inline-block h-3 w-px bg-ink" />Budget</span>
      </div>
    </div>
  );
}

export function CoChart({ view, t, ownerLabel }: { view: BudgetView; t: BudgetTotals; ownerLabel: string }) {
  const rows = view.changeOrders.map((co, i) => ({ co, ct: t.changeOrders[i] })).filter((r) => r.co.status !== "declined");
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.co.totalCents)));
  return (
    <div className="flex flex-col gap-3">
      {rows.map(({ co, ct }) => {
        const pendingCo = !isCoCounted(co.status);
        const deductive = co.totalCents < 0;
        const payer = co.paidBy === "funder" ? "funder pays" : co.paidBy === "split" ? "split" : `${ownerLabel.toLowerCase()} pays`;
        return (
          <div key={co.id} className={ROW}>
            <div className="min-w-0 truncate text-[12.5px] font-semibold text-ink" title={`${co.id} ${co.title}`}>{co.id} <span className="font-normal text-ink-2">{co.title}</span></div>
            <div className="whitespace-nowrap text-right font-mono text-[11.5px] text-ink-2 @2xl:order-3">{deductive ? "−" : ""}{fmtK(Math.abs(ct.netPriceCents))}</div>
            <div className="col-span-2 min-w-0 @2xl:order-2 @2xl:col-span-1">
              <StackBar
                max={max}
                segs={[
                  { label: pendingCo ? "Pending — not counted" : deductive ? "Deducted from the price" : "Added to the price", cents: Math.abs(ct.netPriceCents), className: pendingCo ? RAMP.est : RAMP.paid },
                  { label: "Credit for base scope it replaces", cents: ct.creditCents, className: RAMP.ordered },
                ]}
              />
              <div className="mt-0.5 text-[11.5px] text-ink-3">
                {pendingCo ? `${co.status === "sent" ? "awaiting signature" : "draft"} — not counted` : deductive ? "deductive" : payer}
                {ct.creditCents > 0 && ` · credits ${fmtK(ct.creditCents)} of base scope`}
                {ct.marginCents != null && !ct.notPlanned && ` · margin ${fmtK(ct.marginCents)}`}
                {ct.notPlanned && " · cost not planned, assumed at price"}
                {pendingCo && co.paidCents + co.owedCents + co.orderedCents > 0 && <span className="font-semibold text-flag">{` · ${fmtK(co.paidCents + co.owedCents + co.orderedCents)} already spent`}</span>}
              </div>
            </div>
          </div>
        );
      })}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Legend swatch={RAMP.paid} label="Counted in the price" />
        <Legend swatch={RAMP.est} label="Pending, not counted" />
        <Legend swatch={RAMP.ordered} label="Credit for replaced scope" />
      </div>
    </div>
  );
}

/** Only drawn when it matters: more than one payer, a funder-paid CO, or a gap. */
export function PayChart({ t }: { t: BudgetTotals }) {
  const max = Math.max(1, t.priceCents);
  const steps = [RAMP.paid, RAMP.ordered, RAMP.owed, RAMP.est];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[12.5px] font-semibold text-ink">The price</div>
        <StackBar max={max} segs={[{ label: "Base price", cents: t.basePriceCents, className: RAMP.paid }, { label: "Change orders", cents: Math.max(0, t.coNetCents), className: RAMP.ordered }]} />
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <Legend swatch={RAMP.paid} label="Base price" value={fmtK(t.basePriceCents)} />
          {t.coNetCents !== 0 && <Legend swatch={RAMP.ordered} label="Change orders" value={fmtK(t.coNetCents)} />}
        </div>
      </div>
      <div>
        <div className="text-[12.5px] font-semibold text-ink">Who pays it</div>
        <StackBar max={max} segs={t.paidBy.map((p, i) => ({ label: p.label, cents: p.amountCents, className: steps[i % steps.length] }))} />
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {t.paidBy.map((p, i) => <Legend key={p.key} swatch={steps[i % steps.length]} label={p.label} value={fmtK(p.amountCents)} />)}
        </div>
        {(t.coPendingCents !== 0 || t.unfundedCents > 0) && (
          <p className="mt-1.5 text-[12px] text-ink-3">
            {t.unfundedCents > 0 && `${fmtK(t.unfundedCents)} of the base price isn't covered by any payer and lands on the owner. `}
            {t.coPendingCents !== 0 && `${fmtK(t.coPendingCents)} of pending change orders isn't included.`}
          </p>
        )}
      </div>
    </div>
  );
}
