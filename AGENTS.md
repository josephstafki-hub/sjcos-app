<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Server resources — rules for every agent and subagent (admin, 2026-10-30)

This box is shared with the live site and other apps. Joe's account has a hard limit of
24 GB RAM / 8 CPU threads across everything he runs; at 24 GB Linux kills the biggest
process. A `next dev` started by an agent in a worktree leaked ~1.5 GB/min and froze the
server twice.

- **Never run `next dev`.** No exceptions for subagents. To see a change, list what needs a
  visual check and hand it back; one coordinator does a memory-capped production build.
- A coordinator who must run the app: `next build` with its own `SJC_DIST_DIR`, then
  `next start` on a side port inside `systemd-run --user -p MemoryMax=8G -p Restart=no`,
  check, and stop it the same turn. `pgrep -af next` first. Never build into the live `.next`.
- No browsers (Chromium/Playwright) in subagents. One niced `tsc --noEmit` at a time;
  run single test files, not the full suite, unless you are the coordinator.
- Never stop, restart or rebuild `sjcos.service`, `sjcos-mcp.service`, `sjcos-worker.service`
  or `ordinem.service` unless Joe asked for a deploy.
- Killed with exit 137 / "Killed" = you hit the limit. Report it; don't retry.
- Anyone briefing a subagent must paste these rules into the brief (Codex does not read
  Claude's rule files).

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

# Estimates and change orders — where things go

Rule from Joe (2026-09-23); full text in `docs/estimates-and-change-orders.md`.

- **The formal estimate lives under Documents › Formal Estimate** (`kind = formal`).
  To add or change its lines, call `add_estimate_lines` on it — the id is
  `get_project → pricing_and_paperwork.formal_estimate_id`. The client's PDF is
  generated from those lines (`create_document_draft { template_key:
  "estimate_doc", estimate_id }`). After the lines change, `render_document_draft`
  re-prints it with the current lines (until then it can't be sent or
  published). Don't create a second formal estimate when one exists. Never insert these rows by
  script. `contract` needs `estimate_id` too; `change_order` needs
  `change_order_id`; `invoice_doc` needs `invoice_id`.
- **A sent estimate is locked** (Joe, 2026-10-30; migration 0047). Once it is
  out to the client (sent, or a signature request on it is out or signed), its
  lines can't be added, edited or deleted. To revise before signing, Joe voids
  the signature request (it goes back to draft), then it is edited and sent
  again. Signed stays locked: a Pre-con change or a change order instead.
- **Money › Pre-con changes** holds client additions or changes priced
  **before the contract is signed**: a new estimate with `kind = precon_change`
  (`create_estimate`), not a change order.
- **After the contract is signed** → a change order (Money › Change orders).
  Never in pre-construction; the table refuses the row. No MCP tool creates a
  change order — draft it in the app or ask Joe with `ask_owner`.
- Lead phase: the rough estimate on the lead page. Not a project estimate.

# Job total and paid (the projects-list bar)

Rule from Joe (2026-10-30). A job's total, paid amount and "% paid" bar are
computed by Postgres from its records on every write
(`db/migrations/0037_job_money_ledger.sql`): formal estimate in effect + approved
change orders + pre-con fee invoices + agreed outside the app; payments on
invoices + paid outside the app. No tool writes them, and a direct write to
`contract_value` / `collected_to_date` / `progress` is overwritten.

- A client paid → record the payment on its invoice; the bar moves by itself.
- A total or payment from outside the app (Houzz, a pre-con fee the app never
  billed) → Joe enters it on Money › Overview › "Money outside the app".
  Ask him with `ask_owner`; never script it.
- Read the breakdown from `get_project → job_money`.

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
