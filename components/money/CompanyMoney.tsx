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
import { Button, Card, Chip, EmptyState, KpiTile, Table, TableWrapper, TableHead, TableBody, TableHeader, TableRow, TableCell, TablePrimaryCell } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import { fmtK, fmtPct, type CompanyTotals, type ProfitStatus } from "@/lib/budget-types";
import { sortCompanyRows, type CompanyJobRow, type CompanyMoney as CompanyMoneyData, type CompanySortKey } from "@/lib/budget-company";
import { Fold, Section } from "@/components/projects/budget/parts";

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
const unknown = <span className="text-ink-3">—</span>;

function Totals({ t }: { t: CompanyTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 @2xl/page:grid-cols-4">
      <KpiTile label="Contracted" value={fmtK(t.contractedCents)} meta={`Across ${jobs(t.jobCount)}`} hint="Job totals come from each project's ledger: its formal estimate, approved changes, pre-con fees and agreed money outside the app." />
      <KpiTile label="Collected" value={fmtK(t.collectedCents)} meta={`${fmtPct(t.contractedCents > 0 ? t.collectedCents / t.contractedCents : null)} of contracted`} hint="Includes settled invoice payments and paid money recorded outside the app." />
      <KpiTile label="Left to collect" value={fmtK(t.leftToCollectCents)} hint="Price less collected, including work not billed yet. This is not what clients owe today." />
      <KpiTile label="Unpaid invoices" value={fmtK(t.unpaidInvoicesCents)} meta={`Billing tracked on ${t.billingTrackedJobs} of ${jobs(t.jobCount)}`} hint="Invoices issued from SJC OS with an open balance. Excludes work that has not been billed." />
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
  const th = (k: CompanySortKey, label: string, className = "", numeric = true) => (
    <TableHeader numeric={numeric} className={className} aria-sort={k === key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-ink">
        {label}{k === key && <Arrow className="size-3" />}
      </button>
    </TableHeader>
  );
  if (!rows.length) return <EmptyState compact title="No jobs in this group" description="Jobs appear here as their stage changes." />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-label text-ink-3">Sort by
          <select value={key} onChange={e => sortBy(e.target.value as CompanySortKey)} className="h-9 rounded-md border border-rule bg-card px-2 text-body">
            {SORTS.map(([k,l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <Button variant="ghost" iconOnly icon={Arrow} aria-label="Reverse sort order" title="Reverse sort order" onClick={() => setDir(dir === "asc" ? "desc" : "asc")} />
      </div>
      <TableWrapper><Table density="compact">
        <TableHead><TableRow>{th("name","Job","",false)}{th("price","Price")}{th("cost","Cost","@max-3xl/page:hidden")}{th("profit","Profit","@max-3xl/page:hidden")}{th("margin","Margin","@max-5xl/page:hidden")}{th("workDone","Work done","@max-5xl/page:hidden")}{th("collected","Collected","@max-xl/page:hidden")}{th("unpaid","Unpaid inv.","@max-5xl/page:hidden")}{th("leftToCollect","Left to collect","@max-4xl/page:hidden")}</TableRow></TableHead>
        <TableBody>{sorted.map(r => <TableRow key={r.slug} title={r.headline}>
          <TablePrimaryCell meta={<span>{STAGE[r.stage] ?? r.stage} · {STATUS[r.profitStatus].label}<span className="block @xl/page:hidden">Collected {fmtK(r.collectedCents)}</span></span>}><Link href={href(r.slug)} className="hover:underline">{r.name}</Link></TablePrimaryCell>
          <TableCell numeric>{fmtK(r.priceCents)}</TableCell>
          <TableCell numeric className="@max-3xl/page:hidden">{fmtK(r.costCents)}{r.costIsSoFar && <div className="text-meta text-ink-3">so far</div>}</TableCell>
          <TableCell numeric className={`@max-3xl/page:hidden ${r.profitCents != null && r.profitCents < 0 ? "text-flag" : ""}`}>{r.profitCents != null ? fmtK(r.profitCents) : unknown}</TableCell>
          <TableCell numeric className="@max-5xl/page:hidden">{r.marginPct != null ? fmtPct(r.marginPct) : unknown}</TableCell>
          <TableCell numeric className="@max-5xl/page:hidden">{r.workDonePct != null ? fmtPct(r.workDonePct) : unknown}</TableCell>
          <TableCell numeric className="@max-xl/page:hidden">{fmtK(r.collectedCents)}</TableCell>
          <TableCell numeric className="@max-5xl/page:hidden">{fmtK(r.unpaidInvoicesCents)}</TableCell>
          <TableCell numeric className="@max-4xl/page:hidden">{fmtK(r.leftToCollectCents)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></TableWrapper>
    </div>
  );
}

const ATTENTION_SHOWN = 8;

export function CompanyMoney({ data }: { data: CompanyMoneyData }) {
  const [allAttention, setAllAttention] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const attention = allAttention ? data.attention : data.attention.slice(0, ATTENTION_SHOWN);

  return (
    <div className="flex flex-col gap-6">
      {data.totals.profitJobs === 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/25 bg-warn-soft p-4 text-body text-warn" role="status"><p>Profit isn’t known on any job yet — no job has a finished budget.</p><Button href={data.attention.find(a => a.kind === "profit_unknown")?.href ?? (data.open[0] ? href(data.open[0].slug) : "/projects")} variant="ghost" size="sm">Fill budgets →</Button></div>}
      <Totals t={data.totals} />
      {data.totals.profitJobs > 0 && <p className="text-body text-ink-2">Profit {fmtK(data.totals.profitCents)} · {fmtPct(data.totals.blendedMarginPct)} margin, known on {data.totals.profitJobs} of {jobs(data.totals.jobCount)}.</p>}
      {data.totals.unbilledJobs > 0 && <p className="text-body text-ink-2">Work done, not billed: {fmtK(data.totals.unbilledCents)} · known on {jobs(data.totals.unbilledJobs)}.</p>}

      <Section title="Needs attention" sub="Most money first.">
        {data.attention.length === 0 ? <EmptyState compact title="No money issues flagged" description="Budget, invoice and cost issues will appear here when they need a decision." /> : (
          <TableWrapper><Table density="compact">
            <TableHead><TableRow><TableHeader numeric>Amount</TableHeader><TableHeader>Job</TableHeader><TableHeader className="@max-3xl/page:hidden">Issue</TableHeader><TableHeader><span className="sr-only">Action</span></TableHeader></TableRow></TableHead>
            <TableBody>{attention.map((a,i) => <TableRow key={`${a.slug}-${a.kind}-${i}`}>
              <TableCell numeric className="whitespace-nowrap">{fmtK(a.amountCents)}</TableCell>
              <TablePrimaryCell meta={<span className="@3xl/page:hidden">{a.text}</span>}><Link href={a.href} className="hover:underline">{a.name}</Link></TablePrimaryCell>
              <TableCell className="@max-3xl/page:hidden text-ink-2">{a.text}</TableCell>
              <TableCell className="text-right @max-xl/page:hidden"><Button variant="ghost" size="sm" href={a.href}>{a.kind === "profit_unknown" ? "Add budget" : "Review"}</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>
          {data.attention.length > ATTENTION_SHOWN && <Button variant="ghost" onClick={() => setAllAttention(!allAttention)} className="w-full justify-start border-t border-rule-soft">{allAttention ? "Show fewer" : `Show all ${data.attention.length}`}</Button>}
          </TableWrapper>
        )}
      </Section>

      <Section title="Open jobs" sub="The bar is what each job has cost and is still expected to, against its price. A job with no finished budget shows cost so far and no profit.">
        <JobsList rows={data.open} />
      </Section>

      <Section title="Closed jobs">
        <Fold title={`${jobs(data.closed.length)} closed`} right={`contracted ${fmtK(data.closedTotals.contractedCents)} · collected ${fmtK(data.closedTotals.collectedCents)}${data.closedTotals.profitJobs ? ` · profit known on ${data.closedTotals.profitJobs}` : ""}`} open={closedOpen} onToggle={() => setClosedOpen(!closedOpen)}>
          <p className="mb-3 text-body text-ink-3">Most of this history came from Houzz, which carried prices and payments but no costs — so profit is unknown on a closed job unless its costs were entered here.</p>
          <JobsList rows={data.closed} />
        </Fold>
      </Section>
    </div>
  );
}
