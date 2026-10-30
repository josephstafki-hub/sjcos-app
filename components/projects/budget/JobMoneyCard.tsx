"use client";

// Money › Overview — "Job total and paid": the two figures the projects list,
// Today and /money show for this job, term by term. Postgres works both out
// from the job's records on every write (migration 0037); the only typed parts
// are the two "outside the app" amounts, which the owner edits here.

import { Card } from "@/components/ui";
import { fmtUsd } from "@/lib/cost-book-units";
import type { JobMoney } from "@/lib/budget-types";
import { BTN } from "./parts";

export function JobMoneyCard({ money, isOwner, onEdit }: { money: JobMoney; isOwner: boolean; onEdit: () => void }) {
  const pct = money.totalCents > 0 ? Math.min(100, Math.round((100 * money.collectedCents) / money.totalCents)) : null;
  const row = (label: string, cents: number, show = cents !== 0) =>
    show && (
      <div key={label} className="flex items-baseline gap-3 text-ink-2">
        <span className="min-w-0 flex-1">{label}</span>
        <span className="font-mono">{fmtUsd(cents)}</span>
      </div>
    );
  const head = (label: string, cents: number) => (
    <div className="flex items-baseline gap-3 font-semibold text-ink">
      <span className="flex-1">{label}</span>
      <span className="font-mono text-[14px]">{fmtUsd(cents)}</span>
    </div>
  );

  return (
    <Card className="flex flex-col gap-3 p-4 text-[12.5px]">
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <div className="flex flex-col gap-1">
          {head("Job total", money.totalCents)}
          {row(money.estimateId != null ? `Contract — estimate #${money.estimateId}` : "Contract estimate", money.estimateCents)}
          {row("Approved change orders", money.changeOrdersCents)}
          {row("Pre-con fee invoices", money.preconCents)}
          {row("Agreed outside the app", money.openingTotalCents)}
          {money.totalCents === 0 && (
            <p className="text-ink-3">No total yet. It fills in when the formal estimate is approved, signed or billed against.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {head(pct == null ? "Paid" : `Paid · ${pct}%`, money.collectedCents)}
          {row("Payments on invoices", money.paymentsCents)}
          {row("Paid outside the app", money.openingCollectedCents)}
          {pct != null && (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-3">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          )}
          {money.totalCents > 0 && row("Left to collect", Math.max(0, money.totalCents - money.collectedCents), true)}
        </div>
      </div>
      {money.openingNote && (money.openingTotalCents > 0 || money.openingCollectedCents > 0) && (
        <p className="text-[11.5px] text-ink-3">Outside the app: {money.openingNote}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-rule-soft pt-2.5">
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-3">
          The projects list shows these same figures. They come from the estimate, change orders, invoices and payments; record a payment on its invoice and they move.
        </p>
        {isOwner && <button type="button" onClick={onEdit} className={BTN}>Money outside the app</button>}
      </div>
    </Card>
  );
}
