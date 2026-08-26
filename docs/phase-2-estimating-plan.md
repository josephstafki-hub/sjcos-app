# SJC OS — Phase 2 Plan: The Estimating Spine
*Drafted 2026-06-30. Covers plan-vs-build rows 3c, 3d, 4d, 5-sign, skills-prod, and the merge option. Sits on the Phase-1 foundations (e-sign, scheduler, MCP).*

> **✅ BUILT (verified 2026-08-25) — kept as the design record.** The spine
> shipped: `cost_items` + `/cost-book`, `estimates` + `estimate_lines` (with the
> `design_build` / `plans` / **`merged`** rails in `lib/estimates.ts`), the
> browser-extension catalog clipper (`browser-extension/`, `POST /api/catalog/clip`),
> contract + SOW generation, draw schedules (`lib/draw-schedule.ts`), and portal
> document signing (`/api/portal/sign-doc/[id]`). Money is **cents** throughout.
> The document half went a different way than the "production doc skills" idea
> here — see `docs/phase-2-b5-b6-plan.md` and `docs/doc-templates-plan.md`.

## Goal

Turn SJC OS into the place an estimate is built and a contract comes out of:
**measure → price from a reusable cost book → estimate → client-approve → auto-generate contract + SOW → e-sign.** This is the pre-construction → contract spine, minus the deferred CAD designer.

## What already exists (build on, don't duplicate)

- `catalog_items` — products/materials (name, supplier, sku, category, retail price as text) + real CRUD. → extend for the clipper + estimate material lines.
- `lead_estimates` — rough lead estimate (jsonb line items + total + status). → keep for the lightweight lead-stage rough estimate; the new structured model is for project estimates.
- `project_selections` + `project_sections` — selections with prices + section budgets. → a source of estimate lines for the design-build rail.
- `ai.estimate()` in `lib/ai.ts` — phased-estimate AI method (Qwen + mock fallback). → the `estimate-research` assist.
- `signature_requests` / `signature_events` (Phase-1 e-sign) — generated docs become signature requests. → contract/SOW/estimate signing.
- `lib/automate.ts` — the Claude-CLI path. → how we run the polished doc skills (sow/specs/pdf) AI-agnostically.

## New data model (sketch)

```
-- The company's reusable unit costs (labor+material assemblies), distinct from
-- catalog_items (retail products). The engine of repeatable estimating.
cost_items (
  id bigserial PK, name text, category text,
  unit text CHECK (unit IN ('sf','lf','ea','hr','ls','cy')),   -- sq ft / lin ft / each / hour / lump / cu yd
  unit_cost integer,            -- cents (avoid float)
  default_markup numeric(5,2),  -- e.g. 20.00 (%)
  notes text, archived boolean DEFAULT false, created_at
)

-- A project (or lead) estimate.
estimates (
  id bigserial PK,
  project_id uuid NULL REFERENCES projects ON DELETE CASCADE,
  lead_slug text NULL,                       -- pre-project estimates
  title text, rail text CHECK (rail IN ('design_build','plans','merged')),
  status text CHECK (status IN ('draft','sent','approved','declined')) DEFAULT 'draft',
  subtotal integer, markup_total integer, total integer,   -- cents, recomputed
  sent_at, approved_at, created_by uuid, created_at
)

estimate_lines (
  id bigserial PK,
  estimate_id bigint REFERENCES estimates ON DELETE CASCADE,
  cost_item_id bigint NULL REFERENCES cost_items ON DELETE SET NULL,  -- or free-form
  description text, section text,            -- grouping (room/phase)
  unit text, qty numeric(10,2), unit_cost integer, markup numeric(5,2),
  extended integer,                          -- qty*unit_cost*(1+markup), cents
  sort_order int
)
```
Catalog clipper adds to `catalog_items`: `source_url text`, `image_file_id text` (image via existing `storeUpload`).

## Work items (dependency-ordered)

**B1 — Cost book** *(row 3d core; foundation for everything else)*
- `cost_items` table + CRUD (mirror the catalog pattern: server reads, owner-gated actions, a `/settings` or new `/cost-book` surface).
- Seed from Joe's real price list (see decisions). Pure constants (units) in a db-free module per the client-bundle gotcha.

**B2 — Estimate builder** *(row 3d; the heart)*
- `estimates` + `estimate_lines` tables. `lib/estimates.ts` reads, `lib/actions/estimates.ts` writes (add/edit/remove line, recompute totals on every write).
- Owner UI: a new **"Estimate" project tab** — add lines from the cost book (pick item → qty → auto-price w/ markup) or free-form; grouped by section; live subtotal/markup/total.
- `ai.estimate()` assist button: suggest missing line items / sanity-check pricing (Qwen; candidate for the Claude path — see decisions).

**B3 — Takeoff entry** *(row 3d; feeds B2)*
- v1 = **manual quantity entry** against cost-book items, with the uploaded plan (existing `project_floorplans`) shown side-by-side for reference.
- On-PDF measuring (click-to-measure scale tool) is a **later** add — large, CAD-like. v1 keeps takeoff = typed quantities.

**B4 — Estimate → client approval** *(row 3d + 5-sign; reuses e-sign)*
- "Send estimate" → render the estimate to a `signature_request` (doc_type `estimate`) → client reviews + e-signs in the portal (already built). On sign → estimate `status=approved`.

**B5 — Contract + SOW generation** *(row 4d)*
- From an approved estimate, generate **contract** (terms + total + a simple manual draw schedule — AI draw optimizer is deferred) and **SOW** (scope narrative + lines) as `signature_request` bodies → e-sign.
- v1 body = generated text/markdown.

**B6 — Wire in production doc skills** *(row skills-prod)*
- Produce polished **.docx / .pdf** (sow, specs, bank-approval) via the Claude-CLI path (`lib/automate.ts` pattern), attached to the signature request as a `file_id`. AI-agnostic seam preserved. Enhancement on top of B5's text bodies.

**B7 — Merge** *(row 3d merge option)*
- Combine two estimates (e.g., a design-build + a plans-based) into one `rail='merged'` estimate: union the lines, keep section grouping, recompute totals.

**A — Browser-extension catalog clipper** *(row 3c; parallelizable)*
- MV3 Chrome extension: popup + content script scrapes the current product page (name/price/image/URL), POSTs to a new **token-authenticated** `POST /api/catalog/clip` (extension is cross-origin → per-owner clip token in `.env.local`/settings, not the session cookie).
- Lands a `catalog_item` immediately usable in estimates/selections.

## Sequencing

1. **B1 cost book** → 2. **B2 estimate builder** → 3. **B3 takeoff** → 4. **B4 estimate e-sign** → 5. **B5 contract/SOW gen** → 6. **B7 merge** → 7. **B6 polished docs** (enhancement) → **A clipper** can run in parallel any time (feeds catalog).

## Out of scope this phase (already deferred)
Floor-plan designer + auto-estimate-from-geometry (3a), on-PDF click-to-measure takeoff, AI cash-flow draw schedule (4b), the formal 3-sign-off approval gate (4a). Estimates here send for signature individually.

## Decisions (locked 2026-06-30)

1. **Cost book source → BUILD BY HAND.** `cost_items` starts empty; Joe adds items through the CRUD UI as real jobs are estimated. (Importer can be added later if a list materializes.)
2. **Markup model → SINGLE COMPANY-WIDE %.** Default markup % in `app_settings` (`estimate.default_markup`), applied to every line, overridable per line. `cost_items.default_markup` is secondary.
3. **Estimate AI → QWEN (free/local).** Estimate assist uses the existing Ollama/Qwen `ai.estimate()` with mock fallback. Revisit if quality is weak on real estimates (A1).
4. **Doc output → POLISHED DOCS NOW.** B6 moves up and merges into B5: contract/SOW/estimate generated as **.docx/.pdf** via the production doc skills (sow/specs/pdf) through the Claude-CLI path (`lib/automate.ts`), attached to the `signature_request` as a `file_id`. (Text-body e-sign is the fallback if the skill path fails.)
5. **Browser extension** — still open; decide when we reach item A (parallel/last). Likely Chrome, loaded unpacked for Joe only.

### Revised sequencing (after decisions)
1. **B1 cost book** (empty + CRUD; add `estimate.default_markup` setting) → 2. **B2 estimate builder** (Qwen assist) → 3. **B3 takeoff** (manual qty) → 4. **B4 estimate→e-sign** → 5. **B5+B6 contract/SOW gen AS polished .docx/.pdf** via the doc-skill Claude path → 6. **B7 merge**. **A clipper** parallel, decide later.

> **B5+B6 is the most complex new integration in Phase 2:** the Claude-CLI path (`lib/automate.ts`) must invoke the sow/specs/pdf skills headlessly with project+estimate inputs and write a file into `uploads/` that becomes the signature_request's `file_id`. Scope it as its own step when reached (Claude call cost/auth, skill input contracts, file handoff).
