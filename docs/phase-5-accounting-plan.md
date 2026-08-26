# Phase 5 — Full QuickBooks Replacement (Accounting Epic) — Sub-Plan v2

*Status: **v2 — decisions locked 2026-07-05 · awaiting CPA packet answers · build not started.**
Re-checked **2026-08-25: still not started — and that is deliberate.** Joe's position: Books is a
**future product**, not overdue work. Nothing has been built toward it — no ledger tables in
`db/schema.sql`, no `/books` page (the sidebar item is a disabled "soon" chip), no payment
processor anywhere. This plan stays on the shelf, ready, until Joe decides to start it. The 5.0 cents flip did land: money is stored in cents app-wide
(`scripts/migrate-cents.mjs`). **The CPA packet at the bottom is still unanswered — that is the
actual blocker, not engineering time.** Supersedes the 2026-07-01 draft. This is the roadmap's largest and highest-liability epic (`docs/plan-vs-build.md` §8). Do NOT ship the tax surfaces (5.6/5.7 output) until the CPA packet at the bottom is answered.*

**Resume protocol:** this doc is the source of truth for the epic. Mark each sub-phase checkbox `[x] + commit hash` as it lands. One commit per sub-phase, push after each, deploy (stop `sjcos.service` → `npm run build` → restart, `XDG_RUNTIME_DIR=/run/user/1010`) after code phases. If a session dies, resume from this checklist.

## Build checklist

- [x] 5.0 Cents migration + COA/cost-code seed — code flip done (COA/cost-code seed lands with 5.1)
- [ ] 5.1 Ledger core + /books goes live
- [ ] 5.2 Wire money events + opening balances
- [ ] 5.3 Vendors + A/P + expenses (+ pay gating)
- [ ] 5.4 Job costing + WIP
- [ ] 5.5 Bank reconciliation (manual CSV)
- [ ] 5.6 1099 prep (CPA-gated output)
- [ ] 5.7 MN sales/use tax (CPA-gated rules)
- [ ] 5.8 Reports + monthly close
- [ ] 5.9 AI cash flags + MCP tools

---

## Context — why this, why now

SJC OS owns the front half of the money flow: estimates → contracts with draw schedules → milestone invoices → deposits/retainers → collections (Day-15 demand letter / Day-30 lien package). What it lacks is the thing that actually replaces QuickBooks: a **general ledger** — chart of accounts, double-entry bookkeeping, A/P (bills + expenses), job costing, bank reconciliation, 1099 prep, MN sales/use-tax tracking, and the P&L / Balance Sheet / cash reports that fall out of a ledger.

The plan is grounded in two things Joe asked for:
1. **General-contractor bookkeeping best practices** (job costing first, deposits as liability, WIP over/under-billing, committed costs, contractor COA, use-tax on materials).
2. **How the OS is meant to work** (master plan §8): AI completes every step it can and presents for approval; deposits tracked as liability applied to the first draw; AI proactively flags cash position rather than waiting for a report pull.

**Decisions locked with Joe (2026-07-05):**
1. **Migrate transactional money to cents** (invoices / retainers / sub_invoices) — one convention everywhere, no permanent conversion seam.
2. **Manual bank-statement CSV import + reconcile screen in v1** (Plaid bank feed stays deferred).

## What already exists (build on, don't rebuild)

- `invoices` (amount + `line_items[].amount` int **dollars**, status draft/sent/paid), `retainers` (collected/applied int **dollars**) — `db/schema.sql` §invoices.
- `estimates` / `estimate_lines` / `cost_items` — int **cents**. `sub_invoices` (dollars, submitted/approved/paid). `change_orders` + e-sign. `projects.contract_value`/`collected_to_date` (dollars, feed the /today A/R headline).
- Money code: `lib/money.ts` (`getProjectMoney`, `usd()`), `lib/actions/money.ts` (`createInvoice`, `createMilestoneInvoice`, `updateInvoice`, `deleteInvoice`, `sendInvoice`, `markInvoicePaid`, `collectRetainer`, `applyRetainer`), `lib/actions/collections.ts` (demand/lien — built), `components/projects/MoneyPanel.tsx`, client-portal invoice list.
- Infra to reuse: `lib/ai.ts` `ai.ask` (Qwen + mock fallback) · `lib/documents.ts` (pdfkit/docx, `LEGAL_DISCLAIMER`, `storeBuffer`) · `lib/upload-store.ts` + `/api/files/[id]` · reminders engine (`lib/reminders.ts` + `sjcos-reminders.timer` + `reminder_log` dedup) · `emit()` notifications · MCP server `mcp/sjcos-mcp.mjs` · cents formatter `fmtUsd` (`lib/cost-book-units.ts`) · sidebar "Books" disabled placeholder · W-9/COI docs on 28 subs (`sub_documents`, `subs.coi_expires_at`).

## Non-negotiable guardrails

1. **CPA review before the tax surfaces go live** (1099 + MN sales/use tax + COA sign-off). Ship behind "for preparation only — not tax advice" via the existing `LEGAL_DISCLAIMER` pattern.
2. **Ledger = double-entry, append-only, cents.** No UPDATE/DELETE on posted entries; corrections are reversing entries. Σdebits = Σcredits enforced in the action AND asserted in rolled-back DB tests.
3. Owner-gated writes (`requireRole("owner")`, `Result` return) · provider-agnostic AI · additive idempotent `db/schema.sql` applied via throwaway `db/apply-*.mjs` in the project dir · client-safe constants in db-free `lib/*-types.ts` (pg-in-client-bundle gotcha) · `import type` in client files.
4. **Every migration/backfill script: dry-run default, `--approve` to run, JSON snapshot first, `--undo --confirm` reversal** (pattern: `scripts/import-undo.mjs`).

## GC bookkeeping best practices this encodes

- **Job costing is the heart**: every direct cost carries `project_id` + `cost_code_id` (simplified NAHB-style: labor / materials / subcontractors / equipment / permits+fees / other-direct — seeded, editable). Direct costs are **COGS accounts, not overhead**.
- **Deposits are a liability** (§8 explicit): retainer collected → Customer Deposits (2100); applied → reduces A/R. Never income at collection.
- **Progress billing + simple WIP**: % complete = cost-to-date ÷ estimated cost → earned revenue vs billed → **over/under-billing** per active job. Small-shop version, not ASC 606 ceremony.
- **Committed costs**: approved `sub_invoices` auto-become A/P bills; the job-cost report shows actual + committed vs estimate.
- **Change orders** billed/costed separately (CO income account 4100).
- **Pay gating (OS-fit)**: warn before paying a sub with expired/missing COI or no W-9 (data already in DB); prompt for a lien waiver on final payment.
- **Accrual ledger, cash-basis report toggle**: manage on accrual (WIP/job costing require it); CPA decides filing basis; cash-basis P&L derived from cash-touching postings.
- **1099-NEC prep**: vendor flagged at onboarding, payments auto-accumulate per calendar year. **CPA flag: reporting threshold rises $600 → $2,000 for payments made in 2026 (OBBBA)** — encode as a settings constant, CPA-confirmed.
- **MN sales-tax correction (IMPORTANT — the v1 draft had this backwards):** MN contractors improving real property are the **end consumers of materials** — they pay sales/use tax on material **purchases**; lump-sum contracts to customers are generally **not** taxed on the invoice. Model = **use-tax accrual on material purchases** (when the supplier didn't collect) + a filing worksheet. Entire rule set CPA-gated.
- **Monthly close checklist** via the reminders engine: reconcile bank, review A/R aging, review WIP, check use-tax accrual — surfaces on /today.

## Data model (all cents; add to `db/schema.sql`, apply additively)

```sql
accounts (
  id bigserial PK, code text UNIQUE,            -- "1000"
  name text, type CHECK (asset|liability|equity|income|expense),
  subtype text DEFAULT '',                      -- e.g. 'cogs','overhead','bank'
  is_active bool DEFAULT true, sort_order int )
cost_codes ( id bigserial PK, code text UNIQUE, name text, is_active bool )
journal_entries (
  id bigserial PK, entry_date date, memo text,
  source_type CHECK (manual|invoice|payment|expense|bill|bill_payment|retainer|use_tax|adjustment|reversal|opening),
  source_id text DEFAULT '',                    -- e.g. invoice id
  reverses_entry_id bigint NULL REFERENCES journal_entries,
  created_by uuid, created_at timestamptz )
journal_lines (
  id bigserial PK, entry_id FK ON DELETE RESTRICT,
  account_id FK, debit_cents int DEFAULT 0, credit_cents int DEFAULT 0,
  project_id uuid NULL REFERENCES projects ON DELETE SET NULL,   -- job-costing dim
  cost_code_id bigint NULL REFERENCES cost_codes,
  memo text,
  CHECK ((debit_cents=0) <> (credit_cents=0)) ) -- exactly one side per line
vendors (
  id bigserial PK, name text, email text DEFAULT '', phone text DEFAULT '',
  sub_slug text NULL REFERENCES subs(slug) ON DELETE SET NULL,
  is_1099 bool DEFAULT false, tax_id_last4 text DEFAULT '',  -- NO full EIN/SSN stored
  w9_file_id text NULL, address text DEFAULT '', notes text, is_active bool )
bills (
  id bigserial PK, vendor_id FK, project_id uuid NULL, bill_date date, due_date date NULL,
  ref text DEFAULT '', status CHECK (open|paid), total_cents int,
  source_sub_invoice_id bigint NULL REFERENCES sub_invoices,
  paid_at timestamptz NULL, created_at )
bill_lines ( id bigserial PK, bill_id FK CASCADE, account_id FK, cost_code_id NULL,
  description text, amount_cents int )
expenses (                                       -- direct card/cash spends, no bill
  id bigserial PK, expense_date date, vendor_id NULL, account_id FK, cost_code_id NULL,
  project_id uuid NULL, amount_cents int, memo text, receipt_file_id text NULL,
  paid_from CHECK (checking|card|cash), use_tax_cents int DEFAULT 0, created_at )
bank_statement_lines (
  id bigserial PK, account_id FK,               -- which bank account (COA 1000)
  stmt_date date, description text, amount_cents int,  -- signed: + deposit, − withdrawal
  import_batch text, status CHECK (unmatched|matched|created|ignored),
  matched_entry_id bigint NULL REFERENCES journal_entries, created_at,
  UNIQUE (account_id, stmt_date, description, amount_cents, import_batch) ) -- re-import idempotent
```

**Seed COA** (idempotent in schema.sql, CPA to confirm): 1000 Checking · 1100 A/R · 1200 Retainage Receivable · 2000 A/P · 2100 Customer Deposits · 2200 Sales/Use Tax Payable · 2300 Retainage Payable · 2500 Credit Card Payable · 3000 Owner's Equity · 3100 Owner Draws · 3900 Retained Earnings · 4000 Contract Income · 4100 Change Order Income · 4900 Other Income · 5000 COGS-Materials · 5100 COGS-Subcontractors · 5200 COGS-Labor · 5300 COGS-Equipment · 5400 COGS-Permits+Fees · 5500 COGS-Other Direct · 6000–6900 Overhead (Insurance, Vehicle, Tools, Office, Marketing, Licenses, Professional Fees, Bank Fees, Other). Seed cost codes: L/M/S/E/P/O matching the 5xxx buckets.

## Posting matrix (the double-entry rules — encode in `lib/posting.ts`)

| Event (hook location) | Debit | Credit |
|---|---|---|
| Invoice **sent** (`sendInvoice`, `createMilestoneInvoice` auto-send) | 1100 A/R | 4000 Contract Income (proj dim) — CO invoices → 4100 |
| Invoice **paid** (`markInvoicePaid`) | 1000 Checking | 1100 A/R |
| Deposit/retainer **collected** (`collectRetainer`) | 1000 Checking | 2100 Customer Deposits |
| Deposit **applied** (`applyRetainer`) | 2100 Customer Deposits | 1100 A/R |
| Bill entered (`createBill`, sub-invoice approve) | 5xxx COGS (proj + cost code) | 2000 A/P |
| Bill paid (`payBill`) | 2000 A/P | 1000 Checking |
| Expense (`createExpense`) | 5xxx/6xxx | 1000 Checking or 2500 Card |
| Use-tax accrual (material purchase, supplier didn't collect) | 5000 COGS-Materials (tax is part of job cost) | 2200 Use Tax Payable |
| Use-tax remitted | 2200 | 1000 |
| Correction | reversing entry: swapped lines, `reverses_entry_id` set | |

`postJournalEntry` validates: ≥2 lines, each line one-sided, Σdebit === Σcredit, accounts active. Insert entry + lines in ONE transaction.

## Build sub-phases (one commit each)

### 5.0 — Cents migration + COA/cost-code seed
**✅ DONE — code flip shipped.** Prod money tables were empty (0 invoices/retainers/sub_invoices — the 2026-06-30 wipe), so `scripts/migrate-cents.mjs` is a no-op here; NOT run with `--approve` (nothing to convert). The COA + cost-code seed is folded into 5.1 (tables land there). What shipped: all money display now uses cents formatters (`usd()` in lib/money reformatted to cents; MoneyPanel + sub pages + collections on `fmtUsd`), write paths convert typed dollars → cents at the client/action boundary (`dollarsToCents`), `createMilestoneInvoice`/`billMilestonesForStatus` pass cents (dropped the `/100`), collection PDFs render `fmtUsd(d.amount)`. Schema comments flipped to CENTS. tsc+lint(0)+build clean, PDFs assert %PDF-, authed routes 200, deployed.
- **Migrate to cents:** `invoices.amount` + each `line_items[].amount`, `retainers.collected/applied`, `sub_invoices.amount` (×100 via `scripts/migrate-cents.mjs` — snapshot `db/.cents-snapshot.json`, dry-run/--approve/--undo). Add `-- CENTS` comments in schema.sql; seed.sql values ×100.
- **Stay dollars (display/estimating, not books):** `projects.contract_value`/`collected_to_date` (marked deprecated — the /today A/R headline goes ledger-derived in 5.8), `project_sections.budget`, `project_selections.price`, `lead_estimates`.
- **Code updates (grep `amount` + `/100` + `usd(`):** `lib/money.ts` (`usd()` → cents input, or adopt `fmtUsd` from `lib/cost-book-units.ts`), `lib/actions/money.ts` (dollar form inputs ×100 via a `parseDollars`-style helper; `createMilestoneInvoice` drops its cents→dollars conversion), `MoneyPanel.tsx`, `app/client-portal/page.tsx`, `lib/sub-portal.ts` + `SubInvoiceSubmit.tsx`, `app/subs/[slug]/page.tsx` (sub-invoice display), `lib/actions/collections.ts` (demand-letter amounts). `lib/today.ts` A/R headline stays untouched until 5.8.
- **Verify:** rolled-back SQL spot-checks (a known invoice shows the same $ on MoneyPanel/portal), tsc+build, demand-letter PDF renders correct totals.

### 5.1 — Ledger core + /books goes live
- Tables: `accounts`, `cost_codes`, `journal_entries`, `journal_lines` + seeds.
- `lib/ledger-types.ts` (client-safe: ACCOUNT_TYPES, entry-form types) · `lib/ledger.ts` (server reads: `getChartOfAccounts`, `getTrialBalance(asOf)`, `getAccountRegister(accountId, range)`, `getJournal(range)`) · `lib/actions/ledger.ts` (`postJournalEntry`, `postReversal(entryId)`, `createAccount`/`archiveAccount`, `createCostCode`).
- `app/books/page.tsx` + `components/books/BooksClient.tsx` — tabs: **Overview** (cash/A-R/A-P/deposit balances) · **Journal** (list + manual-entry composer) · **Accounts** (COA CRUD + register drill-in). Enable the sidebar "Books" link (currently disabled).
- **Verify:** rolled-back round-trip — balanced entry posts, unbalanced rejected, reversal nets the register to zero, trial balance nets zero; /books 200 with owner cookie.

### 5.2 — Wire money events + opening balances
- `lib/posting.ts` (server-only bridge implementing the posting matrix; every function takes a client/tx handle so it joins the caller's transaction).
- Hooks: `sendInvoice`, `markInvoicePaid`, `collectRetainer`, `applyRetainer`, `createMilestoneInvoice` auto-send — each posts atomically with the status flip. CO-linked invoices → 4100.
- `scripts/backfill-ledger.mjs` (dry-run/--approve/--undo): opening entries dated to the opening-balance date (CPA question) — paid invoices → income+cash, sent-unpaid → A/R+income, retainer balances → cash+deposit liability, `source_type='opening'`.
- **Verify:** post-backfill trial balance nets zero and the A/R account equals Σ sent invoices; send+pay an invoice in a rolled-back tx and assert the 4 postings.

### 5.3 — Vendors + A/P + expenses (+ pay gating)
- Tables: `vendors`, `bills`, `bill_lines`, `expenses`. `lib/ap-types.ts` · `lib/ap.ts` (reads: vendor list w/ YTD paid, open bills, expense feed) · `lib/actions/ap.ts` (`createVendor` [prefill from `subs` + link `sub_slug`; W-9 already in `sub_documents`], `createBill`, `payBill`, `createExpense` w/ receipt via `storeUpload` — all posting through `lib/posting.ts`).
- **Sub-invoice bridge:** approving a `sub_invoices` row (existing action) auto-creates an open bill (vendor auto-created from the sub if missing), `source_sub_invoice_id` set — idempotent on re-run.
- **Pay gating:** `payBill` + UI check — a sub-linked vendor with expired/missing COI (`subs.coi_expires_at`) or no W-9 gets a non-blocking warning + confirm; the final-payment prompt mentions the lien waiver.
- UI: /books **A/P tab** (vendors, open bills, pay flow, quick-expense composer w/ receipt drop); project Money tab gains a "Job costs" list (bills+expenses for that project).
- **Verify:** rolled-back bill→pay round-trip postings; sub-invoice approve creates exactly one bill on re-run; expense receipt serves via `/api/files/[id]`.

### 5.4 — Job costing + WIP
- `lib/job-costing.ts`: `getJobCostReport(slug)` → per cost code {estimate (from the approved estimate's `estimate_lines`), actual (Σ journal_lines 5xxx w/ project dim), committed (open bills), variance}; `getWipReport()` → per active project {estCost, costToDate, pctComplete, contract (approved estimate total), earned, billed, overUnder}.
- `components/projects/JobCostPanel.tsx` in the Money tab (actual-vs-estimate bars, committed ghosted); /books **Overview** gains the WIP table.
- Qwen margin flag via `ai.ask` (AiStream/Suspense pattern — never block SSR on Qwen).
- **Verify:** hand-computed fixture in a rolled-back tx (known bills/estimate → exact variance + over/under numbers).

### 5.5 — Bank reconciliation (manual CSV)
- Table `bank_statement_lines`. `lib/bank-rec.ts` + `lib/actions/bank-rec.ts`: `importStatementCsv` (hand-rolled CSV parse, no new dep; tolerate common date/amount/desc layouts; preview→confirm; the UNIQUE constraint makes re-import idempotent), `matchLine(lineId, entryId)`, `createEntryFromLine` (unmatched line → expense/deposit composer prefilled; **Qwen suggests account/cost code via `ai.ask` — suggestion only, Joe approves**, per the OS approval principle), `ignoreLine`.
- Auto-match suggestions: same amount within ±3 days of an unmatched cash-touching entry.
- UI: /books **Reconcile tab** — import, unmatched queue, per-month "book balance vs statement balance" strip.
- **Verify:** import a fixture CSV twice → no dupes; match + create paths post correctly; a month closes at $0 difference.

### 5.6 — 1099 prep (CPA-GATED output)
- `lib/ten99.ts`: `getVendor1099Report(year)` = Σ (bill payments + expenses) per `is_1099` vendor by calendar year of **payment date**; threshold from `app_settings` key `tax.1099_threshold_cents` (default 200000 = $2,000 for 2026 payments — **CPA confirm**).
- Worksheet CSV + PDF via `lib/documents.ts` (+ `LEGAL_DISCLAIMER`); /books **Taxes tab** section. Prep only — no e-file in v1.
- **Verify:** fixture vendors crossing/under the threshold; PDF `%PDF-` assert (react-server tsx technique).

### 5.7 — MN sales/use tax (CPA-GATED rules)
- Use-tax capture on `expenses`/`bill_lines` for material purchases (`use_tax_cents`; auto-suggest = rate × amount when flagged "supplier didn't collect"; rate in `app_settings` `tax.mn_use_rate`); accrual posts per the matrix.
- `lib/sales-tax.ts` `getTaxPeriodSummary(period)` (accrued, remitted, payable balance) + filing worksheet PDF; /books Taxes tab. Prep only.
- **Verify:** fixture purchase → accrual posting → remittance clears 2200 to zero.

### 5.8 — Reports + monthly close
- `lib/reports.ts`: `getPnL(range, basis)` (accrual = income/COGS/overhead postings by entry_date; cash = derived from cash-account counterpart postings), `getBalanceSheet(asOf)`, `getCashPosition()`, `getArAging()` (current/30/60/90 from sent invoices), `getJobProfitability()`.
- /books **Reports tab** (date-range picker, cash/accrual toggle, PDF export via `lib/documents.ts`).
- **Switch the /today A/R headline to ledger-derived** (replace the `contract_value - collected_to_date` query in `lib/today.ts`).
- Monthly-close checklist: reminders-engine scan (1st of month → emit "Close last month: reconcile bank · review A/R aging · review WIP · use-tax check", deduped via `reminder_log`).
- **Verify:** P&L/BS tie to the trial balance on fixtures; aging buckets match `daysOverdue`; PDF asserts.

### 5.9 — AI cash flags + MCP
- Scans in `lib/reminders.ts`: cash runway (checking balance ÷ trailing-90-day avg burn < 6 weeks), overdue-A/R cluster, job margin dip (actual+committed > 90% of estimate before late-construction status) → `emit()` flagged notifications; narrative via `ai.ask` with deterministic fallback.
- /today cash card + /books Overview flags.
- MCP read tools in `mcp/sjcos-mcp.mjs`: `ledger_snapshot`, `ar_aging`, `job_cost_report(slug)`, `pnl(range)` (curated SELECTs, read-only, no raw SQL — house style).
- **Verify:** MCP stdio round-trip; scan idempotency (run twice → 1 notification).

## Deferred within §8 (do NOT build this epic)

Plaid bank feed + auto-reconcile · bank rules/auto-categorization (the 80% target) · payment processing (Stripe / portal pay / payment links) · A/R dunning **automation** (the aging *report* is in 5.8; Day-15 demand / Day-30 lien already exist) · AI-optimized draw schedule (unblocks after 5.9 cash data) · 1099 **e-file** · sales-tax **e-file**.

## CPA review packet (answer before 5.6/5.7 output ships; COA before 5.1 seed if possible)

1. COA seed sign-off (list above) — anything to add/rename for how you want statements grouped?
2. Filing basis: cash or accrual? (Books stay accrual internally; reports offer a cash toggle.)
3. 1099-NEC threshold for payments made in 2026 — $2,000 post-OBBBA? Which vendor types are reportable?
4. MN contractor taxability: confirm the end-consumer-of-materials model, the use-tax rate(s) to apply, and any taxable-service edge cases (e.g., contracts with retail-sale components).
5. Opening-balance date + starting trial balance figures.
6. Fiscal year = calendar year?
7. Owner draws / equity handling for the LLC.

## Verification approach (every sub-phase)

- `npx tsc --noEmit` + `npm run build` clean (ProjectTabs non-active-panel gotcha: verify via build, not curl).
- Rolled-back DB round-trips via `~/bin/sjcos-query` proving: every journal entry balances; the trial balance nets to zero; posting hooks write the exact debit/credit pairs in the matrix; aggregations (job cost, 1099, tax, aging) match hand-computed fixtures.
- Authed-route smoke test (live owner uuid via `~/bin/sjcos-query "SELECT id FROM users WHERE role='owner' LIMIT 1;"`, `SESSION_SECRET` from .env.local, jose-minted `sjcos_session` cookie — env vars before `node`).
- PDFs: assert the buffer starts with `%PDF-`.
- One commit per sub-phase; push; stop→build→restart `sjcos.service` to deploy.
