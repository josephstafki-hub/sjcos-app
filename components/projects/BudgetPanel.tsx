"use client";

// Project Money › Overview — what this job should make, how far along it is,
// whether anything is wrong, and every number behind that (plan §4).
//
// Pure render over one BudgetView (lib/budget.ts builds it on the server);
// every derived number comes from computeTotals(), the same function the
// company page and the MCP tools use, so they can never disagree. Layered so
// each layer stands without the ones below it: headline → picture → trades →
// the folds. Nothing here fetches on mount — ProjectTabs keeps every panel
// mounted.

import { useState, useTransition } from "react";
import { Card, KpiTile, Table, TableWrapper, TableHead, TableBody, TableHeader, TableRow, TableCell, TablePrimaryCell, Chip } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { fmtUsd } from "@/lib/cost-book-units";
import { computeTotals, describeFinancials, fmtK, type BudgetChangeOrder, type BudgetCostRow, type BudgetLine, type BudgetView } from "@/lib/budget-types";
import {
  adoptEstimateAsBudget, assignCost, deleteBudgetLine, deleteExpense, linkCostToPurchaseOrder,
  saveBudgetLine, saveBudgetSettings, saveChangeOrderCosts, saveExpense, saveOutsideMoney, savePayersAndFunding, setSubInvoicePayment,
} from "@/lib/actions/budget";
import { HeadlineStrip } from "./budget/HeadlineStrip";
import { InOutBars } from "./budget/InOutBars";
import { CoChart, PayChart, TradeChart } from "./budget/Charts";
import { ChangeOrderCards, CostsLedger, FundingTable, HowFigured, InvoicesTable, TradesTable } from "./budget/Folds";
import { CoCostsModal, ExpenseModal, LineModal, OutsideMoneyModal, PayersModal, PaymentModal, SettingsModal, parseTarget } from "./budget/EditModals";
import { TabLink } from "./TabNav";
import { JobMoneyCard } from "./budget/JobMoneyCard";
import { BTN, Fold, Section } from "./budget/parts";

type Result = { ok: boolean; error?: string };
type Modal =
  | { kind: "line"; line: BudgetLine | null }
  | { kind: "settings" }
  | { kind: "expense"; row: BudgetCostRow | null }
  | { kind: "payment"; row: BudgetCostRow }
  | { kind: "co"; co: BudgetChangeOrder }
  | { kind: "payers" }
  | { kind: "outside" };
type FoldKey = "trades" | "cos" | "costs" | "invoices" | "funding" | "notes" | "figured";

export function BudgetPanel({ slug, budget, isOwner, hasApprovedEstimate, poOptions, today }: {
  slug: string;
  budget: BudgetView;
  /** Only the owner may enter the money outside the app. */
  isOwner: boolean;
  hasApprovedEstimate: boolean;
  poOptions: { id: number; label: string }[];
  /** ISO day in the shop's timezone — the default date on a new expense. */
  today: string;
}) {
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<Modal | null>(null);
  const [open, setOpen] = useState<Record<FoldKey, boolean>>({ trades: false, cos: false, costs: false, invoices: false, funding: false, notes: false, figured: false });
  const toggle = (k: FoldKey) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const t = computeTotals(budget);
  const sentences = describeFinancials(budget, t);
  const ownerLabel = budget.parties.find((p) => p.isOwner)?.label ?? "Client";
  const showPay = budget.parties.length > 1 || t.coFunderCents !== 0 || t.unfundedCents > 0;
  const showCos = budget.changeOrders.some((c) => c.status !== "declined");

  // A modal stays open on failure so what was typed survives; runAction toasts the reason.
  const run = (fn: () => Promise<Result>, closeOnSuccess = true) =>
    startTransition(async () => {
      const r = await runAction(fn);
      if (r.ok && closeOnSuccess) setModal(null);
    });
  const expenseTarget = (row: BudgetCostRow | null) => {
    if (row?.keyKind === "line") return `line:${budget.lines.find((l) => l.id === row.key)?.rowId ?? ""}`;
    if (row?.keyKind === "co") return `co:${budget.changeOrders.find((c) => c.id === row.key)?.rowId ?? ""}`;
    return "";
  };
  const showFigured = () => {
    setOpen((o) => ({ ...o, figured: true }));
    requestAnimationFrame(() => document.getElementById("budget-figured")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // `@container`: the app's side panels leave this column ~340px wide on a
  // 1280px laptop, so the layout answers to the column, never the window.
  return (
    <div className="@container flex flex-col gap-5">
      {budget.jobMoney && <div className="grid grid-cols-2 gap-3 @2xl/page:grid-cols-4">
        <KpiTile label="Contract" value={fmtK(budget.jobMoney.totalCents)} hint="Job total from the financial ledger, including approved changes, pre-con fees and money agreed outside the app." />
        <KpiTile label="Paid" value={fmtK(budget.jobMoney.collectedCents)} tone="money" hint="Settled invoice payments plus money recorded as paid outside the app." />
        <KpiTile label="Remaining" value={fmtK(budget.jobMoney.totalCents - budget.jobMoney.collectedCents)} hint="Contract less paid, including work that has not been billed yet." />
        <KpiTile label="Next draw" value={budget.nextDraw ? fmtK(budget.nextDraw.amountCents) : "—"} meta={budget.nextDraw?.label ?? "No unbilled draw scheduled"} hint="Next unbilled milestone on the formal estimate in effect. This is a scheduled draw, not a past-due invoice." />
      </div>}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h3 className="font-serif text-heading font-semibold">Invoices</h3><TabLink tab="Money" section="Invoices" className="text-label font-semibold text-accent-2 hover:underline">Manage invoices →</TabLink></div>
        {budget.clientInvoices.length === 0 ? <p className="py-3 text-body text-ink-3">Invoices will appear here when a milestone is billed. Open Invoices to create one.</p> : <TableWrapper><Table density="compact"><TableHead><TableRow><TableHeader>Invoice</TableHeader><TableHeader numeric>Amount</TableHeader><TableHeader className="@max-3xl/page:hidden">Status</TableHeader></TableRow></TableHead><TableBody>{budget.clientInvoices.map(i => <TableRow key={i.number}><TablePrimaryCell meta={<><span className="font-mono">{i.number}</span> · {i.dateLabel}<span className="block @3xl/page:hidden">{i.statusLabel}</span></>}>{i.label}</TablePrimaryCell><TableCell numeric className="whitespace-nowrap">{fmtUsd(i.amountCents)}</TableCell><TableCell className="@max-3xl/page:hidden"><Chip kind={i.status === "paid" ? "ok" : i.status === "draft" ? "neutral" : "info"}>{i.status === "paid" ? "Paid" : i.status === "draft" ? "Draft" : "Open"}</Chip></TableCell></TableRow>)}</TableBody></Table></TableWrapper>}
      </section>
      <details className="rounded-lg border border-rule-soft bg-card p-4"><summary className="cursor-pointer text-subheading font-semibold text-ink">Budget and profit</summary><div className="mt-3">
      <HeadlineStrip
        view={budget} t={t} sentences={sentences} pending={pending}
        canAdopt={hasApprovedEstimate && budget.lines.length === 0}
        onAdopt={() => run(() => adoptEstimateAsBudget(slug))}
        onAddLine={() => setModal({ kind: "line", line: null })}
        onSettings={() => setModal({ kind: "settings" })}
        onShowFigured={showFigured}
      /></div></details>

      {budget.jobMoney && (
        <Section title="Job total and paid" sub="What the projects list shows for this job, and what it adds up from.">
          <JobMoneyCard money={budget.jobMoney} isOwner={isOwner} onEdit={() => setModal({ kind: "outside" })} />
        </Section>
      )}

      <Section title="Money in, money out" sub="Both bars run from $0 to the price, so they can be read against each other.">
        <InOutBars view={budget} t={t} />
      </Section>

      {budget.lines.length > 0 && (
        <Section title="Cost by trade" sub="Each bar is what the trade has cost and is still expected to. The hairline is its budget.">
          <Card className="p-4"><TradeChart view={budget} t={t} /></Card>
        </Section>
      )}

      {showCos && (
        <Section title="Change orders" sub="Work added beyond the base price. One that isn't signed adds nothing — but money already spent on it still counts as cost.">
          <Card className="p-4"><CoChart view={budget} t={t} ownerLabel={ownerLabel} /></Card>
        </Section>
      )}

      {showPay && (
        <Section title="Who pays for what" sub="The price, against where the money comes from.">
          <Card className="p-4"><PayChart t={t} /></Card>
        </Section>
      )}

      <Section
        title="Details"
        action={
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setModal({ kind: "payers" })} className={BTN}>Who pays</button>
          </div>
        }
      >
        <Fold title="Trades, line by line" right={`${budget.lines.length} line${budget.lines.length === 1 ? "" : "s"} · ${fmtK(t.projectedCostCents)} ${budget.completeness.budget ? "projected" : "so far"}`} open={open.trades} onToggle={() => toggle("trades")}>
          <TradesTable view={budget} t={t} onEdit={(line) => setModal({ kind: "line", line })} onAdd={() => setModal({ kind: "line", line: null })} />
        </Fold>
        {budget.changeOrders.length > 0 && (
          <Fold title="Change orders" right={`${budget.changeOrders.length} · ${fmtK(t.coNetCents)} counted`} open={open.cos} onToggle={() => toggle("cos")}>
            <ChangeOrderCards view={budget} t={t} onEdit={(co) => setModal({ kind: "co", co })} />
          </Fold>
        )}
        <Fold title="Costs" right={`${budget.costs.length} · spent ${fmtK(t.paidCents)} · owed ${fmtK(t.owedCents)}`} open={open.costs} onToggle={() => toggle("costs")}>
          <CostsLedger
            view={budget} pending={pending} poOptions={poOptions}
            onAssign={(row, value) => run(() => assignCost(slug, { source: row.source, id: row.sourceId, target: parseTarget(value) }), false)}
            onLinkPo={(row, poId) => run(() => linkCostToPurchaseOrder(slug, { source: row.source as "sub_invoice" | "expense", id: row.sourceId, purchaseOrderId: poId }), false)}
            onEditExpense={(row) => setModal({ kind: "expense", row })}
            onPayment={(row) => setModal({ kind: "payment", row })}
            onAddExpense={() => setModal({ kind: "expense", row: null })}
          />
        </Fold>
        <Fold title="Client invoices" right={`${budget.clientInvoices.length} · collected ${fmtK(t.collectedCents)}`} open={open.invoices} onToggle={() => toggle("invoices")}>
          <InvoicesTable view={budget} />
        </Fold>
        {budget.fundingEvents.length > 0 && (
          <Fold title="Funding" right={`${budget.fundingEvents.length} expected payments`} open={open.funding} onToggle={() => toggle("funding")}>
            <FundingTable view={budget} />
          </Fold>
        )}
        {budget.notes && budget.notes.length > 0 && (
          <Fold title="Notes and open questions" right={String(budget.notes.length)} open={open.notes} onToggle={() => toggle("notes")}>
            <ul className="list-disc space-y-1 pl-5 text-body text-ink-2">{budget.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Fold>
        )}
        <div id="budget-figured" className="scroll-mt-4">
          <Fold title="How these numbers are figured" right={budget.completeness.missing.length ? `${budget.completeness.missing.length} soft spot${budget.completeness.missing.length === 1 ? "" : "s"}` : "all firm"} open={open.figured} onToggle={() => toggle("figured")}>
            <HowFigured view={budget} t={t} />
          </Fold>
        </div>
      </Section>

      {modal?.kind === "line" && (
        <LineModal line={modal.line} pending={pending} onClose={() => setModal(null)}
          onSave={(input) => run(() => saveBudgetLine(slug, input))} onDelete={(id) => run(() => deleteBudgetLine(slug, id))} />
      )}
      {modal?.kind === "settings" && (
        <SettingsModal view={budget} pending={pending} onClose={() => setModal(null)} onSave={(input) => run(() => saveBudgetSettings(slug, input))} />
      )}
      {modal?.kind === "expense" && (
        <ExpenseModal view={budget} row={modal.row} target={expenseTarget(modal.row)} poOptions={poOptions} today={today} pending={pending} onClose={() => setModal(null)}
          onSave={(input) => run(() => saveExpense(slug, input))} onDelete={(id) => run(() => deleteExpense(slug, id))} />
      )}
      {modal?.kind === "payment" && (
        <PaymentModal row={modal.row} pending={pending} onClose={() => setModal(null)} onSave={(args) => run(() => setSubInvoicePayment(slug, args))} />
      )}
      {modal?.kind === "co" && (
        <CoCostsModal view={budget} co={modal.co} pending={pending} onClose={() => setModal(null)} onSave={(input) => run(() => saveChangeOrderCosts(slug, input))} />
      )}
      {modal?.kind === "payers" && (
        <PayersModal view={budget} pending={pending} onClose={() => setModal(null)} onSave={(input) => run(() => savePayersAndFunding(slug, input))} />
      )}
      {modal?.kind === "outside" && budget.jobMoney && (
        <OutsideMoneyModal money={budget.jobMoney} pending={pending} onClose={() => setModal(null)}
          onSave={(input) => run(() => saveOutsideMoney(slug, input))} />
      )}
    </div>
  );
}
