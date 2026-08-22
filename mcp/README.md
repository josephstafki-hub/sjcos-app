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
| `list_vendors` | Materials suppliers (favorites first) — distinct from subs (labor) |
| `list_purchase_orders` / `get_purchase_order` | A project's POs (optional `status`) / one PO + its lines (`id`) |
| `list_compliance` | Unresolved compliance items due within N days |
| `list_signature_requests` | E-sign requests (optional `project_slug`,`status`) |
| `search_knowledge` | Full-text + fuzzy search of the knowledge base (`query`, optional `project_slug`/`lead_slug`/`kind`/`limit`) |
| `fetch_knowledge` / `list_recent_knowledge` | One item by `id` / recent items (`days`,`kind`,…) |
| `list_work_items` / `get_work_item` | The work queue (optional `status`,`assignee_key`,`due_before`,`needs_enrichment` — detector items awaiting an agent brief) / one item + its runs & receipts |
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
| `enrich_work_item` | Rewrite a **detector-filed** item's factual body into a readable brief (original kept under `--- source facts ---`); refuses non-detector items; never touches status/priority/assignee/due/approvals |
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
| `list_newsletter_groups` | Audiences (email groups) with live member counts — pass ids to `queue_newsletter_issue` |
| `set_newsletter_welcome_issue` | Mark/unmark an issue as THE welcome email (`id`, `on?`); displaces any prior one |
| `add_newsletter_recipient` | Add/reactivate an email (`email`,`name?`); parks a welcome greeting + enrolls in any **armed** drip |
| `update_newsletter_recipient` | Change name / active flag (`id` or `email`) |
| `remove_newsletter_recipient` | Delete from the list (`id` or `email`) |
| `import_client_newsletter_recipients` | Add every active client user's email |
| `create_newsletter_issue` | New draft from a template (`template_key?`) |
| `update_newsletter_issue` | Edit a **draft**'s `title`/`intro`/`blocks` — this is also how you write the welcome email's content |
| `queue_newsletter_issue` | Park a copy in the outbox (`id`, `group_ids?` to scope to audiences, deduped) |

The welcome email is not a separate template — it's just a normal issue with
`is_welcome=true` (`set_newsletter_welcome_issue`), edited with
`update_newsletter_issue` like any other draft. `{name}` in its title, intro, or
any block is filled with the recipient's name when it's parked for them.

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
`queue_newsletter_issue` (optionally with `group_ids` to target an audience) →
tell the owner to Release in `/newsletter`. To grow the list:
`add_newsletter_recipient` (or `import_client_newsletter_recipients`), which
also kicks off the welcome sequence for each new address if one is armed.

## Purchase order tools (per-project procurement)

Purchase orders are drivable from any MCP client, same split as the newsletter.
**Reads** (`list_purchase_orders`, `get_purchase_order`, `list_vendors`, above)
are direct SELECTs; **writes** go through the app's bearer-gated internal route
(`/api/internal/purchase-orders`, authed with `CRON_SECRET`, audited to
`agent_runs`).

| Tool | Effect |
|---|---|
| `create_purchase_order` | Draft a PO on a project. `vendor_kind` is `vendor` (+ `vendor_id` from `list_vendors`), `sub` (+ `sub_slug`, must be assigned to the project), or `one_off` (+ `vendor_name`/`email`/`phone`, not saved) |
| `update_purchase_order` | Edit a draft/queued PO's `title`/`notes` (locked once sent) |
| `add_purchase_order_line` | Add a line (`po_id`, `description`, `qty_ordered`, `unit_cost`, `unit?`) |
| `update_purchase_order_line` | Edit one line's fields (`id`, rest optional) |
| `delete_purchase_order_line` | Remove a line (`id`) |
| `queue_purchase_order` | Draft → queued: flag it ready for Joe's review (`id`) |

> **The send line.** `queue_purchase_order` only flags a PO ready for review.
> Emailing it needs an owner grant: `send_purchase_order` with an
> `owner_grant_id` (see **Owner grants** below). Receiving/closing out/void
> stay owner-only in the app — no tool, do not add one.

**Typical agent flow:** `create_purchase_order` → `add_purchase_order_line`
(repeat per item) → `queue_purchase_order` → tell the owner it's ready to send.

## Mood board tools (per-project, per-room inspiration)

Mood boards are fully drivable from any MCP client — an agent can stand up a
project's room programme, pin inspiration it sourced from the web, add the
palette and the design direction, and compose the result. Lives in its own
module, `mcp/mood-tools.mjs`, registered from `buildServer()`.

| Tool | Effect |
|---|---|
| `list_mood_boards` | Every board on a project with its items, kinds and positions |
| `create_mood_board` | Create an empty board for a room (idempotent) |
| `set_mood_board_settings` | Board display `title` and/or `background_color` |
| `add_mood_image_from_url` | Download a public image and pin it; records the source URL |
| `add_mood_swatch` | Add a `#rrggbb` colour chip, optionally named |
| `add_mood_text` | Add a standalone direction note |
| `update_mood_item` | Edit an item's caption, note, or (swatch) colour |
| `arrange_mood_board` | Compose a board — hero + masonry + palette band |

**`arrange_mood_board` is not optional polish.** Items with no coordinates fall
into the canvas's uniform auto grid, which reads as a contact sheet rather than
a mood board. This lays a board out the way designers actually compose one: a
dominant hero anchoring the top-left, supporting images masonry-packed at varied
scale with slight rotation, and colour swatches clustered as a palette strip in
a bottom band beside the direction text. Items are sized by visual **area** from
each photo's true aspect ratio, so a portrait and a landscape shot carry equal
weight. It is seeded per room, so re-running reproduces the same board instead
of reshuffling one the owner has already dragged into place.

> **Look before you pin.** `add_mood_image_from_url` fetches an agent-chosen URL
> server-side, so it treats that URL as hostile: http(s) only, every resolved
> address must be public (loopback, link-local, RFC1918 and CGNAT are refused,
> which covers the cloud metadata endpoint), the content-type must be `image/*`,
> and there is a 12 MB cap. None of that judges whether the picture is any
> *good* — only an agent that has actually viewed the image can. Pinning
> unverified images to a board a client will see is worse than an empty board.
> Sourced images are tagged `MOOD · SOURCED` (vs `MOOD` for the client's own
> pins) so the owner can always tell the two apart.

> **No deletes.** Consistent with the safety model below, there is no tool to
> remove a pin or a board. Mood items are cheap to re-add and expensive to lose,
> so removal stays an owner action in the app.

**Typical agent flow:** `create_mood_board` per room → `add_mood_image_from_url`
(only for images you have looked at) + `add_mood_swatch` + `add_mood_text` →
`arrange_mood_board` → tell the owner it's ready to review.

## Bidding tools (per-project bid packages → email)

Bids are **email**: the owner's Send button emails the packet (scope, per-sub
note, files attached) straight to each sub via the app's Gmail connector, subs
reply to Joe's inbox, and Joe records the numbers on the board. Nothing
bid-related touches the sub portal. Agents can stage everything short of
sending — create the package, build the packet, pick recipients, tailor notes —
and can read/compare/award. Lives in its own module, `mcp/bidding-tools.mjs`.
Reads and internal-record writes are direct SQL; `award_bid` goes through the
app's bearer-gated internal route (`/api/internal/bidding`, authed with
`CRON_SECRET`, audited to `agent_runs`) so it runs the exact code the owner's
button runs.

| Tool | Effect |
|---|---|
| `list_bid_packages` | Packages by project/trade/status with invite + bid counts and the low number |
| `get_bid_package` | One package in full: packet files, invites (per-sub notes, statuses), latest submissions |
| `compare_bids` | Submitted bids low → high with deltas, line items, exclusions, lead times, docs |
| `list_project_files` | The project's uploaded files — the pool `attach_bid_file` draws from |
| `create_bid_package` | Start a DRAFT bid request for a category of work |
| `update_bid_package` | Edit title / trade / scope notes / due date |
| `attach_bid_file` | Put a project file in the packet, with the label the sub sees |
| `remove_bid_file` | Pull a packet file — DRAFT packages only (sent packets are locked) |
| `add_bid_invites` | Invite subs by slug (group by trade via `list_subs`); DRAFT until send |
| `set_bid_invite_message` | The per-sub note that customizes the packet for one recipient |
| `remove_bid_invite` | Take a sub off — unsent invites only |
| `close_bid_package` | End bidding without awarding |
| `award_bid` | Pick the winner; everyone else goes `not_awarded`; package closes |

> **Where the send line sits for this family.** Sending a bid package
> transmits real email to real subs (packet attached), so it needs an owner
> grant: `send_bid_package` with an `owner_grant_id` (see **Owner grants**
> below). The bidding route itself still refuses an un-granted send.

**Typical agent flow:** `create_bid_package` → `list_project_files` +
`attach_bid_file` (plans, takeoff) → `list_subs`, pick by trade →
`add_bid_invites` → `set_bid_invite_message` where a sub needs tailoring →
tell Joe it's staged so he can press Send → as he records bids, `compare_bids`
→ brief the owner (or, when asked, `award_bid`).

## Owner grants (express permission to send)

Agents draft and stage on their own. Anything that reaches a real inbox needs
an **owner grant** — Joe's express permission for one action on one target
(`lib/owner-grants.ts`, `mcp/grants-tools.mjs`, `/engine/permissions`).

| Tool | Effect |
|---|---|
| `request_owner_permission` | Ask: `action` + `target_id` + a specific `reason` → a Decision notification Joe approves/denies on `/engine/permissions`. Returns the grant id |
| `check_owner_permission` | Poll a grant: requested / approved (live) / denied / revoked / spent, with its audit trail |
| `list_owner_permissions` | Grants pending or currently usable |
| `send_bid_package` | Email the packet to every unsent sub (`package_id`, `owner_grant_id`) |
| `send_purchase_order` | Email a draft/queued PO to its vendor (`po_id`, `owner_grant_id`) |
| `send_invoice` | Email a draft invoice to the client (`invoice_id`, `owner_grant_id`) |
| `release_newsletter_issue` | Release every queued outbox row of an issue (`issue_id`, `owner_grant_id`) |
| `release_newsletter_outbox_item` | Release one outbox row (`outbox_id`, `owner_grant_id`) |
| `send_document_for_signature` | Submit a rendered draft for signature (`draft_id`, `owner_grant_id`, `override?`) |
| `send_email` | One-off plain-text email from the business Gmail (`to`, `subject`, `body`, `owner_grant_id`); a grant may be pinned to one recipient |

How a grant comes to exist: Joe ticks **Express permission (sends)** on an Ask-window
message (a 20-minute, run-scoped grant Claude is told about in its prompt); Joe mints
one by hand on `/engine/permissions` (any action, optional target / recipient, uses,
expiry) and pastes the id to the agent; or an agent's `request_owner_permission` is
approved there. The app spends the grant **atomically for the exact action + target
before anything transmits** (`lib/agent-sends.ts`) and writes the outcome to the
grant's audit + `agent_runs`. A grant that doesn't cover the call is refused with a
reason the agent can relay. Arming a newsletter drip sequence and PO receiving/close
remain owner-only with no tool.

## `search` / `fetch` (ChatGPT connector contract)

ChatGPT custom connectors (Settings → Connectors → Create, and the Responses
API's `mcp` tool in connector mode) refuse any server that doesn't expose two
tools named exactly `search` and `fetch` with OpenAI's result shape — the
connector shows as unreachable / non-compliant even when the transport is fine.
Both live in `mcp/chatgpt-tools.mjs`, are **read-only**, and are unified views
over the same curated queries as the tools above (no new data access).

| Tool | Effect |
|---|---|
| `search` | `{query}` → `{results:[{id,title,url,text}]}` across knowledge, projects, leads, subs, vendors and the open work queue. Ids are namespaced: `project:<slug>`, `lead:<slug>`, `sub:<slug>`, `vendor:<slug>`, `knowledge:<uuid>`, `work_item:<uuid>` |
| `fetch` | `{id}` → `{id,title,text,url,metadata}` — the full record behind a search hit (a project also carries invoices, subs, money and recent knowledge) |

Other clients can ignore them; the specific `list_*`/`get_*` tools are still
the better fit for structured, filtered questions.

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
  on the server, or connect over the authenticated **HTTP transport** (see below).
  Good for read/search/ask: "what's due today?", "what do we know about Dan's selections?".
- **Codex:** point its MCP/tool config at the same command. Use Codex for review/
  tests/SQL-safety, not as a long-running operator.
- **Hermes (Telegram):** does not speak MCP directly yet. Near-term it keeps using
  the temp CSV; once wired, it should call `list_work_items` / `update_work_item_status`
  / `capture_knowledge` / `record_receipt` and drive the daily one-item-at-a-time
  review from `work_items` instead of the CSV.

> **Placeholders, not secrets.** The config above contains no credentials — the
> server reads `DATABASE_URL` from `.env.local` itself. Never put the DB password
> in a client config or commit it.

## HTTP transport (remote / off-box agents)

By default the server runs over **stdio** — an MCP client spawns it locally and
nothing is exposed on the network. To let an agent on another machine connect,
run it instead as a long-lived **Streamable HTTP** service, gated by a bearer
token. Same 58 tools, same curated/no-raw-SQL/send-gated safety model — the token
only controls *who can reach* them.

Set two env vars and start the process:

| Env var | Meaning |
| --- | --- |
| `MCP_HTTP_PORT` | Port to listen on. **Its presence switches the server into HTTP mode.** Unset → stdio (the default). Read from `process.env` ONLY — never put it in `.env.local`, or every stdio spawn (the `claude mcp` registration) reads it too, tries to bind the port the systemd service already holds, and dies with EADDRINUSE. Set it in the systemd unit's `Environment=` line. |
| `MCP_HTTP_TOKEN` | Bearer token required on every `/mcp` request. **Must be set** in HTTP mode — the server refuses to start without it (fail closed). Use a distinct secret, **not** `CRON_SECRET`. |
| `MCP_HTTP_HOST` | Bind address. Defaults to `127.0.0.1` (loopback — put nginx in front for TLS). |

```
MCP_HTTP_PORT=3018 MCP_HTTP_TOKEN='<long-random-secret>' node /home/joe/sjcos-app/mcp/sjcos-mcp.mjs
```

Endpoints (all under `/mcp`, except the probe):
- `POST /mcp` — JSON-RPC; an `initialize` request opens a session and returns an
  `mcp-session-id` header the client echoes on subsequent calls.
- `GET /mcp` — server→client SSE stream for an existing session.
- `DELETE /mcp` — terminate a session.
- `GET /healthz` — unauthenticated liveness probe (for nginx/systemd), returns `ok`.

**Connect a client** (Claude Code):
```
claude mcp add --transport http sjcos https://os.sjcarpentryllc.com/mcp \
  --header "Authorization: Bearer <MCP_HTTP_TOKEN>"
```

**Making it reachable / persistent (as deployed on this box):**
1. Add `MCP_HTTP_TOKEN` to `.env.local` (the token may live there — both modes
   want it; the PORT must not — see the table above).
2. The user systemd unit `sjcos-mcp.service` sets `Environment=MCP_HTTP_PORT=3018`
   and runs `ExecStart=/usr/bin/node %h/sjcos-app/mcp/sjcos-mcp.mjs`;
   `systemctl --user enable --now sjcos-mcp.service`.
3. nginx exposes it over `os.sjcarpentryllc.com` — see the two locations in
   `deploy/mcp-nginx-location.conf` (also folded into `deploy/nginx-sjcos.conf`):
   `location /mcp` forwards the client's own bearer header (Claude Code remote),
   and a secret-path `location = /mcp-connect-<random>` injects the bearer
   server-side for clients that can't send one (the claude.ai custom-connector
   dialog only speaks OAuth-or-nothing). For the secret path, the unguessable
   URL *is* the credential — rotate it and `MCP_HTTP_TOKEN` together.

> Only the bearer token stands between a caller and the gated-write tools. Use a
> long random secret, rotate it if leaked, and never commit it.

**Connecting claude.ai / ChatGPT (no-auth connectors):** paste the secret path
`https://os.sjcarpentryllc.com/mcp-connect-<random>` as the server URL and pick
"No authentication". Two server-side details make that work and are easy to
regress:

- **OAuth-discovery probes must 404.** Both clients GET
  `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
  and `/.well-known/openid-configuration` first; the app's auth middleware would
  307 those to `/login`, which the connector reads as "this is an OAuth server"
  and then fails dynamic client registration. nginx 404s them
  (`deploy/nginx-sjcos.conf`) and `proxy.ts` 404s them as a backstop — verify
  with `curl -sI https://os.sjcarpentryllc.com/.well-known/oauth-protected-resource`
  (want `404`, not `307`).
- **Sessions are in-memory.** A restart forgets every `mcp-session-id`; the
  server answers those with **404** (per spec) so clients re-`initialize`
  transparently. A 400 there — the old behaviour — left connectors erroring
  after each deploy until they were removed and re-added.
- ChatGPT additionally needs `search` + `fetch` (previous section).

## Safety model

- Read tools are parameterized SELECTs; no raw SQL.
- Write tools only touch internal records / append-only audit / proposals.
- Sends (email, bid packages, POs, invoices, documents, newsletter release) happen
  only through the owner-grant tools, each spending a grant Joe created or approved
  for that exact target — see **Owner grants** above.
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
