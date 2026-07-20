# Today Page v2 — Interactive AI Feed (design + build plan)

**Status:** built · Phases 1–8 complete (Phase 7 stretch done 2026-07-20) — 2026-07-10
**Written:** 2026-07-10
**Audience:** any agent/model executing this incrementally. Each phase is
independently shippable, has exact file paths, contracts, and acceptance
checks. Do the phases IN ORDER. Don't invent extra scope.

---

## 1. Goal

Rebuild `/today` so the AI (Claude / Qwen / Hermes — the existing three chat
agents) *presents and works* the day's to-dos instead of just listing them:

- **Quick to-dos** → completed inline (one click, or "have the AI do it")
  right in the chat/feed, without leaving the page.
- **AI-completable to-dos** → handed to Hermes (the only agent with SJC OS
  MCP tools) which does the work, marks the item done, and the rail updates
  live.
- **Larger tasks** → presented with a deep link to the page where the real
  work happens (lead detail, project detail, warranty, compliance), plus an
  optional "prep me" chat action that gathers context first.

Core principle that keeps this buildable by smaller models: **the app, not
the model, renders the interactive affordances.** Action buttons ("chips")
are deterministic React elements keyed to a `work_item_id`, verified
server-side on click. The model's job is narrative + actually executing
chat-lane work via MCP. We never parse free-form model text to decide what
buttons exist (a model-emitted action block is a stretch goal, Phase 7).

---

## 2. Current state (what already exists — reuse, don't rebuild)

| Piece | File | Notes |
|---|---|---|
| Today data builder | `lib/today.ts` | `getTodayData()`; `OPEN_WORK_ITEMS_SQL` + `OPEN_WORK_ITEMS_ORDER_SQL` define "Joe's open backlog"; 5-slot Priorities rail promoted via `work_items.promoted_at`; Waiting-on-me = the rest |
| Today page | `app/today/page.tsx` → `components/today/TodayBody.tsx` | server component; AI brief streams in a Suspense boundary |
| Priorities rail | `components/today/TodayPriorities.tsx` + `TodayQueueContext.tsx` | click-to-check-and-swap already works (`checkPriorityCompletion` in `lib/actions/today.ts`) |
| Chat (full page) | `components/ai/AssistantChat.tsx` (`/ai`) | 3 agents, persisted `ai_conversations`/`ai_messages`, background runs in `dev_agent_runs`, client polls `pollAgentRun` |
| Chat (embedded) | `components/cmdk/CommandBar.tsx` | embedded on /today today; same persistence + polling |
| Send path | `lib/actions/ai-chat.ts#sendMessageAction` | Qwen/Hermes run in-process in background; Claude via detached runner |
| Agents | `lib/dev-agents.ts`, `lib/dev-agents-meta.ts` | Hermes = real agent w/ MCP tools (gateway :8642); Qwen = local Ollama, text-only, no tools; Claude = code agent |
| MCP server | `mcp/sjcos-mcp.mjs` | curated read tools + gated writes (`update_work_item_status`, `record_agent_run`, `record_receipt`, …). `promoted_at` is deliberately NOT writable over MCP |
| MCP etiquette | `docs/hermes-mcp.md`, `AGENTS.md`, `mcp/README.md` | must be updated in Phase 6 |

Key invariants to preserve:
- `promoted_at` stays app-owned. No MCP write to it, ever.
- No client-facing sends (email/SMS/invoice/contract) from MCP or from chat
  chips. Drafts only; Joe sends from the app.
- All chat mutations behind `requireRole("owner")`.
- The 5-slot Priorities rail + Waiting-on-me backlog semantics stay identical
  (same SQL, same promote-on-demand behavior).

---

## 3. UX design

### 3.1 Layout (desktop, `/today`)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Good morning, Joe.                        WEEK LABEL · [A/R chip][leads]  │
├──────────────────────────────────────────────┬────────────────────────────┤
│  TODAY FEED (the interactive centerpiece)    │  RIGHT RAIL (unchanged-ish)│
│ ┌──────────────────────────────────────────┐ │  This week   [week strip]  │
│ │ [Claude][Qwen][Hermes]      agent picker │ │                            │
│ ├──────────────────────────────────────────┤ │  Today's schedule          │
│ │ ✦ Triage brief (assistant bubble)        │ │   8:00 · Ramsey site …     │
│ │   "3 things move the week. #1 and #4 I   │ │                            │
│ │    can handle — say go. #2 needs you     │ │  Waiting on me (7)         │
│ │    on the Hendricks estimate."           │ │   · Lead — … (existing     │
│ ├──────────────────────────────────────────┤ │     WaitingList behavior)  │
│ │ #1 ▪ LEAD TODO  · chat lane              │ │                            │
│ │   Follow up with Hendricks on tile pick  │ └────────────────────────────┘
│ │   due Jul 12 · Hendricks Kitchen         │
│ │   [✦ Have Hermes do it] [✓ Done] [Open ↗]│
│ ├──────────────────────────────────────────┤
│ │ #2 ▪ JOB · deep lane                     │
│ │   Build draw 3 invoice — Ramsey Bath     │
│ │   [Open project ↗] [✦ Prep me] [Snooze]  │
│ ├──────────────────────────────────────────┤
│ │ … #3–#5 …                                │
│ ├──────────────────────────────────────────┤
│ │ (chat messages appear here, in-stream,   │
│ │  when Joe asks something or a card is    │
│ │  handed to an agent — with live activity │
│ │  lines while Hermes works)               │
│ ├──────────────────────────────────────────┤
│ │ ✦ Ask about today…              [↑ send] │
│ └──────────────────────────────────────────┘
└───────────────────────────────────────────────────────────────────────────┘
```

- The **feed** replaces both the old `CommandBar embedded` block and the
  `TodayPriorities` list: priority cards live INSIDE the scrollable feed,
  interleaved with chat messages. Cards are React components (never model
  output).
- The **AI brief** bubble (existing `getTodayBrief`) becomes the feed's
  pinned first item ("triage brief", upgraded in Phase 5 to mention lanes).
- Right rail keeps `WeekStrip`, schedule card, and `WaitingList` exactly as
  they are (they already share state via `TodayQueueContext`).
- Mobile: feed stacks above the rail (same `grid-cols-1 lg:grid-cols-…`
  pattern already in `TodayBody`).

### 3.2 Lanes

Every Priorities/Waiting candidate gets a **lane**:

| Lane | Meaning | Card chips |
|---|---|---|
| `chat` | An agent can complete it end-to-end with internal MCP writes (notes, status, drafts, look-ups) | `✦ Have Hermes do it` · `✓ Mark done` · `Open ↗` |
| `quick` | One human click closes it; no page work needed | `✓ Mark done` · `Snooze 3d` · `Open ↗` |
| `deep` | Real page work (money, documents, selections, client-facing) | `Open <page> ↗` (primary) · `✦ Prep me` · `Snooze 3d` |

Non-work-item signal cards (warranty claims, compliance, flagged leads,
schedule, job momentum — the `checkable: false` candidates in
`lib/today.ts`) are **always `deep`**: they have their own pages and no
work_item row to close. Their only chips are `Open ↗` and `✦ Prep me`.

### 3.3 Chip behaviors (all deterministic server actions)

- **✓ Mark done** → server action marks the work_item `done` (with
  `completed_at`), then returns a fresh queue; the card swaps out and the
  next backlog item promotes in (reuses the existing promote logic).
- **Snooze 3d** → pushes `due_at` 3 days out and demotes it
  (`promoted_at = NULL`) so it drops back to Waiting-on-me; next item
  promotes in.
- **Open ↗** → plain `next/link` to the card's existing `href`.
- **✦ Have Hermes do it** → sends a structured directive (§5.4) into the
  feed's Hermes conversation. Hermes uses its MCP tools, updates the item,
  records run + receipt. When the turn resolves, the client refreshes the
  queue — if Hermes marked it done, the card checks off and swaps.
- **✦ Prep me** → sends a "prep" directive: the agent gathers context
  (project money, last activity, related knowledge) and replies with a
  short "here's what to do when you open the page" note + the deep link.
  Works with Qwen (gets a server-built context brief inline) or Hermes
  (pulls live via MCP).

### 3.4 Agent roles on this page

- **Hermes** — the operator. Default agent for the feed. Only agent that can
  actually complete `chat`-lane items (it has the sjcos MCP server).
- **Qwen** — the narrator. Cheap/local; answers questions and does "prep me"
  from the server-provided context brief. If Joe clicks "Have Hermes do it"
  while Qwen is selected, the directive still goes to a **Hermes**
  conversation (the chip names the agent, not the picker).
- **Claude** — the builder. Unchanged behavior: selecting Claude and sending
  hands off to `/ai?c=…` like the CommandBar does today. No Today-specific
  work runs through Claude.

---

## 4. Data changes (Phase 1)

Append to `db/schema.sql` (idempotent style, matching the file's existing
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` pattern) and run it against the DB:

```sql
-- Today v2: triage lane override. NULL = classify by rules at read time
-- (lib/today-triage.ts). Set by the owner (UI) or by an agent proposal the
-- owner accepted — rules are the default, this column is the exception.
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS effort_class text
  CHECK (effort_class IN ('chat','quick','deep'));

-- Today v2: when a chat turn is ABOUT one work item (a card handed to an
-- agent), stamp it so the thread renders the card's chips under the reply
-- and the client knows which item to re-check after the turn lands.
ALTER TABLE ai_messages    ADD COLUMN IF NOT EXISTS subject_work_item_id uuid
  REFERENCES work_items(id) ON DELETE SET NULL;
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS subject_work_item_id uuid
  REFERENCES work_items(id) ON DELETE SET NULL;
```

No other tables change. `promoted_at` semantics untouched.

---

## 5. Build phases

### Phase 1 — Triage classifier + schema (no UI change)

**New file `lib/today-triage.ts`** (pure, no DB):

```ts
export type Lane = "chat" | "quick" | "deep";

/** Keyword rules, checked in order against `${title} ${body}` (lowercased).
 *  First hit wins; default is "quick". An explicit work_items.effort_class
 *  overrides everything. */
const DEEP_RE  = /\b(estimate|invoice|draw|bill|payment|selection|contract|sign|proposal|permit|coi|insurance|upload|photo|drawing|plan|design|order|purchase|schedule the|change order)\b/;
const CHAT_RE  = /\b(follow.?up|check.?in|reply|respond|draft|note|log|capture|summar|remind|status|update .*(status|log)|research|look.?up|find out|ask)\b/;

export function laneFor(item: {
  title: string; body?: string | null; effortClass?: string | null;
}): Lane {
  if (item.effortClass === "chat" || item.effortClass === "quick" || item.effortClass === "deep")
    return item.effortClass;
  const hay = `${item.title} ${item.body ?? ""}`.toLowerCase();
  if (DEEP_RE.test(hay)) return "deep";
  if (CHAT_RE.test(hay)) return "chat";
  return "quick";
}
```

**Wire into `lib/today.ts`:**
- Add `w.effort_class` to `OPEN_WORK_ITEMS_SQL`'s SELECT list and
  `effort_class: string | null` to `TodayWorkItemRow`.
- Add `lane: Lane` to `TodayPriority`; in `workItemCandidate()` set
  `lane: laneFor({ title: w.title, body: w.body, effortClass: w.effort_class })`.
- Every `checkable: false` candidate gets `lane: "deep"` explicitly.
- Add `lane` to the Waiting items too (`waitingLabel` list): extend the
  waiting item shape to `{ id, label, href, lane, checkable }`.

**Schema:** apply §4 SQL.

**Accept:** `npx tsc --noEmit` passes; `/today` renders unchanged;
`curl localhost:3000/api/today` payload now includes `lane` on priorities.

---

### Phase 2 — Queue actions + refresh loop (server side of the chips)

**Extend `lib/actions/today.ts`:**

```ts
export interface QueueSnapshot {
  priorities: TodayPriority[];
  waiting: { items: WaitingItem[]; total: number };
}

/** Re-read the live queue (same candidate pipeline as getTodayData, but
 *  ONLY priorities + waiting — no schedule/brief/chips). Factor the
 *  candidate-building block of getTodayData() into a shared helper in
 *  lib/today.ts (export async function getQueueSnapshot(): Promise<QueueSnapshot>)
 *  and have BOTH getTodayData() and this action call it, so the ranking
 *  logic never forks. */
export async function refreshTodayQueue(): Promise<QueueSnapshot>;

/** Owner clicked "Mark done" on a card. Marks the work_item done
 *  (status='done', completed_at=now()) and returns the fresh queue. */
export async function completeTodayItem(workItemId: string): Promise<QueueSnapshot>;

/** Owner clicked "Snooze 3d". due_at = GREATEST(now(), due_at) + 3 days,
 *  promoted_at = NULL (drops back to backlog), returns the fresh queue. */
export async function snoozeTodayItem(workItemId: string, days?: number): Promise<QueueSnapshot>;
```

Rules:
- All three: `await requireRole("owner")` first (copy the existing pattern).
- `completeTodayItem` / `snoozeTodayItem` must be idempotent: if the item is
  already done/cancelled, skip the write and just return the fresh snapshot.
- Do NOT delete `checkPriorityCompletion` — the click-to-navigate check
  still uses it.

**Extend `components/today/TodayQueueContext.tsx`:** add to the context
value `refresh(): Promise<void>` (calls `refreshTodayQueue`, replaces both
lists), `complete(id)`, `snooze(id)` (call the actions, replace both lists),
and a `busyId: string | null` for per-card pending state. Also refresh on
window focus (`useEffect` + `focus` listener, throttled to ≥30s apart).

**Accept:** temporary dev-only buttons (or a unit test) can mark a promoted
item done and see the next backlog item appear in `priorities` and leave
`waiting` — verified against the DB. Rail behavior on `/today` unchanged.

---

### Phase 3 — The Today feed component (UI rebuild)

**New `components/today/TodayFeed.tsx`** (client). This is the centerpiece.
Build it by copying the *mechanics* of `CommandBar` (conversation create →
`sendMessageAction` → `pollAgentRun` loop → append reply) — do not import
CommandBar itself. Structure:

1. **Header row**: agent picker (`AGENT_ORDER` / `AGENT_META`, default
   `hermes`), "New chat" button. Selecting `claude` behaves like CommandBar:
   on send, create claude conversation and `router.push('/ai?c=…')`.
2. **Scroll area** containing, in order:
   - The AI brief bubble (move the existing `AiBubble` + Suspense block from
     `TodayBody` in here as a `brief` prop — it's a server-rendered child
     passed via `children`/prop so streaming still works).
   - One `<PriorityCard>` per priority from `useTodayQueue()`.
   - The chat transcript (user/assistant bubbles, live activity tail while
     pending — copy the rendering from `CommandBar`, including the ⚠️
     error style and elapsed counter).
   - When an assistant message has `subjectWorkItemId` and that item is
     still open, re-render that card's chips under the reply.
3. **Composer** pinned at the bottom of the feed card (same styling as the
   CommandBar form row: sparkles icon, input, ↵ send).

**New `components/today/PriorityCard.tsx`** (client): renders one
`TodayPriority` — keeps the existing card look (dot, mono tag, rank, serif
title, sub) and adds a chip row by lane (§3.2/3.3):

- `✓ Mark done` → `complete(p.id)` (only when `p.checkable`).
- `Snooze 3d` → `snooze(p.id)` (only when `p.checkable`).
- `Open ↗` → existing href + existing `handleCardClick` stale-check.
- `✦ Have Hermes do it` (lane `chat`, checkable only) → calls the feed's
  `handOff(p, "do")`.
- `✦ Prep me` (lane `deep`) → `handOff(p, "prep")`.
- Chips disabled while `busyId === p.id`; card fades (`opacity-60`) like the
  existing checking state.

**Rewire `components/today/TodayBody.tsx`:**
- Remove the `CommandBar embedded` block and `TodayPriorities` from the left
  column; render `<TodayFeed brief={…}>` there instead.
- Right rail (WeekStrip / schedule / WaitingList) stays as-is, still inside
  `TodayQueueProvider`.
- Keep `TodayPriorities.tsx` on disk until Phase 8 cleanup (nothing else
  imports it after this).
- `/cmdk` deep-link (`TodayBody` without `embedAsk`) must still render: the
  feed replaces the priorities column in both modes; only the ⌘K popup
  behavior is unaffected.

**Accept:** `/today` shows the feed with cards + chips; Mark done swaps the
card for the next backlog item without reload; Snooze drops the card and the
item shows up in Waiting on me; Open still navigates; chatting with
Qwen/Hermes from the composer works exactly like the old embedded bar
(persisted thread, polled turns). ⌘K still focuses the composer
(move the `embedded` focus handler from CommandBar into TodayFeed).

---

### Phase 4 — Hand-off directives ("Have Hermes do it" / "Prep me")

**Extend `lib/actions/ai-chat.ts#sendMessageAction`** with an optional
`subjectWorkItemId?: string` param, threaded onto the inserted user
`ai_messages` row and the `dev_agent_runs` row (§4 columns). Return it on
`ChatMessage` (add `subjectWorkItemId: string | null` to the interface in
`lib/ai-chat.ts` and select it in `getConversation`).

**New file `lib/today-directives.ts`** (server-safe, pure string builders):

```ts
/** Directive sent (as the user turn) when Joe clicks "Have Hermes do it". */
export function doItDirective(p: { id: string; title: string; sub: string; tag: string }): string {
  return [
    `[TODAY ITEM — please complete this now]`,
    `work_item_id: ${p.id}`,
    `title: ${p.title}`,
    `context: ${p.tag} · ${p.sub}`,
    ``,
    `Use your sjcos MCP tools: get_work_item first; do the work with internal`,
    `tools only; then update_work_item_status to done with a short note, and`,
    `record_agent_run + record_receipt. If any step would contact a client or`,
    `send money documents, DO NOT send — prepare a draft, set the item to`,
    `approval_needed, and tell me what's ready for my approval. Reply with`,
    `2-4 sentences on what you did.`,
  ].join("\n");
}

/** Directive for "Prep me" on a deep-lane card. */
export function prepDirective(p: { id?: string; title: string; sub: string; tag: string; href?: string }): string { /* similar: gather context, summarize what to do on ${href}, do NOT change any records */ }
```

**In `TodayFeed.handOff(p, kind)`:**
- `kind === "do"`: ensure the active conversation is a **hermes** one (if
  the picker is on qwen/claude, create/switch to a hermes conversation
  first, flashing a small notice "Handing to Hermes"). Send
  `doItDirective(p)` with `subjectWorkItemId: p.id`.
- `kind === "prep"`: send `prepDirective(p)` to the currently selected
  qwen/hermes conversation (claude → treat as qwen). For **Qwen**, also pass
  `pageContext` = the card's fields plus `todayContext(data)` so the
  text-only model has something to work from.
- On turn completion (the existing poll loop resolving), call
  `refresh()` from the queue context. If the item got marked done by
  Hermes, the card disappears and the swap happens — this is the "completed
  in the chat window" moment.

**Failure paths (must handle):**
- Turn errors (⚠️ message) → still `refresh()` (Hermes may have partially
  worked the item), keep the card interactive.
- Hermes replies but did NOT change the status → card stays; that's fine.
- Concurrent completion elsewhere → `complete/snooze` actions are already
  idempotent (Phase 2).

**Accept:** clicking "Have Hermes do it" on a seeded test item (e.g. "Log a
note that the Ramsey tile arrived") results in: Hermes activity streams in
the feed → reply lands → card swaps out → `work_items.status='done'` in DB →
an `agent_runs` row + `agent_receipts` row exist for it. "Prep me" on a deep
card yields a context summary + the link, and changes no records.

---

### Phase 5 — Triage brief (make the AI "present" the queue)

Upgrade the brief so the assistant opens the day by narrating lanes:

- In `lib/today.ts`, extend `BriefInput` with
  `queue: { rank: string; title: string; lane: Lane; tag: string }[]`
  (the 5 displayed priorities), filled in `getTodayData()`.
- In `lib/ai.ts`, update the `brief()` prompt (both real + mock providers)
  to include the queue and instruct: *"For each item say in one clause
  whether you can handle it in chat ('say go on #1'), it's a one-click
  check-off, or it needs Joe on its page (name the page). ≤3 sentences
  total."* Keep the existing JSON schema/response shape (`summary`) —
  only the prompt content changes, so nothing downstream breaks.
- The mock provider's brief must mention lanes too (so dev without Ollama
  still demos the UX).

**Accept:** feed's opening bubble references items by rank and says which
ones the AI can take. No schema change to `DailyBrief`.

---

### Phase 6 — MCP server + instructions updates

**`mcp/sjcos-mcp.mjs` — add three tools** (follow the existing
`server.registerTool` + `json()` + `rows()` patterns exactly):

1. **`get_today_queue`** (read-only). Mirrors the app's eligibility rules so
   agents see what Joe sees. Note in a comment that the WHERE clause must be
   kept in lockstep with `OPEN_WORK_ITEMS_SQL` in `lib/today.ts`.

```js
server.registerTool(
  "get_today_queue",
  {
    title: "Get today's queue",
    description:
      "Joe's Today rail: promoted priorities (promoted_at set) and the " +
      "waiting backlog, with each item's lane (chat = an agent may complete " +
      "it via MCP; quick = one-click for Joe; deep = needs page work). " +
      "READ-ONLY — promotion is app-owned; complete items via " +
      "update_work_item_status.",
    inputSchema: {},
  },
  async () => {
    const items = await rows(
      `SELECT w.id, w.title, left(NULLIF(w.body,''),140) AS body, w.status,
              w.priority, w.due_at, w.effort_class,
              (w.promoted_at IS NOT NULL) AS promoted,
              p.slug AS project_slug, l.slug AS lead_slug
         FROM work_items w
         LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN leads l ON l.id = w.lead_id
        WHERE w.status NOT IN ('done','cancelled')
          AND w.assignee_kind = 'human'
          AND (w.assignee_key IS NULL OR w.assignee_key = 'human-joe')
          AND (w.lead_id IS NOT NULL OR w.project_id IS NOT NULL)
        ORDER BY (w.promoted_at IS NOT NULL) DESC,
                 array_position(ARRAY['urgent','high','normal','low'], w.priority),
                 w.due_at NULLS LAST, w.updated_at DESC, w.id`,
    );
    // lane: effort_class override, else the same keyword rules as
    // lib/today-triage.ts (duplicate the two regexes here with a
    // keep-in-lockstep comment on BOTH files).
    return json(items.map((w) => ({ ...w, lane: laneForMjs(w) })));
  },
);
```

2. **`snooze_work_item`** (gated write, logged): `{ id, days? (1–30, default 3), reason? }` →
   `UPDATE work_items SET due_at = GREATEST(now(), COALESCE(due_at, now())) + make_interval(days => $2), promoted_at = NULL WHERE id = $1 AND status NOT IN ('done','cancelled') RETURNING id, due_at` and insert an
   `agent_receipts` row (`receipt_kind 'db_row'`, label `snoozed ${days}d: ${reason}`).
   Returns `{ ok, id, due_at }` or `{ ok:false, error }`.

3. **`submit_draft_for_approval`** (gated write): `{ work_item_id, draft, kind? }` —
   for chat-lane items that turn out to need a client-facing step. Sets the
   work item `status='approval_needed'`, `approval_status='requested'`,
   saves the draft as a `knowledge_items` row (`kind: 'draft'`, linked to
   the item's lead/project) and a receipt pointing at it. Never sends
   anything. Returns `{ ok, knowledge_id }`.

Also update `update_work_item_status`'s description to append: *"When
completing a Today-queue item, include a short note and also
record_agent_run + record_receipt so the owner sees proof of work."*

**`docs/hermes-mcp.md` — add a "Today queue" section:**
- `get_today_queue` shows what Joe sees; `promoted` is informational only.
- To finish an item: do the work → `update_work_item_status(done, note)` →
  `record_agent_run` + `record_receipt`. The app's feed refreshes and checks
  the card off — that's the loop closing.
- Never attempt client-facing sends; use `submit_draft_for_approval`.
- `snooze_work_item` only when Joe asks or the item literally can't proceed
  yet (state the reason).

**`AGENTS.md` + `~/.claude/CLAUDE.md` global rule — extend the Open Engine
tool list** to include `get_today_queue`, `snooze_work_item`,
`submit_draft_for_approval`, with one sentence: *"For 'what should I do
today / work my queue' requests, start from `get_today_queue`; complete
items with `update_work_item_status` + run/receipt records; never touch
promotion."*

**`mcp/README.md`** — add the three tools to the catalog + stdio smoke-test
examples.

**Accept:** `node mcp/sjcos-mcp.mjs` boots; a stdio smoke call of
`get_today_queue` returns promoted + backlog items with lanes;
`snooze_work_item` on a done item returns `ok:false`; Hermes (restarted so
it re-reads tool list) can complete the Phase 4 acceptance flow end-to-end
using `get_today_queue` first.

---

### Phase 7 (stretch, optional) — model-emitted action chips

Only after Phases 1–6 are verified. Allow assistant replies to end with a
fenced block:

````
```sjcos-actions
[{"kind":"mark_done","work_item_id":"…","label":"Mark #2 done"}]
```
````

Client: parse fenced block (strict `JSON.parse`, silently drop on any
error), render chips ONLY for whitelisted kinds (`mark_done`, `snooze`,
`open`) whose `work_item_id` exists in the current queue snapshot — the chip
handlers call the same Phase 2 actions (server re-verifies everything).
Strip the block from the displayed message body. Add one line to the Qwen
system prompt (`qwenChat` in `lib/ai.ts`) and to `doItDirective` telling
models the block exists. If a model emits garbage, nothing renders — safe by
construction.

**DONE (2026-07-20):**
- `lib/today-actions.ts` — pure, paranoid `parseModelActions(body)` → the ONLY
  reader of the fence. First fence wins; non-array / bad-JSON / unknown-kind /
  missing-field entries are dropped; results de-duped by `kind:id` and capped
  at 6. On any error it still strips the fence from the shown text but returns
  zero actions. Unit-tested (7 cases).
- `components/today/ModelActionChips.tsx` — renders a chip only when its
  `work_item_id` matches a card in the live `useTodayQueue()` snapshot (and,
  for `mark_done`/`snooze`, that card is `checkable`). Handlers call the
  existing `complete`/`snooze` context actions (owner-verified server-side);
  `open` is a `router.push` to the card's href. The model picks WHICH item,
  never WHAT is allowed.
- `TodayFeed.tsx` — each assistant reply runs through `parseModelActions`; the
  stripped body renders (bubble hidden if empty), chips render beneath.
- `lib/ai.ts` — a self-gating `ACTIONS_HINT` system message added to
  **`qwenChat` only** (NOT the shared `SYSTEM_PROMPT`, which `ollamaChat`'s
  JSON calls use). It fires only when work_item_ids are in play → in practice
  only on /today, so other Ask windows don't get raw fences.
- `lib/today-directives.ts` — `doItDirective` now tells Hermes the block
  exists for suggesting follow-up one-click steps on other items.

Guardrail preserved: chips are still app-rendered; the model only names ids
that must already be in the queue, and every action re-verifies owner + item
server-side. Nothing client-facing, no `promoted_at` write.

**Two things a live E2E (Qwen on /today, Playwright) surfaced and fixed:**
1. `todayContext` (lib/page-context.ts) did NOT include work_item_ids, so a
   model could never name a matching id from the general composer — chips
   could only ever come from hand-off directives. Added `(work_item_id: …)`
   to each priority line so the composer path works too.
2. Qwen (7B) drifts on the fence label — it emitted the array in a plain
   ```json fence, not ```sjcos-actions, so the block leaked as raw text and no
   chip rendered. `parseModelActions` now falls back to ANY fenced block whose
   content is entirely a valid action array (strict all-entries-valid), so a
   ```json / unlabeled fence still works while ordinary JSON is left untouched.
   Also: Qwen often replies with ONLY the block (no prose) — the feed hides the
   empty bubble and shows a small "Suggested" label above the chips.

Verified live: Qwen emitted mark_done + open chips keyed to real promoted
items; fence stripped; chips rendered with correct icons/styling. (Chips were
not clicked in the check — they act on real work_items; the handlers are the
same Phase 2 server actions already shipped.)

**Also wired Hermes (the feed's DEFAULT agent).** `ACTIONS_HINT` moved from a
private const in lib/ai.ts to an exported const in lib/today-directives.ts, and
is now added as a system message in BOTH `qwenChat` (lib/ai.ts) and
`hermesChat` (lib/dev-agents.ts). Without this the default agent couldn't offer
chips from the composer at all. Verified live: with "don't change anything,"
Hermes wrote a prose recommendation and emitted 5 `open` chips, each matching a
live promoted priority (chips whose id isn't in the client snapshot are
silently dropped — the safe path). Hermes correctly offered only `open`
(read-only) and declined to mark anything done.

---

### Phase 8 — cleanup + polish

- Delete `components/today/TodayPriorities.tsx` (feed replaced it); remove
  its export references. Keep `checkPriorityCompletion` (Open ↗ still uses
  it).
- Swap animation: when a card completes, animate out (existing opacity
  pattern is fine; a `transition-all` height collapse is enough — no
  animation library).
- Cost guardrails: the feed defaults to Hermes (local) and Qwen (local);
  the brief stays on the existing provider path. No new Claude-API spend.
- Empty state: all five slots clear → feed shows the existing "ALL CLEAR"
  card + the assistant bubble congratulating; composer still works.
- Update `docs/routes.md` / `docs/plan-vs-build.md` if they describe /today.
- Run `/verify`-style pass: full E2E checklist below.

---

## 6. E2E acceptance checklist (run after Phase 6, again after 8)

Seed (SQL or via MCP `create_work_item`) three items linked to a real
project/lead:
1. chat-lane: "Log a note that tile delivery arrived" (title matches CHAT_RE)
2. quick-lane: "Confirm dumpster pickup happened"
3. deep-lane: "Build draw 3 invoice for <project>" (matches DEEP_RE)

Then verify:
- [ ] `/today` renders feed + right rail; lanes badge correctly on the three items
- [ ] Brief mentions at least one "I can handle" item
- [ ] `✓ Mark done` on item 2 → card swaps, DB row done, Waiting count drops
- [ ] `Snooze 3d` → due_at moved, card demoted to Waiting on me
- [ ] `✦ Have Hermes do it` on item 1 → activity streams → reply → card auto-clears → `agent_runs` + `agent_receipts` rows exist
- [ ] `✦ Prep me` on item 3 → context summary + working deep link, zero record changes
- [ ] Claude picker + send → lands on `/ai?c=…` (unchanged behavior)
- [ ] ⌘K focuses composer; `/cmdk` route still renders
- [ ] Reload mid-Hermes-run → thread resumes polling (pendingRunId path)
- [ ] `npx tsc --noEmit` and `npm run lint` clean

## 7. Guardrails (read before every phase)

1. `promoted_at` writes happen ONLY in `lib/today.ts` / `lib/actions/today.ts`
   (and the new snooze demotion). Never over MCP, never from the model.
2. Chips are app-rendered and server-verified; model text NEVER creates
   privileged actions (Phase 7's whitelist parser is the only exception).
3. No client-facing sends anywhere in this build — drafts + approval only.
4. Every new server action starts with `await requireRole("owner")`.
5. Qwen/Hermes are local — don't add paid-API calls to the Today path.
6. Follow repo conventions: comment style, `query`/`queryOne`, zod input
   schemas in the MCP server, no new dependencies.
