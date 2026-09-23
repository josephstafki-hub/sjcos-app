# Estimates and change orders — where things go

> Rule set by Joe on 2026-09-23 after the in-app agents kept confusing the
> estimates in a project's **Money** tab with the **Formal Estimate** section
> in its **Documents** tab. This page is the canonical statement; `AGENTS.md`,
> `mcp/README.md`, the MCP tool descriptions and the UI copy all point here.
> The database enforces the phase rule by trigger (`db/schema.sql`, "Estimate
> kinds" block), so every writer gets the same answer.

## The rule

1. **The formal estimate lives under Documents › Formal Estimate**
   (`estimates.kind = 'formal'`). Its line items are edited there (add line,
   bulk add, live preview, send for approval, contract generator), and the
   Formal Estimate PDF the client gets is generated from those lines — the
   documents list under the editor holds the copies. Agents:
   `add_estimate_lines` on the id `get_project` reports as
   `pricing_and_paperwork.formal_estimate_id`; then
   `create_document_draft { template_key: "estimate_doc", estimate_id }` for a
   PDF copy, and regenerate it after the lines change. A job normally has one
   formal estimate; don't create a second one to add to it.
2. **Money › Pre-con changes** holds client additions or changes priced
   **before the contract is signed**: a new estimate with
   `kind = 'precon_change'`, priced and approved like any estimate. Not a
   change order.
3. **After the contract is signed** → a change order (Money › Change orders,
   with its PDF under Documents › Change Order). Never in pre-construction.
4. Lead phase: the rough estimate on the lead page (`lead_estimates`). Not a
   project estimate.

Both kinds are rows in the same `estimates` table; `kind` decides which
section shows them (`components/projects/ProjectEstimate.tsx` is mounted once
per kind from `app/(os)/projects/[slug]/page.tsx`).

## Which phase a job is in: `project_scope_change_path(project_id)`

Decided in SQL and mirrored, for copy only, by `scopeChangePath()` in
`lib/estimate-kinds.ts`:

| `projects.status` | Path |
|---|---|
| `precon_signed`, `floor_plan`, `mood_board`, `selections`, `bidding` | `precon_estimate` |
| `construction_contract` | `change_order` **if** a signed contract exists (`signature_requests` doc_type `contract` signed, or a `document_drafts` contract row with status `signed`), else `precon_estimate` |
| `construction`, `closeout`, `warranty` | `change_order` |

`get_project` returns this as `pricing_and_paperwork.scope_change_path`,
together with the job's estimates (each tagged `lives_in`, and
`formal_estimate_id`), change orders and document drafts.

## What is enforced, and where

- **`change_orders` INSERT** is refused unless the path is `change_order`
  (trigger `trg_change_orders_require_contract`).
- **`estimates` with `kind = 'precon_change'`** is refused when the path is
  `change_order` (trigger `trg_estimates_precon_change_before_contract`).
  `kind = 'formal'` is allowed in any phase.
- **`createDocDraft`** (app + `create_document_draft` MCP) requires the record
  a template is generated from: `estimate_doc` and `contract` need
  `estimate_id`, `change_order` needs `change_order_id`, `invoice_doc` needs
  `invoice_id` — and it must belong to the job. The Documents tab's "New …"
  offers a picker of the job's records instead of creating a blank draft.
- **Server actions** (`createChangeOrder`, `createEstimate`) check the path
  first so the UI shows a plain-English refusal; the triggers are the backstop.
- **UI**: Money › Pre-con changes shows the phase and hides "New" once under
  contract; Money › Change orders hides "New change order" in pre-construction.

## Agent recipe

- "Add X to the formal estimate" → `add_estimate_lines { estimate_id: formal_estimate_id, lines }`.
  If a Formal Estimate PDF exists, `render_document_draft` it again. If the
  estimate was already sent/approved, tell Joe the total changed.
- "Client wants to add/change Y" → check `scope_change_path`. `precon_estimate`
  → `create_estimate { kind: "precon_change" }` + `add_estimate_lines`.
  `change_order` → a change order; no tool creates one, so draft it in the app
  or `ask_owner`.
- "Make the formal estimate document" → `create_document_draft
  { template_key: "estimate_doc", estimate_id }`, fill `scope_summary`, render.
- Never insert into `estimates`, `estimate_lines`, `change_orders` or
  `document_drafts` with an ad-hoc script.

## Data notes

- `estimates.kind` defaults to `formal`; the 2026-09-23 migration
  (`db/apply-estimate-kinds.mjs`) re-tagged estimates titled "Revision …" as
  `precon_change`.
- A `precon_change` estimate does not change the project's contract value on
  its own (owner manages that number).
- Lead-scoped estimates (`estimates.lead_slug`) are outside the phase rule.
