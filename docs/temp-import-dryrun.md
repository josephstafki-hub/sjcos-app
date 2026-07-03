# Temp CRM → SJC OS migration (dry-run importer)

The temp CRM tracker (`/home/joe/SJC OS Temp/data/leads.csv`) is the current live
operational data. `scripts/import-temp-leads.mjs` migrates it into the official
SJC OS database **safely and reversibly**. It stays a source-of-truth migration
tool — the CSV becomes an import source, not the long-term truth.

## How to run

```bash
cd /home/joe/sjcos-app
node scripts/import-temp-leads.mjs                   # DRY RUN — report only, writes NOTHING
node scripts/import-temp-leads.mjs --stage           # + buffer raw rows into sjc_temp_lead_imports (reversible)
node scripts/import-temp-leads.mjs --stage --approve # + write approved lead/project rows into official tables
node scripts/import-temp-leads.mjs --csv <path>      # override the CSV path
```

## Safety model

- **Default = pure dry run.** Parse, classify, print. Zero side effects, no DB connection.
- **`--stage`** writes ONLY to `sjc_temp_lead_imports` (every CSV column preserved as
  raw JSON, so nothing is ever lost and the step is reversible).
- **`--approve`** (requires `--stage`) is the ONLY thing that touches official records,
  and only rows classified `lead`/`project`. `archive`/`review` rows are never
  auto-written. Idempotent: knowledge items are fingerprinted; staging upserts on
  `record_id`; slugs are de-duplicated.
- Temp→official status mapping is read from the `stage_rules` crosswalk (Phase 3),
  not hardcoded. All SQL parameterized. No email/SMS/invoices are ever sent.

## Classification

- `active_construction`, `precon_active`, `waiting_on_sub`, `final_invoice_sent`,
  signed/paid signals, … → **project**
- `new`…`precon_deposit_paid` (no signed/paid promotion signal) → **lead**
- `closed_out` / `lost` / `pass` / `archived` / `warranty_*` → **archive**
- unknown stage / no contact → **review** (a human decides; never auto-imported)
- each active row's `next_action` (+ `next_action_due`) → a **work_item**
- `status_notes` / `qualification_notes` / `scope_summary` / `draft_response` → **knowledge_items**

## Latest dry-run snapshot (2026-07-03)

```
╔══════════════════════════════════════════════════════════════════════╗
║  SJC OS — TEMP CRM IMPORT DRY RUN                                       ║
╚══════════════════════════════════════════════════════════════════════╝
CSV: /home/joe/SJC OS Temp/data/leads.csv
Mode: DRY RUN (no writes)

Total rows: 56
  Active   → 12  (2 lead · 10 project)
  Closed   → 44  (closed_out / lost / pass / archived)
  Review   → 0  (need a human before import)

Proposed work_items (from next_action / next_action_due): 12
Proposed knowledge_items (status/qualification/scope/draft): 174

── Proposed LEADS ──────────────────────────────────────────────────────
  • Travis and Erin Christensen  [rough_estimate_sent]  erinmorley87@gmail.com
  • Sam Stading-Ogan  [follow_up_needed]  sam.ogan@stevensgreat.com

── Proposed PROJECTS ───────────────────────────────────────────────────
  • Laurel Gollinger  [construction_scheduled]
  • Molly Egan  [active_construction]
  • John Flanagans  [waiting_on_sub]
  • Elaine Louiselle  [precon_active]
  • Libby Mahowald  [precon_active]
  • Dan Willems  [precon_active]
  • Isaiah Maertens  [precon_active]
  • Jeffrey Plumbon / New Kingdom Healthcare  [final_invoice_sent]
  • Mike McCullough  [active_construction]
  • Derek Battey  [active_construction]

── Proposed WORK ITEMS ─────────────────────────────────────────────────
  • (project) Laurel Gollinger: Wait for Laurel to get back with what she wants to do after receiving the pricing; follow   ⟶ due 2026-07-08
  • (project) Molly Egan: Wait for Molly to confirm whether she wants help finding someone to refurbish the radiator  ⟶ due 2026-07-07
  • (project) John Flanagans: Keep waiting on Rob confirmation that demo/concrete work has begun at 311 Butler; follow u  ⟶ due 2026-07-06
  • (project) Elaine Louiselle: Review/send Elaine draft about Beaumont saving close to $500, and correct/update Houzz est  ⟶ due 2026-07-06
  • (project) Libby Mahowald: Wait for Libby/Tim feedback after showroom links and ranch home style guide email; continu  ⟶ due 2026-07-08
  • (project) Dan Willems: Review/send Dan/Kelli draft answering custom vanity cost difference/running-total question  ⟶ due 2026-07-06
  • (project) Isaiah Maertens: Continue waiting for Jesse to answer whether a beam below is needed since there is no acce  ⟶ due 2026-07-06
  • (project) Jeffrey Plumbon / New Kingdom Healthcare: Track New Kingdom final invoice IN-10051 payment; CO has been issued/uploaded to Cottage G  ⟶ due 2026-07-08
  • (lead) Travis and Erin Christensen: No immediate reply needed; follow up after the July 4 weekend if Travis/Erin have not chos  ⟶ due 2026-07-10
  • (project) Mike McCullough: Check in with Mike on Monday about floor completion and next garage construction steps.  ⟶ due 2026-07-06
  • (project) Derek Battey: Keep waiting on Menards delivery timing for Derek/Battey siding materials; check back earl  ⟶ due 2026-07-06
  • (lead) Sam Stading-Ogan: Follow up later with Sam/Great Clips Plymouth if no reply after their internal cost/timing  ⟶ due 2026-07-08

── Unrecognized stages ─────────────────────────────────────────────────
  (none — all stages recognized)

── Rows needing human review ───────────────────────────────────────────
  (none)

── Duplicate names ─────────────────────────────────────────────────────
  (none)
── Duplicate emails ────────────────────────────────────────────────────
  (none)

Dry run complete. Nothing was written. Re-run with --stage to buffer rows,
then --stage --approve to import approved lead/project rows.
```

> Re-run the dry run any time; the CSV changes as Joe works leads. Import to
> official records only after Joe reviews this report and explicitly approves.
