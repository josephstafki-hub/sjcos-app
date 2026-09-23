# Estimates, Formal Estimate documents and change orders — where things go

> Rule set by Joe on 2026-09-23 after the in-app agents kept confusing the
> estimates in the project's **Money** tab with the **Formal Estimate**
> documents in the **Documents** tab. This page is the canonical statement of
> the rule; `AGENTS.md`, `mcp/README.md`, the MCP tool descriptions and the
> UI copy all point here. The **database enforces it** (triggers on
> `change_orders` and `estimates`, `db/schema.sql` "Estimate kinds" block), so
> every writer — the app, the MCP tools, an agent's one-off script — gets the
> same answer.

## The rule in four lines

| Where | What it is | When |
|---|---|---|
| **Money › Estimate** | The **numbers**: line-item estimate *worksheets* built from the cost book. Two kinds (`estimates.kind`): **`formal`** — the job's base bid; **`precon_change`** — a client-requested addition or change priced before the contract is signed. | Pre-construction |
| **Documents › Formal Estimate** | The **paper**: the client-facing Formal Estimate document (PDF/DOCX, signable), always **rendered from a worksheet** (`estimate_id`). Never typed by hand. When the numbers change, edit the worksheet and re-render. | Whenever a worksheet is ready for the client |
| **Money › Change orders** → **Documents › Change Order** | A scope/price change to a **signed contract**. The change order row (title, description, price) is drafted in Money › Change orders and e-signed; the Documents › Change Order template renders it. | Construction, closeout (contract signed) |
| **Lead page › Rough estimate** | The Phase-1 ballpark for a lead (`lead_estimates`, Rough Estimate PDF). Not a project estimate. | Lead phase |

One sentence: **before the contract is signed a client change is a pre-con
change estimate (Money › Estimate); after it is signed it is a change order.**

## Why the base estimate also lives in Money › Estimate

The Formal Estimate document has no numbers of its own. Its line items,
subtotal and total are *auto fields* resolved from an `estimates` row and its
`estimate_lines` (`lib/doc-templates/fill.ts` → `resolveEstimateDoc`). The
Money › Estimate panel is the worksheet that produces those numbers; its
"Preview · what the client will see" iframe is literally the Formal Estimate
template rendered live. The approved `formal` worksheet is also what
"Create contract from this estimate" and `adopt_estimate_as_budget` read.

So the two tabs are not two places for the same thing: **Money holds the
worksheet, Documents holds the document made from it.** A "Formal Estimate"
with no `estimate_id` is an empty shell that can never render — the app now
refuses to create one and names the worksheets it could be made from.

## Which path applies: `project_scope_change_path(project_id)`

Decided in SQL (single source of truth) and mirrored, for copy only, by
`scopeChangePath()` in `lib/estimate-kinds.ts`:

| `projects.status` | Path |
|---|---|
| `precon_signed`, `floor_plan`, `mood_board`, `selections`, `bidding` | `precon_estimate` |
| `construction_contract` | `change_order` **if** a signed contract exists (`signature_requests` doc_type `contract` signed, or a `document_drafts` contract row with status `signed`), else `precon_estimate` |
| `construction`, `closeout`, `warranty` | `change_order` |

`get_project` (MCP) returns this as `pricing_and_paperwork.scope_change_path`
together with the job's worksheets, change orders and document drafts, each
tagged with where it lives — read it before deciding where something goes.

## What is enforced, and where

- **`change_orders` INSERT** is refused unless the path is `change_order`
  (trigger `trg_change_orders_require_contract`). The message names the status
  and points at Money › Estimate.
- **`estimates` with `kind = 'precon_change'`** is refused when the path is
  `change_order` (trigger `trg_estimates_precon_change_before_contract`).
  `kind = 'formal'` is allowed in any phase (imports and backfills of the base
  bid happen on live jobs).
- **`createDocDraft`** (app + `create_document_draft` MCP) requires the source
  record for templates that render one: `estimate_doc` and `contract` need
  `estimate_id`, `change_order` needs `change_order_id`, `invoice_doc` needs
  `invoice_id` — and the record must belong to the job. The Documents tab's
  "New …" button offers a picker of the job's records instead of creating a
  blank draft.
- **Server actions** (`createChangeOrder`, `createEstimate`) check the path
  first so the UI shows a plain-English refusal; the triggers are the backstop
  for every other writer.
- **UI**: Money › Estimate labels every worksheet with its kind and shows the
  job's phase; Money › Change orders hides "New change order" in
  pre-construction and says where the change goes instead; Documents › Formal
  Estimate / Change Order / Invoice / Contract explain what they are rendered
  from.

## Agent recipe

1. `get_project <slug>` → read `pricing_and_paperwork`.
2. **Client asks for an addition/change**
   - `scope_change_path = precon_estimate` → `create_estimate { kind: "precon_change" }` then `add_estimate_lines`; when Joe wants it in front of the client he sends it for approval from Money › Estimate (the Formal Estimate PDF is rendered from it).
   - `scope_change_path = change_order` → a change order. No MCP tool creates one (the client portal lists every non-draft CO — see `mcp/financials-tools.mjs`); draft it in Money › Change orders or ask Joe with `ask_owner`. `set_change_order_costs` handles the budget side once it exists.
3. **Formal estimate for the job** → build/revise the `formal` worksheet in Money › Estimate (`create_estimate` / `add_estimate_lines`), then `create_document_draft { template_key: "estimate_doc", estimate_id }` for the paper, fill `scope_summary`, render.
4. **Never** insert into `estimates`, `estimate_lines`, `change_orders` or `document_drafts` with an ad-hoc script when a tool exists; if you must, the triggers above still apply.

## Data notes

- `estimates.kind` defaults to `formal`; the 2026-09-23 migration
  (`db/apply-estimate-kinds.mjs`) re-tagged existing worksheets whose title
  starts with "Revision" as `precon_change`.
- A `precon_change` worksheet is priced and approved like any estimate
  (`sendEstimate` → e-sign → status `approved`); it does **not** change the
  project's contract value on its own (owner manages that number).
- Lead-scoped worksheets (`estimates.lead_slug`) are outside the phase rule —
  the lead page's Documents tab offers Formal Estimate only for those.
