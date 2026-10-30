import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { Button, Card, Chip, Eyebrow, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/dal";
import { runDirect } from "@/lib/commands/db";
import { houzzExitInventory } from "@/lib/houzz-exit";

export const dynamic = "force-dynamic";

/** Houzz exit checklist (A21, INTEGRATIONS.md, V30). Inventory + the five
 *  retirement criteria with evidence from SJC OS. Nothing here cancels or
 *  migrates anything; Joe retires Houzz by hand when every row is met. */
export default async function HouzzExitPage() {
  await requireAccess("engine");
  const inv = await houzzExitInventory(runDirect);
  const nextActions: Record<number, { label: string; href: string }> = {
    1: { label: "Complete payment setup", href: "/settings/payments" },
    2: { label: "Verify a saved design export", href: "/floor" },
    3: { label: "File Houzz exports on their jobs", href: "/files" },
    4: { label: "Review the first unpaid invoice", href: inv.invoices.outstanding[0] ? `/projects/${inv.invoices.outstanding[0].slug}?tab=Money` : "/money" },
    5: { label: "Review reminder policies", href: "/engine/decisions" },
  };
  const titles: Record<number, string> = { 1: "Payments and reconciliation", 2: "Designer workflow verification", 3: "Preserve Houzz records", 4: "Finish existing payment links", 5: "Confirm one sender per action" };
  const priority = [4, 1, 5, 3, 2];
  const checklist = [...inv.criteria].sort((a, b) => Number(a.status === "met") - Number(b.status === "met") || priority.indexOf(a.n) - priority.indexOf(b.n));
  const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const chip = (s: string) => (s === "met" ? <Chip kind="money">met</Chip> : s === "not_met" ? <Chip kind="flag">not met</Chip> : <Chip kind="ghost">Needs evidence</Chip>);
  return (
    <Shell breadcrumb="OPERATIONS ENGINE · HOUZZ EXIT">
      <div className="mx-auto max-w-6xl px-4 @3xl/page:px-6 pb-16 pt-6">
        <div className="mb-4">
          <PageHeader title={<> Houzz exit </>} meta={<> {inv.ready_to_cancel ? "every criterion met — you can retire Houzz when you choose" : `${inv.criteria.filter((c) => c.status === "met").length} of 5 criteria met · not ready to cancel`} </>} />
          <p className="mt-2 max-w-[680px] text-body leading-relaxed text-ink-3">
            The transition inventory. Nothing on this page cancels Houzz, deletes a file or moves a payment link; it shows what
            SJC OS can prove and what still needs your hand. Cancel the subscription yourself once every row is met — never
            because integration code was merged.
          </p>
        </div>

        <section className="mb-8 flex flex-col gap-3">
          {checklist.map((c) => (
            <Card key={c.n} kind="default" className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3 text-body">
                <span className="text-ink-3">{c.n}.</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{titles[c.n]}</div>
                  {c.status !== "met" && <Button variant="secondary" size="sm" className="mt-2 h-auto! min-h-11 max-w-full whitespace-normal! py-2 text-left" href={nextActions[c.n].href}>{nextActions[c.n].label}</Button>}
                  <details className="mt-2"><summary className="cursor-pointer text-meta text-ink-3">Evidence and remaining gaps</summary><p className="mt-2 text-body text-ink-2">{c.title}</p>
                  {c.evidence.length > 0 && <ul className="mt-1 list-disc pl-5 text-meta text-ink-3">{c.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                  {c.gaps.length > 0 && <ul className="mt-1 list-disc pl-5 text-meta text-flag">{c.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}
                  </details>
                </div>
                {chip(c.status)}
              </div>
            </Card>
          ))}
        </section>

        <details><summary className="cursor-pointer py-2 text-body text-ink-2">Technical inventory and history</summary>
        <section className="mb-8">
          <Eyebrow muted>Invoices sent and unpaid ({inv.invoices.outstanding.length}) · all invoices {Object.entries(inv.invoices.by_status).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}</Eyebrow>
          {inv.invoices.outstanding.length === 0 ? (
            <Card kind="soft" className="mt-2 px-4 py-3 text-body text-ink-3">No open invoices. Nothing to finish or migrate.</Card>
          ) : (
            <div className="mt-2 max-w-full overflow-x-auto"><table className="w-full border-collapse text-body">
              <thead><tr className="border-b border-rule text-left text-meta text-ink-3"><th className="py-2 pr-3">Invoice</th><th className="py-2 pr-3">Job</th><th className="py-2 pr-3">Milestone</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Sent</th><th className="py-2 pr-3">Delivery</th></tr></thead>
              <tbody>
                {inv.invoices.outstanding.map((i) => (
                  <tr key={i.id} className="border-b border-rule/60">
                    <td className="py-2 pr-3">{i.number || `#${i.id}`}</td>
                    <td className="py-2 pr-3"><Link href={`/projects/${i.slug}?tab=Money`} className="underline-offset-2 hover:underline">{i.project}</Link></td>
                    <td className="py-2 pr-3">{i.milestone}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{money(i.amount_cents)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{i.sent_at?.slice(0, 10) ?? "—"}</td>
                    <td className="py-2 pr-3">{i.delivery ?? "unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>

        <section className="mb-8 grid gap-3 @3xl/page:grid-cols-2">
          <Card kind="soft" className="px-4 py-3 text-body">
            <Eyebrow muted>Imported Houzz history (kept as evidence)</Eyebrow>
            <div className="mt-1 text-ink-3">{inv.imported_history.houzz_expenses} payment records · {money(inv.imported_history.houzz_expense_cents)} · {inv.imported_history.houzz_lead_imports} lead imports · {inv.imported_history.retainers_recorded} retainers</div>
          </Card>
          <Card kind="soft" className="px-4 py-3 text-body">
            <Eyebrow muted>Designer</Eyebrow>
            <div className="mt-1 text-ink-3">{inv.designer.designs} designs · {inv.designer.versions} versions · {inv.designer.pinned_versions} pinned for estimates · {inv.designer.exports} exported files</div>
          </Card>
        </section>

        <section className="mb-8">
          <Eyebrow muted>Who sends what</Eyebrow>
          <ul className="mt-2 text-body">{inv.active_senders.map((s, i) => <li key={i} className="border-b border-rule/60 py-2"><span className="font-medium">{s.owner}</span> — {s.what} · <span className="text-ink-3">{s.state}</span></li>)}</ul>
        </section>

        <section><h2 className="text-heading font-serif">History to keep</h2>
          <ul className="mt-2 list-disc pl-5 text-body text-ink-3">{inv.code_references.map((r,i)=><li key={i}>{r}</li>)}</ul>
          <p className="mt-3 text-body text-ink-3">Before cancelling Houzz, export the records you still need and attach them to the matching job in Files.</p>
        </section>
        </details>
      </div>
    </Shell>
  );
}
