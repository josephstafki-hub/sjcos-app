# Project Budget panel for SJC OS

A "where are we at" view for the Money tab of every project. Three graphs up top (budget bar, cost by trade, who pays), change orders as their own chart, and everything else folded under Details. Pure render component fed by one object, `BudgetView`, so the same panel works for a fixed-price kitchen, an insurance restoration, a lender-funded addition, or a cost-plus job, and so an agent can fill it from documents when the app does not hold the data yet.

## Files

| File | What it is |
|---|---|
| `lib/budget-types.ts` | The `BudgetView` contract, every field documented, plus `computeTotals()`: the one place the math lives. No db import; safe in client bundles. |
| `components/projects/BudgetPanel.tsx` | The panel. Client component, `Card`/`Chip`/`Eyebrow` primitives, Tailwind tokens from `globals.css`. No page header. |
| `lib/budget.ts` | Server builder `getProjectBudget(slug)` that assembles a `BudgetView` from SJC OS tables. |
| `db/apply-project-budget.mjs` | Additive, idempotent schema: `budget_lines`, `change_order_credits`, `budget_parties`, `funding_events`, link columns on `sub_invoices` / `purchase_orders` / `change_orders` / `projects`. |
| `lib/budget-sample.ts` | The Egan job as a `BudgetView`. Dev fixture and the worked example for agents. |

## Wiring it in (3 steps)

1. `node db/apply-project-budget.mjs`
2. In `app/(os)/projects/[slug]/page.tsx`, alongside the other `getProject*` reads: `const budget = await getProjectBudget(slug);` and render `<BudgetPanel budget={budget} />` as the first section of the Money tab (above `MoneyPanel`). Gate it with `showMoney` like the rest.
3. Until a project has `budget_lines`, the builder falls back to one line from `contract_value` with spent = paid invoices, so nothing breaks on existing projects.

Writes (creating lines, credits, parties, funding events) are not included. Add `lib/actions/budget.ts` in the same shape as `lib/actions/change-orders.ts`, or let agents populate the tables through new MCP tools (`set_budget_lines`, `credit_budget_line`, `add_funding_event`).

## The math

Everything is integer cents. All derived numbers come from `computeTotals(view)`:

```
budget        = Σ lines.budgetCents                          (credited lines included: it is the ceiling)
spent         = Σ active lines.spentCents
committed     = Σ active lines.committedCents
est           = Σ active lines.estToFinishCents
projected     = spent + committed + est
headroom      = budget - projected                           (negative = over)
leftToDraw    = budget - spent - committed
credited      = Σ credited lines.budgetCents                 (budget released to change orders)

coTotal       = Σ approved/billed/paid COs.totalCents        (draft/sent are "pending", shown outlined, not counted)
coCredit      = Σ those COs' credits
coOwner       = coTotal - coCredit - coFunder
projectTotal  = projected + coTotal

paidBy[party] = min(baseShare, budget)
                + (owner only) coOwner + max(0, -headroom) + unfunded
                + (funder)     coFunder
                - (non fixed-price) its share of positive headroom
```

"Active" means not credited. A credited line's budget still counts toward the ceiling, but its cost is tracked on the change order instead, and the credit lowers what the client pays for that CO.

Line variance = spent + committed + est - budget. Over is red, under is green, within $1 is "on budget".

## Every field

### `BudgetView`

| Field | Meaning | Fill it with |
|---|---|---|
| `basis` | How the base scope is priced: `fixed_price`, `insurance`, `cost_plus`, `time_materials`. Changes who benefits from an under-run (SJC margin on fixed price; the payer otherwise). | The contract type. |
| `asOfLabel` | Date the numbers were true. | "Sep 18, 2026" |
| `budgetLabel` | Caption under the big number. | "contract value", "insurance budget", "target budget", "not-to-exceed" |
| `budgetCaption` | One line on how the ceiling was built. Optional. | "Dwelling RCV + code upgrade; includes the $10k deductible." |
| `parties` | Who pays for the base scope. Exactly one has `isOwner`. Sum of `baseShareCents` should equal the budget; any shortfall shows as "unfunded" and lands on the owner. | Fixed price: one owner party at the contract value. Insurance: insurer at net claim + owner at deductible. Lender: lender at loan amount + owner at down payment. |
| `lines` | The base budget, one row per trade or category. See below. | From the approved estimate's sections, the carrier estimate's categories, or the signed contract's schedule of values. |
| `changeOrders` | Everything beyond base scope. See below. | `change_orders` rows plus credits. |
| `fundingEvents` | Expected inflows and what triggers them. Optional. | Insurance payments, lender draws, deposits, milestone payments. Empty on a simple fixed-price job. |
| `clientInvoices` | Ledger of what SJC billed the client. | `invoices` rows. |
| `subInvoices` | Ledger of sub/vendor invoices, quotes, POs. | `sub_invoices` + `purchase_orders`. |
| `retainageCents` | Money the client or lender is holding back. Shown as a KPI note. Optional. | 5-10% of billed on commercial or lender jobs. |
| `notes` | Agent-written observations: assumptions, open questions, next moves. Collapsed by default so they never crowd the graphs. | Free text, one item per point. |

### `BudgetLine`

| Field | Meaning | How to decide |
|---|---|---|
| `id` | Stable key, slug-like. COs reference it. | "plaster", "electrical" |
| `trade` | Display name, short. | "Lath & plaster" |
| `detail` | One line of context under the name. | Vendor, scope, room count. |
| `source` | Where the budget number came from. Shown on hover. | "Estimate #12 section Plumbing", "USAA lines 3-5", "Kunkel bid 6/11" |
| `kind` | `trade` (drawn in the chart), `allowance`, `overhead`, `tax`, `contingency`, `other` (summed as "other budget", listed in the table). | Anything that is not a trade goes in a non-trade kind so the chart stays about work. |
| `budgetCents` | What this line is allowed to cost. 0 is valid: work that must happen but was never budgeted (radiators on Egan). | Fixed price: estimate line total including markup. Insurance: carrier line-item total, with O&P and tax as their own `overhead`/`tax` lines. Cost-plus: the target. |
| `spentCents` | Billed to the client AND paid, allocated to this line. | Paid `invoices` line items with `budget_key`. If invoices are not allocated by line, leave 0 and use `committed`; the panel still works. |
| `committedCents` | Known, owed, not yet on a paid client invoice: approved sub invoices, sent POs, signed quotes, unpaid contract balances. | Σ sub cost on the line minus spent, floored at 0. |
| `estToFinishCents` | Cost still to come that is not committed. The speculative number. | Not started: budget - spent - committed. In progress: the remaining sub balance not yet invoiced. Done: 0. Revisit as bids land. |
| `status` / `statusKind` | Short label and chip color. | `money` complete/under, `accent` in progress, `flag` over/blocked, `info` credited, `ghost` not started. |
| `credited` / `creditedTo` | This line's scope was replaced by a change order; its budget is a credit on that CO and its cost is tracked there. | Client upgrades a claim-repaired bathroom to a full reno: the claim's tile and fixture lines are credited to the CO. |
| `flags` | Short warnings surfaced as red chips in the table. | "Supplement candidate", "No sub invoice on file", "Quote expired" |

### `BudgetChangeOrder`

| Field | Meaning | How to decide |
|---|---|---|
| `id` | Display number. | "CO-1" |
| `title`, `description`, `vendor` | What it is, what it replaces, who is doing it. | |
| `status` | `draft`, `sent`, `approved`, `declined`, `billed`, `paid`. Only approved/billed/paid count in totals; draft/sent show outlined as pending; declined are hidden from the chart. | Mirrors `change_orders.status`; billed/paid are derived from invoices. |
| `totalCents` | Full price to the client before credits. Negative for a deductive CO (scope removed, money back). | The signed CO amount. |
| `credits[]` | `{ lineId, amountCents }` base budget this CO absorbs. Client pays `total - Σ credits`. | Full line budget when the CO fully replaces the scope; partial when it replaces part. |
| `billedCents` | Already on client invoices. | Σ invoice line items with `co_id`. |
| `spentCents` | Actual cost on the CO, if tracked. Optional; for margin. | Sub invoices linked to the CO. |
| `paidBy` / `funderShareCents` | `owner` (default), `funder` (insurer/lender approved it as a supplement), `split`. | An approved insurance supplement is a CO paid by the funder. |

### `FundingEvent`

| Field | Meaning |
|---|---|
| `partyKey` | Which party it comes from; matches `BudgetParty.key`. |
| `source` | "USAA initial payment", "Bank draw 2 of 4", "Client deposit". |
| `amountCents` | |
| `trigger` | What has to happen: "On estimate", "When incurred", "At completion", "Inspection passed". |
| `status` / `statusLabel` | `expected`, `requested`, `received`, and a dated label. |

### `BudgetClientInvoice` / `BudgetSubInvoice`

Ledger rows. `allocations` / `key` say which line or CO the money belongs to; that is what lets spent and committed be computed per trade. When they are missing the totals still work, only the per-trade split degrades.

## Situations this covers

| Situation | How it is represented |
|---|---|
| Plain fixed-price remodel | `basis: fixed_price`, one owner party at contract value, lines from the estimate sections, no funding events. Headroom is SJC's margin risk. |
| Insurance restoration | `basis: insurance`, insurer + owner (deductible) parties, lines from the carrier estimate by category, O&P and tax as `overhead`/`tax` lines, funding events for ACV / depreciation / code upgrade. Supplements are COs with `paidBy: funder`. |
| Lender-financed addition | Lender + owner parties, funding events per draw with inspection triggers, `retainageCents` if held. |
| Cost-plus or T&M | `basis: cost_plus` / `time_materials`. Budget is the target; under-run flows back to the payer in "who pays". |
| Client upgrade beyond scope | CO with credits against the base lines it replaces (Egan spray foam, bathroom). |
| Client removes scope | CO with negative `totalCents`; chart draws it green. |
| Work required but never budgeted | Line with `budgetCents: 0`; shows fully as over, flagged "Supplement candidate" or "Unbudgeted". |
| Allowances and selections overages | Line with `kind: allowance`; when the client picks over allowance, either raise `est` (overage billed as-is) or create a CO for the overage. |
| Contingency | Line with `kind: contingency`, `est: 0` until drawn; when used, move the amount to the trade line's `est` and reduce contingency. |
| Deposits and retainage | Deposit is a `received` funding event from the owner; retainage in `retainageCents`. |
| Partial payments, unpaid invoices | Only `paid` invoices count as spent; `sent` shows in the ledger with days outstanding. |
| Multiple phases | One `BudgetView` per project; put the phase in `trade` ("Phase 2 · Framing") or run one project per phase. |
| Not enough data yet | Leave `spent` at 0, fill `committed` from quotes, let `est` default to budget. The panel renders; the notes say what is soft. |

## Rules for agents filling a BudgetView from documents

1. One line per trade as the payer sees it (an insurer's categories, an estimate's sections), not per invoice.
2. Demo and tear-off get their own line even when the source folds them into each trade.
3. Never double count O&P: it is either inside the trade lines (fixed price) or its own `overhead` line (insurance), not both.
4. A cost with no budget line still gets a line, at `budgetCents: 0`.
5. Every dollar a sub invoiced goes on exactly one line or CO.
6. Guesses go in `estToFinishCents` and get a note. Facts go in `spent`/`committed`.
7. Put reasoning and open questions in `notes`, not in `detail`.
