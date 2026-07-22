# SJC OS — MCP server

`sjcos-mcp.mjs` is a [Model Context Protocol](https://modelcontextprotocol.io)
server exposing **structured access** to the SJC OS database — the shared access
point for the Open Brain / Open Engine / Open Skills layers. MCP is an open
standard, so this is **AI-agnostic** — any MCP client (Claude Desktop, Claude
Code, Cursor, Continue, Codex, …) can connect, not just Claude.

It runs as its own process over **stdio**, separate from the Next app, and reads
`DATABASE_URL` from `../.env.local`.

## Read tools

| Tool | Purpose |
|---|---|
| `business_snapshot` | Counts: leads by stage, projects by status, subs, A/R, compliance due in 60d, **work items by status + awaiting approval** |
| `list_leads` / `get_lead` | Leads (optional `stage`,`limit`) / one lead + intake + activity (`slug`) |
| `list_projects` / `get_project` | Projects (optional `status`) / one project + invoices + subs + money (`slug`) |
| `list_subs` | Subcontractors + COI status (optional `trade`) |
| `list_compliance` | Unresolved compliance items due within N days |
| `list_signature_requests` | E-sign requests (optional `project_slug`,`status`) |
| `search_knowledge` | Full-text + fuzzy search of the knowledge base (`query`, optional `project_slug`/`lead_slug`/`kind`/`limit`) |
| `fetch_knowledge` / `list_recent_knowledge` | One item by `id` / recent items (`days`,`kind`,…) |
| `list_work_items` / `get_work_item` | The work queue (optional `status`,`assignee_key`,`due_before`) / one item + its runs & receipts |
| `get_today_queue` | Joe's `/today` rail: promoted priorities + waiting backlog, each with its lane (`chat`/`quick`/`deep`). READ-ONLY — promotion is app-owned |
| `list_skills` / `get_skill` / `search_skills` | Skill library (approved unless `include_proposed`) / one skill + current body / search |
| `suggest_skill_for_work_item` | The skill/runbook a work item expects, else best fuzzy matches |
| `list_runbooks` / `get_runbook` | Runbooks / one runbook + ordered steps |

## Write tools (gated / logged)

Safe by construction — internal records, append-only audit, and proposals only.
**No client-facing sends** (email/SMS/invoice/contract) are exposed here.

| Tool | Effect |
|---|---|
| `capture_knowledge` | Save a knowledge item (dedup by fingerprint; optional receipt) |
| `create_work_item` | Add to the queue (`requires_approval` defaults true) |
| `update_work_item_status` | Move an item's status (done sets completed_at) |
| `snooze_work_item` | Push `due_at` out + clear app-owned promotion (`{id, days?, reason?}`); logs a receipt |
| `submit_draft_for_approval` | Chat-lane item that needs a client-facing step: save the draft + set `approval_needed` (never sends) |
| `record_agent_run` / `record_receipt` | Open/close a run; append proof-of-work |
| `create_skill_proposal` | Propose a skill → lands `proposed`, out of the library until Joe approves in `/engine` |
| `record_skill_used` | Log that an agent followed a skill |

All tools are parameterized SQL. **No raw-SQL tool** is exposed. Before working a
non-trivial work item, an agent should `get_work_item` → `suggest_skill_for_work_item`
→ `get_skill`, then `record_skill_used` + `record_receipt` as it goes.

## Newsletter tools (email list + issues)

The client newsletter is drivable from any MCP client. **Reads** are direct
SELECTs; **writes** go through the app's bearer-gated internal route
(`/api/internal/newsletter`, authed with `CRON_SECRET`, audited to `agent_runs`).

| Tool | Effect |
|---|---|
| `list_newsletter_recipients` | The email list (id, email, name, active) |
| `list_newsletter_issues` | Issues with status / recipient_count / block_count |
| `get_newsletter_issue` | One issue's full content (`id`) |
| `list_newsletter_outbox` | Parked/sent rows — `queued` ones await Release |
| `list_newsletter_sequences` | Drip sequences: active flag, subscribers, steps |
| `add_newsletter_recipient` | Add/reactivate an email (`email`,`name?`); parks a welcome greeting + enrolls in any **armed** drip |
| `update_newsletter_recipient` | Change name / active flag (`id` or `email`) |
| `remove_newsletter_recipient` | Delete from the list (`id` or `email`) |
| `import_client_newsletter_recipients` | Add every active client user's email |
| `create_newsletter_issue` | New draft from a template (`template_key?`) |
| `update_newsletter_issue` | Edit a **draft**'s `title`/`intro`/`blocks` |
| `queue_newsletter_issue` | Park a copy per recipient in the outbox (`id`) |

> **The send line — do not cross it.** These tools stop one click short of a real
> inbox. `queue_newsletter_issue` PARKS the send; the owner Releases each outbox
> row in `/newsletter` for anything to actually mail. `add_newsletter_recipient`
> enrolls a contact in whatever welcome drip the owner has **already armed** — that
> drip is the one pre-existing path that then sends on its own (guarded in
> `lib/newsletter-drip.ts`); **arming a sequence is a human action in the app and
> is deliberately NOT an MCP tool.** There is no `release`/`arm`/`send` tool, and
> none should be added without the owner explicitly moving that line.

**Typical agent flow:** `create_newsletter_issue` → `update_newsletter_issue`
(title/intro/blocks, optionally from `list_projects` recent jobs) →
`queue_newsletter_issue` → tell the owner to Release in `/newsletter`. To grow the
list: `add_newsletter_recipient` (or `import_client_newsletter_recipients`), which
also kicks off the welcome sequence for each new address if one is armed.

## Register with a client

**Claude Code (CLI):**
```
claude mcp add sjcos -- node /home/joe/sjcos-app/mcp/sjcos-mcp.mjs
```

**Generic client config (e.g. Claude Desktop `claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "sjcos": {
      "command": "node",
      "args": ["/home/joe/sjcos-app/mcp/sjcos-mcp.mjs"]
    }
  }
}
```

The client spawns the server with a clean env; the server falls back to reading
`DATABASE_URL` from `.env.local`, so no extra env wiring is needed when run from
the project on this box.

## Per-client connection

- **Claude Code (server):** `claude mcp add sjcos -- node /home/joe/sjcos-app/mcp/sjcos-mcp.mjs`.
  Runs locally on the box — full read + gated-write access.
- **Claude Desktop / cowork (local Mac/PC):** add the JSON above to
  `claude_desktop_config.json`. Works only if the desktop machine can see
  `/home/joe/sjcos-app` and reach Postgres. It **cannot** by default (Postgres is
  bound to localhost on the server — do not expose it to the LAN/internet). Use it
  on the server, or stand up a small authenticated HTTP/MCP bridge later. Good for
  read/search/ask: "what's due today?", "what do we know about Dan's selections?".
- **Codex:** point its MCP/tool config at the same command. Use Codex for review/
  tests/SQL-safety, not as a long-running operator.
- **Hermes (Telegram):** does not speak MCP directly yet. Near-term it keeps using
  the temp CSV; once wired, it should call `list_work_items` / `update_work_item_status`
  / `capture_knowledge` / `record_receipt` and drive the daily one-item-at-a-time
  review from `work_items` instead of the CSV.

> **Placeholders, not secrets.** The config above contains no credentials — the
> server reads `DATABASE_URL` from `.env.local` itself. Never put the DB password
> in a client config or commit it.

## Safety model

- Read tools are parameterized SELECTs; no raw SQL.
- Write tools only touch internal records / append-only audit / proposals. They
  never send email, SMS, invoices, or contracts — those stay owner-approved in the
  app.
- Agent-proposed skills land `proposed` and are invisible to the library until Joe
  approves them at `/engine`.
- Agent-written knowledge/memories are evidence by default and never act as
  standing instructions until confirmed (see the plan §5.2).

## Smoke test

```
# from sjcos-app/, a quick stdio round-trip:
node -e '
import("@modelcontextprotocol/sdk/client/index.js").then(async ({Client})=>{
  const {StdioClientTransport}=await import("@modelcontextprotocol/sdk/client/stdio.js");
  const c=new Client({name:"t",version:"1.0.0"});
  await c.connect(new StdioClientTransport({command:"node",args:["mcp/sjcos-mcp.mjs"]}));
  console.log((await c.listTools()).tools.map(t=>t.name));
  await c.close();
});'
```

Call the Today-queue tools directly:

```
# from sjcos-app/, get the Today rail with lanes:
node -e '
import("@modelcontextprotocol/sdk/client/index.js").then(async ({Client})=>{
  const {StdioClientTransport}=await import("@modelcontextprotocol/sdk/client/stdio.js");
  const c=new Client({name:"t",version:"1.0.0"});
  await c.connect(new StdioClientTransport({command:"node",args:["mcp/sjcos-mcp.mjs"]}));
  const r=await c.callTool({name:"get_today_queue",arguments:{}});
  console.log(r.content[0].text);
  // snooze on a done/nonexistent id → { ok:false }:
  const s=await c.callTool({name:"snooze_work_item",arguments:{id:"00000000-0000-0000-0000-000000000000",days:2}});
  console.log(s.content[0].text);
  await c.close();
});'
```
