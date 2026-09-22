"use client";

// The glance layer of Money › Overview (plan §4.1): what this job should make,
// what it costs, how far along it is — and what those numbers rest on.

import { Info, Settings2 } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import { fmtK, fmtPct, type BudgetTotals, type BudgetView } from "@/lib/budget-types";
import { BTN, BTN_PRIMARY } from "./parts";

/** Narrow column: label and value share a line. With room: a stacked tile. */
function Tile({ label, value, note, children }: { label: string; value: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-rule-soft bg-paper px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3 @xl:block">
        <div className="text-[11.5px] text-ink-3">{label}</div>
        <div className="font-serif text-[20px] leading-tight text-ink @xl:mt-0.5 @xl:text-[22px]">{value}</div>
      </div>
      {children}
      {note && <div className="mt-1 text-[11.5px] leading-snug text-ink-3">{note}</div>}
    </div>
  );
}

const money = (n: number, word: string) => (n > 0 ? `${word} ${fmtK(n)}` : null);

export function HeadlineStrip({
  view, t, sentences, pending, canAdopt, onAdopt, onAddLine, onSettings, onShowFigured,
}: {
  view: BudgetView;
  t: BudgetTotals;
  sentences: string[];
  pending: boolean;
  /** The job has an approved estimate and no budget lines yet. */
  canAdopt: boolean;
  onAdopt: () => void;
  onAddLine: () => void;
  onSettings: () => void;
  onShowFigured: () => void;
}) {
  const c = view.completeness;
  const unknown = c.profit === "unknown";
  const profit = t.headlineProfitCents;
  const margin = c.profit === "projected" ? t.marginPct : t.plannedMarginPct;
  const loss = profit != null && profit < 0;
  const behindPlan = c.profit === "projected" && t.marginPct != null && t.plannedMarginPct != null && t.marginPct < t.plannedMarginPct - 0.02;
  const marginKind: ChipKind = c.profit === "planned" ? "ghost" : loss ? "flag" : behindPlan ? "accent" : "money";

  const costParts = [money(t.paidCents, "spent"), money(t.owedCents, "owed"), money(t.orderedCents, "on order"), unknown ? null : money(t.estToFinishCents, "still to spend")]
    .filter(Boolean).join(" · ");
  const counted = view.changeOrders.filter((co) => ["approved", "billed", "paid"].includes(co.status)).length;
  const priceNote = counted ? `base ${fmtK(t.basePriceCents)} + ${counted} change order${counted === 1 ? "" : "s"} ${fmtK(t.coNetCents)}` : view.budgetLabel;
  const billingNote = [t.billedPct != null ? `billed ${fmtPct(t.billedPct)}` : null, `collected ${fmtPct(t.collectedPct)}`].filter(Boolean).join(" · ");

  const chips = [
    c.profit === "projected" ? "Projected" : c.profit === "planned" ? "Planned" : "Profit not known",
    c.profit === "projected" ? (c.costsThrough ? `costs through ${new Date(`${c.costsThrough}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "costs not dated") : null,
    c.billing === "tracked" ? "billing tracked" : c.billing === "partial" ? "billing partial" : "billing by hand",
  ].filter((x): x is string => !!x);

  return (
    <Card className="p-4 @xl:p-5">
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        {/* Hero: exactly one. Words, never $0, when profit isn't known. */}
        <div className="min-w-0">
          <div className="text-[12px] text-ink-3">
            {c.profit === "projected" ? "Projected profit" : c.profit === "planned" ? "Planned profit" : "Profit"}
          </div>
          {profit != null ? (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`font-serif text-[38px] leading-none ${loss ? "text-flag" : "text-ink"}`}>{loss ? `−${fmtK(-profit)}` : fmtK(profit)}</span>
              <Chip kind={marginKind}>{loss ? "loss" : `${fmtPct(margin)} margin`}</Chip>
            </div>
          ) : (
            <div className="mt-1 font-serif text-[26px] leading-tight text-ink-2">Not known yet</div>
          )}
          <div className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
            {c.profit === "projected" && t.plannedProfitCents != null && `the plan was ${fmtK(t.plannedProfitCents)}`}
            {c.profit === "planned" && "the plan — no costs entered yet"}
            {unknown && (view.lines.length
              ? "The budget isn't finished. Set what each trade should really cost, then tick “covers the whole job” in Budget settings."
              : "this job has no budget yet")}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-2 @xl:grid-cols-3 @xl:gap-2.5">
          <Tile label="Price" value={fmtK(t.priceCents)} note={priceNote} />
          <Tile label={unknown ? "Cost so far" : "Cost"} value={fmtK(unknown ? t.costSoFarCents : t.projectedCostCents)} note={costParts || "nothing logged yet"} />
          <Tile label="Work done (by cost)" value={t.workDonePct != null ? fmtPct(t.workDonePct) : "—"} note={billingNote}>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-3" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${Math.round((t.workDonePct ?? 0) * 100)}%` }} />
            </div>
          </Tile>
        </div>
      </div>

      {/* One thought per line: profit, progress, cash, problems. Easier to scan than a block. */}
      <div className="mt-3.5 flex flex-col gap-1.5 text-[13px] leading-snug text-ink-2">
        {sentences.map((s) => <p key={s}>{s}</p>)}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {chips.map((label, i) => <Chip key={label} kind={i === 0 && !unknown ? "info" : "ghost"}>{label}</Chip>)}
        <span className="ml-1 font-mono text-[10px] text-ink-4">as of {view.asOfLabel}</span>
        <span className="flex-1" />
        {unknown && canAdopt && (
          <button type="button" disabled={pending} onClick={onAdopt} className={BTN_PRIMARY}>Use estimate as budget</button>
        )}
        {unknown && !canAdopt && view.lines.length === 0 && (
          <button type="button" onClick={onAddLine} className={BTN_PRIMARY}>Add first budget line</button>
        )}
        <button type="button" onClick={onShowFigured} className={BTN}><Info className="size-3.5" strokeWidth={1.75} />How these numbers are figured</button>
        {/* With lines in but the budget unconfirmed, settings IS the next step. */}
        <button type="button" onClick={onSettings} className={unknown && view.lines.length > 0 ? BTN_PRIMARY : BTN}><Settings2 className="size-3.5" strokeWidth={1.75} />Budget settings</button>
      </div>
    </Card>
  );
}
