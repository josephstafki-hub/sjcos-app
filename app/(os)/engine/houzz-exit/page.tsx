import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
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
  const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const chip = (s: string) => (s === "met" ? <Chip kind="money">met</Chip> : s === "not_met" ? <Chip kind="flag">not met</Chip> : <Chip kind="ghost">needs your evidence</Chip>);
  return (
    <Shell breadcrumb="OPERATIONS ENGINE · HOUZZ EXIT">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        <div className="mb-4">
          <Eyebrow>{inv.ready_to_cancel ? "every criterion met — you can retire Houzz when you choose" : `${inv.criteria.filter((c) => c.status === "met").length} of 5 criteria met · not ready to cancel`}</Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">Houzz exit</h1>
          <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-ink-3">
            The transition inventory. Nothing on this page cancels Houzz, deletes a file or moves a payment link; it shows what
            SJC OS can prove and what still needs your hand. Cancel the subscription yourself once every row is met — never
            because integration code was merged.
          </p>
        </div>

        <section className="mb-8 flex flex-col gap-3">
          {inv.criteria.map((c) => (
            <Card key={c.n} kind={c.status === "met" ? "money" : "default"} className="px-4 py-3">
              <div className="flex items-start gap-3 text-[13px]">
                <span className="font-mono text-ink-3">{c.n}.</span>
                <div className="flex-1">
                  <div className="font-medium text-ink">{c.title}</div>
                  {c.evidence.length > 0 && <ul className="mt-1 list-disc pl-5 text-[12px] text-ink-3">{c.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                  {c.gaps.length > 0 && <ul className="mt-1 list-disc pl-5 text-[12px] text-flag">{c.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}
                </div>
                {chip(c.status)}
              </div>
            </Card>
          ))}
        </section>

        <section className="mb-8">
          <Eyebrow>Invoices sent and unpaid ({inv.invoices.outstanding.length}) · all invoices {Object.entries(inv.invoices.by_status).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}</Eyebrow>
          {inv.invoices.outstanding.length === 0 ? (
            <Card kind="soft" className="mt-2 px-4 py-3 text-[13px] text-ink-3">No open invoices. Nothing to finish or migrate.</Card>
          ) : (
            <table className="mt-2 w-full border-collapse text-[13px]">
              <thead><tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3"><th className="py-2 pr-3">Invoice</th><th className="py-2 pr-3">Job</th><th className="py-2 pr-3">Milestone</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Sent</th><th className="py-2 pr-3">Delivery</th></tr></thead>
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
            </table>
          )}
        </section>

        <section className="mb-8 grid gap-3 md:grid-cols-2">
          <Card kind="soft" className="px-4 py-3 text-[13px]">
            <Eyebrow>Imported Houzz history (kept as evidence)</Eyebrow>
            <div className="mt-1 text-ink-3">{inv.imported_history.houzz_expenses} payment records · {money(inv.imported_history.houzz_expense_cents)} · {inv.imported_history.houzz_lead_imports} lead imports · {inv.imported_history.retainers_recorded} retainers</div>
          </Card>
          <Card kind="soft" className="px-4 py-3 text-[13px]">
            <Eyebrow>Designer</Eyebrow>
            <div className="mt-1 text-ink-3">{inv.designer.designs} designs · {inv.designer.versions} versions · {inv.designer.pinned_versions} pinned for estimates · {inv.designer.exports} exported files</div>
          </Card>
        </section>

        <section className="mb-8">
          <Eyebrow>Who sends what</Eyebrow>
          <ul className="mt-2 text-[13px]">{inv.active_senders.map((s, i) => <li key={i} className="border-b border-rule/60 py-2"><span className="font-medium">{s.owner}</span> — {s.what} · <span className="text-ink-3">{s.state}</span></li>)}</ul>
        </section>

        <section>
          <Eyebrow>Code that still references Houzz</Eyebrow>
          <ul className="mt-2 list-disc pl-5 text-[12px] text-ink-3">{inv.code_references.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="mt-3 text-[12px] text-ink-3">Export the same inventory from the shell: <code>node scripts/houzz-export-inventory.mjs</code> (read-only).</p>
        </section>
      </div>
    </Shell>
  );
}
