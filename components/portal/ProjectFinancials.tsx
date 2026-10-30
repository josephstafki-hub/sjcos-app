import { usd } from "@/lib/money";
import type { getPortalFinancials } from "@/lib/portal-financials";

export function ProjectFinancials({ data }: { data: NonNullable<Awaited<ReturnType<typeof getPortalFinancials>>> }) {
  const rows = [
    ["Contract price", data.contractCents], ["Changes", data.changesCents],
    ...(data.otherAgreedCents ? [["Pre-con & other agreed work", data.otherAgreedCents] as const] : []),
    ["Current price", data.currentCents],
    ["Invoice payments (net of refunds)", data.invoicePaidCents],
    ["Paid outside app invoices", data.outsidePaidCents],
    ["Paid to date", data.paidCents], ["Remaining", data.remainingCents],
  ] as const;
  return <div><p className="text-meta text-ink-3">Paid to date = invoice payments + payments recorded outside app invoices, including any pre-con payments recorded there.</p><dl className="divide-y divide-rule-soft">
    {rows.map(([label, amount]) => <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-body">
      <dt className="text-ink-3">{label}</dt><dd className={`shrink-0 font-semibold tabular-nums ${label === "Paid to date" ? "text-money" : "text-ink"}`}>{usd(amount)}</dd>
    </div>)}
  </dl></div>;
}
