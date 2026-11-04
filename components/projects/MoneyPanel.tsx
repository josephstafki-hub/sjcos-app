"use client";

import { ActionMenu } from "./ActionMenu";

import { Fragment, useState, useTransition } from "react";
import { Plus, X, DollarSign, Pencil, Sparkles, FileText } from "lucide-react";
import { runAction } from "@/lib/run-action";
import { Button, Chip, EmptyState, Table, TableWrapper, TableHead, TableBody, TableHeader, TableRow, TableCell, TablePrimaryCell } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type { ProjectMoney, InvoiceStatus, Invoice, InvoiceLine, ManualPaymentView } from "@/lib/money";
import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  sendInvoice,
  recordManualPayment,
  reverseManualPayment,
} from "@/lib/actions/money";
import { generateDemandLetter, generateLienPackage } from "@/lib/actions/collections";
// Money helpers from the db-free cost-book-units module (safe in the client
// bundle — NOT lib/money, which imports pg). Amounts are CENTS everywhere; the
// edit form converts typed dollars → cents before calling the actions.
import { fmtUsd, dollarsToCents, centsToInput } from "@/lib/cost-book-units";

const fmt = (cents: number) => fmtUsd(cents);

/** Issued but never emailed: the send failed, or it was issued with no send
 *  (a billing command with no email on file). The "sent" bucket would hide it. */
function unsent(inv: Invoice): boolean {
  return inv.lifecycle === "issued" && (inv.deliveryState === "none" || inv.deliveryState === "failed");
}

const STATUS_CHIP: Record<InvoiceStatus, ChipKind> = {
  draft: "ghost",
  sent: "accent",
  paid: "money",
};

type Result = { ok: boolean; error?: string };

/** Invoice ledger with draft editing, partial payments and payment history.
 *  The same controls are available in table and narrow stacked layouts. */
export function MoneyPanel({ slug, money }: { slug: string; money: ProjectMoney }) {
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [recording, setRecording] = useState<Invoice | null>(null);
  const [undoing, setUndoing] = useState<{ invoice: Invoice; payment: ManualPaymentView } | null>(null);

  // runAction raises the site-wide toast on failure; a modal stays open on
  // failure so the typed-in values survive.
  function run(fn: () => Promise<Result>, fallback?: string, onSuccess?: () => void) {
    startTransition(async () => {
      const r = await runAction(fn, { fallback });
      if (r.ok) onSuccess?.();
    });
  }

  const invoiceActions = (inv: Invoice) => (
    <div className="flex flex-wrap justify-end gap-1">
              {inv.lines.length > 0 && <Button variant="ghost" icon={FileText} iconOnly aria-label={`Preview ${inv.number}`} title="Preview PDF — what the client receives" href={`/api/projects/${slug}/invoices/${inv.id}/preview`} target="_blank" rel="noreferrer" />}
              {inv.status === "draft" && <Button variant="ghost" icon={Pencil} iconOnly aria-label={`Edit ${inv.number}`} title="Edit line items" onClick={() => setEditing(inv)} />}
              {(inv.status === "draft" || unsent(inv)) && <Button size="sm" variant="secondary" disabled={pending} title={inv.deliveryError ?? undefined} onClick={() => run(() => sendInvoice(inv.id))}>{inv.deliveryState === "failed" ? "Resend" : "Send"}</Button>}
              {(inv.status === "sent" || inv.status === "draft") && <Button size="sm" variant="secondary" disabled={pending} onClick={() => setRecording(inv)}>Record payment</Button>}
              {inv.status === "draft" && <ActionMenu label={`More actions for ${inv.number}`}><Button variant="ghost" className="text-flag" disabled={pending} onClick={() => run(() => deleteInvoice(inv.id))}>Delete draft</Button></ActionMenu>}
            </div>
  );
  const invoiceDetails = (inv: Invoice) => (
    <details className="py-2"><summary className="cursor-pointer text-meta text-ink-3">Line items & payments</summary><div className="space-y-2 py-3">
            {inv.lines.map((line,i) => <div key={i} className="flex justify-between gap-4 text-meta"><span className="text-ink-2">{line.label}</span><span className="tabular-nums">{fmt(line.amount)}</span></div>)}
            {(inv.manualPayments ?? []).map(payment => <div key={payment.id} className="flex flex-wrap items-center gap-2 border-t border-rule-soft pt-2 text-meta text-ink-3"><span>{payment.receivedAt} · {payment.method} · {fmt(payment.amount)}{payment.reversed ? " · Undone" : " received"}</span>{payment.note && <span>{payment.note}</span>}{!payment.reversed && <Button size="sm" variant="ghost" disabled={pending} onClick={() => setUndoing({invoice:inv,payment})}>Undo payment</Button>}</div>)}
          </div></details>
  );

  return (
    <div className="space-y-4 max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-serif text-heading font-semibold text-ink">Invoices</h3><p className="mt-1 text-meta text-ink-3">{fmt(money.paidTotal)} paid on invoices · {fmt(money.outstanding)} outstanding{money.pendingTotal > 0 ? ` · ${fmt(money.pendingTotal)} in flight` : ""}</p></div>
        <Button icon={Plus} onClick={() => setModal(true)}>New invoice</Button>
      </div>
      {money.invoices.length === 0 ? <EmptyState icon={FileText} title="No invoices yet" description="Create an invoice to bill a milestone and track its payments here." /> : (
        <>
        <div className="divide-y divide-rule-soft rounded-lg border border-rule-soft bg-card @xl/page:hidden">
          {money.invoices.map(inv => <div key={inv.id} className="space-y-3 p-3">
            <div className="text-subheading font-semibold text-ink">{inv.milestone}</div>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-mono text-meta text-ink-3">{inv.number}</span><span className="ml-2"><Chip kind={unsent(inv) ? "flag" : STATUS_CHIP[inv.status]}>{unsent(inv) ? "Not sent" : inv.status[0].toUpperCase() + inv.status.slice(1)}</Chip></span></div><span className="text-body font-semibold tabular-nums">{fmt(inv.amount)}</span></div>
            {inv.balance > 0 && inv.balance !== inv.amount && <div className="text-right text-meta text-ink-3">{fmt(inv.balance)} open</div>}
            <div className="text-meta text-ink-3">{inv.statusLabel}</div>
            {invoiceActions(inv)}
            {(inv.lines.length > 0 || (inv.manualPayments ?? []).length > 0) && invoiceDetails(inv)}
            {inv.status === "sent" && !unsent(inv) && inv.pending === 0 && inv.balance > 0 && inv.daysOverdue !== null && inv.daysOverdue >= 15 && <div className="flex flex-wrap items-center gap-2"><span className="text-meta text-flag">{inv.daysOverdue} days overdue</span><Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => generateDemandLetter(inv.id,true))}>Demand letter</Button>{inv.daysOverdue >= 30 && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => generateLienPackage(inv.id))}>Lien package</Button>}</div>}
          </div>)}
          <div className="flex items-center justify-between gap-3 p-3 text-body font-semibold"><span>Invoice total</span><span className="tabular-nums">{fmt(money.invoices.reduce((sum,inv) => sum + inv.amount,0))}</span></div>
        </div>
        <TableWrapper className="@max-xl/page:hidden"><Table density="compact">
          <TableHead><TableRow><TableHeader>Invoice</TableHeader><TableHeader numeric>Amount</TableHeader><TableHeader><span className="sr-only">Actions</span></TableHeader></TableRow></TableHead>
          <TableBody>{money.invoices.map(inv => <Fragment key={inv.id}><TableRow>
            <TablePrimaryCell meta={<><span className="font-mono">{inv.number}</span> · {inv.statusLabel}</>}>{inv.milestone}<span className="mt-1 block"><Chip kind={unsent(inv) ? "flag" : STATUS_CHIP[inv.status]}>{unsent(inv) ? "Not sent" : inv.status[0].toUpperCase() + inv.status.slice(1)}</Chip></span></TablePrimaryCell>
            <TableCell numeric className="whitespace-nowrap">{fmt(inv.amount)}{inv.balance > 0 && inv.balance !== inv.amount && <div className="text-meta text-ink-3">{fmt(inv.balance)} open</div>}</TableCell>
            <TableCell>{invoiceActions(inv)}</TableCell>
          </TableRow>
          {(inv.lines.length > 0 || (inv.manualPayments ?? []).length > 0) && <TableRow><TableCell colSpan={3} className="!py-0">{invoiceDetails(inv)}</TableCell></TableRow>}
          {inv.status === "sent" && !unsent(inv) && inv.pending === 0 && inv.balance > 0 && inv.daysOverdue !== null && inv.daysOverdue >= 15 && <TableRow><TableCell colSpan={3}><div className="flex flex-wrap items-center gap-2"><span className="text-meta text-flag">{inv.daysOverdue} days overdue</span><Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => generateDemandLetter(inv.id,true))}>Demand letter</Button>{inv.daysOverdue >= 30 && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => generateLienPackage(inv.id))}>Lien package</Button>}</div></TableCell></TableRow>}
          </Fragment>)}</TableBody>
          <tfoot><TableRow><TableCell className="font-semibold">Invoice total</TableCell><TableCell numeric className="font-semibold">{fmt(money.invoices.reduce((sum,inv) => sum + inv.amount,0))}</TableCell><TableCell /></TableRow></tfoot>
        </Table></TableWrapper>
        </>
      )}

      {modal && (
        <NewInvoiceModal
          pending={pending}
          onClose={() => setModal(false)}
          onCreate={(milestone, notes, mode) =>
            run(() => createInvoice(slug, { milestone, notes, mode }), "Could not create the invoice.", () =>
              setModal(false),
            )
          }
        />
      )}

      {recording && <PaymentModal invoice={recording} pending={pending} onClose={() => setRecording(null)}
        onSave={input => run(() => recordManualPayment(recording.id, input), "Could not record the payment.", () => setRecording(null))} />}
      {undoing && <UndoPaymentModal payment={undoing.payment} pending={pending} onClose={() => setUndoing(null)}
        onUndo={reason => run(() => reverseManualPayment(undoing.invoice.id, undoing.payment.id, reason), "Could not undo the payment.", () => setUndoing(null))} />}

      {editing && (
        <EditInvoiceModal
          invoice={editing}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(milestone, lines) =>
            run(() => updateInvoice(editing.id, { milestone, lines }), "Could not save the invoice.", () =>
              setEditing(null),
            )
          }
        />
      )}
    </div>
  );
}

function PaymentModal({ invoice, pending, onClose, onSave }: {
  invoice: Invoice; pending: boolean; onClose: () => void;
  onSave: (input: { amountCents: number; method: string; receivedAt: string; note: string }) => void;
}) {
  const open = invoice.lifecycle === "draft" ? invoice.amount : invoice.balance;
  const [amount, setAmount] = useState(centsToInput(open));
  const [method, setMethod] = useState("check");
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [note, setNote] = useState("");
  return <ModalShell title={`Record payment · ${invoice.number}`} onClose={onClose}>
    <form className="flex flex-col gap-3 p-4" onSubmit={e => { e.preventDefault(); onSave({ amountCents: dollarsToCents(amount), method, receivedAt: date, note }); }}>
      <p className="text-label text-ink-2">{fmt(open)} open. Enter the amount actually received; partial payments leave the rest open.</p>
      {invoice.lifecycle === "draft" && <p className="text-label text-ink-3">This records a payment received outside the app and issues this draft invoice. Nothing is emailed.</p>}
      <label className="flex flex-col gap-1"><span className={LABEL}>Amount received ($)</span><input className={FIELD} type="number" step="0.01" min="0.01" max={open / 100} value={amount} onChange={e => setAmount(e.target.value)} required autoFocus /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Date received</span><input className={FIELD} type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Method</span><select className={FIELD} value={method} onChange={e => setMethod(e.target.value)}><option value="check">Check</option><option value="cash">Cash</option><option value="ach">Bank transfer</option><option value="card">Card received outside the app</option><option value="manual">Other</option></select></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Reference / note</span><input className={FIELD} value={note} onChange={e => setNote(e.target.value)} placeholder="Check number or payment reference" /></label>
      <div className="flex justify-end gap-2"><button type="button" className={FIELD} onClick={onClose}>Cancel</button><button disabled={pending || invoice.pending > 0} className="rounded-md bg-ink px-3 py-1.5 text-label text-paper disabled:opacity-50">{pending ? "Recording…" : "Record payment"}</button></div>
      {invoice.pending > 0 && <p role="status" className="text-label text-flag">An online payment is in flight. Wait for it to settle before recording another.</p>}
    </form>
  </ModalShell>;
}

function UndoPaymentModal({ payment, pending, onClose, onUndo }: { payment: ManualPaymentView; pending: boolean; onClose: () => void; onUndo: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <ModalShell title="Undo manual payment" onClose={onClose}>
    <form className="flex flex-col gap-3 p-4" onSubmit={e => { e.preventDefault(); onUndo(reason); }}>
      <p className="text-label text-ink-2">Undo the {fmt(payment.amount)} {payment.method} entry from {payment.receivedAt}. The original stays in the history, and the invoice balance reopens. This corrects the record; no money is transferred.</p>
      <label className="flex flex-col gap-1"><span className={LABEL}>Reason</span><input autoFocus required minLength={3} value={reason} onChange={e => setReason(e.target.value)} className={FIELD} /></label>
      <div className="flex justify-end gap-2"><button type="button" className={FIELD} onClick={onClose}>Cancel</button><button disabled={pending || reason.trim().length < 3} className="rounded-md bg-ink px-3 py-1.5 text-label text-paper disabled:opacity-50">{pending ? "Undoing…" : "Undo payment"}</button></div>
    </form>
  </ModalShell>;
}


const FIELD = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent";
const LABEL = "text-label font-medium text-ink-3";

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[10vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[85dvh] overflow-y-auto w-full max-w-[480px] rounded-lg border border-rule bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-heading font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewInvoiceModal({
  pending,
  onClose,
  onCreate,
}: {
  pending: boolean;
  onClose: () => void;
  onCreate: (milestone: string, notes: string, mode: "ai" | "blank") => void;
}) {
  const [milestone, setMilestone] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <ModalShell title="New invoice" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Milestone / draw</span>
          <input value={milestone} onChange={(e) => setMilestone(e.target.value)} autoFocus placeholder="Tile substrate sign-off" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Notes for the AI draft (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What this draw covers — AI drafts the line items."
            className={FIELD}
          />
        </label>
        <div className="mt-1 flex items-center justify-end gap-2">
          {pending && (
            <span className="mr-auto inline-flex items-center gap-1 text-meta text-ai-2">
              <DollarSign className="size-3 animate-pulse" strokeWidth={1.75} />
              Drafting line items…
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onCreate(milestone, notes, "blank")}
            className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
          >
            Start blank
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onCreate(milestone, notes, "ai")}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-50"
          >
            <Sparkles className="size-3" strokeWidth={1.75} />
            Draft with AI
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

interface EditLine {
  label: string;
  amount: string;
}

function EditInvoiceModal({
  invoice,
  pending,
  onClose,
  onSave,
}: {
  invoice: Invoice;
  pending: boolean;
  onClose: () => void;
  onSave: (milestone: string, lines: InvoiceLine[]) => void;
}) {
  const [milestone, setMilestone] = useState(invoice.milestone);
  const [lines, setLines] = useState<EditLine[]>(
    invoice.lines.length
      ? invoice.lines.map((l) => ({ label: l.label, amount: l.amount ? centsToInput(l.amount) : "" }))
      : [{ label: "", amount: "" }],
  );

  // Inputs hold typed dollars; the total (and the saved lines) are cents.
  const total = lines.reduce((s, l) => s + dollarsToCents(l.amount), 0);

  function setLine(i: number, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { label: "", amount: "" }]);
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : prev));
  }

  function save() {
    const cleaned: InvoiceLine[] = lines
      .map((l) => ({ label: l.label.trim(), amount: dollarsToCents(l.amount) }))
      .filter((l) => l.label !== "" || l.amount > 0);
    onSave(milestone, cleaned);
  }

  return (
    <ModalShell title={`Edit ${invoice.number}`} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Milestone / draw</span>
          <input value={milestone} onChange={(e) => setMilestone(e.target.value)} className={FIELD} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Line items</span>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={l.label}
                onChange={(e) => setLine(i, { label: e.target.value })}
                placeholder="Description"
                className={`min-w-0 flex-1 ${FIELD}`}
              />
              <input
                value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
                inputMode="numeric"
                placeholder="$0"
                className={`w-[92px] flex-none ${FIELD}`}
              />
              <button
                type="button"
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
                title="Remove line"
                className="rounded-md border border-rule p-1.5 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-40"
              >
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addLine}
            className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md border border-rule px-2 py-1 text-meta font-semibold text-ink-2 hover:bg-paper-2"
          >
            <Plus className="size-3" strokeWidth={1.75} />
            Add line
          </button>
        </div>

        <div className="flex items-center border-t border-rule-soft pt-2">
          <span className="flex-1 text-label font-semibold text-ink">Total</span>
          <span className="tabular-nums text-subheading font-semibold text-accent-2">{fmt(total)}</span>
        </div>

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
