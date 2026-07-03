# Hermes ↔ SJC OS over MCP

Hermes (the Telegram operator) should eventually stop reading the temp CRM CSV /
files directly and instead go through the SJC OS **MCP server** (`mcp/sjcos-mcp.mjs`).
That makes SJC OS Postgres the single source of truth: Hermes reads the same work
queue and knowledge base the app shows Joe, and writes back through the same
gated, audited tools.

> **Legacy note:** `/home/joe/SJC OS Temp` is now import/reference only. It is not
> deleted, but it is no longer the operational source. New work lives in SJC OS.

## Tools Hermes needs (all already implemented)

| Tool | Hermes use |
|---|---|
| `business_snapshot` | Morning briefing — counts by stage/status, **work items awaiting approval**, A/R, compliance due |
| `list_work_items` | The day's queue (filter by `status`, `assignee_key`, `due_before`) |
| `get_work_item` | Full context for the one item under review (incl. its runs & receipts) |
| `update_work_item_status` | Move an item forward (`in_progress`, `waiting_on_*`, `done`, …) |
| `search_knowledge` | "What do we know about <client/job>?" before acting |
| `capture_knowledge` | Save a durable fact/decision surfaced in a Telegram thread |
| `list_skills` / `get_skill` | Load the operating procedure for a task before doing it |
| `record_receipt` | Log proof of work (message sent id, file path, row changed) |

These are curated + parameterized. There is **no raw-SQL tool**, and no
client-facing send (email/SMS/invoice/contract) is exposed — those stay
owner-approved in the app.

## Daily one-item-at-a-time review loop

```
business_snapshot                      # what needs attention today
list_work_items(due_before=tomorrow)   # today's queue, most urgent first
  → get_work_item(id)                  # full context for ONE item
  → suggest_skill_for_work_item(id)    # the procedure to follow, if any
  → get_skill(slug)                    # load it
  → (do the work — surface drafts to Joe for approval; never auto-send)
  → update_work_item_status(id, ...)   # advance it
  → record_receipt(work_item_id, ...)  # proof of what happened
```

Items with `requires_approval = true` (e.g. everything imported from the temp
CRM) must be surfaced to Joe — Hermes proposes, Joe approves in `/engine` or the
detail page's **Ops** tab.

## Register the server with Hermes (placeholders only)

Hermes runs on the same box, so it spawns the MCP server over **stdio**. No
credentials go in the config — the server reads `DATABASE_URL` from
`../.env.local` itself.

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

If Hermes uses a CLI-style registration instead:

```
# from Hermes' MCP config — same command, no secrets
node /home/joe/sjcos-app/mcp/sjcos-mcp.mjs
```

## Safety (do not violate)

- **Postgres stays localhost.** It is bound to 127.0.0.1 on the server. Do **not**
  expose it to the LAN or internet. Hermes connects only because it runs on the
  same host and spawns the MCP process locally.
- **No secrets in configs or docs.** The connection string lives in `.env.local`
  and is read at runtime; it is never printed, logged, or committed.
- **No destructive or client-facing tools** are exposed over MCP. Hermes can move
  internal work and capture knowledge, but sending anything to a client and any
  financial action remain owner-approved in the app.
- If Hermes ever needs to run off-box, stand up an authenticated HTTP/MCP bridge
  in front of the server — never open Postgres directly.

See `mcp/README.md` for the full tool catalog and the stdio smoke test.
