"use client";

// The Money › Overview edit forms (plan §4.7). Each collects typed dollars,
// converts to integer cents, and hands a plain input object to its caller;
// the server validates everything again. A blank dollar box means "not set"
// wherever the model distinguishes that from $0.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { centsToInput, dollarsToCents, fmtUsd } from "@/lib/cost-book-units";
import { fmtK, proposeBillingReconciliation, type BudgetChangeOrder, type BudgetCostRow, type BudgetLine, type BudgetView } from "@/lib/budget-types";
import type { BudgetLineInput, BudgetSettingsInput, ChangeOrderCostsInput, CostTarget, ExpenseInput, ReconcileBillingInput } from "@/lib/budget-writes";
import { BTN, FIELD, FormField, LABEL, ModalFooter, ModalShell } from "./parts";

const blankable = (v: string): number | null => (v.trim() === "" ? null : dollarsToCents(v));
const show = (c: number | null | undefined) => (c == null ? "" : centsToInput(c));
const BODY = "flex flex-col gap-3 p-4";
const TWO = "grid grid-cols-1 gap-3 sm:grid-cols-2";

const KINDS: [BudgetLineInput["kind"], string][] = [["trade", "Trade"], ["allowance", "Allowance"], ["overhead", "Overhead & profit"], ["tax", "Tax / permits"], ["contingency", "Contingency"], ["other", "Other"]];
const STATUS_KINDS: [string, string][] = [["ghost", "Not started"], ["accent", "In progress"], ["money", "Complete / under"], ["flag", "Over / blocked"], ["info", "Moved / note"]];

export function LineModal({ line, pending, onClose, onSave, onDelete }: {
  line: BudgetLine | null; pending: boolean; onClose: () => void; onSave: (input: BudgetLineInput) => void; onDelete: (id: number) => void;
}) {
  const [trade, setTrade] = useState(line?.trade ?? "");
  const [kind, setKind] = useState<BudgetLineInput["kind"]>(line?.kind ?? "trade");
  const [budget, setBudget] = useState(show(line?.budgetCents ?? null));
  const [price, setPrice] = useState(show(line?.priceCents));
  const [est, setEst] = useState(show(line?.estToFinishCents));
  const [pct, setPct] = useState(line?.percentComplete == null ? "" : String(line.percentComplete));
  const [status, setStatus] = useState(line?.status ?? "");
  const [statusKind, setStatusKind] = useState<string>(line?.statusKind ?? "ghost");
  const [detail, setDetail] = useState(line?.detail ?? "");
  const save = () => onSave({
    id: line?.rowId, trade, kind, budgetCents: dollarsToCents(budget), priceCents: blankable(price), estToFinishCents: blankable(est),
    percentComplete: pct.trim() === "" ? null : Math.round(Number(pct)), status, statusKind, detail,
  });
  return (
    <ModalShell title={line ? `Edit ${line.trade}` : "Add a budget line"} onClose={onClose}>
      <div className={BODY}>
        <div className={TWO}>
          <FormField label="Trade"><input autoFocus value={trade} onChange={(e) => setTrade(e.target.value)} className={FIELD} placeholder="Cabinets" /></FormField>
          <FormField label="Kind"><select value={kind} onChange={(e) => setKind(e.target.value as BudgetLineInput["kind"])} className={FIELD}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
        </div>
        <div className={TWO}>
          <FormField label="Budget — what it should cost" hint="What you plan to pay for this trade. $0 is fine for work nobody budgeted."><input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className={FIELD} placeholder="0.00" /></FormField>
          <FormField label="Price — what the client pays" hint="Leave blank if you don't price by trade."><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={FIELD} placeholder="" /></FormField>
        </div>
        <div className={TWO}>
          <FormField label="Still to spend" hint="Blank = work it out (budget less what's spent, owed and on order). 0 = nothing left."><input inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value)} className={FIELD} placeholder="work it out" /></FormField>
          <FormField label="% done (optional)" hint="Only when cost misleads — cabinets paid for but not installed. 100 marks it complete."><input inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} className={FIELD} placeholder="by cost" /></FormField>
        </div>
        <div className={TWO}>
          <FormField label="Status"><input value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD} placeholder="Rough-in done" /></FormField>
          <FormField label="Status color"><select value={statusKind} onChange={(e) => setStatusKind(e.target.value)} className={FIELD}>{STATUS_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
        </div>
        <FormField label="Note"><input value={detail} onChange={(e) => setDetail(e.target.value)} className={FIELD} placeholder="Vendor, scope, room count" /></FormField>
        {line && <p className="text-[11.5px] text-ink-3">Spent {fmtK(line.paidCents)} · owed {fmtK(line.owedCents)} · on order {fmtK(line.orderedCents)} — these come from the costs filed under this trade.</p>}
      </div>
      <ModalFooter onClose={onClose} onSave={save} pending={pending}
        danger={line?.rowId != null ? <button type="button" disabled={pending} onClick={() => onDelete(line.rowId!)} className={`${BTN} text-flag`}><Trash2 className="size-3.5" strokeWidth={1.75} />Delete</button> : undefined} />
    </ModalShell>
  );
}

const BASES: [string, string][] = [["fixed_price", "Fixed price"], ["insurance", "Insurance claim"], ["cost_plus", "Cost plus"], ["time_materials", "Time & materials"]];

export function SettingsModal({ view, pending, onClose, onSave }: {
  view: BudgetView; pending: boolean; onClose: () => void; onSave: (input: BudgetSettingsInput) => void;
}) {
  const [basis, setBasis] = useState<string>(view.basis);
  const [label, setLabel] = useState(view.budgetLabel);
  const [caption, setCaption] = useState(view.budgetCaption ?? "");
  // Only a price someone set by hand is shown; otherwise the box stays blank ("from the estimate / contract").
  const [price, setPrice] = useState(show(view.priceSource === "override" ? view.priceCents : null));
  const [retainage, setRetainage] = useState(show(view.retainageCents ?? 0));
  const [complete, setComplete] = useState(view.completeness.budget);
  const [through, setThrough] = useState(view.completeness.costsThrough ?? "");
  const [notes, setNotes] = useState((view.notes ?? []).join("\n"));
  const save = () => onSave({
    basis, budgetLabel: label, budgetCaption: caption, priceCents: blankable(price), retainageCents: dollarsToCents(retainage),
    budgetComplete: complete, costsThrough: through || null, notes: notes.split("\n"),
  });
  return (
    <ModalShell title="Budget settings" onClose={onClose} wide>
      <div className={BODY}>
        <label className="flex items-start gap-2.5 rounded-md border border-rule bg-paper px-3 py-2.5">
          <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span className="text-[13px] text-ink"><b className="font-semibold">The budget covers the whole job, with real costs.</b>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">Tick this once every trade is listed and its budget is what you really expect to pay. Until then the page shows cost so far and no profit — a profit figured from half a budget is wrong.</span></span>
        </label>
        <div className={TWO}>
          <FormField label="Base price (before change orders)" hint="Blank = the approved estimate, else the contract total. Set it if that total already includes change orders."><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={FIELD} placeholder="from estimate / contract" /></FormField>
          <FormField label="Costs entered through" hint="The date your sub invoices and receipts are complete to."><input type="date" value={through} onChange={(e) => setThrough(e.target.value)} className={FIELD} /></FormField>
        </div>
        <div className={TWO}>
          <FormField label="How it's priced"><select value={basis} onChange={(e) => setBasis(e.target.value)} className={FIELD}>{BASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
          <FormField label="Retainage held"><input inputMode="decimal" value={retainage} onChange={(e) => setRetainage(e.target.value)} className={FIELD} /></FormField>
        </div>
        <div className={TWO}>
          <FormField label="What the price is called"><input value={label} onChange={(e) => setLabel(e.target.value)} className={FIELD} placeholder="contract" /></FormField>
          <FormField label="How it was built (one line)"><input value={caption} onChange={(e) => setCaption(e.target.value)} className={FIELD} /></FormField>
        </div>
        <FormField label="Notes and open questions" hint="One per line."><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={FIELD} /></FormField>
      </div>
      <ModalFooter onClose={onClose} onSave={save} pending={pending} />
    </ModalShell>
  );
}

const EXPENSE_KINDS: [string, string][] = [["material", "Materials"], ["labor", "Labor"], ["sub", "Subcontractor"], ["equipment", "Equipment"], ["permit", "Permit / fee"], ["other", "Other"]];

/** "line:12" / "co:3" / "" ↔ CostTarget. */
export function parseTarget(value: string): CostTarget {
  const [kind, id] = value.split(":");
  return (kind === "line" || kind === "co") && id ? { kind, id: Number(id) } : null;
}

export function ExpenseModal({ view, row, target, poOptions, today, pending, onClose, onSave, onDelete }: {
  view: BudgetView; row: BudgetCostRow | null; target: string; poOptions: { id: number; label: string }[]; today: string;
  pending: boolean; onClose: () => void; onSave: (input: ExpenseInput) => void; onDelete: (id: number) => void;
}) {
  const [date, setDate] = useState(row?.on ?? today);
  const [vendor, setVendor] = useState(row?.vendor ?? "");
  const [kind, setKind] = useState(row?.kind ?? "material");
  const [amount, setAmount] = useState(row ? centsToInput(row.amountCents) : "");
  const [memo, setMemo] = useState(row?.note ?? "");
  const [paidFrom, setPaidFrom] = useState(row?.paidFrom ?? "card");
  const [where, setWhere] = useState(target);
  const [po, setPo] = useState(row?.purchaseOrderId != null ? String(row.purchaseOrderId) : "");
  const save = () => onSave({
    id: row?.sourceId, date, vendorLabel: vendor, kind, amountCents: dollarsToCents(amount), memo, paidFrom,
    target: parseTarget(where), purchaseOrderId: po ? Number(po) : null,
  });
  return (
    <ModalShell title={row ? "Edit expense" : "Add an expense"} onClose={onClose}>
      <div className={BODY}>
        <div className={TWO}>
          <FormField label="Paid to"><input autoFocus value={vendor} onChange={(e) => setVendor(e.target.value)} className={FIELD} placeholder="Menards" /></FormField>
          <FormField label="Amount" hint="Negative for a return."><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={FIELD} placeholder="0.00" /></FormField>
        </div>
        <div className={TWO}>
          <FormField label="Date paid"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} /></FormField>
          <FormField label="Kind"><select value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>{EXPENSE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
        </div>
        <div className={TWO}>
          <FormField label="Trade">
            <select value={where} onChange={(e) => setWhere(e.target.value)} className={FIELD}>
              <option value="">Not assigned yet</option>
              <optgroup label="Trades">{view.lines.map((l) => <option key={l.id} value={`line:${l.rowId}`}>{l.trade}</option>)}</optgroup>
              {view.changeOrders.length > 0 && <optgroup label="Change orders">{view.changeOrders.map((c) => <option key={c.id} value={`co:${c.rowId}`}>{c.id} {c.title}</option>)}</optgroup>}
            </select>
          </FormField>
          <FormField label="Paid from"><select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} className={FIELD}><option value="card">Card</option><option value="checking">Checking</option><option value="cash">Cash</option></select></FormField>
        </div>
        {poOptions.length > 0 && (
          <FormField label="Is this a payment on a purchase order?" hint="Pick it so the order and the payment count once, not twice.">
            <select value={po} onChange={(e) => setPo(e.target.value)} className={FIELD}><option value="">No</option>{poOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          </FormField>
        )}
        <FormField label="What it was for"><input value={memo} onChange={(e) => setMemo(e.target.value)} className={FIELD} /></FormField>
      </div>
      <ModalFooter onClose={onClose} onSave={save} pending={pending}
        danger={row ? <button type="button" disabled={pending} onClick={() => onDelete(row.sourceId)} className={`${BTN} text-flag`}><Trash2 className="size-3.5" strokeWidth={1.75} />Delete</button> : undefined} />
    </ModalShell>
  );
}

export function PaymentModal({ row, pending, onClose, onSave }: {
  row: BudgetCostRow; pending: boolean; onClose: () => void; onSave: (args: { id: number; status: "submitted" | "approved" | "paid"; paidCents?: number }) => void;
}) {
  const [status, setStatus] = useState<"submitted" | "approved" | "paid">(row.status === "paid" ? "paid" : row.status === "submitted" ? "submitted" : "approved");
  const [paid, setPaid] = useState(centsToInput(row.paidCents));
  return (
    <ModalShell title={`${row.vendor} — ${fmtUsd(row.amountCents)}`} onClose={onClose}>
      <div className={BODY}>
        <FormField label="Where it stands">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={FIELD}>
            <option value="submitted">Received, not approved</option><option value="approved">Approved — owed</option><option value="paid">Paid in full</option>
          </select>
        </FormField>
        {status !== "paid" && <FormField label="Paid so far" hint="A deposit or a part payment. The rest shows as owed."><input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} className={FIELD} /></FormField>}
      </div>
      <ModalFooter onClose={onClose} pending={pending} onSave={() => onSave({ id: row.sourceId, status, paidCents: status === "paid" ? undefined : dollarsToCents(paid) })} />
    </ModalShell>
  );
}

export function CoCostsModal({ view, co, pending, onClose, onSave }: {
  view: BudgetView; co: BudgetChangeOrder; pending: boolean; onClose: () => void; onSave: (input: ChangeOrderCostsInput) => void;
}) {
  const [planned, setPlanned] = useState(show(co.budgetCostCents));
  const [est, setEst] = useState(show(co.estToFinishCents));
  const [paidBy, setPaidBy] = useState<ChangeOrderCostsInput["paidBy"]>(co.paidBy ?? "owner");
  const [share, setShare] = useState(show(co.funderShareCents ?? 0));
  const [credits, setCredits] = useState(co.credits.map((c) => ({ lineId: String(view.lines.find((l) => l.id === c.lineId)?.rowId ?? ""), amount: centsToInput(c.amountCents) })));
  const save = () => onSave({
    id: co.rowId!, paidBy, funderShareCents: dollarsToCents(share), budgetCostCents: blankable(planned), estToFinishCents: blankable(est),
    credits: credits.filter((c) => c.lineId).map((c) => ({ lineId: Number(c.lineId), amountCents: dollarsToCents(c.amount) })),
  });
  return (
    <ModalShell title={`${co.id} ${co.title} — costs`} onClose={onClose} wide>
      <div className={BODY}>
        <p className="text-[12.5px] text-ink-2">Price to the client {fmtUsd(co.totalCents)}. This form never changes a change order&rsquo;s price or status — that stays in Change orders.</p>
        <div className={TWO}>
          <FormField label="Planned cost" hint="What this change should cost you. Blank = not planned, so it is assumed to cost its full price (no profit)."><input inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} className={FIELD} placeholder="not planned" /></FormField>
          <FormField label="Still to spend" hint="Blank = work it out from the planned cost. 0 = nothing left."><input inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value)} className={FIELD} placeholder="work it out" /></FormField>
        </div>
        {view.parties.length > 1 && (
          <div className={TWO}>
            <FormField label="Who pays for it"><select value={paidBy} onChange={(e) => setPaidBy(e.target.value as ChangeOrderCostsInput["paidBy"])} className={FIELD}><option value="owner">The client</option><option value="funder">The insurer / lender</option><option value="split">Split</option></select></FormField>
            {paidBy === "split" && <FormField label="The funder's share"><input inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} className={FIELD} /></FormField>}
          </div>
        )}
        <div>
          <div className={LABEL}>Base scope this replaces</div>
          <p className="mb-1.5 mt-0.5 text-[11.5px] leading-snug text-ink-3">The client is credited for it, and the trade drops out of the cost — but only once this change order is signed.</p>
          {credits.map((c, i) => (
            <div key={i} className="mb-1.5 grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
              <select aria-label="Credited trade" value={c.lineId} onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, lineId: e.target.value } : x)))} className={FIELD}>
                <option value="">Pick a trade…</option>{view.lines.map((l) => <option key={l.id} value={l.rowId}>{l.trade}</option>)}
              </select>
              <input aria-label="Credit amount" inputMode="decimal" value={c.amount} onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={FIELD} placeholder="0.00" />
              <button type="button" onClick={() => setCredits(credits.filter((_, j) => j !== i))} className="text-ink-3 hover:text-flag" aria-label="Remove credit"><Trash2 className="size-3.5" strokeWidth={1.75} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setCredits([...credits, { lineId: "", amount: "" }])} className={BTN}>Add a credit</button>
        </div>
      </div>
      <ModalFooter onClose={onClose} onSave={save} pending={pending} />
    </ModalShell>
  );
}

export function ReconcileModal({ view, pending, onClose, onSave, onUndo }: {
  view: BudgetView; pending: boolean; onClose: () => void; onSave: (input: ReconcileBillingInput) => void; onUndo: () => void;
}) {
  const b = view.billing;
  const p = proposeBillingReconciliation(b);
  const tracked = b.source === "invoices";
  const [opening, setOpening] = useState(centsToInput(tracked ? b.openingCollectedCents : p.proposedOpeningCollectedCents));
  const [billed, setBilled] = useState(centsToInput(tracked ? b.openingBilledCents : p.proposedOpeningBilledCents));
  const [note, setNote] = useState(b.openingNote ?? "");
  const [sync, setSync] = useState(false);
  const result = dollarsToCents(opening) + b.paidInvoicesCents;
  const line = (k: string, v: string, strong?: boolean) => (
    <div className={`flex items-center gap-3 ${strong ? "font-semibold text-ink" : "text-ink-2"}`}><span className="flex-1">{k}</span><span className="font-mono">{v}</span></div>
  );
  return (
    <ModalShell title="Reconcile billing" onClose={onClose} wide>
      <div className={BODY}>
        <p className="text-[12.5px] leading-relaxed text-ink-2">Right now &ldquo;collected&rdquo; on this job is the total you keep by hand. Switching it to the invoices here, plus an opening balance for anything collected before they were tracked, lets the page show what is billed, what is unpaid, and whether billing is ahead of the work.</p>
        <div className="flex flex-col gap-1 rounded-md border border-rule bg-paper px-3 py-2.5 text-[12.5px]">
          {line("Your hand-kept collected total", fmtUsd(b.handKeptCollectedCents))}
          {line(`Paid invoices in SJC OS (${b.invoiceCount} invoice${b.invoiceCount === 1 ? "" : "s"} on file)`, fmtUsd(b.paidInvoicesCents))}
          {line("Difference", fmtUsd(p.differenceCents), true)}
          {p.handKeptLooksStale && <p className="mt-1 text-[11.5px] font-semibold text-flag">The invoices show more collected than your hand-kept total — that total looks out of date.</p>}
        </div>
        <div className={TWO}>
          <FormField label="Collected before invoices were tracked" hint="A deposit carried on a Houzz estimate, for example."><input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} className={FIELD} /></FormField>
          <FormField label="Billed before invoices were tracked" hint="Usually the same amount."><input inputMode="decimal" value={billed} onChange={(e) => setBilled(e.target.value)} className={FIELD} /></FormField>
        </div>
        <FormField label="Where that opening balance came from"><input value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} placeholder="$10,000 deposit on Houzz estimate ES-10165" /></FormField>
        <div className="rounded-md border border-rule bg-paper px-3 py-2.5 text-[12.5px]">{line("Collected will read", fmtUsd(result), true)}</div>
        <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>Also set the hand-kept total to {fmtK(result)}, so Today and the projects list agree.</span>
        </label>
      </div>
      <ModalFooter onClose={onClose} pending={pending} saveLabel={tracked ? "Update" : "Switch to invoices"}
        onSave={() => onSave({ openingCollectedCents: dollarsToCents(opening), openingBilledCents: dollarsToCents(billed), note, alsoUpdateHandKept: sync })}
        danger={tracked ? <button type="button" disabled={pending} onClick={onUndo} className={BTN}>Back to the hand-kept total</button> : undefined} />
    </ModalShell>
  );
}
