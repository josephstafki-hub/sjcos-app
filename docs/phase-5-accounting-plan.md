# Phase 5 — Full QuickBooks Replacement (Accounting Epic) — Sub-Plan

*Drafted 2026-07-01. Status: **DRAFT for Joe + CPA review — not started.** This is the roadmap's largest and highest-liability epic (`docs/plan-vs-build.md` §8). Joe's standing decree: it "needs its own sub-plan + CPA review before it's safe." This document is that sub-plan. **Do not begin building the tax/1099/sales-tax logic until a CPA has reviewed the rules encoded here.***

---

## Context — why this, why now

SJC OS already owns the *front half* of the money flow: estimates → contracts with draw schedules → milestone invoices → retainers → collections (demand letter / lien package). What it does **not** have is a general ledger — the thing that actually replaces QuickBooks: a chart of accounts, double-entry bookkeeping, expense/bill tracking, job costing (actuals vs. estimate), 1099 prep, MN sales-tax tracking, and the P&L / Balance Sheet / cash reports that fall out of a ledger.

Everything to date has been *operational* records. Accounting is *financial-of-record* — mistakes here have tax and legal consequences, which is why it was deferred until it could get a dedicated plan and professional review. The goal of Phase 5 is a correct, auditable ledger core first; **payments, bank sync, and A/R-dunning automation are explicitly deferred within Phase 5** until the core is solid.

---

## Non-negotiable guardrails

1. **CPA review before go-live.** The 1099 thresholds, MN sales-tax nexus/rate/filing logic, and any tax-form output must be reviewed by Joe's CPA. Ship these behind a "not tax advice / for preparation only" disclaimer, mirroring the existing `LEGAL_DISCLAIMER` pattern in `lib/documents.ts` (used on lien/demand PDFs).
2. **Money is stored in integer minor units (cents).** See the currency-units decision below — this is the first thing to settle because the existing `invoices`/`retainers` tables use integer **dollars** while `estimates`/`cost_items` use **cents**. The ledger must be cents.
3. **Double-entry, append-only.** Ledger entries are never edited or deleted in place; corrections are reversing entries. Every transaction must balance (Σ debits = Σ credits) — enforce in the write action and assert with a DB round-trip test.
4. **Owner-gated writes.** All accounting mutations go through `requireRole("owner")` actions (established pattern in `lib/actions/*`).
5. **Provider-agnostic AI.** Cash-flag/analysis text goes through `ai.ts` (Qwen), never a hardcoded provider — same as every other AI touch-point.
6. **Additive DB migrations.** Apply new tables via the idempotent `db/schema.sql` through a throwaway `db/apply-*.mjs` in the project dir (never full reseed — live prod data must survive).

---

## Decision needed first: currency units reconciliation

**Problem:** two money conventions coexist.
- `invoices.amount`, `invoices.line_items[].amount`, `retainers.collected/applied` → **integer dollars**.
- `estimates.*`, `estimate_lines.*`, `cost_items.unit_cost` → **integer cents**.

A general ledger must be cents (rounding at dollar granularity is unacceptable for reconciliation). Options:

- **(A) New ledger is cents; leave `invoices`/`retainers` as dollars, convert at the boundary** (×100 when an invoice posts to the ledger). Lowest risk, no migration, but keeps the split.
- **(B) Migrate `invoices`/`retainers` to cents too** (one-time `UPDATE ... *100` + `ALTER`, update `lib/money.ts` + `lib/actions/money.ts` + `MoneyPanel`). Cleaner long-term, one migration, touches working code.

**Recommendation: (A) for the first ledger cut** (isolate risk), then (B) as a follow-up once the ledger is trusted. **Confirm with Joe.**

---

## Data model (new tables — all cents, all owner-scoped)

Single-entity books (SJC Carpentry LLC only), so no `entity_id`.

- **`accounts`** — chart of accounts. `id, code text, name, type CHECK(asset|liability|equity|income|expense), subtype, is_active, sort_order`. Seed a construction-contractor default COA (checking, A/R, retainage receivable, WIP, A/P, sales-tax payable, retainage payable, owner's equity, contract income, COGS-labor/materials/subs, overhead buckets, etc.) — **CPA to confirm the seed COA.**
- **`journal_entries`** — `id, entry_date, memo, source_type (manual|invoice|payment|expense|bill|retainer|adjustment), source_id, created_by, created_at`. Header of a balanced transaction.
- **`journal_lines`** — `id, entry_id FK, account_id FK, debit_cents int, credit_cents int, project_id nullable FK (job costing dim), memo`. CHECK: exactly one of debit/credit non-zero. App-level assert Σdebit=Σcredit per entry.
- **`vendors`** — `id, name, email, ein_or_ssn (encrypted at rest), is_1099, address, ...`. Distinct from `subs` (a sub may map to a vendor; link by `sub_slug` nullable).
- **`bills`** + **`bill_lines`** — A/P: vendor bill, due date, status(open|paid), lines → expense/COGS accounts + `project_id` for job costing.
- **`expenses`** — direct/quick expenses (card/cash) not routed through a bill: `date, vendor_id, account_id, project_id, amount_cents, memo, receipt_file_id` (reuse `storeUpload`/`storeBuffer` + `/api/files/[id]`).
- **`sales_tax_periods`** (or derive on the fly) — MN sales/use tax accrual per filing period. **CPA to confirm nexus + which line items are taxable** (labor vs. materials treatment in MN construction contracts is nuanced).
- Posting bridges: when an invoice is **sent** → post A/R + income (+ sales-tax payable if taxable); when **paid** → post cash + clear A/R; retainer collect/apply → retainage accounts. These hooks slot into the existing `lib/actions/money.ts` and `advanceProjectStatus` milestone path.

---

## Build sub-phases (dependency-ordered, one commit each)

- **5.0 — Currency decision + COA seed.** Settle the cents question (above); create `accounts` + seed the contractor COA (CPA-reviewed). No behavior change yet.
- **5.1 — Double-entry ledger core.** `journal_entries` + `journal_lines`, `lib/ledger.ts` (reads: trial balance, account register) + `lib/actions/ledger.ts` (owner-gated `postJournalEntry` with balance assertion + reversing entries). Manual journal-entry UI on a new `/books` page (currently a disabled placeholder in the sidebar). This is the spine — everything else posts through it.
- **5.2 — Wire existing money events into the ledger.** Invoice sent/paid, retainer collect/apply post balanced entries via 5.1. Backfill existing invoices/retainers into opening entries (one-time script). Now the ledger reflects reality.
- **5.3 — Expenses + bills + vendors (A/P).** `vendors`, `bills`/`bill_lines`, `expenses` with receipt upload; each posts to the ledger with a `project_id` dimension. Unlocks job costing.
- **5.4 — Job costing.** Actuals (ledger lines tagged `project_id`) vs. estimate (`estimates.total`) per project → margin view on the project Money tab; `ai.ask` flags margin erosion. Reuses the estimate figures already in `lib/estimates.ts`.
- **5.5 — 1099 prep.** Sum vendor payments where `is_1099` over a tax year, threshold flag (**CPA-confirmed threshold**), export worksheet (CSV/PDF via `lib/documents.ts`). **Prep only, not e-file, v1** — with disclaimer.
- **5.6 — MN sales-tax tracking.** Accrue tax-payable on taxable invoice lines; period summary + filing worksheet. **CPA-confirmed taxability rules.** Prep only, not e-file, v1.
- **5.7 — Reports.** P&L, Balance Sheet, cash summary, A/R aging — all derived from the ledger (no separate stores). Date-range picker. Render on `/books`; PDF export via `lib/documents.ts`.
- **5.8 — AI cash flags.** `ai.ask`-driven proactive flags (low cash runway, overdue A/R clusters, margin dips) surfaced on `/today` and `/books`, using the reminder/scheduler engine (`lib/reminders.ts`) for periodic scans.

**Deferred within Phase 5 (do NOT build in this pass):** bank connection + auto-reconcile (Plaid), bank rules/auto-categorization, payment processing (Stripe/portal pay → also unblocks 5-pay), A/R aging *dunning automation* (the aging *report* is in 5.7; automated 7/14/21 dunning is deferred), AI-optimized draw schedule (4b).

---

## Reuse (don't rebuild)

- **AI:** `lib/ai.ts` `ai.ask` (free-form Qwen) for cash flags / narratives; deterministic fallback pattern already established.
- **Docs/PDF:** `lib/documents.ts` (`pdfkit` + `docx`, `LEGAL_DISCLAIMER`, `storeBuffer`) for tax worksheets & reports; `serverExternalPackages:["pdfkit"]` already set. Verify PDFs headless with the documented `NODE_OPTIONS="--conditions=react-server" npx tsx` technique.
- **Files/receipts:** `lib/upload-store.ts` `storeUpload`/`storeBuffer` + `/api/files/[id]` serve route.
- **Scheduler:** `lib/reminders.ts` + `sjcos-reminders.timer` for periodic cash/A-R scans (add scans there, as done for COI/warranty/insurance/dunning).
- **Client-safe types split:** put shared constants/types in a `lib/*-types.ts` with **no db import** (the pg-in-client-bundle gotcha — bit us repeatedly; `import type` for types in client components).
- **Money events:** hook posting into existing `lib/actions/money.ts` + `createMilestoneInvoice` + `advanceProjectStatus`.

---

## Open questions for Joe (before / during build)

1. Currency units: option A (boundary-convert) or B (migrate invoices/retainers to cents)? *(Recommend A first.)*
2. Cash-basis or accrual books? (MN contractor default is usually cash-basis for tax, but WIP/retainage favor accrual visibility — CPA input.)
3. Does the CPA want a specific COA structure, or is a standard construction COA a fine starting point?
4. 1099 & MN sales tax: **prep worksheets only in v1** (Joe/CPA files manually), confirmed? Or is e-file in scope later?
5. Fiscal year = calendar year? Opening balances as of what date (need a starting trial balance to seed)?

---

## Verification approach (per sub-phase)

- `npx tsc --noEmit` + `npm run build` clean (ProjectTabs/non-active-panel gotcha: verify via build, not curl).
- **Rolled-back DB round-trips via `~/bin/sjcos-query`** proving: every journal entry balances (Σdebit=Σcredit); invoice-sent/paid posts the correct debits/credits; trial balance nets to zero; job-costing actuals sum correctly; 1099/sales-tax aggregations match hand-computed fixtures.
- Authed-route smoke test (mint owner cookie: fetch live owner uuid via `~/bin/sjcos-query "SELECT id FROM users WHERE role='owner' LIMIT 1;"`, read `SESSION_SECRET`, jose SignJWT, env vars **before** node).
- PDF reports/worksheets: assert buffer starts with `%PDF-` via the react-server tsx technique.
- One commit per sub-phase; push + `stop→build→restart sjcos.service` deploy only after Joe signs off on each.

---

## Sequencing note

5.0 → 5.1 → 5.2 are the critical path (a trustworthy ledger). 5.3–5.4 unlock job costing (high owner value). 5.5–5.6 are the CPA-gated tax pieces — build the data aggregation early but **hold the "file/output" surface until CPA review**. 5.7–5.8 fall out cheaply once the ledger exists. After Phase 5, roadmap → Phase 7 deferred epics (floor designer, task loop, lead intake) + deferred comms (SMS inbox, website push).
