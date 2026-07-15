"use client";

import { useState, useTransition } from "react";
import { Plus, X, DollarSign, Pencil, Trash2, Sparkles } from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type { ProjectMoney, InvoiceStatus, Invoice, InvoiceLine } from "@/lib/money";
import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  sendInvoice,
  markInvoicePaid,
  collectRetainer,
  applyRetainer,
} from "@/lib/actions/money";
import { generateDemandLetter, generateLienPackage } from "@/lib/actions/collections";
// Money helpers from the db-free cost-book-units module (safe in the client
// bundle — NOT lib/money, which imports pg). Amounts are CENTS everywhere; the
// edit/retainer forms convert typed dollars → cents before calling the actions.
import { fmtUsd, dollarsToCents, centsToInput } from "@/lib/cost-book-units";

const fmt = (cents: number) => fmtUsd(cents);

const STATUS_CHIP: Record<InvoiceStatus, ChipKind> = {
  draft: "ghost",
  sent: "accent",
  paid: "money",
};

type Result = { ok: boolean; error?: string };

/** Project Money tab — invoice list (edit draft / send / mark paid / delete
 *  draft), retainer ledger (collect / apply), and a New-invoice modal (Qwen
 *  drafts the line items, or start blank and fill them in). */
export function MoneyPanel({ slug, money }: { slug: string; money: ProjectMoney }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);

  function run(fn: () => Promise<Result>) {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  const r = money.retainer;

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_300px]">
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

        {error && <div className="text-[12px] text-flag">{error}</div>}

        {money.invoices.length === 0 ? (
          <Card kind="dashed" className="p-8 text-center">
            <div className="text-[13px] text-ink-3">No invoices yet. Create one to draft line items.</div>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            {money.invoices.map((inv, i) => (
              <div key={inv.id} className={i ? "border-t border-rule-soft" : ""}>
                <div className="flex items-center gap-3 px-4 pt-3">
                  <span className="w-[64px] flex-none font-mono text-[11px] text-ink-3">{inv.number}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink">{inv.milestone}</div>
                    <div className="font-mono text-[10px] text-ink-3">{inv.statusLabel}</div>
                  </div>
                  <span className="font-mono text-[12px] text-ink-2">{fmt(inv.amount)}</span>
                  <Chip kind={STATUS_CHIP[inv.status]} dot>
                    {inv.status}
                  </Chip>
                  <div className="flex w-[130px] items-center justify-end gap-1.5">
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
                    {inv.status === "sent" && (
                      <button
                        disabled={pending}
                        onClick={() => run(() => markInvoicePaid(inv.id))}
                        className="rounded-md border border-money/40 bg-money/10 px-2 py-1 text-[11px] font-semibold text-money hover:bg-money/20 disabled:opacity-50"
                      >
                        Mark paid
                      </button>
                    )}
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
                {/* Collections — overdue sent invoices (P4-7) */}
                {inv.status === "sent" && inv.daysOverdue !== null && inv.daysOverdue >= 15 && (
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

      {/* Retainer ledger */}
      <Card className="h-fit p-3.5">
        <Eyebrow muted>Retainer</Eyebrow>
        <div className="mt-2 flex flex-col gap-1.5">
          <Row label="Collected" value={fmt(r.collected)} valueClass="text-money" />
          <Row label="Applied" value={fmt(r.applied)} />
          <div className="mt-0.5 flex items-center border-t border-rule-soft pt-1.5">
            <span className="flex-1 text-[12px] font-semibold text-ink">Balance</span>
            <span className="font-mono text-[13px] font-semibold text-accent-2">{fmt(r.balance)}</span>
          </div>
        </div>

        <RetainerForm label="Collect" disabled={pending} onSubmit={(amt) => run(() => collectRetainer(slug, amt))} />
        <RetainerForm label="Apply" disabled={pending} onSubmit={(amt) => run(() => applyRetainer(slug, amt))} />
      </Card>

      {modal && (
        <NewInvoiceModal
          pending={pending}
          onClose={() => setModal(false)}
          onCreate={(milestone, notes, mode) =>
            startTransition(async () => {
              setError("");
              const res = await createInvoice(slug, { milestone, notes, mode });
              if (res.ok) setModal(false);
              else setError(res.error ?? "Could not create the invoice.");
            })
          }
        />
      )}

      {editing && (
        <EditInvoiceModal
          invoice={editing}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(milestone, lines) =>
            startTransition(async () => {
              setError("");
              const res = await updateInvoice(editing.id, { milestone, lines });
              if (res.ok) setEditing(null);
              else setError(res.error ?? "Could not save the invoice.");
            })
          }
        />
      )}
    </div>
  );
}

function Row({ label, value, valueClass = "text-ink-2" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center">
      <span className="flex-1 text-[12px] text-ink-2">{label}</span>
      <span className={`font-mono text-[12px] ${valueClass}`}>{value}</span>
    </div>
  );
}

function RetainerForm({
  label,
  disabled,
  onSubmit,
}: {
  label: string;
  disabled: boolean;
  onSubmit: (amount: number) => void;
}) {
  const [v, setV] = useState("");
  return (
    <form
      className="mt-2 flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const amt = dollarsToCents(v); // typed dollars → cents
        if (amt > 0) {
          onSubmit(amt);
          setV("");
        }
      }}
    >
      <span className="w-[52px] flex-none font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="$0"
        inputMode="numeric"
        className="w-[84px] rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
      >
        Go
      </button>
    </form>
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
