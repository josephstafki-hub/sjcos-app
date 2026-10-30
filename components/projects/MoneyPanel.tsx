"use client";

import { useState, useTransition } from "react";
import { Plus, X, DollarSign, Pencil, Trash2, Sparkles, FileText } from "lucide-react";
import { runAction } from "@/lib/run-action";
import { Card, Chip, Eyebrow } from "@/components/ui";
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

/** Project Money tab — invoice list (edit draft / send / mark paid / delete
 *  draft), a paid/outstanding totals rail, and a New-invoice modal (Qwen
 *  drafts the line items, or start blank and fill them in). */
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

  // minmax(0,1fr), not 1fr: a raw 1fr track's minimum is its content's min-content
  // width, so one long nowrap invoice line blows the whole column past the viewport.
  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Invoices */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center">
          <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">Invoices</h3>
          <button
            onClick={() => setModal(true)}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
          >
            <Plus className="size-3" strokeWidth={1.5} />
            New invoice
          </button>
        </div>

        {money.invoices.length === 0 ? (
          <Card kind="dashed" className="p-8 text-center">
            <div className="text-[13px] text-ink-3">No invoices yet. Create one to draft line items.</div>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            {money.invoices.map((inv, i) => (
              <div key={inv.id} className={i ? "border-t border-rule-soft" : ""}>
                {/* Wrapping row: when the column is narrow (phone, operator panel
                    open) the amount/status/actions group drops to its own line
                    instead of colliding with the milestone or clipping. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3">
                  <span className="w-[64px] flex-none font-mono text-[11px] text-ink-3">{inv.number}</span>
                  <div className="min-w-0 flex-1 basis-[140px]">
                    <div className="truncate text-[13px] text-ink">{inv.milestone}</div>
                    <div className="font-mono text-[10px] text-ink-3">{inv.statusLabel}</div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
                    <span className="font-mono text-[12px] text-ink-2">{fmt(inv.amount)}</span>
                    {unsent(inv) ? (
                      <Chip kind="flag" dot>
                        not sent
                      </Chip>
                    ) : (
                      <Chip kind={STATUS_CHIP[inv.status]} dot>
                        {inv.status}
                      </Chip>
                    )}
                    <div className="flex items-center justify-end gap-1.5">
                      {inv.lines.length > 0 && (
                        <a
                          href={`/api/projects/${slug}/invoices/${inv.id}/preview`}
                          target="_blank"
                          rel="noreferrer"
                          title="Preview PDF — what the client receives"
                          className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
                        >
                          <FileText className="size-3" strokeWidth={1.75} />
                        </a>
                      )}
                      {inv.status === "draft" && (
                        <>
                          <button
                            onClick={() => setEditing(inv)}
                            title="Edit line items"
                            className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
                          >
                            <Pencil className="size-3" strokeWidth={1.75} />
                          </button>
                          <button
                            disabled={pending}
                            onClick={() => run(() => deleteInvoice(inv.id))}
                            title="Delete draft"
                            className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
                          >
                            <Trash2 className="size-3" strokeWidth={1.75} />
                          </button>
                          <button
                            disabled={pending}
                            onClick={() => run(() => sendInvoice(inv.id))}
                            className="rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50"
                          >
                            Send
                          </button>
                        </>
                      )}
                      {unsent(inv) && (
                        <button
                          disabled={pending}
                          onClick={() => run(() => sendInvoice(inv.id))}
                          title={inv.deliveryError ?? "Issued but never emailed to the client"}
                          className="rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50"
                        >
                          {inv.deliveryState === "failed" ? "Resend" : "Send"}
                        </button>
                      )}
                      {/* Drafts too: a deposit paid by check before the invoice
                          was ever emailed (or a job with no client email on
                          file) still needs to land as paid. */}
                      {(inv.status === "sent" || inv.status === "draft") && (
                        <button
                          disabled={pending}
                          onClick={() => setRecording(inv)}
                          className="rounded-md border border-money/40 bg-money/10 px-2 py-1 text-[11px] font-semibold text-money hover:bg-money/20 disabled:opacity-50"
                        >
                          Record payment
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {/* read-only line breakdown */}
                {inv.lines.length > 0 && (
                  <div className="flex flex-col gap-0.5 px-4 pb-1.5 pl-[80px] pt-1.5">
                    {inv.lines.map((l, k) => (
                      <div key={k} className="flex items-center gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-ink-3">{l.label}</span>
                        <span className="font-mono text-ink-3">{fmt(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(inv.manualPayments ?? []).length > 0 && (
                  <div className="space-y-1 px-4 py-2">
                    {(inv.manualPayments ?? []).map(payment => (
                      <div key={payment.id} className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                        <span>{payment.receivedAt} · {payment.method} · {fmt(payment.amount)}{payment.reversed ? " · Undone" : " received"}</span>
                        {payment.note && <span>{payment.note}</span>}
                        {!payment.reversed && <button disabled={pending} onClick={() => setUndoing({ invoice: inv, payment })}
                          className="rounded border border-rule px-2 py-1 text-ink hover:bg-paper-2 disabled:opacity-50">Undo payment</button>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Collections — overdue sent invoices with money owed and nothing in flight (P4-7) */}
                {inv.status === "sent" && !unsent(inv) && inv.pending === 0 && inv.balance > 0 && inv.daysOverdue !== null && inv.daysOverdue >= 15 && (
                  <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-[80px] pt-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-flag">
                      {inv.daysOverdue}d overdue
                    </span>
                    <button
                      disabled={pending}
                      onClick={() => run(() => generateDemandLetter(inv.id, true))}
                      className="rounded-md border border-flag/40 bg-flag/10 px-2 py-0.5 text-[11px] font-semibold text-flag hover:bg-flag/20 disabled:opacity-50"
                    >
                      Demand letter
                    </button>
                    {inv.daysOverdue >= 30 && (
                      <button
                        disabled={pending}
                        onClick={() => run(() => generateLienPackage(inv.id))}
                        className="rounded-md border border-flag/40 bg-flag/10 px-2 py-0.5 text-[11px] font-semibold text-flag hover:bg-flag/20 disabled:opacity-50"
                      >
                        Lien package (draft)
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* Billed totals — derived from the invoices themselves (P1-B7 retired the
          retainer ledger; SJC bills fixed-price draws, not against a balance). */}
      <Card className="h-fit p-3.5">
        <Eyebrow muted>Billed</Eyebrow>
        <div className="mt-2 flex flex-col gap-1.5">
          <Row label="Paid" value={fmt(money.paidTotal)} valueClass="text-money" />
          <Row label="Outstanding" value={fmt(money.outstanding)} />
          <div className="mt-0.5 flex items-center border-t border-rule-soft pt-1.5">
            <span className="flex-1 text-[12px] font-semibold text-ink">Billed to date</span>
            <span className="font-mono text-[13px] font-semibold text-accent-2">
              {fmt(money.paidTotal + money.outstanding)}
            </span>
          </div>
        </div>
      </Card>

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
      <p className="text-[12px] text-ink-2">{fmt(open)} open. Enter the amount actually received; partial payments leave the rest open.</p>
      {invoice.lifecycle === "draft" && <p className="text-[12px] text-ink-3">This records a payment received outside the app and issues this draft invoice. Nothing is emailed.</p>}
      <label className="flex flex-col gap-1"><span className={LABEL}>Amount received ($)</span><input className={FIELD} type="number" step="0.01" min="0.01" max={open / 100} value={amount} onChange={e => setAmount(e.target.value)} required autoFocus /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Date received</span><input className={FIELD} type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Method</span><select className={FIELD} value={method} onChange={e => setMethod(e.target.value)}><option value="check">Check</option><option value="cash">Cash</option><option value="ach">Bank transfer</option><option value="card">Card received outside the app</option><option value="manual">Other</option></select></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Reference / note</span><input className={FIELD} value={note} onChange={e => setNote(e.target.value)} placeholder="Check number or payment reference" /></label>
      <div className="flex justify-end gap-2"><button type="button" className={FIELD} onClick={onClose}>Cancel</button><button disabled={pending || invoice.pending > 0} className="rounded-md bg-ink px-3 py-1.5 text-[12px] text-paper disabled:opacity-50">{pending ? "Recording…" : "Record payment"}</button></div>
      {invoice.pending > 0 && <p role="status" className="text-[12px] text-flag">An online payment is in flight. Wait for it to settle before recording another.</p>}
    </form>
  </ModalShell>;
}

function UndoPaymentModal({ payment, pending, onClose, onUndo }: { payment: ManualPaymentView; pending: boolean; onClose: () => void; onUndo: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <ModalShell title="Undo manual payment" onClose={onClose}>
    <form className="flex flex-col gap-3 p-4" onSubmit={e => { e.preventDefault(); onUndo(reason); }}>
      <p className="text-[12px] text-ink-2">Undo the {fmt(payment.amount)} {payment.method} entry from {payment.receivedAt}. The original stays in the history, and the invoice balance reopens. This corrects the record; no money is transferred.</p>
      <label className="flex flex-col gap-1"><span className={LABEL}>Reason</span><input autoFocus required minLength={3} value={reason} onChange={e => setReason(e.target.value)} className={FIELD} /></label>
      <div className="flex justify-end gap-2"><button type="button" className={FIELD} onClick={onClose}>Cancel</button><button disabled={pending || reason.trim().length < 3} className="rounded-md bg-ink px-3 py-1.5 text-[12px] text-paper disabled:opacity-50">{pending ? "Undoing…" : "Undo payment"}</button></div>
    </form>
  </ModalShell>;
}

function Row({ label, value, valueClass = "text-ink-2" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center">
      <span className="flex-1 text-[12px] text-ink-2">{label}</span>
      <span className={`font-mono text-[12px] ${valueClass}`}>{value}</span>
    </div>
  );
}

const FIELD = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">{title}</h2>
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
            <span className="mr-auto inline-flex items-center gap-1 text-[11px] text-ai-2">
              <DollarSign className="size-3 animate-pulse" strokeWidth={1.75} />
              Drafting line items…
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onCreate(milestone, notes, "blank")}
            className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
          >
            Start blank
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onCreate(milestone, notes, "ai")}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
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
            className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2"
          >
            <Plus className="size-3" strokeWidth={1.75} />
            Add line
          </button>
        </div>

        <div className="flex items-center border-t border-rule-soft pt-2">
          <span className="flex-1 text-[12px] font-semibold text-ink">Total</span>
          <span className="font-mono text-[14px] font-semibold text-accent-2">{fmt(total)}</span>
        </div>

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
