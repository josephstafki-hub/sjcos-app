import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Eyebrow } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { queryOne } from "@/lib/db";
import { usd } from "@/lib/money";
import { readInvoiceBalance } from "@/lib/billing/server";
import { portalPaymentSetup } from "@/lib/payments/server";
import { PayInvoice } from "@/components/money/PayInvoice";

// Client portal › Pay an invoice (A20). Shows the verified open balance and,
// when Square is connected, the card / bank-transfer checkout (tokenization
// happens in the browser; the server route charges the server-computed
// balance). Otherwise the owner's offline payment instructions.
export default async function PortalPayPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const id = Number(invoiceId);
  const slug = await portalSlug();
  if (!slug || !Number.isInteger(id)) notFound();
  const inv = await queryOne<{ id: number; number: string; milestone: string; amount: number; status: string; revision: number; due_at: string | null }>(
    `SELECT i.id::int AS id, i.number, i.milestone, i.amount, i.status, i.revision, i.due_at::text AS due_at
       FROM invoices i JOIN projects p ON p.id = i.project_id
      WHERE i.id = $1 AND p.slug = $2 AND i.status <> 'draft'`,
    [id, slug],
  );
  if (!inv) notFound();
  const [balance, setup] = await Promise.all([readInvoiceBalance(inv.id), portalPaymentSetup()]);
  const open = balance?.balanceCents ?? 0;
  const pending = balance?.pendingCents ?? 0;

  return (
    <main className="mx-auto w-full max-w-2xl px-9 py-7">
      <Eyebrow>Pay invoice</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        {inv.number} · {inv.milestone}
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Invoice total {usd(inv.amount)}
        {inv.due_at ? ` · due ${inv.due_at}` : ""}. Questions about a line? Ask in{" "}
        <Link href="/client-portal/messages" className="underline">Messages</Link> before you pay.
      </p>
      <div className="my-5 border-t border-rule" />

      <Card kind="accent" className="p-3">
        <div className="flex items-center">
          <span className="flex-1 text-[12.5px] text-ink-2">Open balance</span>
          <span className="font-mono text-[15px] font-semibold text-ink">{usd(open)}</span>
        </div>
        {pending > 0 && (
          <div className="mt-1 text-[11.5px] text-ink-3">
            A bank transfer of {usd(pending)} is still processing. The balance updates when it clears; no need to pay again.
          </div>
        )}
      </Card>

      <div className="mt-4">
        {open <= 0 ? (
          <p className="text-[13.5px] text-ink-3">Nothing is due on this invoice. Thank you.</p>
        ) : pending > 0 ? null : setup.online ? (
          <PayInvoice
            invoiceId={inv.id}
            revision={Number(inv.revision)}
            amountCents={open}
            applicationId={setup.applicationId}
            locationId={setup.locationId}
            environment={setup.environment}
            allowCard={setup.card}
            allowAch={setup.ach}
          />
        ) : (
          <Card className="p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">How to pay</div>
            <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink">{setup.instructions}</p>
          </Card>
        )}
      </div>
      <p className="mt-4 text-[11px] text-ink-3">
        <Link href="/client-portal/money" className="underline">Back to Money</Link>
      </p>
    </main>
  );
}
