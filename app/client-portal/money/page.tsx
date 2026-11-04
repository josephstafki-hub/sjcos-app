import Link from "next/link";
import { invoiceState, portalInvoiceSummary } from "@/lib/portal-presentation";
import { Button, Card, Chip, Eyebrow } from "@/components/ui";
import { ProjectFinancials } from "@/components/portal/ProjectFinancials";
import { portalSlug } from "@/lib/client-portal";
import { getPortalFinancials } from "@/lib/portal-financials";
import { getProjectMoney, usd, type Invoice } from "@/lib/money";

export default async function PortalMoneyPage() {
  const slug = await portalSlug();
  const [financials, money] = slug
    ? await Promise.all([getPortalFinancials(slug), getProjectMoney(slug)]) : [null, null];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const summary = portalInvoiceSummary(money?.invoices ?? [], today, financials?.currentCents, financials?.outsidePaidCents);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 @3xl/page:px-8 [&>*]:max-w-3xl">
      <Eyebrow>Money</Eyebrow>
      <h1 className="mt-1 font-serif text-display font-medium text-accent-2">Where the money stands.</h1>
      <p className="mt-2 text-body text-ink-2">For a question about an invoice, <Link href="/client-portal/messages" className="underline">message Joe</Link> before you pay.</p>
      <Card className="mt-6">
        <dl className="grid grid-cols-3 divide-x divide-rule-soft">
          <div className="min-w-0 p-3"><dt className="text-label text-ink-3"><a href="#due-now" className="inline-flex min-h-11 items-center underline">Due now</a></dt><dd className="break-words text-subheading font-semibold tabular-nums @xl/page:text-kpi">{usd(summary.dueCents)}</dd></div>
          <div className="min-w-0 p-3"><dt className="text-label text-ink-3"><a href="#processing" className="inline-flex min-h-11 items-center underline">Processing</a></dt><dd className="break-words text-subheading font-semibold tabular-nums @xl/page:text-kpi">{usd(summary.processingCents)}</dd></div>
          <div className="min-w-0 p-3"><dt className="flex min-h-11 items-center text-label text-ink-3">Still to bill</dt><dd className="break-words text-subheading font-semibold tabular-nums @xl/page:text-kpi">{summary.stillToBillCents == null ? "—" : usd(summary.stillToBillCents)}</dd></div>
        </dl>
        <details className="border-t border-rule-soft px-3 text-meta text-ink-3"><summary className="min-h-11 cursor-pointer py-3">What’s still to bill?</summary><p className="pb-3">Current project price less issued invoices and payments recorded outside invoices. Money already invoiced, including payments processing, is excluded. This is not due now.</p></details>
      </Card>
      <InvoiceSection id="due-now" title="Due now" invoices={summary.due} empty="No invoices due now." payable />
      <section id="processing" className="mt-6 scroll-mt-4">
        <h2 className="font-serif text-heading font-semibold">Processing</h2>
        <p className="mt-2 text-body text-ink-3">{summary.processing.length ? "These payments are in flight. No need to pay these invoices again." : "No payments processing."}</p>
        <div className="divide-y divide-rule-soft">{summary.processing.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)}</div>
      </section>
      {summary.upcoming.length > 0 && <InvoiceSection id="upcoming" title="Upcoming invoices" invoices={summary.upcoming} empty="" upcoming />}
      {summary.review.length > 0 && <InvoiceSection id="in-review" title="In review" invoices={summary.review} empty="" />}
      {financials && <section className="mt-8"><h2 className="font-serif text-heading font-semibold">Project breakdown</h2><Card className="mt-3 p-4"><ProjectFinancials data={financials} /></Card></section>}
      <InvoiceSection id="history" title="Paid & settled history" invoices={summary.settled} empty="Settled invoices will appear here." />
    </main>
  );
}

function InvoiceSection({ id, title, invoices, empty, payable = false, upcoming = false }: { id: string; title: string; invoices: Invoice[]; empty: string; payable?: boolean; upcoming?: boolean }) {
  return <section id={id} className="mt-6 scroll-mt-4"><h2 className="font-serif text-heading font-semibold">{title}</h2>{invoices.length === 0 ? <p className="mt-3 text-body text-ink-3">{empty}</p> : <div className="mt-3 divide-y divide-rule border-y border-rule">{invoices.map(inv => <InvoiceRow key={inv.id} invoice={inv} payable={payable} upcoming={upcoming} />)}</div>}</section>;
}

function InvoiceRow({ invoice: inv, payable = false, upcoming = false }: { invoice: Invoice; payable?: boolean; upcoming?: boolean }) {
  const settled = inv.balance <= 0 && inv.pending <= 0;
  return <article id={`invoice-${inv.id}`} className="scroll-mt-4 py-4">
    <h3 className="text-subheading font-semibold text-ink">{inv.milestone}</h3>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <span className="font-mono text-meta text-ink-3">{inv.number}</span>
      <Chip kind={settled ? "money" : "info"} dot>{settled ? inv.status === "paid" ? "Paid" : "Settled" : upcoming ? "Upcoming" : invoiceState(inv)}</Chip>
      <span className="ml-auto text-body font-semibold tabular-nums">{usd(inv.pending > 0 ? inv.pending : settled ? inv.amount : inv.balance)} {inv.pending > 0 ? "processing" : settled ? "invoiced" : "remaining"}</span>
    </div>
    <p className="mt-2 text-meta text-ink-3">{inv.statusLabel}{inv.dueAt && !settled ? ` · Due ${inv.dueAt}` : ""}</p>
    {inv.lines.length > 0 && <details className="mt-3 text-body"><summary className="min-h-11 cursor-pointer py-3 text-ink-2">Invoice breakdown</summary><dl className="space-y-2">{inv.lines.map((line, index) => <div key={index} className="flex items-baseline justify-between gap-4 text-ink-2"><dt>{line.label}</dt><dd className="shrink-0 tabular-nums">{usd(line.amount)}</dd></div>)}</dl></details>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button variant="secondary" href={`/client-portal/pay/${inv.id}`}>{inv.pending > 0 ? "View payment details" : "View invoice"}</Button>
      {payable && inv.balance > 0 && inv.pending <= 0 && inv.lifecycle !== "disputed" && <Button href={`/client-portal/pay/${inv.id}`}>Pay {usd(inv.balance)}</Button>}
    </div>
  </article>;
}
