# Fill a project's financials from documents

*Open Skill `fill-project-financials` · category `money` · filed as a PROPOSAL
by `scripts/propose-financials-skill.mjs` — it is not in the active library
until Joe approves it in `/engine` › Skills & runbooks. Spec:
`docs/project-financials-plan.md` §8.*

**When to use:** Joe asks what a job is making, asks to "set up the budget" or
"enter the costs" for a job, or hands over a folder of estimates, sub invoices
and receipts for one. Also when a job's Money › Overview reads "Profit not known
yet".

## What you are building

A job's financials are two separate things. **Price** is what the client pays.
**Cost** is what the job costs SJC. Profit is the difference, and the page will
only show one once the budget covers the *whole* job with *real* costs. Your
work is to get a job from "profit not known" to an honest projected profit —
or to say plainly what is still missing.

All money is **integer cents** in every tool.

## Steps

1. **Read first.** `get_project_financials { project_slug }`. Note
   `completeness.profit`, what is already there, and `completeness.missing`.
   Never recompute a profit yourself; if the tool says unknown, it is unknown.
2. **Find the documents.** `list_project_files` → `get_project_file`. You want:
   the estimate or contract (the budget), sub and vendor invoices (cost), and
   receipts (cost). For Houzz-era jobs read the estimate AND the invoices
   together — see "Houzz" below.
3. **Budget lines.** If the job has an approved estimate, start with
   `adopt_estimate_as_budget`. **Read its `warning`**: the Houzz-imported
   estimates carry the client's *prices* as their costs (no markup), so adopting
   one gives you the trades and prices but NOT what they cost. Then, or
   instead, `set_budget_lines`:
   - One line per trade **as the payer sees it** — an estimate's sections, an
     insurer's categories. Not one per invoice.
   - Demo and tear-off get their own line even when the source folds them into
     each trade.
   - `budget_cents` = what the trade should **cost SJC** (the sub's bid, the
     material quote, Joe's hours × rate). `price_cents` = what the client pays
     for it. They are different numbers; never copy one into the other to fill a
     gap. If you do not know a trade's cost, say so in `notes` and leave the
     budget unfinished.
   - Overhead & profit is either inside the trade lines (fixed price) or its own
     `overhead` line (insurance). **Never both.**
   - Work that has to happen but was never budgeted still gets a line, at
     `budget_cents: 0`. It will show fully over budget — that is the truth.
4. **Costs.** Every dollar goes on exactly one trade or change order.
   - A bill from a sub or vendor → `record_sub_invoice` (`sub_slug` for a roster
     sub — `list_subs`; `vendor_label` for anyone else). `status: "paid"` when
     SJC has paid it, otherwise `approved`; a deposit is `paid_cents`. A bill
     covering two trades is two records.
   - Something SJC paid directly — a receipt, a card charge, a check, Joe's own
     labor (`kind: "labor"`) → `add_expense`.
   - **Always pass a `source_ref`** built from the document ("cpk:1745",
     "receipt:menards-0912"). The same ref again updates the record instead of
     adding a second one, so a retried import is harmless: the document's own
     fields (vendor, amount, date, note) are replaced, while the payment state
     and the trade / PO filing are kept unless you pass them. Re-importing an
     invoice never undoes a payment Joe recorded since.
   - If a bill or payment is against a purchase order, pass `po_id` (or
     `link_cost_to_po` afterwards). Otherwise the order and its bill count
     twice. `get_project_financials` flags look-alikes as "possible duplicate" —
     resolve every one.
5. **Guesses vs facts.** Facts go in costs. A guess about what is still to come
   goes in a line's `est_to_finish_cents`, with a note saying it is a guess.
   Leave it out to let the page derive it (budget less what is spent, owed and
   on order); `0` means nothing is left.
6. **Payers**, only when there is more than one: `set_budget_parties` (insurer
   at the net claim + client at the deductible; lender + down payment) and
   `set_funding_events` for the payments expected and what triggers each.
7. **Settings.** `set_budget_settings`:
   - `costs_through` = the date the documents you entered run to.
   - `notes` = assumptions, open questions, next moves. Reasoning goes here, not
     in a line's `detail`.
   - `budget_complete: true` **only** when every trade is listed and every
     budget is a real expected cost. This is the switch that lets a profit
     show. If in doubt, leave it off and say what is missing.
8. **Billing — look, don't touch.** "Collected" on a job is Joe's hand-kept
   total until he reconciles it. If the documents show money collected that the
   invoices in SJC OS don't (a deposit carried on a Houzz estimate), run
   `propose_billing_reconciliation` and tell Joe with `ask_owner` or
   `create_work_item`. No tool switches billing; that is his reviewed step.
9. **Read it back.** `get_project_financials` again. Check the summary sentences
   read true, nothing is "possible duplicate", and unassigned is $0 or explained.
10. **Proof.** `record_receipt` with what you entered, from which documents, and
    what is still missing.

## Hard lines

- **Never create a change order, and never move one out of draft.** The client
  portal lists every change order that is not a draft, and tells the client to
  sign a sent one. `set_change_order_costs` edits only the budget side (planned
  cost, credits) of a change order that already exists.
- **A trade is replaced by one change order.** Crediting a trade that another
  change order already credits is refused; take it off the first one. A trade
  that a change order credits cannot be deleted either — the credit goes first.
- **Never mark a budget complete to make a profit appear.**
- **Never invent a cost** to fill a line. Unknown is a valid answer.
- Nothing here is client-facing, and nothing here sends anything.

## Houzz

SJC's history came out of Houzz, which tracked payments three different ways.
Read the estimate and the invoices together and count each dollar once:

1. **Whole job on the estimate** — the estimate carries the draw schedule and
   its own "Amount Paid". There may be no separate invoices.
2. **Whole job on one invoice** — the estimate says "Invoiced (100%)" and one
   invoice carries the schedule. Use the invoice; do NOT also add the estimate.
3. **Deposit on the estimate, later draws on separate invoices** — different
   money. Add them. (Egan: $10,000 on the estimate + three invoices.)

An estimate reading "Invoiced (100%)" and an invoice for the same amount are the
same money. A deposit on an estimate plus a *different* progress invoice are not.

## Done means

Either the page shows a projected profit you can defend line by line, or it
still says "Profit not known yet" and your notes say exactly what is missing and
who has it.
