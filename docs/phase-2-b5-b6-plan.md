# Phase 2 — B5+B6 Mini-Plan: Contract / SOW generation
*Drafted 2026-06-30. Generate a contract + Scope of Work from an approved estimate, as a polished document the client e-signs. Builds on B1–B4 + the Phase-1 e-sign.*

> **✅ BUILT — Option C is what shipped (verified 2026-08-25).** Documents are
> assembled deterministically in-app (pdfkit + the `docx` package) and the only
> AI-written field is the scope narrative — exactly the hybrid recommended
> below. The 🔴 key finding held: the Claude-CLI doc-skills path was never used.
>
> It has since grown past this mini-plan into a full template system —
> **`lib/doc-templates/`** (8 templates: contract, precon, lien release,
> completion cert, change order, estimate, invoice, rough estimate),
> `lib/doc-render.ts`, `document_drafts`, and a token-guarded agent surface that
> **cannot send**. Canonical legal text lives in
> `docs/reference/doc-templates/*.md`. **Read `docs/doc-templates-plan.md`
> instead of this file for anything current;** this one is the decision record
> for why the documents are code-generated, not LLM-generated.

## 🔴 Key finding (changes the original P2-4 assumption)

The plan-vs-build decision P2-4 said "polished .docx/.pdf via the production doc skills (sow/specs/pdf) through the Claude-CLI path." **Those skills are NOT installed on this server.** Verified:
- `~/.claude/skills/` doesn't exist; no `sow`/`specs`/`pdf`/`docx`/`bank-approval` SKILL.md anywhere on the box.
- The local `claude` CLI's `skillUsage` shows it has only ever run `fewer-permission-prompts` and `claude-api`.

They live in your *other* Claude environment (Windows/desktop). So the assumed path — `lib/automate.ts` shells to the CLI which invokes the doc skills — **can't work as-is**. Also: `lib/automate.ts` deliberately **forbids Bash** in execute mode, but those skills generate files via Python (python-docx etc.), which needs Bash. So using them would require both *porting the skills here* AND *loosening the automate sandbox* — a lot of surface area for a binding legal document.

## Options

**Option A — Server-side document library (recommended).** Render the contract + SOW deterministically in-app with a pure-JS library — no Claude dependency. Polish comes from a good template, not an LLM. Free, fast (~ms), reliable, reproducible. The document is assembled from real estimate data; an LLM never fabricates numbers or terms.
- PDF (the signable, client-viewable artifact): `pdfkit` or `@react-pdf/renderer` (pure JS, no headless browser — important on this GPU-less box).
- Optional `.docx` (editable owner record): the `docx` npm package.

**Option B — Port the doc skills + use the Claude-CLI path.** Bring `sow`/`specs`/`pdf` onto this server, loosen the automate sandbox to allow their Python execution, and shell out per document. Matches the original vision and reuses your authored skill templates — but: per-doc Claude cost, slower, a binding doc assembled by an LLM, and a wider sandbox. Higher risk/complexity.

**Option C — Hybrid (recommended if you want AI prose).** Option A assembles the document deterministically, but **Qwen (local, free) drafts the scope-narrative prose** for the SOW (the one genuinely free-text part). Numbers, terms, totals, and layout stay code-generated; only the descriptive paragraph is AI. Best of both — polished + safe + a touch of AI where it helps.

> **Recommendation: C** (A as the floor). Keep binding content deterministic; let Qwen write only the narrative. No new external dependency on skills that aren't here, no Claude cost, works fully offline-of-Claude.

## Design (Option C)

**Inputs:** an **approved** (or sent) estimate + its lines, the project, the client (signer), and company boilerplate from `app_settings` (license #, address, standard terms).

**Documents produced (per estimate):**
1. **Contract** (PDF) — parties, project, total, a simple **draw schedule** (deposit + progress draws; the AI cash-flow optimizer is deferred per 4b, so v1 uses a basic configurable split, e.g. 10% deposit then even milestone draws), standard terms boilerplate, signature block.
2. **Scope of Work** (PDF) — a Qwen-drafted scope narrative (grounded in the estimate sections/lines) + the itemized line breakdown by section + total.

**Generation flow (new `lib/documents.ts` + action):**
1. Owner clicks **"Generate contract"** / **"Generate SOW"** on an approved estimate (in the Estimate tab or Sign-offs tab).
2. Action loads estimate+lines+project+client+settings → (SOW) calls `ai.ask`/`ai.summarize` on Qwen for the narrative → renders the PDF via the doc lib into a buffer.
3. Store the buffer with the existing `storeUpload`-style helper into `uploads/` + a `files` row (reuse the upload infra; add a non-File variant that takes a Buffer + filename + mime `application/pdf`).
4. Create a **signature_request** (doc_type `contract` / `sow`) with `file_id` set to the generated file (and a short `body` summary as fallback). Client e-signs it (B4 flow already exists).

**Serving the file to the client (new, required):** `/api/files/[id]` is **owner-only**. The signing client must view the PDF. Add a **portal-scoped file route** (mirror the existing `/api/portal/selection-image/[id]`) that serves a signature_request's `file_id` to the linked client only. The portal `ClientSignDocs` then shows a "View document (PDF)" link above the consent/sign controls when `file_id` is set (today it renders `body` text).

**Schema:** no new tables. Reuses `signature_requests.file_id` (already exists) + `files`. May add a few `app_settings` keys for company boilerplate (`company.license`, `company.address`, `contract.terms`, `contract.deposit_pct`).

## Work breakdown
- **B5a** — `lib/documents.ts`: PDF render for contract + SOW (doc lib + template); Buffer→`files` upload helper.
- **B5b** — actions `generateContract(estimateId)` / `generateSOW(estimateId)` → file + signature_request (doc_type, file_id); owner UI buttons on an approved estimate.
- **B5c** — portal file route + `ClientSignDocs` "View document" link so the client reviews the actual PDF before signing.
- **B6** — Qwen scope-narrative draft feeding the SOW (the hybrid bit). Company-boilerplate settings.

## Decisions for Joe
1. **Approach** — A (deterministic only), B (port skills + Claude path), or **C (deterministic + Qwen narrative, recommended)**?
2. **Formats** — PDF only (client-viewable + signable), or also emit an editable **.docx** for your records?
3. **PDF library** — `pdfkit` (lean, programmatic) vs `@react-pdf/renderer` (JSX templates, nicer layout). Either is pure-JS/no-browser. (I'd pick `@react-pdf/renderer` for maintainable templates.)
4. **Draw schedule for the contract** — fixed simple default now (e.g. 10% deposit + even progress draws), configurable in settings? (Full AI optimizer stays deferred.)
5. **Company boilerplate** — give me your license #, business address, and standard contract terms to seed `app_settings`, or use placeholders you edit later in Settings?

## Out of scope (still deferred)
AI cash-flow draw optimizer (4b), the 3-sign-off approval gate (4a), bringing the desktop doc skills onto the server (unless Option B is chosen), polished templates beyond a clean v1 layout.
