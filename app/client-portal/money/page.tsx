import { Button, Card, Chip, Eyebrow } from "@/components/ui";
import { ProjectFinancials } from "@/components/portal/ProjectFinancials";
import { portalSlug } from "@/lib/client-portal";
import { getPortalFinancials } from "@/lib/portal-financials";
import { getProjectMoney, usd } from "@/lib/money";

export default async function PortalMoneyPage() {
  const slug = await portalSlug();
  const [financials, money] = slug
    ? await Promise.all([getPortalFinancials(slug), getProjectMoney(slug)]) : [null, null];
  const invoices = (money?.invoices ?? []).filter((i) => i.status !== "draft");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-8 [&>*]:max-w-3xl">
      <Eyebrow>Money</Eyebrow>
      <h1 className="mt-1 font-serif text-display font-medium text-accent-2">Where the money stands.</h1>
      <p className="mt-2 text-body text-ink-2">Your project total, recorded payments, and invoices. For a question about a line, message Joe before you pay.</p>
      {financials && <Card className="mt-6 p-4"><ProjectFinancials data={financials} /></Card>}
      <section className="mt-8">
        <h2 className="font-serif text-heading font-semibold">Invoices</h2>
        {invoices.length === 0 ? <p className="mt-3 text-body text-ink-3">Nothing billed yet. Joe’s invoices will appear here as milestones are reached.</p> :
          <div className="mt-3 divide-y divide-rule border-y border-rule">
            {invoices.map((inv) => <article key={inv.id} className="py-4">
              <h3 className="text-subheading font-semibold text-ink">{inv.milestone}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-mono text-meta text-ink-3">{inv.number}</span>
                <Chip kind={inv.status === "paid" ? "money" : "info"} dot>{inv.pending > 0 ? "Processing" : inv.lifecycle === "disputed" ? "In review" : inv.status === "paid" ? "Paid" : "Due"}</Chip>
                <span className="ml-auto text-body font-semibold tabular-nums">{usd(inv.amount)}</span>
              </div>
              {inv.lines.length > 0 && <dl className="mt-3 space-y-2">{inv.lines.map((line, i) => <div key={i} className="flex items-baseline justify-between gap-4 text-body text-ink-2"><dt>{line.label}</dt><dd className="shrink-0 tabular-nums">{usd(line.amount)}</dd></div>)}</dl>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-meta text-ink-3">{inv.statusLabel}</span>
                {inv.balance > 0 && inv.pending === 0 && inv.lifecycle !== "disputed" && <Button href={`/client-portal/pay/${inv.id}`}>Pay {usd(inv.balance)}</Button>}
              </div>
            </article>)}
          </div>}
      </section>
    </main>
  );
}
