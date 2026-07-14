# Document Templates Plan — AI-fillable business documents

**Status: Phases 1–5 + Phase 6 UI BUILT & VERIFIED (2026-07-10). Only the legacy-generator
CUTOVER/deletion is deliberately deferred (see below).** This doc is written so another
model/session can execute it phase by phase without re-deriving context. Read it top to bottom
before starting; each phase lists exact files.

Progress:
- **Phase 1 (DB) ✓** — `document_drafts` table + widened `signature_requests.doc_type`
  (adds `precon`) in `db/schema.sql`, applied to dev DB. `DocType` union + labels widened in
  `lib/esign-types.ts`.
- **Phase 2 (templates + fill) ✓** — `lib/doc-templates/` : `types.ts`, `blocks.ts` (block
  builders + `**bold**` parser), `registry.ts`, `contract.ts`, `precon.ts`, `lien-release.ts`,
  `completion-cert.ts`, `fill-validate.ts` (pure, unit-tested), `fill.ts` (DB auto-resolvers).
  Money is CENTS; AI may write only `source:'ai'` fields — enforced + smoke-tested.
- **Phase 3 (renderers) ✓** — `lib/doc-render.ts` : `renderTemplatePdf` / `renderTemplateDocx`
  walk the section blocks; reuse `companyHeader`/`docTitle`/palette exported from
  `lib/documents.ts`. All 4 legal docs rendered from seeded data and eyeballed (statutory bold,
  variant selection, notary block, reconciling amounts, per-page `key vversion · date` footer,
  valid DOCX). Contract = 6pp, precon = 4pp, lien = 2pp, cert = 2pp.
- **Phase 4 (actions + MCP) ✓** — `lib/doc-drafts.ts` (core lifecycle), `lib/esign-create.ts`
  (shared `insertSentRequest`; `documents.ts` refactored onto it),
  `lib/actions/doc-drafts.ts` (owner-gated + `draftDocNarrative` via Qwen),
  `app/api/internal/doc-drafts/route.ts` (token-guarded agent surface — create/get/list/update/
  render; NO send), and 6 MCP tools in `mcp/sjcos-mcp.mjs` (HTTP clients to that route).
  Verified end-to-end through the running app: unauthorized→401, AI money edit rejected, AI
  narrative accepted, missing-field "still need", render→PDF+DOCX, and **no submit path from any
  agent tool** (submit is owner-only in the action layer).

- **Phase 5 (transactional templates) ✓** — `lib/doc-templates/change-order.ts`,
  `estimate-doc.ts`, `invoice-doc.ts` + auto-resolvers in `fill.ts`. Rendered from seeded data
  and eyeballed against the source .docx (checkboxes drawn as squares, pricing/totals grids,
  Net-7 terms, no signature on the invoice). All 7 templates build clean.
- **Phase 6 UI ✓** — Settings "Billing rates" group (`lib/billing-rates.ts` shared metadata,
  `updateBillingRates` action, form in `SettingsClient`); project **Documents** panel
  (`components/projects/ProjectDocuments.tsx`) under the Sign-offs tab (new-document menu, field
  editor with auto/unlock + owner inputs + "Draft with AI" narrative buttons, render, send-for-
  signature, clone/void); lead-scoped precon entry (same component, `leadSlug`) as a Documents
  tab on the lead page. `npm run build` clean; pages verified 200 as owner; precon lead flow
  resolves markup 20% + super $62/hr and rejects AI edits to owner/money fields.

- **Rough-estimate PDF for leads (added 2026-07-10, follow-up).** 8th template
  `rough_estimate` (`lib/doc-templates/rough-estimate.ts`) renders a lead's Phase 1 rough
  estimate (range/string values from `lead_estimates`, informational — not signable) in the
  house style. `renderRoughEstimatePdf(leadSlug)` in `lib/doc-drafts.ts` renders it on the fly;
  `sendEstimate` (lib/actions/leads.ts) now ATTACHES it to the lead email (Gmail gained
  multipart attachment support in `lib/gmail.ts`; `sendNewEmail`/`sendNewEmailAction` take
  `attachments`). Owner preview at `GET /api/leads/[slug]/rough-estimate`; "Preview PDF" button
  on the Rough estimate tab. Also fixed a `columns_table` renderer bug in `lib/doc-render.ts`
  (fixed 90px cols + single-line row advance → long cells overlapped; now adaptive widths +
  per-row height from the tallest wrapped cell). NOTE: this rides on the doc-templates system,
  so it only works once that system is deployed — it is NOT on prod yet.

**Deferred by design — legacy-generator CUTOVER + deletion (Phase 6 tail).** The new draft
system runs ALONGSIDE the existing generators; nothing was rewired or deleted. Cutting
`generateContract` (lib/actions/documents.ts), the closeout cert + lien waiver
(lib/actions/closeout.ts), and the CO send flow over to `createDocDraft`/`renderDocDraft`, then
deleting the superseded inline renderers, changes working money/contract/closeout paths and per
this plan should happen only "after cutover verifies" — which needs real estimate/CO/project
data and Joe's sign-off. Do that as its own PR once Joe has driven the new drafts on a live job.

## Goal

Turn Joe's document set into first-class, AI-fillable templates inside SJC OS:

1. **Construction Contract** — Joe's long-form MN contract text (canonical), rendered in the
   visual style of his uploaded `SJC_Contract_Template.docx`.
2. **Pre-Construction Agreement** — Joe's precon text (canonical), same house style.
3. **Lien Release / Waiver** — new, four variants (partial/final × conditional/unconditional).
4. **Certificate of Substantial Completion** — new.
5. **Change Order** — from `SJC_Change_Order_Template.docx`.
6. **Formal Estimate** — from `SJC_Estimate_Template.docx`.
7. **Invoice** — from `SJC_Invoice_Template.docx`.

"AI-fillable" means: an AI agent (in-app dev chat, /ai agents, or the `sjcos` MCP server) can
create a **document draft** from a template, fill/edit its fields iteratively, and render
PDF + DOCX — but **sending or requesting signature always stays owner-gated**, consistent with
the existing approval discipline (AI never touches binding figures; AI narrative fields only).

## Source material (all checked in)

- Canonical legal texts with merge fields + attorney notes:
  - `docs/reference/doc-templates/construction-contract.md`
  - `docs/reference/doc-templates/preconstruction-agreement.md`
  - `docs/reference/doc-templates/lien-release.md`
  - `docs/reference/doc-templates/certificate-of-completion.md`
- Visual style sources (Joe's uploaded Word templates, copied from `uploads/ai-chat/`):
  - `docs/reference/doc-templates/source/SJC_Contract_Template.docx`
  - `docs/reference/doc-templates/source/SJC_Change_Order_Template.docx`
  - `docs/reference/doc-templates/source/SJC_Estimate_Template.docx`
  - `docs/reference/doc-templates/source/SJC_Invoice_Template.docx`

House style shared by all four docx files: company name header line + address/phone/email
sub-line, document title + one-line subtitle, top info grid (doc #, date, refs), boxed section
labels in caps, two-column label/value tables for money, checkbox groups where applicable, and
paired signature blocks ("Client — SIGNATURE / PRINT NAME / DATE", "SJ Carpentry LLC — …").
This matches the existing pdfkit primitives in `lib/documents.ts` (companyHeader, docTitle,
sectionLabel, row, signatureLine) — extend those, don't reinvent.

## Current state (what already exists — reuse it)

- `lib/documents.ts` — deterministic pdfkit + docx renderers: short-form contract, SOW,
  completion certificate, final lien waiver, permit packet, demand letter, lien statement,
  incident report. Pattern: facts are code-generated from DB; the ONLY AI-authored part is a
  narrative string passed in. `LEGAL_DISCLAIMER` footer for legal docs.
- `lib/actions/documents.ts` — `generateContract`/`generateSOW`: gather → render PDF + DOCX →
  `storeBuffer` (files browser) → create `signature_requests` row ('sent') → client signs in
  portal. Approval gate (design/selections/estimate) guards contract generation.
- `lib/actions/closeout.ts` — existing completion-cert + lien-waiver generation (simple
  versions; will be switched to the new templates).
- `signature_requests.doc_type` CHECK: `design, estimate, contract, sow, change_order,
  completion, lien_waiver, other` (db/schema.sql:727). **No `precon`** — needs migration.
- Company info from `app_settings` (`profile.company`, `profile.phone`, `profile.email`,
  `company.license`, `company.address`) via `getCompanyDocInfo()`; contract terms blob at
  `contract.terms` (settings UI already edits it).
- Draw schedules: `lib/draw-schedule.ts`, persisted on `estimates.draw_schedule`.
- Money is **cents** everywhere transactional (Phase 5.0); `fmtUsd` for display.
- MCP server `mcp/sjcos-mcp.mjs` (`server.registerTool(name, {title, description,
  inputSchema(zod)}, handler)`), gated write tools; `submit_draft_for_approval` pattern for
  client-facing artifacts.

## Architecture decisions (locked)

1. **Canonical text lives in code, not the DB.** One TS module per template under
   `lib/doc-templates/`. Legal language changes go through git (reviewable, versioned,
   attorney-diffable). Each template exports `templateKey`, `templateVersion` (bump on any
   language change; stamped on every rendered doc), `sections` (ordered content blocks), and a
   `fields` manifest.
2. **Field manifest drives everything.** Each field: `key`, `label`, `kind`
   (`text | money_cents | date | enum | table | narrative`), `source`
   (`auto` — resolved from DB/app_settings, `owner` — must be provided/confirmed by Joe,
   `ai` — AI may draft it), `required`. **AI may only write `ai`-source fields** (narratives
   like `sow_narrative`, `work_summary`, `co_reason_detail`). Money, dates, and statutory text
   are never AI-writable — enforce in the fill layer, not just by convention.
3. **New `document_drafts` table** is the editable unit. AI tools edit the field-values JSON
   and re-render; the render is deterministic from (template, version, values). PDF is the
   signable artifact; DOCX is the owner's manual escape hatch.
4. **Existing e-sign flow is the send path.** A draft is promoted to a `signature_requests`
   row by an owner-gated action; nothing in the AI surface can send.
5. **Company block always from app_settings** — never hard-coded. (Known conflict: docx
   templates say (612) 361-6585 / info@sjcarpentryllc.com; Joe's contract text says
   (612) 475-8563 / josephstafki@sjcarpentryllc.com. Joe confirms canonical values in
   Settings; flag in UI if `profile.phone`/`profile.email` are empty.)
6. **Statutory formatting**: the mechanics-lien notice must render ≥10-pt bold
   (Minn. Stat. § 514.011). Renderer must support a `statutory` emphasis flag on sections.

## Data model (Phase 1)

Append to `db/schema.sql` (idempotent, matching file conventions):

```sql
-- ─── Document templates (doc-templates plan) ───────────────────────────────
CREATE TABLE IF NOT EXISTS document_drafts (
  id               bigserial PRIMARY KEY,
  project_id       uuid REFERENCES projects(id) ON DELETE CASCADE,  -- project-scoped (most)
  lead_slug        text,                                            -- or lead-scoped (precon/estimate)
  template_key     text NOT NULL,           -- 'contract','precon','lien_release','completion_cert','change_order','estimate_doc','invoice_doc'
  template_version text NOT NULL DEFAULT '',
  title            text NOT NULL DEFAULT '',
  field_values     jsonb NOT NULL DEFAULT '{}',   -- { field_key: value }
  fill_report      jsonb NOT NULL DEFAULT '{}',   -- { field_key: 'auto'|'ai'|'owner'|'missing' }
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','rendered','submitted','signed','void')),
  pdf_file_id      text REFERENCES files(id) ON DELETE SET NULL,
  docx_file_id     text REFERENCES files(id) ON DELETE SET NULL,
  signature_request_id bigint REFERENCES signature_requests(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_via      text NOT NULL DEFAULT 'app',   -- 'app' | 'ai' | 'mcp'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_drafts_project ON document_drafts(project_id, created_at DESC);

-- Widen signature_requests doc_type for the new templates.
ALTER TABLE signature_requests DROP CONSTRAINT IF EXISTS signature_requests_doc_type_check;
ALTER TABLE signature_requests ADD CONSTRAINT signature_requests_doc_type_check
  CHECK (doc_type IN ('design','estimate','contract','sow','change_order',
                      'completion','lien_waiver','precon','other')) NOT VALID;
```

Notes: `status` lifecycle draft → rendered (files exist) → submitted (signature_request
created) → signed/void. Re-editing after `rendered` re-renders and replaces files;
after `submitted`, drafts are read-only (void + clone to revise).

## Template modules (Phase 2)

New directory `lib/doc-templates/` (plain server helpers, NOT "use server"):

- `types.ts` — `DocTemplate`, `TemplateField`, `TemplateSection` (section kinds: `heading`,
  `paragraph` (with inline-bold runs), `list`, `info_grid`, `money_table`, `checkbox_group`,
  `signature_block`, `notary_block`, `statutory_notice`, `field_table` like
  `payment_schedule_table`), `FillResult`.
- `registry.ts` — `getTemplate(key)`, `listTemplates()`.
- One module per template, transcribing the canonical texts **verbatim** from
  `docs/reference/doc-templates/*.md` (the .md files remain the source of truth for language;
  a code comment in each module must point back to its .md):
  - `contract.ts` (key `contract`) — long-form agreement + Exhibit A SOW. Auto fields from
    project + estimate (+ draw schedule); `sow_narrative` is the AI field.
  - `precon.ts` (key `precon`) — precon agreement. Works lead-scoped OR project-scoped
    (precon is signed before a project may exist — support `lead_slug`). Billing-rates table
    from new `app_settings` keys `rates.*` with the defaults from the .md.
  - `lien-release.ts` (key `lien_release`) — `waiver_type` enum field
    (`partial_conditional | partial_unconditional | final_conditional | final_unconditional`)
    selects which body paragraphs render. Amounts auto from invoices/retainers/projects.
  - `completion-cert.ts` (key `completion_cert`) — punch data from `project_punch`,
    account summary from project/invoices; `work_summary` is the AI field.
  - `change-order.ts` (key `change_order`) — mirrors `SJC_Change_Order_Template.docx`:
    reason checkbox group, scope description (AI field `co_scope_description` drafted from the
    CO record's title/description), pricing-impact table, deposit policy text, terms,
    signatures. Auto from `change_orders` row.
  - `estimate-doc.ts` (key `estimate_doc`) — mirrors `SJC_Estimate_Template.docx`:
    valid-until (30 days), scope summary (AI field), line items from `estimate_lines` grouped
    by section, contingency row, allowances & selections text, notes & terms, acceptance block.
  - `invoice-doc.ts` (key `invoice_doc`) — mirrors `SJC_Invoice_Template.docx`: Net-7 dates,
    bill-to grid, `invoices.line_items`, previous-payments/retainer-applied row (from
    `retainers`), CO balance row, payment-terms text. No AI fields; no signature block.

## Fill engine (Phase 2, same PR)

`lib/doc-templates/fill.ts`:

- `resolveAutoFields(templateKey, scope: {slug? leadSlug? estimateId? invoiceId? changeOrderId?})`
  → pulls from DB/app_settings (reuse `getCompanyDocInfo`, `gatherDocData`,
  `gatherCloseoutData` where they fit). Returns `{ values, fillReport }` marking each field
  `auto` or `missing`.
- `applyFieldEdits(draft, edits, actor: 'ai' | 'owner')` — validates against the manifest:
  unknown keys rejected; `actor === 'ai'` may only touch `source: 'ai'` fields; money fields
  must be integers (cents); enums validated. Returns updated values + fill report.
- `validateForRender(template, values)` — all `required` fields present → ok, else the list of
  missing fields (this is what AI tools echo back to Joe as "still need: …").

## Renderers (Phase 3)

`lib/doc-render.ts` (new; imports the primitives from `lib/documents.ts` — export the
currently-private helpers `companyHeader`, `docTitle`, `sectionLabel`, `row`, `signatureLine`,
`para`, `disclaimerFooter`, `pdfToBuffer` rather than duplicating them):

- `renderTemplatePdf(template, values): Buffer` — walks `sections`, rendering each block kind.
  New primitives needed: numbered/lettered headings, inline-bold runs inside paragraphs,
  checkbox rows (☐/☒ via rect stroke), info-grid (2-col label/value), notary block, page
  footer with `templateKey vtemplateVersion · generated date` on every page, and the
  `statutory_notice` block (≥10-pt bold). Long docs must paginate cleanly (pdfkit auto-flows;
  test the ~6-page contract).
- `renderTemplateDocx(template, values): Buffer` — same walk with the `docx` package
  (extend `p`/`heading`/`twoColTable` helpers).
- Legal docs (`contract`, `precon`, `lien_release`, `completion_cert`) get the
  `LEGAL_DISCLAIMER` footer; transactional docs (estimate/invoice/CO) get the house footer
  from their docx sources ("This estimate is not a contract…", Net-7 text, etc. — already in
  the canonical sections).

## Actions + AI tool surface (Phase 4)

`lib/actions/doc-drafts.ts` ("use server", owner-gated via `requireRole("owner")` for app UI;
a parallel internal entry for MCP/agents that records `created_via`):

- `createDocDraft(templateKey, scope)` → resolves auto fields, inserts draft, returns
  `{ id, fillReport, missingFields }`.
- `updateDocDraftFields(id, edits, actor)` → apply + save; if previously rendered, mark stale.
- `renderDocDraft(id)` → validate → render PDF + DOCX → `storeBuffer` (tag e.g.
  `CONTRACT · DRAFT`, project files browser) → status `rendered`.
- `submitDocDraftForSignature(id)` → **owner-only, never callable by AI** → creates the
  `signature_requests` row (doc_type mapped from templateKey; body = compact text fallback like
  `contractBody()` does today), links `signature_request_id`, status `submitted`. Reuse
  `createSentRequest` logic from `lib/actions/documents.ts` (extract it to a shared helper).
- `voidDocDraft(id)`, `cloneDocDraft(id)`.

MCP tools (`mcp/sjcos-mcp.mjs`, same registerTool pattern; all of these are internal-record
tools, allowed under the gated-writes rule; **no send tool**):

- `list_doc_templates` — keys, titles, field manifests (so an agent knows what it can fill).
- `create_document_draft` — args: template_key, project_slug | lead_slug, optional
  estimate_id/invoice_id/change_order_id. Returns draft id + fill report + missing fields.
- `get_document_draft` / `list_document_drafts` — read back values + status.
- `update_document_draft` — field edits; enforce ai-writable-only via `applyFieldEdits(…, 'ai')`.
- `render_document_draft` — produce the PDF/DOCX, return file ids + missing-field errors.
- Submission for signature goes through the existing owner-approval seam: agents call the
  existing `submit_draft_for_approval` with a pointer to the draft; Joe approves in-app, and
  the app calls `submitDocDraftForSignature`.

Every MCP mutation should `record_agent_run`-style audit (follow the existing pattern in the
file for gated writes).

## UI (Phase 5)

- Project page → Documents/Sign-offs area: "New document" menu listing the 7 templates;
  draft editor screen = field form (auto values shown read-only with an unlock toggle, AI
  narrative fields with a "Draft with AI" button calling `ai.ask` like `generateSOW` does),
  Render preview (PDF link), and Submit-for-signature (owner).
- Leads: precon agreement entry point (lead-scoped) on the lead detail page.
- Settings: new "Billing rates" group (`rates.*` keys) powering the precon rates table; keep
  the existing `contract.terms` blob for the legacy short-form generator until cutover.
- Cutover: switch `generateContract` (lib/actions/documents.ts), closeout cert + lien waiver
  (lib/actions/closeout.ts), and CO send flow to create drafts from the new templates instead
  of the old inline renderers. Keep old renderers until then; delete after cutover verifies.
  **STATUS 2026-07-10: NOT done — deliberately deferred.** Settings billing rates ✓, project +
  lead Documents UI ✓. The old and new systems coexist; the rewire + deletion is a separate PR
  to run after Joe validates the new drafts on a live job (see the status header at the top).

## Phase order (each phase is one working PR; verify before moving on)

1. **DB**: `document_drafts` + doc_type migration (schema.sql; run setup against dev DB).
2. **Templates + fill**: `lib/doc-templates/*` for `contract`, `precon`, `lien_release`,
   `completion_cert` (the four legal docs — the texts are ready), with unit-testable pure fill
   logic.
3. **Renderers**: `lib/doc-render.ts` PDF + DOCX; render all four legal docs from seeded data
   and eyeball the PDFs (page breaks, statutory bold, checkbox groups, notary block).
4. **Actions + MCP tools**: draft lifecycle end-to-end; verify AI cannot write locked fields
   and cannot send.
5. **Transactional templates**: `change_order`, `estimate_doc`, `invoice_doc` modules +
   renderers (visual match to the source docx files).
6. **UI + cutover** of the legacy generators; delete superseded renderer code.

## Verification checklist (run per phase; final pass before cutover)

- [ ] Contract renders all sections in order vs `construction-contract.md`; mechanics-lien
      notice is ≥10-pt bold; payment table matches the estimate's draw schedule to the cent.
- [ ] Precon renders lead-scoped with no project row; rates table pulls `rates.*` settings.
- [ ] Lien release renders exactly one variant's paragraphs per `waiver_type`; amounts
      reconcile: `contract_total - paid_to_date = balance_remaining`.
- [ ] Completion cert punch/account numbers match `project_punch` and invoices.
- [ ] `update_document_draft` (as AI) rejects edits to money/date/statutory fields.
- [ ] No path exists from any AI/MCP tool to `signature_requests` 'sent' status.
- [ ] `template_version` + generated date stamped in every PDF footer.
- [ ] DOCX opens in Word/LibreOffice with structure intact (spot-check contract + CO).
- [ ] Estimate/Invoice/CO PDFs visually match `docs/reference/doc-templates/source/*.docx`.

## Open questions for Joe — RESOLVED 2026-07-10

1. Canonical company phone/email — **(612) 361-6585 + info@sjcarpentryllc.com** (the docx-template
   set). Set in `app_settings` (`profile.phone`, `profile.email`); templates read from there.
   (Joe still needs to set `company.address` in Settings — left blank so a placeholder can't
   reach a real doc; render prompts for it.)
2. Precon third-party markup: **20% for profit/overhead + applicable tax** (single number).
   The 18% + 1.2% split was dropped. Merge field `{{markup_pct}}` (default 20%), settings key
   `rates.markup`.
3. Site Superintendent rate: the $22/hr was a **typo → corrected to $62/hr** (settings key
   `rates.super`).
4. 3-day right-of-cancellation notice: **added to the main construction contract** as its own
   "NOTICE OF RIGHT TO CANCEL" section (attorney to confirm wording + refund carve-out).
5. Attorney review of the four legal texts, tracked per-template via `attorneyReviewed` on the
   `DocTemplate` (drafts ship with the `LEGAL_DISCLAIMER` footer until flipped `true`):
   - `contract` — **reviewed, confirmed 2026-07-14.** Disclaimer footer removed.
   - `precon` / `completion_cert` / `lien_release` — still pending; disclaimer footer remains
     until Joe confirms review is done for each.
