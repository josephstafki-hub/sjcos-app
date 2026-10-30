import { usd } from "@/lib/money";
import type { getPortalFinancials } from "@/lib/portal-financials";

export function ProjectFinancials({ data }: { data: NonNullable<Awaited<ReturnType<typeof getPortalFinancials>>> }) {
  const rows = [
    ["Contract price", data.contractCents], ["Changes", data.changesCents],
    ...(data.otherAgreedCents ? [["Pre-con & other agreed work", data.otherAgreedCents] as const] : []),
    ["Current price", data.currentCents], ["Paid to date", data.paidCents], ["Remaining", data.remainingCents],
  ] as const;
  return <dl className="divide-y divide-rule-soft">
    {rows.map(([label, amount]) => <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-body">
      <dt className="text-ink-3">{label}</dt><dd className={`shrink-0 font-semibold tabular-nums ${label === "Paid to date" ? "text-money" : "text-ink"}`}>{usd(amount)}</dd>
    </div>)}
  </dl>;
}
