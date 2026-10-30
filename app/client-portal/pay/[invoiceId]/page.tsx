import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, Eyebrow } from "@/components/ui";
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
    <main className="mx-auto w-full max-w-lg px-4 py-7">
      <Card className="p-5 sm:p-6">
        <p className="font-serif text-heading font-semibold">SJ Carpentry</p>
        <Eyebrow className="mt-4">{pending > 0 ? "Payment processing" : open <= 0 ? "Settled invoice" : "Invoice"}</Eyebrow>
        <h1 className="mt-1 font-serif text-heading font-medium leading-tight text-accent-2">
          {inv.number} · {inv.milestone}
        </h1>
        <p className="mt-1.5 text-body leading-relaxed text-ink-2">
          Invoice total {usd(inv.amount)}
          {inv.due_at ? ` · due ${inv.due_at}` : ""}. Questions about a line? Ask in{" "}
          <Link href="/client-portal/messages" className="underline">Messages</Link> before you pay.
        </p>
        <div className="my-5 border-t border-rule" />

        <div className="py-2">
          <div className="flex items-center">
            <span className="flex-1 text-body text-ink-2">Open balance</span>
            <span className="font-serif text-kpi tabular-nums text-ink">{usd(open)}</span>
          </div>
          {pending > 0 && (
            <div className="mt-1 text-label text-ink-3">
              A bank transfer of {usd(pending)} is still processing. The balance updates when it clears; no need to pay again.
            </div>
          )}
        </div>

        <div className="mt-4">
          {open <= 0 ? (
            <p className="text-body text-ink-3">Nothing is due on this invoice. Thank you.</p>
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
              surcharge={setup.surcharge}
            />
          ) : (
            <div className="border-t border-rule pt-4">
              <p className="mb-3 text-subheading font-semibold text-ink">Online payment isn’t available right now.</p>
              <div className="font-sans text-meta text-ink-3">How to pay</div>
              <p className="mt-1 whitespace-pre-line text-body leading-relaxed text-ink">{setup.instructions}</p>
              <Button href="/client-portal/messages" size="lg" className="mt-4 w-full">Message Joe about payment</Button>
            </div>
          )}
        </div>
        <p className="mt-4 text-meta text-ink-3">
          <Link href="/client-portal/money" className="inline-flex min-h-11 items-center underline">Back to Money</Link>
        </p>
      </Card>
    </main>
  );
}
