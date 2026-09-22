# Project financials: per-job overview + company view — build plan

*Drafted 2026-09-21 from Joe's "Financial overview per project" packet (the
packet is preserved verbatim under `docs/reference/project-budget-packet/`).
This document is the spec a build agent works from. Status: **PLAN — not built.**
Mark phases `[x] + commit` in §10 as they land.*

*v2, 2026-09-21: revised after Astra's review. Astra's comments are kept where
they were left; each is followed by a "Resolved in v2" note naming the rule that
changed. §14 lists what changed and the production evidence behind it.*

## 0. In one paragraph

> **Astra review — overall (2026-09-21):** Strong direction: separate client price from job cost, share calculations between project and company views, explain the sources, and review the math first. Keep the design and phase structure, but resolve the financial rules below before implementation. These comments are recommendations; the proposed specification is preserved below them.
>
> **Resolved in v2:** All seven specific comments were accepted and folded into the rules below; none was rejected. The design and phase structure are kept, as recommended. §14 lists each correction with its evidence, including two that turned out to be wrong on live data today rather than hypothetically.

Add a **Overview** section at the top of every project's Money tab that answers
three questions at a glance — *what will this job make, how far along is it, is
anything wrong* — and lets anyone drill from those three numbers down to the
line, invoice, and receipt that produced them. Then roll the same numbers up
into a company page at `/money` that ranks every open job by projected profit
and flags the ones that need attention. The packet's `BudgetView` contract,
`computeTotals()` math, and `BudgetPanel` are the starting point; §3 changes
their semantics so the page can actually state profit on a fixed-price job
(the packet cannot — see §3.1), §4 reshapes the UI for a reader who has never
read a financial statement, and §11 says how to run the build with agents.

## 1. Who reads it, and the vocabulary

Two readers, one page:

| Reader | Needs | Where they stop |
|---|---|---|
| Glance (Joe on his phone between jobs; a staff member with the `money` area) | Profit, progress, problems. Three numbers and one sentence. | The headline strip (§4.1) |
| Deep dive (Joe doing a weekly review; an agent filling or auditing the numbers) | Every line, every invoice, every receipt, and the formula that ties them together | The detail folds (§4.6) |

**Vocabulary is fixed.** The top layer uses only these words; the detail layer may
add the accounting terms in parentheses on first use.

| Word on the page | Means | Not |
|---|---|---|
| **Price** | What the client pays: contract + approved change orders | "contract value", "revenue", "budget" |
| **Cost** | What the job costs SJC: subs, materials, labor, permits | "spend", "expense" (used only in the ledger) |
| **Profit** | Price − Cost. Shown with **margin** (profit ÷ price) | "headroom", "variance" |
| **Spent** | Cost SJC has already paid | "actual" |
| **Owed** | Cost incurred but not yet paid: a sub's invoice on file, PO material received and not yet billed | "committed", "A/P" |
| **On order** | Promised but not yet incurred: the unreceived, unbilled balance of a sent PO (a signed sub quote is entered as a PO to that sub) | "committed" |
| **Still to spend** | Best estimate of cost yet to come that is not on order | "est. to finish", "ETC" |
| **Budget** (a trade line's) | What that line was *planned* to cost | the price of that line |
| **Work done (by cost)** | (spent + owed) ÷ projected cost. **On order never counts** — ordering cabinets is not installing them. A trade can carry a hand-set % where cost misleads (§3.3) | `projects.progress` (that column is "% billed") |
| **Billed / Collected / Left to bill** | Invoices sent; money received; price − billed | |
| **Unpaid invoices** | Sent invoices in SJC OS that are not paid yet | "outstanding A/R" on a job whose billing history is partial |
| **Left to collect** | Price − collected. Includes work that has not been billed, so it is **not** "outstanding" | |
| **Over budget / Under budget** | A line projected to cost more / less than its budget | |

## 2. What exists today (read before building)

### 2.1 Live data reality (2026-09-21, read-only count on the prod DB)

| Signal | Count | What it means for the page |
|---|---|---|
| Projects / open (not warranty) | 51 / 10 | The company view is 10 rows plus a closed-jobs section |
| Projects with `contract_value > 0` / `collected_to_date > 0` | 13 / 11 | Whole **dollars**. This is the only money signal most jobs have |
| Projects with invoices / invoices / paid | 3 / 5 / 3 | Cents. Billed/collected come from here when present |
| Projects with estimates / approved estimates / lines | 6 / 2 / 72 | Cents. Sections are inconsistent ("Subcontract labor", "Kitchen", "Electrical"...) |
| `sub_invoices` | **0** | The only cost-actuals table is empty |
| Purchase orders | 2 | Cents |
| Change orders | **0** | `change_orders.number` etc. do not exist yet |
| Selections sections with budgets | 3 projects | Dollars; a different "budget" (client selections), not this one |

Consequences the design has to respect:

1. **Every job renders something honest with only `contract_value` and
   `collected_to_date`.** That is the default state, not an edge case. The page
   must say what it does *not* know (§3.6 completeness) instead of showing $0 cost
   and 100% margin.
2. **Cost data will be entered after the fact, by agents from documents**
   (Houzz estimates/invoices, sub invoices, receipts) more than it will be typed
   in live. The packet's "agent fills a BudgetView from PDFs" idea is the
   primary population path, so the MCP write tools (§8) are not optional.
3. **Units.** `projects.contract_value`, `collected_to_date`, `selections_budget`,
   `project_sections.budget` are whole **dollars**; `invoices`, `estimates`,
   `estimate_lines`, `purchase_orders`, `sub_invoices`, `change_orders.price_cents`
   are **cents**. Convert at the builder boundary (×100), never in the view or UI.
4. `projects.progress` is a hand-typed integer that the app labels "% billed"
   (`lib/projects.ts:117`, memory: collected ÷ contract). **Do not write it and
   do not call it "% complete".** The page shows *work done* (cost-based) and
   *billed* (invoice-based) as two separately labeled numbers.
5. **Two "collected" numbers already disagree in production**, because nothing
   keeps `projects.collected_to_date` in step with the `invoices` table
   (`markInvoicePaid` never touches it). Read-only check, 2026-09-21, the three
   jobs that have invoice rows:

   | Job | Hand-kept collected | Paid invoices on file | What "use invoices when any exist" would show |
   |---|---|---|---|
   | alcantara-closet | $3,726.00 | $0 (one $3,710.54 draft) | collected drops to **$0** |
   | elaine-louiselle | $14,148.00 | $15,647.82 | collected moves by $1,499.82, unreviewed |
   | burns-closet | $1,660.00 | $1,660.00 | agrees |

   So the billing source is an explicit, reviewed per-job setting (§3.2
   "Billing"), never inferred from whether invoice rows exist.
6. **A PO's `fulfilled` status means received, not paid** (`lib/po-recompute.ts`
   derives it from `qty_received`). POs have no payment state at all; `closed`
   is a manual step from sent / partial / fulfilled; and **no code path ever
   changes `sub_invoices.status`** after the sub submits. "Spent" cannot be
   read off either table today — §3.3 "Counting each cost once" defines it.

### 2.2 Code to build on (do not rebuild)

- `lib/money.ts` `getProjectMoney(slug)` — invoices only (paid/outstanding). Keep;
  the builder reads `invoices` itself.
- `lib/estimates.ts` `getProjectEstimates(slug)` — approved estimate + lines with
  `section`, `qty`, `unit_cost`, `markup`, `extended` — the budget source.
- `lib/purchase-orders.ts`, `lib/change-orders.ts`, `lib/sub-portal.ts` (sub
  invoices) — cost and CO sources.
- `lib/actions/change-orders.ts` — the shape for `lib/actions/budget.ts`
  (`requireAccess`, `Result`, `revalidatePath`).
- `components/projects/MoneyPanel.tsx` — `ModalShell`, `Row`, table styling;
  imports `fmtUsd` from `lib/cost-book-units` (never `lib/money` in a client file).
- `components/projects/PanelSections.tsx` — the Money tab sub-nav.
- `lib/permissions.ts` — the `money` area ("All other financials", paths
  `["/books"]`) is the documented default gate for every future money feature.
- `mcp/sjcos-mcp.mjs` `server.registerTool(...)` pattern; sibling modules export
  `registerXTools(server)`; `mcp/call-tool.mjs` stdin helper for terminal tests.
- `db/apply-floor-designer.mjs` — the migration-runner pattern (reads `.env.local`,
  `pg` directly, `STATEMENTS[]`, idempotent). The packet's
  `db/apply-project-budget.mjs` imports `../lib/db.js`, which does not exist —
  rewrite it in this pattern.
- `docs/phase-5-accounting-plan.md` — the future ledger. This feature is the
  "job costing + WIP" slice of §5.4 done small-shop style **without** the
  ledger. Its tables must be additive and forward-compatible with that plan
  (§6 notes where).
- Meters: `h-1.5 rounded-full bg-paper-3` with an inner `bg-money` fill (used on
  the project rail and projects list). No chart library exists; charts are inline
  SVG or flex divs.

## 3. The model: `BudgetView` v2

Start from `docs/reference/project-budget-packet/lib/budget-types.ts.txt` (the
packet's source files are stored with a `.txt` suffix so the repo's tsconfig and
linter never compile them). Keep its
shape, documentation style, cents-everywhere rule, and "no db import" rule.
Change what follows.

### 3.1 Why the packet cannot state profit

The packet defines a line's `spentCents` as "cost that has been **billed to the
client and paid by the client**" and derives `headroom = budget − (spent +
committed + est)`. On an insurance or cost-plus job, where the client is
reimbursing pass-through costs, that works. On a fixed-price job (all of SJC's
regular work — `db/schema.sql` retires retainers with "SJ Carpentry is
fixed-price only") it collapses: by the end of the job "spent" equals the
contract by definition, headroom trends to zero regardless of what the subs
actually cost, and margin never appears. The packet's README even says "headroom
is SJC's margin risk" for fixed price, but the number cannot show it.

The fix is to keep **cost** and **price** on separate axes everywhere:

- The **cost** side of a line: `budgetCents` (planned cost), then four states
  of real money in order of certainty — `paidCents` (spent), `owedCents`
  (incurred, unpaid), `orderedCents` (promised, not incurred),
  `estToFinishCents` (forecast).
- The **price** side: `priceCents` per line (what the payer pays for that scope;
  from the estimate's `extended`, the carrier's line total, or the contract's
  schedule of values), and `priceCents` on the view (the base contract).
- Money the client has paid is **collected**, a project-level revenue fact from
  invoices, never a per-line "spent".

### 3.2 Field changes

`BudgetLine`
- replace `spentCents` with `paidCents`: cost SJC has **paid** on this line
  (expenses; sub invoices marked paid). A received PO is *not* paid.
- replace `committedCents` with two fields, because they answer different
  questions:
  - `owedCents`: **incurred, not yet paid** — a sub's invoice on file and
    unpaid; PO material received and not yet billed.
  - `orderedCents`: **promised, not yet incurred** — the unreceived, unbilled
    balance of a sent PO. A signed sub quote is entered as a PO to that sub, so
    the PO is the one commitment record.

  All three are **derived by the assembler from linked cost records** (§3.3
  "Counting each cost once"); nobody types them.
- `estToFinishCents`: remaining cost that is not on order. Three states, kept
  distinct: a number (including an explicit **0** = nothing left) is used as
  given; `null` means "derive" = `max(0, budget − paid − owed − ordered)`; a
  line at **100% complete** derives to 0. ("Complete" is `percentComplete =
  100`, never a match on the free-text status label.)
- add `percentComplete` (optional, 0–100): a hand-set physical % for a trade
  where cost misleads (cabinets delivered and paid for, not installed).
- add `priceCents` (optional): what the payer pays for this line. Default =
  `budgetCents` when unknown. Lets the trade table show expected margin per
  trade and lets the CO credit math use price, not cost.
- keep `kind`, `credited`, `creditedTo`, `flags`, `status`, `statusKind`.
- **A credit takes effect only once its change order is counted.** Until the CO
  is signed the base scope may still have to be built, so the line stays in the
  cost (budget and est-to-finish). Money already spent on a line keeps counting
  after the line is credited away — only its budget and its est-to-finish leave.

`BudgetChangeOrder`
- `totalCents` (price, may be negative), `credits[]`, `billedCents`, `paidBy`,
  `funderShareCents`: unchanged.
- the cost side mirrors a line: `budgetCostCents` (the CO's **planned cost,
  fixed when it is priced**; optional), `paidCents` / `owedCents` /
  `orderedCents` (derived from linked costs, exactly as for a line),
  `estToFinishCents` (optional). Remaining cost has three defined states:
  1. `estToFinishCents` set, including an explicit 0 → used as given.
  2. `estToFinishCents` null, `budgetCostCents` set → derived:
     `max(0, budgetCost − paid − owed − ordered)`.
  3. both null ("cost not planned") → **conservative default**: the CO is
     assumed to cost its **full price, before credits**, so
     `est = max(0, total − paid − owed − ordered)`. (Not the net price: a
     credited line drops out of the cost, so assuming the net would invent
     profit equal to that line's cost.) This holds whether none or only part of
     its cost has been linked. `missing` gains "CO-n cost not
     planned; assumed at price." A deductive CO (total ≤ 0) in this state derives
     to 0 and is flagged "reduce the affected trade's still-to-spend."
- **Cost already incurred or ordered on a CO always counts**, whatever its
  status. A draft, sent, or declined CO contributes no price and no
  est-to-finish, but money spent on it is real, and it is flagged ("$300 spent
  on CO-2, which is not signed").

`BudgetView`
- add `priceCents`: the base price. Builder order: approved estimate `total` →
  `projects.contract_value × 100` → Σ line `priceCents`.
- **Billing** — add `billing: { source, collectedCents, billedCents | null,
  unpaidInvoicesCents, openingCollectedCents, openingBilledCents, mismatchCents }`.
  The source is an explicit per-job setting (`projects.billing_source`), never
  inferred from whether invoice rows exist (§2.1 item 5):
  - `manual` (every existing job at migration): `collected =
    collected_to_date × 100`. `billed` is **null — unknown**, not assumed equal
    to collected. Invoice rows still show in the ledger, and
    `unpaidInvoices = Σ sent invoices` is reported as the known fact it is,
    beside the label "billing history isn't tracked here yet".
  - `invoices`: `collected = openingCollected + Σ paid invoices`; `billed =
    openingBilled + Σ (sent + paid) invoices`. The opening balance is money
    collected before invoices were tracked here (a Houzz deposit carried on the
    estimate, per the Houzz billing patterns), entered once, with a note.
  - Moving a job from `manual` to `invoices` is a **reviewed action**
    (`reconcileBilling`, §4.7): it shows both totals side by side, proposes
    `opening = max(0, hand-kept − paid invoices)`, and Joe confirms. Importing
    an invoice never changes the source by itself, so it can neither discard
    history nor double-count it.
  - `mismatchCents` = hand-kept collected − (opening + paid invoices). Flagged
    on an `invoices` job when it is $1 or more either way (the hand-kept total
    is whole dollars, so cents always differ); on a `manual` job only when the
    invoices show **more** collected than the hand-kept total — the other
    direction is just history nobody has entered yet. **Every job, new ones included, starts on `manual`** (v2.2): only 3 of 51
    jobs have any in-app invoices — billing still runs through Houzz — so a
    new job defaulted to `invoices` would show $0 collected.
- add `expenses: BudgetExpense[]` (see §6 `expenses`) for the ledger fold.
- add `completeness: BudgetCompleteness` (§3.6).
- rename `subInvoices` → `costs` (sub invoices + POs + expenses, one ledger),
  each row `{ vendor, dateLabel, amountCents, paidCents, owedCents,
  orderedCents, kind, status, note, key, source: "sub_invoice" | "po" |
  "expense", sourceId, purchaseOrderId?, sourceRef? }`. The three state fields
  are what the row **contributes after allocation** (a PO fully billed by its
  linked invoice contributes 0), so the ledger always sums to the totals. `key`
  absent ⇒ **unassigned**; unassigned cost is still counted in project totals
  (as a synthetic "Unassigned" line) so profit is never overstated by an
  unfiled receipt.
- keep `basis`, `budgetLabel`, `budgetCaption`, `parties`, `fundingEvents`,
  `clientInvoices`, `retainageCents`, `notes`, `asOfLabel`.

### 3.3 `computeTotals()` v2 — the one place the math lives

> **Astra review — change orders:** The zero-margin fallback is inconsistent: §3.2 applies it only when no cost fields are set, while the §9 fixture expects it with $700 already committed. Define missing, partially known, and explicitly zero remaining costs. Count costs already incurred on pending or declined COs even when their revenue is excluded. Preserve a separate original CO cost budget: deriving it from current actuals, commitments, and remaining cost makes the budget move with the forecast and hides overruns.
>
> **Resolved in v2:** Right on all three points. §3.2 now defines the three states of a CO's remaining cost, and the zero-margin default covers partly linked costs too — which is what the fixture always did; the prose was wrong. Cost on an unsigned or declined CO counts. The CO's planned cost is a fixed `budgetCostCents`, never rebuilt from the forecast, so a CO overrun shows in cost headroom and planned profit stays put.

> **Astra review — progress:** Under §7, committed costs include sent POs, so ordering cabinets can increase “Work done” before installation starts. Separate ordered commitments, incurred costs, and payments. Define which costs qualify for the progress estimate and label it accordingly, or track physical progress separately. Earned and under-billed figures depend on this decision too.
>
> **Resolved in v2:** Correct, and §1 and §7 of the draft contradicted each other on it. "Committed" is split into **owed** (incurred) and **on order** (not incurred); work done counts spent + owed only, is labeled "by cost", and a trade can carry a hand-set % where cost misleads. On the §9 fixture this moves work done from 73% to 59% and flips the billing sentence from "about $2,400 of unbilled work" to "billed about $5,700 ahead" — the old rule would have told Joe to invoice for cabinets that had only been ordered.

#### Counting each cost once — `allocateCosts()`

Three kinds of record can describe the same purchase: a **PO** (a promise), a
**sub invoice** (a bill), and an **expense** (a payment SJC made directly by
card, cash, or check). A sub invoice or an expense may name the PO it bills
against (`purchase_order_id`). The rule is a pure function in
`lib/budget-assemble.ts`:

```
for each PO with status sent | partial | fulfilled | closed   (draft, queued, void contribute nothing):
  R = Σ round(qty_received × unit_cost)            received value
  B = Σ linked sub invoices + Σ linked expenses     billed against it, in any payment state
  PO.owed    = max(0, R − B)                        received, and nobody has billed it yet
  PO.ordered = closed ? 0 : max(0, subtotal − max(R, B))
  PO.paid    = 0                                    a PO is never "spent"; its payment is the linked expense or paid invoice
each sub invoice:  paid = amount when status = 'paid'; otherwise paid = clamp(paid_cents, 0, amount); owed = amount − paid
                   (a 50% deposit on a sub's invoice is half spent, half owed — one row, one source_ref)
each expense:      paid = amount
a linked invoice or expense inherits the PO's trade / CO unless it names its own
```

Worked: a $10,000 PO is sent → on order 10,000. Fully received → owed 10,000.
Its $10,000 invoice arrives, linked → the PO contributes 0 and the invoice owes
10,000. The invoice is paid → spent 10,000. **$10,000 at every step.** Closing
a PO releases only what was never received or billed; it never erases cost.
Invoices above the PO total count in full and raise "billed $X over PO-n".
Unlinked look-alikes (same job, same amount, within 14 days) raise "possible
duplicate" and are never merged silently — except two records of one type that
each carry their own `source_ref`, which are two documents. An unlinked bill
for exactly a live PO's total is flagged against that PO whatever the dates.

Agent imports carry a stable `source_ref` ("houzz:IN-10047", "cpk:1745");
writes upsert on `(project_id, source_ref)`, so a retried import cannot
duplicate a cost.

#### Totals

All integer cents; ratios are plain numbers; `Math.round` only when a ratio is
turned back into cents. "Active" = not credited, where a line counts as
credited only while the CO it names is counted. "Counted" COs = approved,
billed, paid. "Any CO" = every status.

```
-- cost side   (paid / owed / ordered come from allocateCosts)
paid            = Σ ALL lines paid    + Σ any CO paid    + unassigned paid      (real money always counts,
owed            = Σ ALL lines owed    + Σ any CO owed    + unassigned owed       even on a line credited away)
ordered         = Σ ALL lines ordered + Σ any CO ordered + unassigned ordered
estToFinish     = Σ active lines est     + Σ counted COs est            (the three states in §3.2)
incurred        = paid + owed
projectedCost   = incurred + ordered + estToFinish
costSoFar       = incurred + ordered                                     (shown instead of projectedCost when profit is unknown)

budgetCost      = Σ active lines budget                                  (credited lines excluded: their cost lives on the CO)
coBudgetCost    = Σ counted COs (budgetCostCents ?? max(0, total))       (fixed; never rebuilt from the forecast)
costHeadroom    = budgetCost + coBudgetCost − projectedCost             (negative = over; unsigned-CO spend lands here)
unsignedCoCost  = Σ draft/sent/declined COs (paid + owed + ordered)      (flagged)

-- price side
basePrice       = view.priceCents
coNet           = Σ counted COs (totalCents − Σ credits)                 (what the client pays extra)
coPending       = Σ draft/sent COs totalCents                            (informational, never counted)
price           = basePrice + coNet

-- profit   (all three are null unless completeness.budget is true, §3.6)
projectedProfit = price − projectedCost
marginPct       = price > 0 ? projectedProfit / price : null
plannedProfit   = price − (budgetCost + coBudgetCost)                    (what the plan promised; does not move with the forecast)

-- work done, by cost   (on order NEVER counts)
lineProjected   = line paid + owed + ordered + est
lineDone        = percentComplete != null ? round(lineProjected × percentComplete / 100)
                                          : min(lineProjected, line paid + line owed)
workDonePct     = projectedCost > 0 ? (Σ lineDone + Σ any CO incurred + unassigned incurred) / projectedCost : null
                  (also null when completeness.budget is false: without the whole scope there is no denominator)
earned          = workDonePct == null ? null : round(price × workDonePct)

-- billing   (billed is null on a 'manual' job, §3.2)
collected       = billing.collectedCents
leftToCollect   = price − collected                                      (always known; NOT "outstanding")
unpaidInvoices  = billing.unpaidInvoicesCents                            (sent invoices in SJC OS; a fact at any coverage)
billed          = billing.billedCents
leftToBill      = billed == null ? null : price − billed
overUnderBilled = billed == null || earned == null ? null : billed − earned    (+ = billed ahead of the work, − = unbilled work)
billedPct, collectedPct = ÷ price; null when the numerator is

-- who pays (only meaningful with >1 party or funder COs; same rule as the packet, on the price side)
paidBy[party]   = min(baseShare, basePrice)
                + owner:  coOwner + unfunded
                + funder: coFunder
unfunded        = max(0, basePrice − Σ baseShare)

-- per line
lineVariance    = lineProjected − budget      (> $1 over → flag, < −$1 → under)
lineMargin      = line price − lineProjected  (only shown when line.priceCents is set)
overLines / underLines: sorted by |variance|, credited lines excluded
```

Keep the packet's `fmtK` (whole dollars) and `fmtSigned`; add `fmtPct`
(`"24%"`, one decimal only under 10%).

### 3.4 `describeFinancials(view, totals): string[]` — the plain-English layer

Deterministic template sentences, never AI, so the summary is always true.
Plain strings with no markup, so the same text serves the page, the MCP tools
and the Ask-window context (the bold below is for this document only).
Pure function in `lib/budget-types.ts`, unit-tested. Rules:

- Sentence 1, profit, by `completeness.profit` (§3.6):
  - `projected`: "This job should make about **$15,700 (26%)** if the remaining
    work costs what you expect — $1,300 less than planned."
  - `planned`: "The budget plans a profit of about **$17,000 (28%)**. No costs
    have been entered yet, so this is the plan, not a forecast."
  - `unknown`: "Profit isn't known yet: the budget for this job isn't finished.
    **$200** of cost has been logged so far." (Or "there is no budget for this
    job yet".) Never a margin in this state. The wording has to hold both when
    trades are missing and when an adopted estimate's costs aren't real yet.
- Sentence 2, progress. With a complete budget and tracked billing: "About
  **59%** of the work is done (by cost) and **69%** of the price is billed —
  you've billed about **$5,700 ahead** of the work." / "... there is about $X
  of unbilled work to invoice." / "... billing is roughly on pace" (within 5
  points). On a `manual` job: "**48%** of the price has been collected; billing
  history isn't tracked here yet."
- Sentence 3, cash. "$12,000 of invoices are sent and not yet paid" (+ "; INV-002
  is 17 days out"). Omitted at $0. Then always: "**$31,200** is left to collect
  on this job" — labeled as that, never as "outstanding".
- Sentence 4, problems, only when any: "2 trades are over budget (Cabinets
  +$1,000, Demo +$200)." / "$300 has been spent on CO-2, which isn't signed." /
  "1 change order ($5,000) is waiting on a signature and is not counted." /
  "$1,450 of costs are not assigned to a trade." / "The hand-kept collected
  total is $1,500 off the invoices — reconcile billing."

### 3.5 Rounding and display

Charts and stat tiles show whole dollars (`fmtK`); tables show cents (`fmtUsd`).
Percentages are whole numbers. Negative profit is shown as "−$3,200 (loss)".

### 3.6 Completeness — what the numbers rest on, and what they may claim

> **Astra review — incomplete data:** One linked receipt proves some costs exist, not that the budget or remaining-cost forecast is complete. Track completeness separately from source presence; keep profit unknown when the remaining scope is unaccounted for. The §3.2 invoice fallback also needs reconciliation: importing the first invoice must not silently discard historical `collected_to_date`. Distinguish partial imports from complete billing history, with provenance and a reviewed opening balance where needed. Simply adding both sources would risk double-counting.
>
> **Resolved in v2:** Agreed on both halves. The draft's ladder conflated "a cost row exists" with "the costs are complete": one $200 receipt on a job with no budget would have read as a 99% margin, the exact failure §2.1 set out to avoid. Sources and completeness are now separate, and profit stays unknown until the budget covers the scope. The invoice fallback was worse than the comment guessed — it is already wrong on live data (§2.1 item 5) — and is replaced by an explicit billing source with a reviewed opening balance (§3.2).

Two separate things, never merged into one "confidence" grade:

```ts
interface BudgetCompleteness {
  // What exists (source presence). Says nothing about whether it is all of it.
  basedOn: string[];        // "Contract $63,539", "Approved estimate (12 lines)", "7 sub invoices", "2 receipts"

  // What is claimed complete.
  budget: boolean;          // the budget lines cover the WHOLE scope. True when adopted from an approved
                            // estimate, or when the owner / agent marks it (projects.budget_complete).
                            // Warned, not blocked, when Σ line price is more than 2% off the base price.
  costsThrough: string | null;  // "costs entered through" date, asserted by whoever filled them; null = never asserted
  billing: "tracked" | "partial" | "none";
                            // source = invoices → tracked; manual with invoice rows → partial; manual with none → none

  // What follows from the two above.
  profit: "unknown" | "planned" | "projected";
  //   unknown   = !budget                         → show Cost so far; never a profit or a margin
  //   planned   = budget && no cost rows linked   → show planned profit, labeled as the plan
  //   projected = budget && cost rows linked      → show projected profit + "costs through <date | not dated>"
  missing: string[];        // "Budget doesn't cover the whole job", "CO-2 cost not planned", "$1,450 unassigned",
                            // "Costs last entered Sep 1", "Billing history partial", "Est. to finish derived on 4 lines"
}
```

Rendered as one chip in the headline strip ("Planned · budget from estimate · no
costs entered" / "Projected · costs through Sep 14 · billing partial") and
expanded in the "How these numbers are figured" fold. A construction job whose
`costsThrough` is more than 14 days old gains "Costs last entered …" in
`missing` and on the company attention list.

## 4. Per-project page

Location: **first section of the Money tab**, labeled **Overview**, rendered
only when `can(viewer, "money")`. Deep link `?tab=Money&section=Overview`. The
Overview *tab's* Money rail card gains one line, "Projected profit", when the
viewer holds `money` (same `showMoney`-style gate, a new `showFinancials`).

Component: `components/projects/BudgetPanel.tsx` (client, pure render +
edit modals) fed by `getProjectBudget(slug)`. Split the charts into
`components/projects/budget/` (`HeadlineStrip.tsx`, `InOutBars.tsx`,
`TradeChart.tsx`, `CoChart.tsx`, `PayChart.tsx`, `Folds.tsx`, `EditModals.tsx`)
so no file passes ~400 lines. Layout order top to bottom, every layer usable
without the ones below it:

### 4.1 Headline strip (the glance layer)

One `Card`. Left: the **hero figure**, which follows `completeness.profit`:
`projected` → "Projected profit" with a margin chip (`money` when within 2
points of the planned margin or better, `flag` on a loss); `planned` → "Planned
profit", margin chip `ghost`, caption "the plan — no costs entered yet";
`unknown` → the words "Profit not known yet" in place of a number, never $0 and
never a margin. Right: three stat tiles —

| Tile | Value | Note under it |
|---|---|---|
| Price | `fmtK(price)` | "contract $60,000 + 1 change order $1,200" |
| Cost — or **Cost so far** (`costSoFar`) when profit is unknown | `fmtK(projectedCost)` | "spent $19,500 · owed $7,500 · on order $6,000 · still to spend $12,500" |
| Work done (by cost) | meter, `workDonePct`; "—" when unknown | "billed 69% · collected 49%" (billed is omitted on a `manual` job) |

Below the tiles: the `describeFinancials` sentences as one short paragraph
(13px, `text-ink-2`). Below that, one row: completeness chip · "as of Sep 21" ·
a text button "How these numbers are figured" that opens the fold in §4.6.

Typography: the hero uses the app's serif at 34–40px to match every other
big number in SJC OS (`MoneyPanel`, page `h1`s); proportional figures, not
`tabular-nums`. (The dataviz reference prefers sans for hero figures; brand
consistency wins here — flagged in §12.)

Unknown-profit state (`completeness.profit = "unknown"` — the default for every
job at launch): the strip renders Price / Cost so far / Collected / Left to
collect, the sentence says why profit isn't known, and a single primary action
shows — **Use estimate as budget** when an approved estimate exists, otherwise
**Add first budget line**. A receipt logged on such a job raises Cost so far
and nothing else.

### 4.2 "Money in, money out" (the picture)

One card, two horizontal bars sharing **one axis from $0 to price**, built with
flex divs (no SVG, no horizontal scroll on phones):

```
What it costs   [ Spent ████ | Owed ███ | On order ▒▒ | Still to spend ░░░ ]  ▏budget  ······· price ▕
What you billed [ Collected ████ | Billed, unpaid ██ | Left to bill ░░░ ]      ▏earned              ▕
```

- Segments use one **ordinal ramp** (certainty: paid → owed → on order →
  forecast): `--accent-2 #38442d` / `--accent #4c5a40` / `--ink-3 #767a69` /
  `--ink-4 #a7a992`. Validated with the dataviz palette script (`--ordinal`,
  light surface `#fbfaf4`) as a four-step ramp: all checks pass. Row 2 uses
  steps 1, 2 and 4; the row label carries identity, not hue. On a `manual` job
  row 2 collapses to Collected | Left to collect with the note "billing history
  isn't tracked here yet"; when profit is unknown row 1 shows Cost so far
  against the price with no "still to spend" segment and no profit caption.
  Do **not** use the packet's `accent / ai / paper-4` trio: the validator fails
  it (normal-vision ΔE 11.9 < 15, `paper-4` outside the lightness band and at
  1.5:1 contrast). SJC's brand palette is low-chroma by design, so no three
  categorical hues from it pass — which is why the answer is an ordinal ramp,
  not "better" categorical colors.
- 2px `bg-card` gaps between segments; 4px radius on the data end only; bars
  ≤ 24px tall.
- Tick marks, not outlines: a 1px `--ink` hairline with a tiny mono label at
  **budget** (row 1) and **earned** (row 2). When projected cost passes the
  price, the overflow draws in `--flag` beyond the axis end with the label
  "over price".
- Legend under each row with the dollar values (this is also the direct label;
  no numbers inside segments). Hover/focus on a segment shows a tooltip with
  the value and the definition from §1.
- The gap between the end of row 1 and the axis end **is the profit**; caption
  it once: "The space after Cost is your profit."

### 4.3 Cost by trade

Keep the packet's `TradeChart` as bullet rows, with these changes: segments
use the ordinal ramp; the budget is a **tick**, not a stroked rectangle around
the bar; the variance at the row end is text in `text-flag` / `text-money` with
a "+"/"−" sign and the word "over"/"under" (never color alone); rows sort by
absolute variance descending, ties by size; non-trade kinds (overhead, tax,
contingency, allowance) are drawn only when their budget > 0 and grouped at the
bottom under a hairline. Keep the Over / Under lists beside it. Hover tooltip
per row; the table twin is the lines fold.

### 4.4 Change orders (only when any exist)

Packet chart with: pending orders drawn in the light ramp step with the label
"pending, not counted" instead of a dashed stroke; deductive orders extend left
of a zero line in `--money`; credits shown as a lighter trailing segment with
"credits $X of base scope"; each row shows net-to-client and, when tracked,
the CO's own margin.

### 4.5 Who pays (only when it matters)

Render only when `parties.length > 1` or any counted CO has `paidBy ≠ owner`
or `unfunded > 0`. Ten of ten open jobs are single-party fixed price; they
never see this card. Insurance/lender jobs (Egan) get the packet's two-row
stack unchanged except for the ramp.

### 4.6 Details (folds, collapsed by default)

1. **Trades, line by line** — the packet table plus columns Price and Margin,
   inline flags, an "Unassigned costs" synthetic row when any, footer totals,
   and per-row **Edit** (owner/`money`).
2. **Change orders** — cards as in the packet plus cost fields.
3. **Costs** — one ledger: sub invoices, POs, expenses. Columns: date, vendor,
   what, amount, status, **trade** (a select; changing it calls
   `assignCostToLine`), **bills against** (a PO select on invoices and
   expenses; `linkCostToPurchaseOrder`), source chip, and **counts as** — what
   the row contributes after allocation (spent / owed / on order; a PO fully
   billed by its invoice reads "$0 · billed by CPK 1745"), so the ledger visibly
   sums to the totals. Inline flags: "billed $X over PO", "possible duplicate",
   "on an unsigned change order". Row action "Add expense" at the top; a sub
   invoice row carries **Mark paid** (`setSubInvoiceStatus`).
4. **Client invoices** — the packet ledger with days-outstanding.
5. **Funding** — only when funding events exist.
6. **Notes and open questions** — agent/owner notes.
7. **How these numbers are figured** — the §3.3 formulas rendered as a
   plain-English list with this job's numbers substituted in, e.g. "Profit =
   Price $61,200 − Cost $45,500 = $15,700", plus the completeness `basedOn` /
   `missing` lists. This is the explainability layer; every stat tile's "?"
   jumps here.

### 4.7 Editing (v1, owner or `money` area)

Actions in `lib/actions/budget.ts`, all `requireAccess("money")`, `Result`
returns, `revalidatePath("/projects/[slug]")` and `/money`:

| Action | Does |
|---|---|
| `adoptEstimateAsBudget(slug, { estimateId?, replace? })` | One budget line per `estimate_lines.section`: `budget = Σ round(qty × unit_cost)`, `price = Σ extended`, `kind` guessed from the section name (contingency/allowance/overhead/tax keywords, else trade), `source = "Estimate #id · section"`. Pins `projects.price_cents` to the estimate total when unset. Refuses if lines already exist unless `replace: true`, and a re-sync upserts by key — it never deletes a line costs may point at. **Marks the budget complete only when the estimate has real markup** (v2.2): both approved estimates on the live system are Houzz imports whose "costs" are client prices, and adopting one as-is would plan a $0 profit. Those get lines, prices, and a note; profit stays unknown until real costs are set. |
| `upsertBudgetLine(slug, line)` / `deleteBudgetLine` | Trade, kind, budget, price, est-to-finish (blank = derive, 0 = nothing left), % done (optional), status, status kind, flags, detail, source, sort. |
| `setBudgetSettings(slug, {...})` | basis, label, caption, retainage, notes, `price_cents` override, **budget covers the whole job** (`budget_complete`), **costs entered through** (`costs_through`). |
| `reconcileBilling(slug, { openingCollectedCents, openingBilledCents, note, alsoUpdateHandKept? })` | The reviewed switch from `manual` to `invoices` (§3.2). The modal shows hand-kept vs invoice totals side by side and the proposed opening balance. Owner only. |
| `setBudgetParties(slug, parties[])` | Replace the party list. |
| `addExpense` / `updateExpense` / `deleteExpense` | See §6. Receipt upload via the existing `lib/upload-store`. |
| `assignCostToLine(slug, source, sourceId, lineKey \| coNumber \| null)` | Sets `budget_line_id` / `change_order_id` on a sub invoice, PO, or expense. |
| `linkCostToPurchaseOrder(slug, source, sourceId, poId \| null)` | Sets `purchase_order_id` on a sub invoice or expense so the PO is consumed rather than counted twice (§3.3). |
| `setSubInvoiceStatus(slug, id, status, paidAt?)` | Approve / mark paid. Nothing in the app does this today (§2.1 item 6), and "spent" depends on it. |
| `setChangeOrderFunding(slug, coId, { paidBy, funderShare, credits[], budgetCost, estToFinish })` | The CO's budget-side fields. Its paid / owed / on-order amounts are derived from linked costs, never typed. |
| `addFundingEvent` / `updateFundingEvent` / `deleteFundingEvent` | |

Modals reuse `ModalShell` from `MoneyPanel`. Dollar inputs use
`dollarsToCents` / `centsToInput` from `lib/cost-book-units`.

### 4.8 Mobile and layout rules

**The layout answers to its column, never the window (v2.3).** The app's side
panels leave the project content column about **340 px wide on a 1280 px
laptop** and 660 px at 1600 — so "phone-sized" is the normal case, not the edge
case. The panel root is a Tailwind `@container` and every layout breakpoint
inside it is a container variant (`@xl:`, `@2xl:`, `@3xl:`); viewport
breakpoints (`sm:`, `lg:`) are wrong here and crushed three tiles into 100 px
in the first build. Modals are viewport overlays and keep viewport breakpoints.
Charts are flex bars, not SVG with a `min-width`: nothing above the detail
tables ever scrolls sideways.

- The headline strip stacks: hero, then tiles in a 3-column grid at ≥ 640px,
  1-column below.
- Every grid track that holds text is `minmax(0,1fr)`, never bare `1fr`
  (memory: raw `1fr` blows out on long nowrap money strings).
- The two SVG charts (§4.3, §4.4) keep `min-w-[640px]` inside
  `overflow-x-auto`; the §4.2 bars are flex and never scroll.
- All panels stay mounted when the tab is inactive (`ProjectTabs` rule);
  nothing in the panel may fetch on mount.

## 5. Company view: `/money`

> **Astra review — outstanding balance:** Remove the KPI fallback from unpaid invoices to `contract − collected`. That includes work which may not have been billed and should be labeled “Remaining to collect,” separately. With incomplete billing history, outstanding invoices are unknown or explicitly partial. Aggregate comparable, known amounts and show coverage for profit and blended margin.
>
> **Resolved in v2:** Agreed. `contract − collected` is "left to collect", not receivables, and gets its own always-known tile. "Unpaid invoices" sums only sent invoices that exist, and every tile states its coverage. Blended margin uses the same set of jobs top and bottom. One thing outside this plan: `/today`'s "outstanding A/R" chip (`lib/today.ts:273`) carries the same mislabel today and should be renamed "left to collect" in a follow-up.

Route `app/(os)/money/page.tsx`, `Shell` breadcrumb `MONEY`, `aiContext` from a
new `moneyContext()` in `lib/page-context.ts`. Gate: page calls
`requireAccess("money")`; `lib/permissions.ts` `money` area `paths` becomes
`["/money", "/books"]`; `components/shell/Sidebar.tsx` gains `{ label: "Money",
href: "/money", icon: Wallet }` in the MAIN group directly after Projects.
`/books` stays the disabled "soon" ledger placeholder.

Data: `getCompanyMoney()` in `lib/budget.ts` builds a `BudgetView` per project
with **one query per table using `project_id = ANY($1)`**, grouped in JS, then
`computeTotals` per project. Never the single-project builder in a loop.

Layout:

1. **Header** — eyebrow "10 open jobs · $158k contracted · $41k projected
   profit"; h1 "Money".
2. **KPI row** (stat tiles). Each tile sums only amounts that are **known and
   comparable**, and states its coverage:
   - **Contracted** (open jobs) — always known.
   - **Collected** and **Left to collect** (Σ price − collected) — always known.
     Left to collect includes work not billed yet; it is never called
     "outstanding".
   - **Unpaid invoices** (Σ sent invoices in SJC OS) — a fact at any coverage;
     note "billing fully tracked on 1 of 10 jobs".
   - **Profit + blended margin** — summed over jobs whose profit is `projected`
     or `planned` only; **margin = Σ their profit ÷ Σ their price**, the same
     jobs top and bottom; note "on 3 of 10 jobs · covers $92k of $158k
     contracted", with planned and projected counted separately.
   - **Unbilled work** (Σ max(0, −overUnderBilled)) — only jobs with a complete
     budget and tracked billing; same coverage note.
3. **Needs attention** — a list, most money first: trades over budget by > $500,
   sent invoices older than 14 days, jobs under-billed by > $1,000, money spent
   on an unsigned change order, hand-kept collected that disagrees with the
   invoices, invoices billed over their PO, possible duplicate costs,
   construction jobs whose profit is still `unknown`, costs not entered for 14+
   days, pending COs older than 7 days, unassigned costs > $0. Each row links
   to the job's Money tab.
4. **Open jobs table** — one row per non-warranty project, default sort
   profit desc with unknown-profit jobs last, sortable columns: Job · Stage ·
   Price · Cost (projected, or "so far") · Profit · Margin · Work done ·
   Collected · Unpaid invoices · Left to collect · a status chip
   (unknown / planned / projected). Profit, margin and work done read "—" when
   unknown, never 0. The Cost cell holds a 120px mini version of the §4.2 cost
   bar (same ramp, no labels) so the table doubles as the chart; a full-row
   hover tooltip repeats sentence 1 of `describeFinancials`. Click → the job's
   Money tab.
5. **Closed jobs** (warranty) — collapsed fold: Job · Completed · Price ·
   Collected · Profit (or "—" with a "no cost data" chip). Footer totals.
   History from Houzz has no cost side; the fold says so once at the top rather
   than per row.

Also: `business_snapshot` (MCP) gains `open_jobs: { contracted_cents,
collected_cents, left_to_collect_cents, unpaid_invoices_cents, profit_cents,
profit_jobs, profit_price_coverage_cents, unbilled_cents }`
from the same builder, and the `/today` A/R chip keeps its current source.

## 6. Schema (additive, idempotent; append to `db/schema.sql` **and** ship
`db/apply-project-financials.mjs` in the floor-designer runner pattern)

```sql
-- Budget lines: one per trade / category. Cost side + optional price side.
CREATE TABLE IF NOT EXISTS budget_lines (
  id                  bigserial PRIMARY KEY,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key                 text NOT NULL,                        -- slug: 'plaster'
  trade               text NOT NULL,
  detail              text NOT NULL DEFAULT '',
  source              text NOT NULL DEFAULT '',
  kind                text NOT NULL DEFAULT 'trade'
                        CHECK (kind IN ('trade','allowance','overhead','tax','contingency','other')),
  budget_cents        integer NOT NULL DEFAULT 0,           -- planned COST
  price_cents         integer,                              -- what the payer pays for this scope; NULL = unknown (use budget)
  est_to_finish_cents integer,                              -- NULL = derive; 0 = nothing left
  percent_complete    integer CHECK (percent_complete BETWEEN 0 AND 100),  -- optional hand-set physical %
  status              text NOT NULL DEFAULT '',
  status_kind         text NOT NULL DEFAULT 'ghost',
  credited_co_id      bigint REFERENCES change_orders(id) ON DELETE SET NULL,
  flags               jsonb NOT NULL DEFAULT '[]',
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);
CREATE INDEX IF NOT EXISTS idx_budget_lines_project ON budget_lines(project_id, sort_order);

-- Direct costs with no sub invoice or PO: card/cash materials, permits, Joe's labor.
-- Column names match docs/phase-5-accounting-plan.md `expenses` so 5.3 only ADDs
-- account_id / cost_code_id later; `kind` maps 1:1 onto the planned L/M/S/E/P/O cost codes.
CREATE TABLE IF NOT EXISTS expenses (
  id              bigserial PRIMARY KEY,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  expense_date    date NOT NULL DEFAULT CURRENT_DATE,
  vendor_label    text NOT NULL DEFAULT '',
  kind            text NOT NULL DEFAULT 'material'
                    CHECK (kind IN ('labor','material','sub','equipment','permit','other')),
  amount_cents    integer NOT NULL DEFAULT 0,
  memo            text NOT NULL DEFAULT '',
  paid_from       text NOT NULL DEFAULT 'card' CHECK (paid_from IN ('checking','card','cash')),
  receipt_file_id text,
  purchase_order_id bigint REFERENCES purchase_orders(id) ON DELETE SET NULL,  -- this expense pays against that PO
  source_ref      text NOT NULL DEFAULT '',                                     -- stable import key, e.g. 'houzz:IN-10047'
  budget_line_id  bigint REFERENCES budget_lines(id) ON DELETE SET NULL,
  change_order_id bigint REFERENCES change_orders(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id, expense_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_source_ref ON expenses(project_id, source_ref) WHERE source_ref <> '';

-- Link existing cost rows to a line or a CO.
ALTER TABLE sub_invoices    ADD COLUMN IF NOT EXISTS budget_line_id  bigint REFERENCES budget_lines(id) ON DELETE SET NULL;
ALTER TABLE sub_invoices    ADD COLUMN IF NOT EXISTS change_order_id bigint REFERENCES change_orders(id) ON DELETE SET NULL;
ALTER TABLE sub_invoices    ADD COLUMN IF NOT EXISTS invoice_date    date;
ALTER TABLE sub_invoices    ADD COLUMN IF NOT EXISTS paid_at         timestamptz;   -- when SJC paid the sub (spent vs owed)
ALTER TABLE sub_invoices    ADD COLUMN IF NOT EXISTS paid_cents      integer NOT NULL DEFAULT 0;  -- paid so far on an invoice not fully paid
ALTER TABLE sub_invoices    ADD COLUMN IF NOT EXISTS purchase_order_id bigint REFERENCES purchase_orders(id) ON DELETE SET NULL;  -- bills against that PO
ALTER TABLE sub_invoices    ADD COLUMN IF NOT EXISTS source_ref      text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_invoices_source_ref ON sub_invoices(project_id, source_ref) WHERE source_ref <> '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS budget_line_id  bigint REFERENCES budget_lines(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS change_order_id bigint REFERENCES change_orders(id) ON DELETE SET NULL;

-- Change orders: number, funding, credits, cost side.
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS number             text NOT NULL DEFAULT '';
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS vendor_label       text NOT NULL DEFAULT '';
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS paid_by            text NOT NULL DEFAULT 'owner' CHECK (paid_by IN ('owner','funder','split'));
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS funder_share_cents integer NOT NULL DEFAULT 0;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS budget_cost_cents   integer;     -- planned cost, fixed when priced; NULL = not planned
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS est_to_finish_cents integer;     -- NULL = derive (§3.2 states 2 and 3); 0 = nothing left
CREATE TABLE IF NOT EXISTS change_order_credits (
  id              bigserial PRIMARY KEY,
  change_order_id bigint NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  budget_line_id  bigint NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
  amount_cents    integer NOT NULL DEFAULT 0,
  UNIQUE (change_order_id, budget_line_id)
);

-- Who pays, expected inflows (packet tables, unchanged).
CREATE TABLE IF NOT EXISTS budget_parties ( ...packet DDL... );
CREATE TABLE IF NOT EXISTS funding_events ( ...packet DDL... );

-- Project-level settings. price_cents overrides contract_value×100 when set.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_basis    text NOT NULL DEFAULT 'fixed_price' CHECK (budget_basis IN ('fixed_price','insurance','cost_plus','time_materials'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_label    text NOT NULL DEFAULT 'contract';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_caption  text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS price_cents     integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS retainage_cents integer NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_notes    jsonb NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_complete boolean NOT NULL DEFAULT false;   -- lines cover the whole scope
ALTER TABLE projects ADD COLUMN IF NOT EXISTS costs_through   date;                              -- "costs entered through"; NULL = never asserted
ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_source  text NOT NULL DEFAULT 'manual' CHECK (billing_source IN ('manual','invoices'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS opening_collected_cents integer NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS opening_billed_cents    integer NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS opening_note    text NOT NULL DEFAULT '';
```

Every job keeps `billing_source = 'manual'` (the column default), so nothing on
any page changes on migration day — verified on all 51 jobs. New jobs start on
`manual` too (v2.2): the project-creating actions are not touched.

`sub_invoices.sub_slug` becomes nullable and gains `vendor_label` (v2.2): a bill
can come from someone outside the subs roster (2 of Egan's 5 vendors are).
Writers must supply one of the two. The runner executes the block between the
"Project financials (begin)/(end)" markers in `db/schema.sql` verbatim, in one
transaction with a 5 s lock timeout; dry-run by default, `--approve` to commit.

Backfills in the same runner, all idempotent: `change_orders.number = 'CO-' ||
row_number() OVER (PARTITION BY project_id ORDER BY created_at, id)` where
blank; nothing else. Invoice `line_items[]` may carry optional `budget_key` /
`co_id` keys for per-line billing allocation (jsonb, no schema change) — the
builder reads them when present, the v1 UI does not write them.

Migration is applied to the live DB **before** deploy (additive, nothing
running reads the new columns), same as the floor designer.

## 7. Server

> **Astra review — count each cost once:** Adding POs, sub invoices, and expenses can count the same purchase more than once. A $10,000 PO followed by its $10,000 invoice must remain $10,000 of cost. Specify links between those records and how invoices consume commitments, including partial invoices and payments. Existing PO fulfillment tracks receiving, not payment, so `fulfilled` cannot by itself mean “Spent.” Define closed-PO treatment so closing a PO does not erase cost. Agent imports also need stable source identifiers or idempotency keys to prevent duplicates on retries.
>
> **Resolved in v2:** Agreed on every point, and two of them were live bugs in the draft: it mapped `fulfilled` POs to "spent" though that status only means received, and it inherited the packet's PO filter (`sent`, `partial`, `fulfilled`), so closing a PO would have erased its cost. §3.3 "Counting each cost once" is the rule: invoices and expenses link to the PO they bill and consume it, a PO is never "spent", closing releases only the unreceived and unbilled balance, and imports upsert on a stable `source_ref`.

**The builder is split in two** so the contested rules are testable without a
database. `lib/budget-assemble.ts` is db-free and pure:
`allocateCosts(pos, subInvoices, expenses)` and `assembleBudgetView(raw)` take
plain rows and return a `BudgetView`. `lib/budget.ts` only runs the queries and
hands the rows over. Every case in §9 is a test of the pure half, and the MCP
server can import the same module.

`lib/budget.ts` (`import "server-only"`):

- `getProjectBudget(slug): Promise<BudgetView | null>` — wraps the batch builder.
- `getBudgetViews(projectIds: string[]): Promise<Map<string, BudgetView>>` —
  eight set-based queries (projects, budget_lines + credits, change_orders,
  invoices, sub_invoices, purchase_orders, expenses, parties + funding), grouped
  in JS. Builder rules:
  - Cost states come from `allocateCosts()` (§3.3), never from a status alone:
    a `fulfilled` PO is *received*, not paid, and the PO query must include
    `closed` (the packet filtered it out, which erased cost). Rows are keyed by
    `budget_line_id` → line key, else `change_order_id` → `co:<number>` (any CO
    status), else the linked PO's key, else `unassigned`.
  - `priceCents` is the base price **excluding change orders**:
    `projects.price_cents` ?? approved estimate `total` ?? `contract_value × 100`.
    The hand-kept contract total may already include change orders (Houzz-era
    jobs do), so when the price comes from it and a counted CO exists, `missing`
    says "confirm it excludes change orders"; an approved estimate and a
    hand-kept contract more than $1 apart raise "set the price".
  - billing follows `projects.billing_source` (§3.2); it is never inferred
    from whether invoice rows exist.
  - no budget lines → **no synthetic "Contract" line** (the packet did this;
    it makes the empty state look like a real budget). Return `lines: []` and
    `completeness.profit = "unknown"`; the UI owns that state.
  - `asOfLabel` = today; `completeness` is computed in the assembler.
- `getCompanyMoney(): Promise<CompanyMoney>` — open + closed rows, KPIs, and
  the attention list (§5).

`lib/actions/budget.ts` — §4.7. `lib/page-context.ts` — `moneyContext()`.

## 8. MCP tools and the agent fill path

New `mcp/financials-tools.mjs` exporting `registerFinancialsTools(server)`,
registered in `buildServer()`; documented in `mcp/README.md`. Money in cents in
every schema (state it in each description; `strippedDollarError` guard on
free-text fields as the project money tools do). These are internal records:
no owner grant, no sends.

| Tool | Purpose |
|---|---|
| `get_project_financials { project_slug }` | The `BudgetView`, `computeTotals`, `describeFinancials` sentences, and completeness (incl. any billing mismatch). The read tool agents call before touching anything. |
| `company_financials {}` | The `/money` data. |
| `adopt_estimate_as_budget { project_slug, estimate_id?, replace? }` | §4.7. |
| `set_budget_lines { project_slug, lines[] , mode: "merge" \| "replace" }` | Upsert by `key`. Each line: trade, kind, budget_cents, price_cents?, est_to_finish_cents?, status?, status_kind?, detail?, source?, flags?, credited_to? |
| `set_budget_settings { project_slug, basis?, label?, caption?, price_cents?, retainage_cents?, notes?, budget_complete?, costs_through? }` | Set `budget_complete` only when the lines really cover the whole job, and `costs_through` to the date the documents run to. |
| `set_budget_parties { project_slug, parties[] }` | |
| `add_expense { project_slug, date, vendor, kind, amount_cents, memo?, paid_from?, line_key?, co_number?, po_id?, source_ref? }` | Upserts on `source_ref`. Pass `po_id` when the payment is for a PO. |
| `assign_cost { project_slug, source: "sub_invoice"\|"po"\|"expense", id, line_key? , co_number? }` | |
| `record_sub_invoice { project_slug, sub_slug, amount_cents, date?, note?, status?, paid_at?, paid_cents?, line_key?, co_number?, po_id?, source_ref? }` | The sub portal is the only writer today; agents need one for imported paper invoices. Upserts on `source_ref`. |
| `set_sub_invoice_status { project_slug, id, status, paid_at?, paid_cents? }` | Approve / mark paid, or record a part payment. |
| `link_cost_to_po { project_slug, source: "sub_invoice"\|"expense", id, po_id? }` | So a PO and its bill count once. |
| `propose_billing_reconciliation { project_slug, note? }` | Read-and-propose only: returns hand-kept vs invoice totals and a proposed opening balance, and files a work item for Joe. The switch itself is the app's reviewed `reconcileBilling`; no tool flips `billing_source`. |
| `set_change_order_funding { project_slug, co_number, paid_by?, funder_share_cents?, credits?[], budget_cost_cents?, est_to_finish_cents? }` | Cost already incurred on a CO arrives through `assign_cost` with `co_number`, like any other cost — never as a typed total. |
| `add_funding_event` / `update_funding_event` | |

**Open Skill: "Fill a project's financials from documents."** Register through
the existing skills seed path (find how `list_skills` rows are seeded; if there
is no seed, file it with `create_skill_proposal` for Joe to approve). Body =
the packet README's "Rules for agents filling a BudgetView" (one line per trade
as the payer sees it; demo gets its own line; never double-count O&P; unbudgeted
work gets a $0-budget line; every sub dollar lands on exactly one line or CO;
guesses go in est-to-finish with a note) **plus** the Houzz reconciliation rule
from memory (estimate-carried deposits vs separate invoices — count once) and
the procedure: `get_project_financials` → read the project's files
(`list_project_files` / `get_project_file`) → `adopt_estimate_as_budget` or
`set_budget_lines` → `record_sub_invoice` / `add_expense` (always with a
`source_ref`; with `po_id` when the document bills a PO) → `assign_cost` →
`set_budget_settings` (notes; `costs_through`; `budget_complete` only when
true) → `propose_billing_reconciliation` when the documents show collections
the invoices table lacks → `record_receipt`. This is how the 7 construction
jobs get populated after launch (§10 phase 5), and how Hermes keeps them
current.

## 9. Tests and verification

> **Astra review — additional acceptance cases:** Before UI work, test a PO followed by its invoice and payment (count once); partial receiving/invoicing and PO closure; the first invoice imported into a job with historical collections; costs on an unsigned CO; a receipt on a job without a complete budget; partially tracked and deductive COs; and company totals mixing complete and incomplete jobs. Assert amounts and user-facing unknown/partial labels. Tests should validate corrected rules rather than preserve contradictions in this draft.
>
> **Resolved in v2:** All seven cases are now pinned below with amounts and the user-facing label each must produce, and they run in Phase 1, before any UI. That is possible because the builder is split (§7): allocation and assembly are pure, so none of these needs a database. The kitchen fixture was rebuilt on the corrected rules rather than kept as drafted.

- `tests/budget-math.test.mjs` and `tests/budget-assemble.test.mjs` (node's
  runner imports `lib/budget-types.ts` and `lib/budget-assemble.ts` directly, as
  `tests/grant-gate.test.mjs` does). Fixtures live in `lib/budget-fixtures.ts`
  (client-safe): the Egan sample (moved from the packet and converted to v2
  semantics: sub invoices become spent / owed, client invoices become billed /
  collected with a $10,000 opening balance) and this synthetic fixed-price
  job, chosen so every number can be checked by hand:

  ```
  kitchen: basis fixed_price, base price $60,000, billing source invoices (opening 0), budget complete
  lines (budget / price / paid / owed / on order / est):
    demo        3,000 /  4,000 /  3,200 /     0 /     0 /     0 (explicit)   Complete
    cabinets   20,000 / 27,000 / 10,000 / 2,000 / 6,000 / 3,000              In progress   ← ONE $18,000 PO: $10,000 deposit paid against it,
                                                                                            $12,000 received (so $2,000 received-not-billed), $6,000 to arrive
    electrical  5,000 /  8,000 /      0 / 4,800 /     0 /     0 (explicit)   Rough-in done
    labor      15,000 / 21,000 /  6,000 /     0 /     0 / 9,000              In progress
  change orders:
    CO-1 "Island outlet" approved, total 1,200, no credits, cost not planned, owed 700
         → state 3 with part of the cost linked: est 500, cost 1,200, flagged "cost not planned; assumed at price"
    CO-2 "Pantry" sent (unsigned), total 5,000, paid 300
         → price and est-to-finish not counted; the 300 IS counted, and flagged
  invoices: INV-001 paid 30,000; INV-002 sent 12,000 (17 days)
  expected: paid 19,500 · owed 7,500 · ordered 6,000 · est 12,500 · projectedCost 45,500
            budgetCost 43,000 · coBudgetCost 1,200 · costHeadroom −1,300 · unsignedCoCost 300
            price 61,200 · projectedProfit 15,700 · marginPct ≈ 0.2565 · plannedProfit 17,000
            workDonePct = 27,000 / 45,500 ≈ 0.5934
              (the draft's rule gave 33,000 / 45,500 ≈ 0.7253: the cabinet order alone added 13 points)
            earned $36,316.48 · billed 42,000 · collected 30,000 · unpaidInvoices 12,000
            leftToBill 19,200 · leftToCollect 31,200 · overUnderBilled +$5,683.52 (billed ahead) · coPending 5,000
            overLines: cabinets +1,000, demo +200 · underLines: electrical −200 · labor on budget
            with cabinets.percentComplete = 10: lineDone 2,100 instead of 12,000 → workDonePct = 17,100 / 45,500 ≈ 0.3758
  ```

  **Acceptance cases** (each asserts the amounts *and* the label the reader
  sees; all run in Phase 1, before any UI):

  1. **PO → invoice → payment counts once.** $10,000 PO sent → on order 10,000;
     fully received → owed 10,000; its $10,000 invoice linked → PO contributes
     0, invoice owed 10,000; invoice paid → spent 10,000. Job cost is 10,000 at
     every step.
  2. **Partial receiving, partial billing, closing.** PO 10,000, received
     4,000, linked unpaid invoice 6,000 → owed 6,000, on order 4,000, total
     10,000. Close it → on order 0, total 6,000. A closed PO with 4,000 received
     and no invoice → owed 4,000 (closing never erases cost). Void → 0.
     Invoices of 11,000 against a 10,000 PO → 11,000 and "billed $1,000 over
     PO". An unlinked expense of the same amount within 14 days → both count,
     flagged "possible duplicate".
  3. **First invoice into a job with history** — the three real shapes:
     Alcantara (manual, hand-kept $3,726, one $3,710.54 draft) → collected
     stays $3,726, billed null, label "billing history isn't tracked here yet".
     Louiselle (manual, hand-kept $14,148, paid invoices $15,647.82) →
     collected $14,148 with mismatch −$1,499.82 flagged; after
     `reconcileBilling(opening 0)` → $15,647.82. Egan (opening $10,000 +
     invoices $4,350 + $15,720 + $562.50) → $30,632.50 — never $40,632.50 and
     never $20,632.50.
  4. **Cost on an unsigned CO** — CO-2 in the kitchen fixture.
  5. **A receipt on a job without a complete budget.** One $200 expense, no
     lines → costSoFar 200; projectedProfit, marginPct, workDonePct, earned all
     null; profit "unknown"; sentence 1 reads "Profit isn't known yet…" and
     contains no "%".
  6. **Partly tracked and deductive COs.** CO-1 above. A deductive CO of
     −3,000 with no cost plan → price −3,000, est 0, flagged. A CO with
     budgetCost 800, paid 1,000, est null → est 0, cost 1,000, headroom −200,
     plannedProfit unchanged (the overrun is visible, the plan does not move).
  7. **Company totals mixing complete and incomplete jobs.** A projected
     (price 61,200, profit 15,700), B planned (price 28,296, planned profit
     6,000), C unknown (price 63,539) → blended margin = 21,700 ÷ 89,496 ≈
     24.2%, **not** ÷ 153,035; note "profit on 2 of 3 jobs · covers $89k of
     $153k"; Left to collect sums all three; Unbilled work counts only A.

  Also pin: credited line excluded from cost and reported as moved; `unfunded`
  on a short party list; explicit est 0 vs null vs complete status; `source_ref`
  upsert leaves one row after a retried import; no `NaN` anywhere when every
  array is empty. Tests validate the corrected rules above — where they differ
  from the first draft, the draft was wrong.
- `npx tsc --noEmit` clean (worktree: symlink `node_modules` first, confirm the
  symlink exists before trusting a silent pass).
- Side build: `SJC_DIST_DIR=.next-verify npx next build --webpack`, outside the
  sandbox (fonts).
- Visual: worktree `next dev --webpack -p 3099` against the live DB (`.env.local`
  copied), minted owner cookie, headless Chromium screenshots (recipe in the
  `verify-without-building` memory) of: `/projects/molly-egan?tab=Money`
  (insurance, multi-party), `/projects/elaine-louiselle?tab=Money` (fixed price
  with an estimate and invoices), `/projects/john-flanagans?tab=Money`
  (contract-only empty state), `/money`, each at 390px and 1280px widths. Look
  for label collisions, clipped segments, and the `1fr` overflow.
- Palette: rerun the dataviz validator on the final hex values with `--ordinal`
  (light) and note the result in the PR.
- Migration: run `node db/apply-project-financials.mjs` twice against the dev
  copy; second run must be a no-op.

## 10. Build order and checklist

Each phase is one PR from a t3 worktree branch off `main`, merged before the
next starts (phases 3 and 4b may run in parallel, see §11).

- [x] **Phase 1 — Math, allocation and contract** — built 2026-09-21, commit
      `4e6a961` on `t3code/review-fable-plan` (~1,700 lines of code and fixtures, ~650 of
      tests; the estimate was low). 55 tests, each of the 14 corrected rules
      proven to fail its test when the bug is put back; full suite 203/203,
      `tsc` clean, lint clean. Found six more rule errors in this plan while
      building — §14 "v2.1". **Awaiting the review gate.** Original scope:
      `lib/budget-types.ts` (v2 per §3), `lib/budget-assemble.ts`
      (`allocateCosts`, `assembleBudgetView`, pure), `lib/budget-fixtures.ts`,
      `tests/budget-math.test.mjs`, `tests/budget-assemble.test.mjs`. Done when
      the §9 fixture and all seven acceptance cases pass and the sentences read
      well to Joe. **Review gate: Joe reads the vocabulary (§1), the rules
      (§3.2–§3.3), and the sentences for the fixtures; Astra re-reviews the
      rules against its eight comments.** Everything after this depends on the
      semantics being right, so this is the phase to argue about.
- [x] **Phase 2 — Schema, builder, read tools** — built 2026-09-21 on
      `t3code/financials-phase-2`, stacked on Phase 1 (PR #31 was still open).
      **Migration APPLIED to the live DB** (additive; second run a no-op; all 51
      jobs' Collected still equals the hand-kept total; site and services
      healthy). Both MCP read tools verified through the real server on live
      data. **The Egan seed is NOT committed** — it is verified end to end
      inside a rolled-back transaction (all 16 fixture totals reproduced
      through the real queries) and waits for Joe, because it is client-facing:
      see §14 "v2.2". Estimate adoption verified the same way on Louiselle and
      Alcantara. 72 financials tests (220 in the suite), `tsc` and lint clean,
      10 of 10 mutants killed (one survived the first pass and exposed a
      vacuous test, now fixed). New modules: `lib/budget-queries.ts` (the SQL,
      takes a `run`, shared by app / MCP / scripts), `lib/budget-writes.ts`,
      `lib/budget-company.ts`, `lib/budget.ts`, `lib/actions/budget.ts`,
      `mcp/financials-tools.mjs`. Original scope: §6 DDL in
      `db/schema.sql` + `db/apply-project-financials.mjs`; `lib/budget.ts`
      builders; `mcp/financials-tools.mjs` with `get_project_financials` and
      `company_financials` only; `adoptEstimateAsBudget` action; migration
      applied to the live DB; Egan seeded from the fixture through the new
      tables (a one-off `scripts/seed-egan-financials.mjs`, dry-run default,
      `--approve`). Done when `get_project_financials molly-egan` via
      `mcp/call-tool.mjs` returns the fixture's totals and
      `elaine-louiselle` after `adopt_estimate_as_budget` shows profit
      `planned`, and every job's Collected still equals its hand-kept total
      (nothing moved on migration). **Review gate: Joe checks Egan's numbers
      against what he knows, and walks the `reconcileBilling` preview for
      Alcantara and Louiselle.**
- [x] **Phase 3 — Project page** — built 2026-09-21 on
      `t3code/financials-phase-3`, stacked on Phase 2. `components/projects/BudgetPanel.tsx`
      + `components/projects/budget/*` (headline, in/out bars, charts, folds,
      forms), the write layer in `lib/budget-writes.ts`, eleven actions in
      `lib/actions/budget.ts`, and the project page wired (Overview is the
      Money tab's first section for anyone holding `money`; a profit line on
      the Overview rail when one may be claimed). Verified in a real browser
      against a **private throwaway Postgres** restored from a dump of live —
      never the live DB: screenshots of Egan (insurance, seeded), Louiselle
      (estimate adopted, profit unknown) and Flanagan (contract only) at
      340 px, 660 px and 960 px columns and a 390 px phone; 17 form round-trips
      driven end to end; a rolled-back DB test of every write; production
      build clean. Not built here, moved to 4b: editing parties and funding
      events (agents and the seed populate them; nobody needs a form yet).
      See §14 "v2.3". Original scope: `components/projects/BudgetPanel.tsx`
      + `budget/*`, `lib/actions/budget.ts`, project page wiring
      (`showFinancials`, Overview section, rail line). Done when the four
      screenshots in §9 look right, tsc + side build are clean, and every edit
      modal round-trips on the :3099 copy. **Review gate: screenshots in the
      PR; Joe reads the page on his phone.**
- [x] **Phase 4a — Company page** — built 2026-09-21 on
      `t3code/financials-phase-4a`, stacked on Phase 3. `/money` (page +
      `components/money/CompanyMoney.tsx`), the sidebar entry, the `money`
      area's paths (`/money` first, so a money-only login lands on a real page
      instead of `/books`), `moneyContext`, `business_snapshot.open_jobs`, and
      the two docs. Cards in the ~340 px column most screens give it, a
      sortable table with room; unknown always sorts last and reads "—".
      Verified in the private Postgres with a mix of jobs (2 projected, 1
      planned, 1 adopted-unfinished, 6 contract-only): the Profit tile reads
      "16% margin on 3 of 10 jobs — covers $138,577 of $208,652 contracted";
      the snapshot tool agrees to the cent. Permission fence checked with real
      staff logins: without `money` there is no page, no sidebar link, and not
      one financial figure in the project page's HTML. Original scope: `/money`, sidebar, permissions,
      `moneyContext`, `business_snapshot` fields, `docs/routes.md`,
      `docs/users-and-access.md`.
- [x] **Phase 4b — Write tools + skill** — built 2026-09-21 on
      `t3code/financials-phase-4b`, stacked on 4a. Eleven write tools in
      `mcp/financials-tools.mjs` over the same `lib/budget-writes.ts` the app's
      forms use; the payers / expected-payments form deferred from Phase 3; the
      `fill-project-financials` skill (`docs/skills/`), filed as a PROPOSAL by
      `scripts/propose-financials-skill.mjs` so it goes through Joe's approval
      in `/engine` like any agent-written skill, never seeded as approved.
      **Acceptance run through the real MCP server on the private copy:** a job
      taken from profit unknown to projected with tool calls alone; the
      identical import run a second time leaves every total, line and cost
      unchanged; `replace` refuses to drop a trade with costs under it; a
      shell-eaten dollar amount is rejected with nothing written; no tool
      creates a change order or switches billing. 7 of 7 mutants killed.
      Two names differ from §8: `set_change_order_costs` (it sets costs, not
      funding) and one `set_funding_events` that replaces the list. Original
      scope: The rest of §8,
      `mcp/README.md`, the Open Skill. Done when an agent can take Flanagan
      from profit `unknown` to `projected` using only MCP calls, and re-running
      the same import leaves the totals unchanged.
- [ ] **Phase 5 — Deploy and populate.** Staged build (`SJC_DIST_DIR=.next-staged
      npm run build` → `systemctl --user restart sjcos.service`), then restart
      `sjcos-mcp.service`. Then run the fill skill on the 7 construction jobs
      from their Houzz documents (agent work, reviewed by Joe one job at a time;
      Egan first since it is already seeded). Update `docs/plan-vs-build.md` §8
      and `docs/phase-5-accounting-plan.md` "what already exists".

## 11. How to build this with agents

**Recommendation: a spec-driven sequence of five one-shot sessions, one per
phase, each with its own inner verify-and-fix loop and a human review gate
between phases. Not a timed `/loop`, not a single mega-session, not a
multi-agent workflow.**

Why not the alternatives:

- **One giant session.** The floor designer worked that way from a complete
  spec, but this feature has a semantic decision in the middle (§3.1) that
  Joe should confirm on real numbers before 1,500 lines of UI are built on
  it. Phase 1 is deliberately small so that review is cheap.
- **A `/loop`.** Loops are for recurring or polling work. Nothing here waits
  on external state; every phase ends when its checklist passes.
- **A `Workflow` / ultracode fan-out.** The phases are sequentially dependent
  (types → schema → UI → rollup) and the UI lives in one component tree.
  Parallelism buys little and costs merge conflicts. The one safe split is
  phases 3 and 4b after phase 2 lands: two worktrees, no shared files.
- **The in-app Ask window.** Use it for phase 5's population work (it has the
  MCP tools and Joe can approve job by job), not for the code build: headless
  runs, a 10-minute side build, and screenshot loops belong in a terminal /
  T3 Code session in a worktree, as PRs #28–#30 were done.

**Session mechanics (each phase):**

1. Start in a fresh t3 worktree branch off `main`. First commands: the
   concurrent-sessions check (`ps` for other `claude` processes, `git status
   --short`), symlink `node_modules`, confirm `npx tsc --noEmit` runs at all.
2. The prompt is short and points here. Template:

   > Build **Phase N** of `docs/project-financials-plan.md` exactly as
   > specified (read §1–§3 first, then the phase's sections). Start from the
   > packet files in `docs/reference/project-budget-packet/` where the plan
   > says to. Touch only the paths listed for this phase; if you need another
   > file, stop and say why. Money is integer cents everywhere except the
   > `projects` dollar columns named in §2.1. Do not write `projects.progress`.
   > Do not build in `/home/joe/sjcos-app` and do not restart any service.
   > Done means every item under this phase's "Done when" passes; show the
   > actual test output, tsc exit code, and screenshots in your final message,
   > then open a PR against `main` and link it to this thread.
   > If a formula or rule in the plan turns out to be wrong against the real
   > data, do not change it silently **and do not ship it**. Stop the work
   > that depends on it; write down the evidence (the query and the numbers),
   > a proposed correction, and a regression fixture that fails under the old
   > rule and passes under the new one; record the correction in §14 of the
   > plan in the same PR; carry on only with work the rule does not touch. The
   > review gate settles it before anything is built on top.

3. Inside the session the agent runs the loop itself: implement → `node --test`
   → `tsc` → side build → screenshots → fix → repeat until the phase's "Done
   when" holds. That loop has explicit exit criteria, which is what makes it
   safe to run unattended.
4. Review gate. Joe reads the PR (phase 1: the vocabulary and sentences; phase
   2: Egan's numbers; phase 3: the screenshots on his phone; phase 4: the
   `/money` table). Merge, then start the next session. If a gate fails, reply
   in the same thread — the agent has the context — rather than starting over.
5. Phase 5 is operational, not code: the Ask-window agent (Claude) runs the
   fill skill on one job, Joe checks the page, then the next. Hermes can keep
   the numbers current afterwards (log sub invoices as they arrive, bump
   est-to-finish when bids land).

> **Astra review — incorrect formulas:** Replace the session-template instruction to keep the plan's formula after discovering it is wrong. Document the evidence, propose a correction with a regression fixture, and resolve the affected rule at the review gate before building dependent behavior. A known incorrect financial formula should not ship merely to follow the specification.
>
> **Resolved in v2:** Agreed, and this review is the proof: the draft carried wrong financial rules that "keep the plan's version" would have shipped. That line was written to stop silent drift. The template keeps that and drops the part that protected a known-bad formula.

Effort guide: phase 1 ≈ 2 hours of agent time; phase 2 ≈ 2; phase 3 ≈ 3–4 with
the visual loop; phase 4a+4b ≈ 2 each; phase 5 ≈ 30 minutes per job.

## 12. Decisions for Joe (defaults are built unless changed)

1. **Ship `expenses` now** (default yes). Without it, "cost" is subs and POs only
   and profit on a materials-heavy job is fiction. The table is the phase-5
   shape minus the ledger columns, so nothing is thrown away later.
2. **Joe's own labor** (default: an expense of kind `labor`, entered as hours ×
   rate by hand or by an agent; no timesheets in v1). A budget line "SJ
   Carpentry labor" makes it visible per job.
3. **Route `/money` + sidebar "Money"** (default yes). `/books` stays reserved
   for the ledger. Alternative: put the company view under `/projects` as a
   second tab; weaker, because staff with `projects` but not `money` should
   never see margins.
4. **Hero figure in serif** (default yes, matches the app). The dataviz
   reference prefers sans; say the word and it flips to `font-sans`.
5. **Leave `projects.progress` alone** (default yes). The page shows "work
   done" and "billed" separately; the projects list keeps its "% billed" bar.
   Later the list could switch to the cost-based number.
6. **Zero-margin default for a CO whose cost isn't planned** (default yes,
   conservative). The alternative — assume the company's default markup —
   flatters profit.
7. **Work done is measured by cost incurred** — spent + owed, never on order —
   with an optional hand-set % per trade (default yes). The alternative is
   typing physical progress for every trade on every job; `projects.progress`
   shows how well a hand-typed number gets maintained.
8. **Billing source is set per job and switched by review** (default yes).
   Every job — new ones too — stays on its hand-kept collected total until Joe
   reconciles it; nothing moves on migration day. Alcantara and Louiselle are
   the first two to reconcile.
9. **No profit until the budget covers the whole job** (default yes). At
   launch that means all ten open jobs read "Profit not known yet" until a
   budget is adopted or filled. The alternative shows a number sooner, and the
   number is wrong.

## 13. Out of scope (and where it goes)

- Ledger, journal entries, P&L, bank rec, 1099, use tax → `docs/phase-5-accounting-plan.md`.
- Timesheets / labor capture from the field → later; `expenses.kind='labor'` is the seam.
- Per-line invoice allocation UI (`line_items[].budget_key`) → later; the builder already reads it.
- Portal exposure: the client never sees this page; `/client-portal/money` keeps its invoice list.
- Cost-book feedback ("your estimate said $X for cabinets, jobs actually cost $Y") → a natural next step once 5+ jobs have `projected` profit; the data will be there.

## 14. Corrections log

**v2 — 2026-09-21, after Astra's review.** All eight comments were accepted.
What changed, and the evidence:

| # | Draft rule | Problem | v2 rule | Evidence |
|---|---|---|---|---|
| 1 | CO zero-margin default "when no cost field is set"; CO cost budget = actual + committed + est | Prose contradicted the fixture; a budget rebuilt from the forecast can never show an overrun; cost on unsigned COs vanished | Three defined states for a CO's remaining cost; fixed `budgetCostCents`; cost on any CO counts and is flagged | §9 cases 4 and 6 |
| 2 | Work done = (actual + committed) ÷ projected, with sent POs in "committed" | Ordering material read as doing work; §1 and §7 disagreed | Owed vs on order; work done = spent + owed; optional per-trade % | Kitchen fixture: 73% → 59%, "unbilled work" → "billed ahead" |
| 3 | Confidence `costs` = any cost row linked; profit shown from `estimate` up | One receipt on an unbudgeted job showed a ~99% margin | Completeness separate from sources; profit null until `budget_complete` | §9 case 5 |
| 4 | Collected = invoices when any invoice row exists, else hand-kept | Already wrong on 2 of the 3 live jobs with invoices; would drop Egan's estimate-carried deposit on the first import | Explicit `billing_source`, reviewed `reconcileBilling`, opening balance, mismatch flag; `billed` null on manual jobs | §2.1 item 5 (read-only prod query) |
| 5 | Company "Outstanding" fell back to contract − collected; blended margin unspecified | That figure includes unbilled work; mixing known and unknown jobs skews the margin | Left to collect, Unpaid invoices, and coverage on every tile; margin over the same jobs top and bottom | §9 case 7 |
| 6 | Cost = POs + sub invoices + expenses; `fulfilled` PO = spent; closed POs filtered out | Double count; `fulfilled` only means received; closing erased cost; retried imports duplicate | `allocateCosts()`: linked bills consume the PO, a PO is never spent, closing releases only the unreceived and unbilled balance; `source_ref` upsert | `lib/po-recompute.ts:21-24`; no writer of `sub_invoices.status` anywhere; §9 cases 1–2 |
| 7 | Tests listed only the happy-path fixture | The contested rules were untested until the UI phase | Seven acceptance cases in Phase 1, made possible by the pure assembler | §9 |
| 8 | Session template: "keep the plan's version" of a formula found wrong | Would ship a known-bad financial rule | Stop dependent work, evidence + correction + regression fixture, settle at the gate | §11 |

Also new in v2 and not from a comment: `setSubInvoiceStatus` (nothing in the app
can mark a sub invoice paid today, and "spent" depends on it), and the
four-step cost ramp, re-validated.

**v2.1 — 2026-09-21, found while building Phase 1.** Each has a regression test
in `tests/budget-math.test.mjs` / `tests/budget-assemble.test.mjs`, and each
was confirmed to FAIL when the old rule is put back. For the Phase 1 gate to
confirm:

| # | Plan said | Problem | Rule as built |
|---|---|---|---|
| 9 | A line marked `credited` leaves the cost | On Egan, CO-1 and CO-2 are unsigned; dropping their credited lines removed $5,491 of cost while the price still included it — profit from nowhere | A credit takes effect only once its CO is counted |
| 10 | paid / owed / ordered = Σ *active* lines | Money already spent on a line vanished the day the line was credited away | Real money counts on every line; only budget and est-to-finish leave |
| 11 | Unplanned CO assumed to cost its *net* price | With a credit, the credited line's cost leaves and the CO is assumed cheaper by the same amount: profit rises by that line's cost | Assumed at the CO's full price; the swap costs you the old line's margin and gains nothing |
| 12 | A sub invoice is paid or it isn't | Erickson is 50% paid. Splitting one document into two rows breaks `source_ref` idempotency | `sub_invoices.paid_cents` (added to §6 and the two tools) |
| 13 | "A line whose status is complete" derives est 0 | `status` is free text | Complete = `percentComplete = 100` |
| 14 | Mismatch "flagged when non-zero" | The hand-kept total is whole dollars, so Egan is 64¢ off forever; and on a manual job hand-kept > invoices is normal (history not entered) | $1 tolerance; a manual job flags only invoices exceeding the hand-kept total |

Also decided in code, for the gate to see: `describeFinancials` returns plain
strings; when a cost names both a trade and a CO the trade wins; the base price
warns when it comes from a hand-kept contract total that may already include
change orders; and the packet's source files under `docs/reference/` are stored
as `.txt`, because the repo's tsconfig compiled them and broke `tsc` for
everyone (caught by the Phase 1 baseline check, before anything was committed).

**v2.2 — 2026-09-21, found against live data while building Phase 2.**

| # | Plan said | What the live system showed | As built |
|---|---|---|---|
| 15 | Adopt an approved estimate → budget complete → "planned" profit. Phase 2 was "done when Louiselle shows profit `planned`" | Both approved estimates (Louiselle #10, Alcantara #13) have `markup_total = 0`: they are Houzz imports carrying client prices as unit costs. Adopted as-is they plan a **$0 profit** | Lines and prices are adopted; the budget is marked complete only when the estimate has real markup; otherwise a note explains and profit stays unknown. Verified on both jobs in a rolled-back transaction |
| 16 | Sub invoices hang off the subs roster | 2 of Egan's 5 vendors (a mover, a radiator plumber) are not in the roster, and `sub_slug` was NOT NULL | `sub_slug` nullable + `vendor_label` |
| 17 | New jobs start on `billing_source = 'invoices'` | 3 of 51 jobs have in-app invoices; billing runs through Houzz. A new job would show $0 collected | Everything starts on `manual`; no existing action was touched |
| 18 | Seed Egan from the fixture, billing included | Egan's hand-kept collected moved from $31,667 to $34,929 **during the build day**. A seed that fixed billing would have been stale within hours | The seed writes the cost side only. Collected stays the live hand-kept number; reconciling is the owner's reviewed step |
| 19 | Seed the three change orders as the packet has them | **The client portal lists every non-draft change order**, and tells the client to "sign it in the list above" for a sent one. CO-1 "sent" would have asked Molly Egan to sign something that does not exist | The seed writes CO-1 as `draft` (pending either way: every total is identical). CO-3 `approved` WILL show in her portal, so committing the seed is Joe's call, not a script's. **Carry into phase 4b:** no financials tool may create a change order or move one out of draft |
| 20 | — | Sub invoices tied to a roster sub trip the `w9-missing` detector into opening a work item for any such sub without a W-9 | Stated in the seed's header and output; arguably correct behavior, but Joe should expect it |
| 21 | The loader runs its queries in parallel | Fine on a pool; on ONE connection (the transaction the seed verifies inside) pg warns today and will refuse in pg 9 | `loadRawProjectMoney(run, ids, { sequential })`, pinned by a test |

The seed (`node scripts/seed-egan-financials.mjs`, dry-run by default,
`--approve` to keep, `--undo --confirm` to remove exactly what it wrote) also
leaves out the four Houzz client invoices — rows in `invoices` show in the
client portal, and that history belongs in an opening balance — and records the
M&M proposal as CO-1's planned cost rather than as a draft purchase order.

**v2.3 — 2026-09-21, found while building Phase 3.**

| # | Plan said | What happened | As built |
|---|---|---|---|
| 22 | Viewport breakpoints; the two SVG charts keep `min-w-[640px]` and scroll | The content column is ~340 px on a 1280 px laptop. The first build put three stat tiles in 100 px, and a 640 px chart would have scrolled sideways for nearly everyone | Container queries throughout; every chart is flex bars. §4.8 |
| 23 | Field hints inside the `<label>` | A screen reader reads the whole hint out as the field's name (found when two fields both matched "planned cost") | Hints sit outside the label |
| 24 | Edit forms for parties and funding events in this phase | Only multi-payer jobs have them, and the seed / agents fill them | Deferred to 4b with their tools |
| 25 | "Verify on a :3099 dev copy" (the house recipe shares the LIVE database and says never click a write button) | This phase is mostly write buttons | A private Postgres under `~/.cache` (socket-only, 0700), restored from `pg_dump` of live, with a two-line env (database + a throwaway session secret) so the preview cannot send anything. Torn down afterwards |

Verification notes worth keeping: `next dev` in a worktree needs a REAL
`node_modules` (`cp -al`, hardlinks) and Turbopack — a symlink breaks both
bundlers, and `--webpack` fails on `instrumentation.ts`. Every project tab
stays mounted, so a browser test must scope its lookups to the panel (the
Overview rail and the Money section pills repeat the same words). The React
"unique key" warning on the project page is pre-existing: the unmodified page
throws it too — but only ~5 s after load, so a test that closes early misses it.

**v2.4 — 2026-09-22, Astra's review of the PRs (#31–#35).** All five accepted;
each fixed on `t3code/financials-phase-4b` (top of the stack) with a test that
was confirmed to FAIL with the bug put back:

| # | Finding | Severity | Fix |
|---|---|---|---|
| 26 | Re-importing an invoice under its `source_ref` reset it to approved / $0 paid / unfiled — a payment recorded since was erased (#35) | High | On a `source_ref` match, `recordSubInvoice` and `saveExpense` replace only the document's fields; status, paid, trade and PO are kept unless passed. A paid invoice re-imported with a new amount stays paid in full; a part payment is capped at the new amount. The MCP tools pass "not given" through as keep |
| 27 | Deleting a credited line cascaded its credit away and the client's price rose by it (#33) | High | `deleteBudgetLine` refuses while a change order credits the line, naming it |
| 28 | Two change orders could credit one trade; both lowered the price while the cost left once (#33, #35) | High | `saveChangeOrderCosts` refuses a credit on a trade another CO already credits; a unique index on `change_order_credits(budget_line_id)` enforces it in the database too |
| 29 | Re-syncing a no-markup estimate over a confirmed budget kept `budget_complete`, so the page showed a profit built on client prices (#32) | Medium | Adoption SETS `budget_complete` = has-markup: a no-markup sync withdraws the confirmation until real costs are set and it is ticked again |
| 30 | Opening receivables (opening billed − opening collected) vanished from "unpaid invoices" (#31, #34) | Medium | Counted on a reconciled job, and exposed as `billing.openingUnpaidCents`; on such a job unpaid = billed − collected exactly |

The `uq_change_order_credits_line` index was added to the schema block and
applied to the live database (the table was empty).
