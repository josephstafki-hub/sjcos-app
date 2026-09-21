"use client";

// The company Money page (docs/project-financials-plan.md §5): every job side
// by side, built from the same per-job math as a project's Money › Overview.
//
// Every total sums ONLY what is known and says its coverage — a profit over
// three jobs is never divided by the price of ten. Like the project panel, the
// layout answers to its column (`@container`): the app's side panels leave it
// phone-narrow on a laptop, where the jobs read as cards; with room they
// become a sortable table.

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import { fmtK, fmtPct, type CompanyTotals, type ProfitStatus } from "@/lib/budget-types";
import { sortCompanyRows, type CompanyJobRow, type CompanyMoney as CompanyMoneyData, type CompanySortKey } from "@/lib/budget-company";
import { BTN, FIELD, Fold, Legend, RAMP, Section, StackBar, Tile } from "@/components/projects/budget/parts";

const STATUS: Record<ProfitStatus, { label: string; kind: ChipKind }> = {
  projected: { label: "Projected", kind: "info" },
  planned: { label: "Planned", kind: "ghost" },
  unknown: { label: "Not known", kind: "ghost" },
};
const STAGE: Record<string, string> = {
  precon_signed: "Pre-con", floor_plan: "Floor plan", mood_board: "Mood board", selections: "Selections", bidding: "Bidding",
  construction_contract: "Contract", construction: "On site", closeout: "Closeout", warranty: "Closed",
};
const href = (slug: string) => `/projects/${slug}?tab=Money`;
const jobs = (n: number) => `${n} job${n === 1 ? "" : "s"}`;
const unknown = <span className="text-ink-4">—</span>;

function CostBar({ r }: { r: CompanyJobRow }) {
  return (
    <StackBar
      max={Math.max(r.priceCents, r.costCents, 1)}
      segs={[
        { label: "Spent", cents: r.paidCents, className: RAMP.paid },
        { label: "Owed", cents: r.owedCents, className: RAMP.owed },
        { label: "On order", cents: r.orderedCents, className: RAMP.ordered },
        { label: "Still to spend", cents: r.estToFinishCents, className: RAMP.est },
      ]}
      ticks={[{ label: "price", cents: r.priceCents, hideLabel: true }]}
    />
  );
}

function Totals({ t }: { t: CompanyTotals }) {
  const known = t.profitJobs > 0;
  const split = [t.projectedJobs && `${t.projectedJobs} projected`, t.plannedJobs && `${t.plannedJobs} planned`].filter(Boolean).join(", ");
  return (
    <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2 @4xl:grid-cols-3 @xl:gap-2.5">
      <Tile label="Profit" value={known ? fmtK(t.profitCents) : "Not known yet"}
        note={known
          ? `${fmtPct(t.blendedMarginPct)} margin on ${t.profitJobs} of ${jobs(t.jobCount)} (${split}) — covers ${fmtK(t.profitPriceCoverageCents)} of ${fmtK(t.contractedCents)} contracted`
          : `No job has a finished budget yet, so there is nothing honest to add up. 0 of ${jobs(t.jobCount)}.`} />
      <Tile label="Contracted" value={fmtK(t.contractedCents)} note={`across ${jobs(t.jobCount)}`} />
      <Tile label="Collected" value={fmtK(t.collectedCents)} note={`${fmtPct(t.contractedCents > 0 ? t.collectedCents / t.contractedCents : null)} of what's contracted`} />
      <Tile label="Left to collect" value={fmtK(t.leftToCollectCents)} note="Price less collected. Includes work not billed yet — it is not what clients owe you today." />
      <Tile label="Unpaid invoices" value={fmtK(t.unpaidInvoicesCents)} note={`Sent from SJC OS and not paid. Billing is fully tracked on ${t.billingTrackedJobs} of ${jobs(t.jobCount)}.`} />
      <Tile label="Work done, not billed" value={t.unbilledJobs ? fmtK(t.unbilledCents) : "—"}
        note={t.unbilledJobs ? `Known on ${jobs(t.unbilledJobs)} — those with a finished budget and tracked billing.` : "Needs a finished budget and tracked billing; no job has both yet."} />
    </div>
  );
}

const SORTS: [CompanySortKey, string][] = [
  ["profit", "Profit"], ["margin", "Margin"], ["price", "Price"], ["cost", "Cost"], ["workDone", "Work done"],
  ["leftToCollect", "Left to collect"], ["unpaid", "Unpaid invoices"], ["collected", "Collected"], ["name", "Name"],
];

function JobsList({ rows }: { rows: CompanyJobRow[] }) {
  const [key, setKey] = useState<CompanySortKey>("profit");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const sorted = sortCompanyRows(rows, key, dir);
  const sortBy = (k: CompanySortKey) => { if (k === key) setDir(dir === "asc" ? "desc" : "asc"); else { setKey(k); setDir(k === "name" ? "asc" : "desc"); } };
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  const th = (k: CompanySortKey, label: string, right = true) => (
    <th className={`whitespace-nowrap px-2 pb-1.5 ${right ? "text-right" : "text-left"}`} aria-sort={k === key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => sortBy(k)} className={`inline-flex items-center gap-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] ${k === key ? "text-ink" : "text-ink-3 hover:text-ink"}`}>
        {label}{k === key && <Arrow className="size-2.5" strokeWidth={2} />}
      </button>
    </th>
  );
  if (!rows.length) return <p className="text-[13px] text-ink-3">No jobs here.</p>;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Narrow: a sort picker + cards. */}
      <div className="flex items-center gap-2 @4xl:hidden">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-3">
          Sort by
          <select value={key} onChange={(e) => sortBy(e.target.value as CompanySortKey)} className={`${FIELD} py-1 text-[12px]`}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setDir(dir === "asc" ? "desc" : "asc")} className={BTN} aria-label={dir === "asc" ? "Smallest first" : "Largest first"}><Arrow className="size-3.5" strokeWidth={1.75} /></button>
      </div>
      <div className="flex flex-col gap-2 @4xl:hidden">
        {sorted.map((r) => (
          <Link key={r.slug} href={href(r.slug)} title={r.headline}>
            <Card className="flex flex-col gap-1.5 p-3.5 transition-colors hover:bg-paper-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-[16px] leading-tight text-ink">{r.name}</div>
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">{STAGE[r.stage] ?? r.stage}</div>
                </div>
                <div className="text-right">
                  <div className={`font-serif text-[19px] leading-tight ${r.profitCents != null && r.profitCents < 0 ? "text-flag" : "text-ink"}`}>{r.profitCents != null ? fmtK(r.profitCents) : <span className="text-[14px] text-ink-3">profit not known</span>}</div>
                  {r.marginPct != null && <div className="font-mono text-[10.5px] text-ink-3">{fmtPct(r.marginPct)} · {STATUS[r.profitStatus].label.toLowerCase()}</div>}
                </div>
              </div>
              <CostBar r={r} />
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-2">
                <span>Price <b className="font-mono font-medium text-ink">{fmtK(r.priceCents)}</b></span>
                <span>{r.costIsSoFar ? "Cost so far" : "Cost"} <b className="font-mono font-medium text-ink">{fmtK(r.costCents)}</b></span>
                <span>Left to collect <b className="font-mono font-medium text-ink">{fmtK(r.leftToCollectCents)}</b></span>
                {r.unpaidInvoicesCents > 0 && <span>Unpaid invoices <b className="font-mono font-medium text-ink">{fmtK(r.unpaidInvoicesCents)}</b></span>}
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* With room: the same jobs as a sortable table; the Cost cell is the chart. */}
      <Card className="hidden overflow-x-auto p-3 @4xl:block">
        <table className="w-full text-[12.5px]">
          <thead><tr>{th("name", "Job", false)}{th("price", "Price")}{th("cost", "Cost", false)}{th("profit", "Profit")}{th("margin", "Margin")}{th("workDone", "Work done")}{th("collected", "Collected")}{th("unpaid", "Unpaid inv.")}{th("leftToCollect", "Left to collect")}</tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.slug} className="border-t border-rule-soft hover:bg-paper-2" title={r.headline}>
                <td className="px-2 py-2">
                  <Link href={href(r.slug)} className="font-semibold text-ink hover:underline">{r.name}</Link>
                  <div className="flex items-center gap-1.5"><span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">{STAGE[r.stage] ?? r.stage}</span><Chip kind={STATUS[r.profitStatus].kind}>{STATUS[r.profitStatus].label}</Chip></div>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{fmtK(r.priceCents)}</td>
                <td className="min-w-[9rem] px-2 py-2"><CostBar r={r} /><div className="mt-0.5 font-mono text-[11px] text-ink-3">{fmtK(r.costCents)}{r.costIsSoFar ? " so far" : ""}</div></td>
                <td className={`whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${r.profitCents != null && r.profitCents < 0 ? "text-flag" : ""}`}>{r.profitCents != null ? fmtK(r.profitCents) : unknown}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{r.marginPct != null ? fmtPct(r.marginPct) : unknown}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{r.workDonePct != null ? fmtPct(r.workDonePct) : unknown}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{fmtK(r.collectedCents)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{r.unpaidInvoicesCents ? fmtK(r.unpaidInvoicesCents) : unknown}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{fmtK(r.leftToCollectCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Legend swatch={RAMP.paid} label="Spent" /><Legend swatch={RAMP.owed} label="Owed" /><Legend swatch={RAMP.ordered} label="On order" /><Legend swatch={RAMP.est} label="Still to spend" />
        <span className="inline-flex items-center gap-1.5 text-ink-2"><i className="inline-block h-3 w-px bg-ink" />Price</span>
      </div>
    </div>
  );
}

const ATTENTION_SHOWN = 8;

export function CompanyMoney({ data }: { data: CompanyMoneyData }) {
  const [allAttention, setAllAttention] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const attention = allAttention ? data.attention : data.attention.slice(0, ATTENTION_SHOWN);

  return (
    <div className="@container flex flex-col gap-6">
      <Section title="Open jobs, added up" sub="Each figure counts only the jobs where it is actually known, and says how many that is.">
        <Totals t={data.totals} />
      </Section>

      <Section title="Needs attention" sub="Most money first.">
        {data.attention.length === 0 ? <Card className="p-4 text-[13px] text-ink-3">Nothing flagged on any open job.</Card> : (
          <Card className="p-0">
            {attention.map((a, i) => (
              <Link key={`${a.slug}-${a.kind}-${i}`} href={a.href} className={`flex items-baseline gap-3 px-4 py-2.5 hover:bg-paper-2 ${i ? "border-t border-rule-soft" : ""}`}>
                <span className="w-[4.5rem] flex-none text-right font-mono text-[12px] tabular-nums text-ink">{fmtK(a.amountCents)}</span>
                <span className="min-w-0 text-[13px] text-ink-2"><b className="font-semibold text-ink">{a.name}</b> — {a.text}</span>
              </Link>
            ))}
            {data.attention.length > ATTENTION_SHOWN && (
              <button type="button" onClick={() => setAllAttention(!allAttention)} className="w-full border-t border-rule-soft px-4 py-2 text-left text-[12px] font-semibold text-ink-3 hover:bg-paper-2">
                {allAttention ? "Show fewer" : `Show all ${data.attention.length}`}
              </button>
            )}
          </Card>
        )}
      </Section>

      <Section title="Open jobs" sub="The bar is what each job has cost and is still expected to, against its price. A job with no finished budget shows cost so far and no profit.">
        <JobsList rows={data.open} />
      </Section>

      <Section title="Closed jobs">
        <Fold title={`${jobs(data.closed.length)} closed`} right={`contracted ${fmtK(data.closedTotals.contractedCents)} · collected ${fmtK(data.closedTotals.collectedCents)}${data.closedTotals.profitJobs ? ` · profit known on ${data.closedTotals.profitJobs}` : ""}`} open={closedOpen} onToggle={() => setClosedOpen(!closedOpen)}>
          <p className="mb-3 text-[12.5px] text-ink-3">Most of this history came from Houzz, which carried prices and payments but no costs — so profit is unknown on a closed job unless its costs were entered here.</p>
          <JobsList rows={data.closed} />
        </Fold>
      </Section>
    </div>
  );
}
