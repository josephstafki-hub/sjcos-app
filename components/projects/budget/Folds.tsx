"use client";

// The deep-dive layer of Money › Overview (plan §4.6): every line, every cost,
// every invoice — and the arithmetic that ties them to the headline. Tables
// scroll sideways on a phone; the charts above them never do.

import { Pencil, Plus } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import { fmtUsd } from "@/lib/cost-book-units";
import { fmtK, fmtPct, fmtSigned, isCoCounted, type BudgetChangeOrder, type BudgetCostRow, type BudgetLine, type BudgetTotals, type BudgetView } from "@/lib/budget-types";
import { BTN, FIELD, Td, Th, dash } from "./parts";

const usd = (c: number) => (c ? fmtUsd(c) : dash);

export function TradesTable({ view, t, onEdit, onAdd }: { view: BudgetView; t: BudgetTotals; onEdit: (l: BudgetLine) => void; onAdd: () => void }) {
  const loose = view.unassigned;
  const looseTotal = loose.paidCents + loose.owedCents + loose.orderedCents;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-[12.5px]">
          <thead><tr><Th>Trade</Th><Th right>Budget</Th><Th right>Spent</Th><Th right>Owed</Th><Th right>On order</Th><Th right>Still to spend</Th><Th right>Projected</Th><Th right>Over / under</Th><Th right>Price</Th><Th right>Margin</Th><Th /></tr></thead>
          <tbody>
            {view.lines.map((l, i) => {
              const lt = t.lines[i];
              const v = lt.varianceCents;
              return (
                <tr key={l.id} className={`border-t border-rule-soft ${lt.credited ? "text-ink-3" : ""}`}>
                  <Td>
                    <div className="font-semibold" title={l.source}>{l.trade}{l.kind !== "trade" && <span className="ml-1.5 font-mono text-[9.5px] uppercase text-ink-4">{l.kind}</span>}</div>
                    {l.detail && <div className="text-[11.5px] text-ink-3">{l.detail}</div>}
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {l.status && <Chip kind={(l.statusKind ?? "ghost") as ChipKind} dot>{l.status}</Chip>}
                      {l.percentComplete != null && <Chip kind="ghost">{l.percentComplete}% done</Chip>}
                      {l.credited && !lt.credited && <Chip kind="ghost">credit waits on {l.creditedTo}</Chip>}
                      {l.flags?.map((f) => <Chip key={f} kind="flag">{f}</Chip>)}
                    </div>
                  </Td>
                  <Td right mono>{fmtUsd(l.budgetCents)}</Td>
                  <Td right mono>{usd(l.paidCents)}</Td>
                  <Td right mono>{usd(l.owedCents)}</Td>
                  <Td right mono>{usd(l.orderedCents)}</Td>
                  <Td right mono>{lt.estCents ? <span title={lt.estDerived ? "Derived: budget less what is spent, owed and on order" : "Entered"}>{fmtUsd(lt.estCents)}{lt.estDerived && <span className="text-ink-4">*</span>}</span> : dash}</Td>
                  <Td right mono>{fmtUsd(lt.projectedCents)}</Td>
                  <Td right>
                    {lt.credited ? <Chip kind="info">moved to {l.creditedTo}</Chip>
                      : Math.abs(v) <= 100 ? <Chip kind="ghost">on budget</Chip>
                      : <Chip kind={v > 0 ? "flag" : "money"}>{fmtSigned(v)} {v > 0 ? "over" : "under"}</Chip>}
                  </Td>
                  <Td right mono muted>{l.priceCents != null ? fmtUsd(l.priceCents) : dash}</Td>
                  <Td right mono>{lt.marginCents != null ? fmtUsd(lt.marginCents) : dash}</Td>
                  <Td right><button type="button" onClick={() => onEdit(l)} className="text-ink-3 hover:text-ink" aria-label={`Edit ${l.trade}`}><Pencil className="size-3.5" strokeWidth={1.75} /></button></Td>
                </tr>
              );
            })}
            {looseTotal !== 0 && (
              <tr className="border-t border-rule-soft">
                <Td><div className="font-semibold">Not assigned to a trade</div><div className="text-[11.5px] text-ink-3">Counted in the totals. File each under a trade in Costs below.</div></Td>
                <Td right mono>{dash}</Td><Td right mono>{usd(loose.paidCents)}</Td><Td right mono>{usd(loose.owedCents)}</Td><Td right mono>{usd(loose.orderedCents)}</Td>
                <Td right mono>{dash}</Td><Td right mono>{fmtUsd(looseTotal)}</Td><Td right><Chip kind="flag">unassigned</Chip></Td><Td /><Td /><Td />
              </tr>
            )}
          </tbody>
          <tfoot className="bg-paper-2 font-semibold">
            <tr className="border-t border-rule">
              <Td>Trades + change orders</Td>
              <Td right mono>{fmtUsd(t.budgetCostCents + t.coBudgetCostCents)}</Td>
              <Td right mono>{fmtUsd(t.paidCents)}</Td><Td right mono>{fmtUsd(t.owedCents)}</Td><Td right mono>{fmtUsd(t.orderedCents)}</Td>
              <Td right mono>{fmtUsd(t.estToFinishCents)}</Td><Td right mono>{fmtUsd(t.projectedCostCents)}</Td>
              <Td right><Chip kind={t.costHeadroomCents < -100 ? "flag" : "money"}>{fmtSigned(-t.costHeadroomCents)}</Chip></Td>
              <Td right mono>{fmtUsd(t.priceCents)}</Td>
              <Td right mono>{t.projectedProfitCents != null ? fmtUsd(t.projectedProfitCents) : dash}</Td><Td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
        <button type="button" onClick={onAdd} className={BTN}><Plus className="size-3.5" strokeWidth={1.75} />Add a line</button>
        <span>* derived: budget less what is spent, owed and on order. Spent, owed and on order come from the costs below — nobody types them.</span>
      </div>
    </div>
  );
}

const CO_CHIP: Record<string, ChipKind> = { draft: "ghost", sent: "accent", approved: "money", declined: "flag", billed: "info", paid: "money" };
const CO_LABEL: Record<string, string> = { draft: "Draft", sent: "Awaiting signature", approved: "Approved", declined: "Declined", billed: "Billed", paid: "Paid" };

export function ChangeOrderCards({ view, t, onEdit }: { view: BudgetView; t: BudgetTotals; onEdit: (co: BudgetChangeOrder) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2 @5xl:grid-cols-3">
      {view.changeOrders.map((c, i) => {
        const ct = t.changeOrders[i];
        const soFar = c.paidCents + c.owedCents + c.orderedCents;
        return (
          <Card key={c.id} kind="soft" className="flex min-w-0 flex-col gap-2 p-3.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-info">{c.id}</div>
                <div className="font-serif text-[17px] leading-tight text-ink">{c.title}</div>
              </div>
              <Chip kind={CO_CHIP[c.status]} dot>{CO_LABEL[c.status]}</Chip>
            </div>
            {c.description && <p className="text-[12.5px] text-ink-2">{c.description}</p>}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-rule-soft pt-2 text-[12.5px]">
              <span>Price</span><span className="font-mono">{fmtUsd(c.totalCents)}</span>
              <span>Credit for replaced scope</span><span className="font-mono">{ct.creditCents ? `−${fmtUsd(ct.creditCents)}` : "none"}</span>
              <span className="font-semibold">Client pays extra</span><span className="font-mono font-semibold">{fmtUsd(ct.netPriceCents)}</span>
              <span className="mt-1 text-ink-3">Planned cost</span><span className="mt-1 font-mono text-ink-3">{c.budgetCostCents != null ? fmtUsd(c.budgetCostCents) : "not planned"}</span>
              <span className="text-ink-3">Cost so far</span><span className="font-mono text-ink-3">{fmtUsd(soFar)}</span>
              {ct.counted && <><span className="text-ink-3">Still to spend</span><span className="font-mono text-ink-3">{fmtUsd(ct.estCents)}</span></>}
              {ct.marginCents != null && <><span>Margin</span><span className="font-mono">{fmtUsd(ct.marginCents)}</span></>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
              {!isCoCounted(c.status) && c.status !== "declined" && <span>Not counted until signed.</span>}
              {ct.notPlanned && <span>Cost not planned — assumed at price.</span>}
              {!ct.counted && soFar > 0 && <span className="font-semibold text-flag">{fmtK(soFar)} already spent.</span>}
              <span className="flex-1" />
              <button type="button" onClick={() => onEdit(c)} className={BTN}><Pencil className="size-3" strokeWidth={1.75} />Costs</button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

const SOURCE_LABEL = { sub_invoice: "Sub invoice", po: "Purchase order", expense: "Expense" } as const;

export function CostsLedger({
  view, pending, poOptions, onAssign, onLinkPo, onEditExpense, onPayment, onAddExpense,
}: {
  view: BudgetView;
  pending: boolean;
  poOptions: { id: number; label: string }[];
  onAssign: (row: BudgetCostRow, value: string) => void;
  onLinkPo: (row: BudgetCostRow, poId: number | null) => void;
  onEditExpense: (row: BudgetCostRow) => void;
  onPayment: (row: BudgetCostRow) => void;
  onAddExpense: () => void;
}) {
  const targetOf = (r: BudgetCostRow) => {
    if (r.keyKind === "line") { const id = view.lines.find((l) => l.id === r.key)?.rowId; return id != null ? `line:${id}` : ""; }
    if (r.keyKind === "co") { const id = view.changeOrders.find((c) => c.id === r.key)?.rowId; return id != null ? `co:${id}` : ""; }
    return "";
  };
  const countsAs = (r: BudgetCostRow) => {
    const parts = [r.paidCents && `spent ${fmtK(r.paidCents)}`, r.owedCents && `owed ${fmtK(r.owedCents)}`, r.orderedCents && `on order ${fmtK(r.orderedCents)}`].filter(Boolean);
    if (parts.length) return parts.join(" · ");
    return r.source === "po" ? (["draft", "queued"].includes(r.status) ? "$0 · not sent yet" : "$0 · billed by its invoices") : "$0";
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAddExpense} className={BTN}><Plus className="size-3.5" strokeWidth={1.75} />Add expense</button>
        <span className="text-[11.5px] text-ink-3">A receipt, a card charge, a check, your own labor. Sub invoices come from the sub portal; purchase orders from the Purchase orders section.</span>
      </div>
      {view.costs.length === 0 ? <p className="py-2 text-[12.5px] text-ink-3">No costs logged on this job yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead><tr><Th>Date</Th><Th>Who</Th><Th>What</Th><Th right>Amount</Th><Th>Counts as</Th><Th>Trade</Th><Th>Bills against</Th><Th /></tr></thead>
            <tbody>
              {view.costs.map((r) => (
                <tr key={`${r.source}-${r.sourceId}`} className="border-t border-rule-soft">
                  <Td muted className="whitespace-nowrap">{r.dateLabel || dash}</Td>
                  <Td><div className="font-semibold">{r.vendor}</div><div className="font-mono text-[9.5px] uppercase text-ink-4">{SOURCE_LABEL[r.source]}{r.kind ? ` · ${r.kind}` : ""}</div></Td>
                  <Td className="max-w-[16rem]">
                    <div className="text-ink-2">{r.note ?? dash}</div>
                    {r.flags?.length ? <div className="mt-0.5 flex flex-wrap gap-1">{r.flags.map((f) => <Chip key={f} kind="flag">{f}</Chip>)}</div> : null}
                  </Td>
                  <Td right mono>{fmtUsd(r.amountCents)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{countsAs(r)}</Td>
                  <Td>
                    <select aria-label={`Trade for ${r.vendor}`} disabled={pending} value={targetOf(r)} onChange={(e) => onAssign(r, e.target.value)} className={`${FIELD} min-w-[9rem] py-1 text-[12px]`}>
                      <option value="">Not assigned</option>
                      <optgroup label="Trades">{view.lines.map((l) => <option key={l.id} value={`line:${l.rowId}`}>{l.trade}</option>)}</optgroup>
                      {view.changeOrders.length > 0 && <optgroup label="Change orders">{view.changeOrders.map((c) => <option key={c.id} value={`co:${c.rowId}`}>{c.id} {c.title}</option>)}</optgroup>}
                    </select>
                  </Td>
                  <Td>
                    {r.source === "po" ? <span className="text-ink-4">–</span> : (
                      <select aria-label={`Purchase order for ${r.vendor}`} disabled={pending || poOptions.length === 0} value={r.purchaseOrderId ?? ""} onChange={(e) => onLinkPo(r, e.target.value ? Number(e.target.value) : null)} className={`${FIELD} min-w-[8rem] py-1 text-[12px]`}>
                        <option value="">No PO</option>
                        {poOptions.map((po) => <option key={po.id} value={po.id}>{po.label}</option>)}
                      </select>
                    )}
                  </Td>
                  <Td right className="whitespace-nowrap">
                    {r.source === "sub_invoice" && <button type="button" onClick={() => onPayment(r)} className={BTN}>{r.status === "paid" ? "Paid" : "Payment"}</button>}
                    {r.source === "expense" && <button type="button" onClick={() => onEditExpense(r)} className="text-ink-3 hover:text-ink" aria-label={`Edit expense ${r.vendor}`}><Pencil className="size-3.5" strokeWidth={1.75} /></button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const INV_CHIP: Record<string, ChipKind> = { draft: "ghost", sent: "accent", paid: "money" };

export function InvoicesTable({ view }: { view: BudgetView }) {
  const b = view.billing;
  return (
    <div className="flex flex-col gap-2">
      {b.source === "invoices" && b.openingCollectedCents > 0 && (
        <p className="text-[12.5px] text-ink-2">Opening balance <b className="font-mono font-medium">{fmtUsd(b.openingCollectedCents)}</b> collected before invoices were tracked here{b.openingNote ? ` — ${b.openingNote}` : "."}</p>
      )}
      {view.clientInvoices.length === 0 ? <p className="text-[12.5px] text-ink-3">No client invoices in SJC OS for this job.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead><tr><Th>Invoice</Th><Th>Date</Th><Th>For</Th><Th right>Amount</Th><Th>Status</Th></tr></thead>
            <tbody>
              {view.clientInvoices.map((i) => (
                <tr key={i.number} className="border-t border-rule-soft">
                  <Td mono>{i.number}</Td><Td muted className="whitespace-nowrap">{i.dateLabel}</Td><Td>{i.label}</Td>
                  <Td right mono>{fmtUsd(i.amountCents)}</Td><Td><Chip kind={INV_CHIP[i.status]} dot>{i.statusLabel}</Chip></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FundingTable({ view }: { view: BudgetView }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12.5px]">
        <thead><tr><Th>Source</Th><Th right>Amount</Th><Th>What has to happen</Th><Th>Status</Th></tr></thead>
        <tbody>
          {view.fundingEvents.map((f, i) => (
            <tr key={i} className="border-t border-rule-soft">
              <Td>{f.source}</Td><Td right mono>{fmtUsd(f.amountCents)}</Td><Td muted>{f.trigger}</Td>
              <Td><Chip kind={f.status === "received" ? "money" : f.status === "requested" ? "accent" : "ghost"} dot>{f.statusLabel ?? f.status}</Chip></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The explainability layer: each headline number, as arithmetic on THIS job. */
export function HowFigured({ view, t }: { view: BudgetView; t: BudgetTotals }) {
  const c = view.completeness;
  const rows: [string, string][] = [
    ["Price", `base ${fmtK(t.basePriceCents)}${t.coNetCents ? ` + signed change orders ${fmtK(t.coNetCents)}` : ""} = ${fmtK(t.priceCents)}${t.coPendingCents ? ` (${fmtK(t.coPendingCents)} of unsigned change orders is not counted)` : ""}`],
    ["Cost so far", `spent ${fmtK(t.paidCents)} + owed ${fmtK(t.owedCents)} + on order ${fmtK(t.orderedCents)} = ${fmtK(t.costSoFarCents)}`],
  ];
  if (c.budget) {
    rows.push(["Cost", `cost so far ${fmtK(t.costSoFarCents)} + still to spend ${fmtK(t.estToFinishCents)} = ${fmtK(t.projectedCostCents)}`]);
    rows.push(["Profit", `price ${fmtK(t.priceCents)} − cost ${fmtK(t.projectedCostCents)} = ${fmtK(t.projectedProfitCents ?? 0)} (${fmtPct(t.marginPct)} of the price)`]);
    rows.push(["The plan", `price ${fmtK(t.priceCents)} − budget ${fmtK(t.budgetCostCents + t.coBudgetCostCents)} = ${fmtK(t.plannedProfitCents ?? 0)}`]);
    rows.push(["Work done (by cost)", `(spent + owed) ${fmtK(t.incurredCents)} ÷ cost ${fmtK(t.projectedCostCents)} = ${fmtPct(t.workDonePct)}. What is only on order never counts as work.`]);
    if (t.earnedCents != null) rows.push(["Earned", `price ${fmtK(t.priceCents)} × ${fmtPct(t.workDonePct)} = ${fmtK(t.earnedCents)}`]);
  } else {
    rows.push(["Profit", "not shown: until the budget covers the whole job there is no honest figure for what is still to spend."]);
  }
  rows.push(["Collected", view.billing.source === "invoices"
    ? `opening balance ${fmtK(view.billing.openingCollectedCents)} + paid invoices ${fmtK(view.billing.paidInvoicesCents)} = ${fmtK(t.collectedCents)}`
    : `${fmtK(t.collectedCents)} — the hand-kept total on the project, not the invoices`]);
  rows.push(["Left to collect", `price ${fmtK(t.priceCents)} − collected ${fmtK(t.collectedCents)} = ${fmtK(t.leftToCollectCents)}. This includes work not billed yet, so it is not the same as unpaid invoices (${fmtK(t.unpaidInvoicesCents)}).`]);
  if (t.overUnderBilledCents != null) rows.push(["Billing vs the work", `billed ${fmtK(t.billedCents ?? 0)} − earned ${fmtK(t.earnedCents ?? 0)} = ${fmtSigned(t.overUnderBilledCents)} (${t.overUnderBilledCents >= 0 ? "billed ahead of the work" : "work not billed yet"})`]);

  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 @xl:grid-cols-[10rem_minmax(0,1fr)]">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="font-semibold text-ink">{k}</dt><dd className="mb-1 text-ink-2 @xl:mb-0">{v}</dd></div>))}
      </dl>
      <div className="grid grid-cols-1 gap-3 border-t border-rule-soft pt-3 @xl:grid-cols-2">
        <div><div className="mb-1 font-semibold text-ink">Based on</div><ul className="list-disc space-y-0.5 pl-5 text-ink-2">{c.basedOn.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><div className="mb-1 font-semibold text-ink">Missing or soft</div>{c.missing.length ? <ul className="list-disc space-y-0.5 pl-5 text-ink-2">{c.missing.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-ink-3">Nothing flagged.</p>}</div>
      </div>
    </div>
  );
}
