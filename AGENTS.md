<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SJC OS / SJ Carpentry operating rule

When work is related to SJ Carpentry business operations — clients, leads, projects, jobs, vendors, subcontractors, invoices, estimates, receipts, selections, scheduling, follow-ups, open tasks, or business knowledge — use the `sjcos` MCP server first.

SJC OS is the source of truth:
- Open Brain lives in SJC OS knowledge tools: `search_knowledge`, `fetch_knowledge`, `list_recent_knowledge`, `capture_knowledge`.
- Open Engine lives in SJC OS work tools: `business_snapshot`, `get_today_queue`, `list_work_items`, `get_work_item`, `suggest_skill_for_work_item`, `update_work_item_status`, `snooze_work_item`, `submit_draft_for_approval`. For "what should I do today / work my queue" requests, start from `get_today_queue`; complete items with `update_work_item_status` + run/receipt records; never touch promotion.
- Scheduling rule (Joe, 2026-09-02): a to-do with a `due_at` on a later day is snoozed until 00:00 Central of that day and stays out of Today until then — enforced by a table trigger on `work_items`, for every agent and code path. To schedule work, set `due_at` to the day it should be worked; never surface a scheduled item early.
- Open Skills/runbooks live in SJC OS tools: `list_skills`, `get_skill`, `search_skills`, `list_runbooks`, `get_runbook`.
- Audit/proof of work belongs in SJC OS via `record_agent_run`, `record_skill_used`, and `record_receipt`.

Do not treat `/home/joe/SJC OS Temp`, old CSV exports, or one-off local files as the operational source unless MCP is unavailable or the user explicitly asks for legacy/import evidence.

Client-facing sends (emails, bid packages, POs, invoices, documents for signature, newsletter release) are owner-approved. The approval is an **owner grant** (`lib/owner-grants.ts`): without one, draft and stage, then ask — `request_owner_permission` files a Decision Joe approves on `/engine/permissions`. With a grant id (Joe ticked "Express permission" in the Ask window, approved your request, or minted one by hand), pass it as `owner_grant_id` to the matching `send_*` / `release_*` tool for exactly that target. Never route around the grant.

# Estimates, Formal Estimate documents and change orders — where things go

Rule from Joe (2026-09-23), enforced by database triggers for every writer;
full text in `docs/estimates-and-change-orders.md`. Read
`get_project → pricing_and_paperwork.scope_change_path` before filing any of these.

- **Money › Estimate** holds the **numbers**: estimate *worksheets*
  (`estimates` + `estimate_lines`). `kind = formal` is the job's base bid — the
  client approves it, and the contract and budget are built from it.
  `kind = precon_change` is a client-requested addition or change priced
  **before the contract is signed**. Tools: `list_project_estimates`,
  `create_estimate`, `add_estimate_lines`. Never insert these rows by script.
- **Documents › Formal Estimate** holds the **paper**: the client-facing
  document, always rendered **from** a worksheet —
  `create_document_draft { template_key: "estimate_doc", estimate_id }`. Never
  hand-typed; if the numbers change, change the worksheet and re-render.
  `contract` needs `estimate_id` the same way; `change_order` needs
  `change_order_id`; `invoice_doc` needs `invoice_id`.
- **Change orders** (Money › Change orders → Documents › Change Order) are for
  scope changes **after the contract is signed** (construction, closeout).
  Never in pre-construction — the table refuses the row. No MCP tool creates a
  change order; draft it in the app or ask Joe with `ask_owner`.
- Lead phase: the rough estimate on the lead page. Not a project estimate.

# Claude in the app

Claude in the Ask window is Joe's full in-app operator, not just a dev helper: every run loads the sjcos MCP tools alongside repo edit access, so it can take any action any agent can. The same grant rule applies to its sends.

# Newsletter (agent workflow)

The client newsletter is operable by agents — from the in-app chat block on
`/newsletter` (pick Claude / Qwen / Hermes in the rail) or from any MCP client via
the `*_newsletter_*` tools (see `mcp/README.md`).

What an agent MAY do: read the list, add / update / remove recipients, import
client emails, compose issues (`create_newsletter_issue` → `update_newsletter_issue`),
and **queue** an issue (`queue_newsletter_issue`). Adding a recipient parks a
welcome greeting and enrolls them in any welcome drip the owner has armed.

**Release** — actually mailing a queued issue/outbox row — needs an owner grant:
`release_newsletter_issue` / `release_newsletter_outbox_item` with an
`owner_grant_id` (see the grant rule above). **Arming a drip sequence**
(`setSequenceActive`) stays owner-only with no tool, do not add one. Queueing
parks a send; it does not send.
