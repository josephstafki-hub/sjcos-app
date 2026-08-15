import { Card, Chip, Eyebrow } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { getProject } from "@/lib/projects";
import { getProjectMoney, usd } from "@/lib/money";

// Client-portal money: contract standing plus every sent/paid invoice with its
// line items. Drafts never show. Payment itself stays offline (check/transfer
// to Joe) — this is the ledger the client can trust.
export default async function PortalMoneyPage() {
  const slug = await portalSlug();
  const [project, money] = slug
    ? await Promise.all([getProject(slug), getProjectMoney(slug)])
    : [null, null];

  // Contract value string carries a trailing " contract" — strip it for the row.
  const contractOnly = project?.contractValue?.replace(/\s*contract$/i, "").trim();
  const invoices = (money?.invoices ?? []).filter((i) => i.status !== "draft");
  const hasMoney = invoices.length > 0;

  const rows = hasMoney
    ? [
        ...(contractOnly ? [{ label: "Contract", value: contractOnly, good: false }] : []),
        { label: "Paid to date", value: usd(money!.paidTotal), good: money!.paidTotal > 0 },
        { label: "Outstanding", value: usd(money!.outstanding), good: false },
      ]
    : contractOnly
      ? [{ label: "Contract", value: contractOnly, good: false }]
      : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-9 py-7">
      <Eyebrow>Money</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        Where the money stands.
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Every invoice on the project, what&apos;s been paid, and what&apos;s open. Questions
        about a line? Ask in Messages before you pay — no surprises is the whole point.
      </p>
      <div className="my-5 border-t border-rule" />

      {rows.length > 0 ? (
        <Card kind="accent" className="p-3">
          <div className="flex flex-col gap-1.5">
            {rows.map((m) => (
              <div key={m.label} className="flex items-center">
                <span className="flex-1 text-[12.5px] text-ink-2">{m.label}</span>
                <span className={`font-mono text-[12px] ${m.good ? "text-money" : "text-ink-2"}`}>
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <p className="text-[13.5px] leading-relaxed text-ink-3">
          Nothing billed yet. Invoices will appear here as milestones are reached.
        </p>
      )}

      {invoices.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
            Invoices
          </span>
          {invoices.map((inv) => (
            <Card key={inv.id} className="p-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-ink-3">{inv.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{inv.milestone}</span>
                <span className="font-mono text-[12px] font-semibold text-ink-2">
                  {usd(inv.amount)}
                </span>
                <Chip kind={inv.status === "paid" ? "money" : "accent"} dot>
                  {inv.status === "paid" ? "paid" : "due"}
                </Chip>
              </div>
              {inv.lines.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5 border-t border-rule-soft pt-1.5">
                  {inv.lines.map((l, k) => (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-ink-3">{l.label}</span>
                      <span className="font-mono text-ink-3">{usd(l.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1 font-mono text-[10px] text-ink-3">{inv.statusLabel}</div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
