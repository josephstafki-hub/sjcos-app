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
| `get_today_queue` | What Joe sees on `/today`: promoted priorities + backlog, each with its **lane** (start here for "work my queue") |
| `list_work_items` | The day's queue (filter by `status`, `assignee_key`, `due_before`) |
| `snooze_work_item` | Push an item out + drop it back to Waiting on me (only when Joe asks / it can't proceed) |
| `submit_draft_for_approval` | Chat-lane item needs a client-facing step — save a draft + set `approval_needed` (never sends) |
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

## How work_items surface on Joe's Today page

`/today` shows two things pulled from the same backlog Hermes maintains:

- **Priorities** — a 5-slot rail. This is what Joe actually looks at first.
- **Waiting on me** — the rest of the open backlog, in full.

A work item only surfaces on Today at all once it's assigned to Joe with a
lead/project to anchor it: `assignee_kind = 'human'`,
`assignee_key IS NULL OR assignee_key = 'human-joe'`, and either `lead_id` or
`project_id` set. Items assigned to an agent (`assignee_kind = 'agent'`, e.g.
`hermes-telegram` or `claude-code-server`) or with no lead/project never show
on Today — they're Hermes's own working set, not Joe's.

Which 5 items land in Priorities (vs. sitting in Waiting on me) is tracked by
`work_items.promoted_at` — set the first time an item is pulled into a slot,
either automatically (the app tops up empty slots from the top of the ranked
backlog on each page load) or when the owner clicks a finished card on Today
and the app promotes the next one in to fill the gap.

**This is app/owner-driven UI state — Hermes never sets `promoted_at`.** No
MCP tool exposes it, and none should. Hermes's only lever here is
`update_work_item_status`: mark an item `done` (or `cancelled`) when it's
actually finished, same as always. The moment that happens, the next backlog
item gets promoted into Joe's Priorities automatically — either right away
(if Joe's looking at Today when it happens) or on his next page load. Nothing
else for Hermes to do.

## Today queue: lanes + how to work an item

`get_today_queue` returns exactly what Joe sees on `/today` — the promoted
priorities (`promoted: true`) plus the waiting backlog — with each item's
**lane**:

- `chat` — an agent can complete it end-to-end with internal MCP writes.
- `quick` — one click for Joe; no page work.
- `deep` — real page work (money / documents / client-facing); Joe does it.

`promoted` is informational only — promotion is app-owned, so never try to set it.

To finish a Today item:

1. `get_work_item(id)` for full context.
2. Do the work with internal tools only.
3. `update_work_item_status(id, 'done', note)` with a short note.
4. `record_agent_run(...)` + `record_receipt(work_item_id, ...)` so Joe sees proof.

The app's feed refreshes and checks the card off — that's the loop closing.

- **Never attempt a client-facing send.** If a chat-lane item turns out to need
  one, call `submit_draft_for_approval(work_item_id, draft)` — it sets the item
  to `approval_needed` and saves the draft; Joe reviews and sends from the app.
- `snooze_work_item(id, days?, reason?)` only when Joe asks or the item literally
  can't proceed yet — always state the reason.

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
