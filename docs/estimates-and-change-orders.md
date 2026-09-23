# Estimates and change orders — where things go

> Rule set by Joe on 2026-09-23 after the in-app agents kept confusing the
> estimates in a project's **Money** tab with the **Formal Estimate** documents
> in its **Documents** tab. This page is the canonical statement; `AGENTS.md`,
> `mcp/README.md`, the MCP tool descriptions and the UI copy all point here.
> The database enforces the phase rule by trigger (`db/schema.sql`, "Estimate
> kinds" block), so every writer gets the same answer.

## The rule

1. **The formal estimate is the estimate in Money › Estimate** (`estimates.kind = 'formal'`).
   Add or change its line items there. Agents: `add_estimate_lines` on the id
   `get_project` reports as `pricing_and_paperwork.formal_estimate_id`. A job
   normally has one formal estimate; don't create a second one to add to it.
2. **Documents › Formal Estimate is only the PDF of that estimate.** It has no
   numbers of its own — its line items and totals are auto fields rendered from
   the estimate (`lib/doc-templates/fill.ts`). Make it with
   `create_document_draft { template_key: "estimate_doc", estimate_id }` and
   regenerate it after the lines change. Never type numbers into it.
3. **A client asks for an addition or change before the contract is signed** →
   a new estimate in Money › Estimate with `kind = 'precon_change'`. Priced and
   approved like any estimate. Not a change order.
4. **After the contract is signed** → a change order (Money › Change orders,
   with its PDF under Documents › Change Order). Never in pre-construction.
5. Lead phase: the rough estimate on the lead page (`lead_estimates`). Not a
   project estimate. Once the lead converts, it and every lead-stage document
   (pre-con agreement, lead formal-estimate PDF) stay visible read-only on the
   project under Documents › From the lead, which links back to the lead page
   for edits. Lead signature requests also show in the project's Sign in person
   list.

## Which phase a job is in: `project_scope_change_path(project_id)`

Decided in SQL and mirrored, for copy only, by `scopeChangePath()` in
`lib/estimate-kinds.ts`:

| `projects.status` | Path |
|---|---|
| `precon_signed`, `floor_plan`, `mood_board`, `selections`, `bidding` | `precon_estimate` |
| `construction_contract` | `change_order` **if** a signed contract exists (`signature_requests` doc_type `contract` signed, or a `document_drafts` contract row with status `signed`), else `precon_estimate` |
| `construction`, `closeout`, `warranty` | `change_order` |

`get_project` returns this as `pricing_and_paperwork.scope_change_path`,
together with the job's estimates (and `formal_estimate_id`), change orders and
document drafts.

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
- **UI**: Money › Estimate labels each estimate with its kind and shows the
  phase; Money › Change orders hides "New change order" in pre-construction.

## Agent recipe

- "Add X to the formal estimate" → `add_estimate_lines { estimate_id: formal_estimate_id, lines }`.
  If a Formal Estimate PDF exists under Documents, `render_document_draft` it
  again. If the estimate was already sent/approved, tell Joe the total changed.
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
