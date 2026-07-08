<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SJC OS / SJ Carpentry operating rule

When work is related to SJ Carpentry business operations — clients, leads, projects, jobs, vendors, subcontractors, invoices, estimates, receipts, selections, scheduling, follow-ups, open tasks, or business knowledge — use the `sjcos` MCP server first.

SJC OS is the source of truth:
- Open Brain lives in SJC OS knowledge tools: `search_knowledge`, `fetch_knowledge`, `list_recent_knowledge`, `capture_knowledge`.
- Open Engine lives in SJC OS work tools: `business_snapshot`, `list_work_items`, `get_work_item`, `suggest_skill_for_work_item`, `update_work_item_status`.
- Open Skills/runbooks live in SJC OS tools: `list_skills`, `get_skill`, `search_skills`, `list_runbooks`, `get_runbook`.
- Audit/proof of work belongs in SJC OS via `record_agent_run`, `record_skill_used`, and `record_receipt`.

Do not treat `/home/joe/SJC OS Temp`, old CSV exports, or one-off local files as the operational source unless MCP is unavailable or the user explicitly asks for legacy/import evidence. Do not send client-facing emails/SMS/invoices/contracts through MCP; those stay owner-approved.
