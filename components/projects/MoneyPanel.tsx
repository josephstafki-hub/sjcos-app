"use client";

import { useState, useTransition } from "react";
import { Plus, X, DollarSign } from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type { ProjectMoney, InvoiceStatus } from "@/lib/money";
import {
  createInvoice,
  sendInvoice,
  markInvoicePaid,
  collectRetainer,
  applyRetainer,
} from "@/lib/actions/money";

// Local dollar formatter — NOT imported from lib/money (that module imports pg,
// which must never reach the client bundle). See pg-in-client-bundle gotcha.
const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const STATUS_CHIP: Record<InvoiceStatus, ChipKind> = {
  draft: "ghost",
  sent: "accent",
  paid: "money",
};

/** Project Money tab — invoice list (send / mark paid), retainer ledger
 *  (collect / apply), and a New-invoice modal (Qwen drafts the line items). */
export function MoneyPanel({ slug, money }: { slug: string; money: ProjectMoney }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
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
              <div
                key={inv.id}
                className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}
              >
                <span className="w-[64px] flex-none font-mono text-[11px] text-ink-3">{inv.number}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{inv.milestone}</div>
                  <div className="font-mono text-[10px] text-ink-3">{inv.statusLabel}</div>
                </div>
                <span className="font-mono text-[12px] text-ink-2">{fmt(inv.amount)}</span>
                <Chip kind={STATUS_CHIP[inv.status]} dot>
                  {inv.status}
                </Chip>
                <div className="w-[88px] text-right">
                  {inv.status === "draft" && (
                    <button
                      disabled={pending}
                      onClick={() => run(() => sendInvoice(inv.id))}
                      className="rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50"
                    >
                      Send
                    </button>
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

        <RetainerForm
          label="Collect"
          disabled={pending}
          onSubmit={(amt) => run(() => collectRetainer(slug, amt))}
        />
        <RetainerForm
          label="Apply"
          disabled={pending}
          onSubmit={(amt) => run(() => applyRetainer(slug, amt))}
        />
      </Card>

      {modal && (
        <NewInvoiceModal
          pending={pending}
          onClose={() => setModal(false)}
          onCreate={(milestone, notes) =>
            startTransition(async () => {
              setError("");
              const res = await createInvoice(slug, { milestone, notes });
              if (res.ok) setModal(false);
              else setError(res.error ?? "Could not create the invoice.");
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
        const amt = Number(v.replace(/[^\d.]/g, ""));
        if (amt > 0) {
          onSubmit(amt);
          setV("");
        }
      }}
    >
      <span className="w-[52px] flex-none font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
        {label}
      </span>
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

function NewInvoiceModal({
  pending,
  onClose,
  onCreate,
}: {
  pending: boolean;
  onClose: () => void;
  onCreate: (milestone: string, notes: string) => void;
}) {
  const [milestone, setMilestone] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">New invoice</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Milestone / draw</span>
            <input
              value={milestone}
              onChange={(e) => setMilestone(e.target.value)}
              autoFocus
              placeholder="Tile substrate sign-off"
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Notes for the draft (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What this draw covers — Qwen drafts the line items."
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
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
              onClick={() => onCreate(milestone, notes)}
              className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
            >
              Draft invoice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
