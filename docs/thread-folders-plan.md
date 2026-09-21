# Panel threads v2: status, settled, archive, and project folders

Status: BUILT 2026-09-14 (Phases 1–4; Phase 5 stretch not started). Verified
headless on a :3099 dev copy against the live DB (folder create / move / File
under chip / settle / un-settle / pin / scope / archive / restore / delete
folder) plus a direct run of the server paths (folder-on-first-use, agent
context line, activity un-settle, auto-settle sweep rules). The migration
(`db/apply-thread-folders.mjs`) has been applied to the live DB. Answers to
§5: archiving a folder hides its threads; 3-day auto-settle, editable via
`app_settings` key `panel.autoSettleAfterDays`; folder scope is per tab.

Files: `lib/thread-rail.ts` (client-safe partition/status logic, tested in
`tests/thread-rail.test.mjs`), `lib/thread-folders.ts` (rows + sweep),
`lib/actions/ai-chat.ts` (actions + send hooks), `components/panel/ThreadList.tsx`
(the rail), `components/panel/JobPicker.tsx` (searchable job picker for Link /
New folder, added 2026-09-16; search is `searchFolderEntities` in
`lib/thread-folders.ts`; rows are also draggable onto folder headers /
Unfiled, native HTML5 drag events, same `moveConversationAction`; folder
headers drag to reorder — Unfiled is always first and folders keep a fixed
manual order via `sort_key`, never re-sorted by activity — see
`reorderFoldersAction`), `components/panel/useAgentChat.ts` / `PanelChat.tsx` (new-thread
filing, folder chip, scope), `components/panel/panelStore.ts` (scope + run-seen
+ tab-start stamps), `app/api/cron/agent-retries/route.ts` (sweep).

One rule differs from §3.2 as written: a finished run only shows as
"done-unread"/"failed" when it ended after this tab opened. Without that, a
fresh tab lit up every old thread.

Goal: bring the SJC OS panel thread rail up to the lifecycle model T3 Code uses
(running / needs-you / settled / archived, with a stable list that never jumps
around), and add nameable folders so every conversation about one job stays
under that job's name.

Reference implementation: T3 Code `0.0.39-nightly.20260903` (installed at
`/usr/lib/node_modules/t3`, state in `~/.t3/userdata/state.sqlite`). Section 1
is what it does; sections 2 onward are what we build.

---

## 1. How T3 Code does it (research summary)

### 1.1 Data model

One `projection_threads` row per thread, keyed to a `projection_projects` row.
Lifecycle columns:

| column | meaning |
| --- | --- |
| `settled_override` | tri-state: `'settled'`, `'active'` (user said "keep active", blocks auto-settle), or `NULL` (neutral, eligible for auto-settle) |
| `settled_at` | when the work *ended* (last activity), not when the sweep ran; sort key for the Settled shelf |
| `unsettled_at` | re-entry stamp; the only thing that re-anchors a thread in the active list |
| `archived_at` | hidden from the rail entirely; lives under Settings → Archived threads |
| `deleted_at` | soft delete |
| `pinned_at`, `pin_order_key` | pinned block at top; fractional-index key so a drag writes one row |
| `snoozed_until`, `snoozed_at` | hidden until wake time; "raises its hand" early on approval/input/error |
| `pending_approval_count`, `pending_user_input_count` | denormalized counters that drive the status pill |

A separate `projection_thread_sessions` row holds the live state:
`status ∈ idle | starting | running | ready | interrupted | stopped | error`
plus `active_turn_id`.

### 1.2 Settled

- **Manual:** hover ✓ on the row or "Settle thread" in the menu. Rejected while
  the session is starting/running or there is an open approval/question.
  Settling also unpins and unsnoozes ("I'm done with this").
- **Automatic:** a server sweep every 1 minute. A thread is a candidate only if
  it is not archived, has no override, has no pending approval/input, is not
  running, and has no queued turn. It settles when its PR is merged/closed, or
  when it has been quiet for `autoSettleAfterDays` (default 3). An open PR
  blocks staleness-settling.
- **Un-settle:** any new user message resets *any* override to `NULL`
  (`reason: "activity"`). An explicit "Un-settle" sets the override to
  `'active'` (`reason: "user"`).
- **UI:** a collapsed "Settled (N)" shelf below the active list. Rows recede
  (dimmed, grayscale favicon), newest-ended first, paginated 10 then 25.

### 1.3 Archive

UI-only action, blocked while a turn is running. Archived threads leave the
rail and are listed under Settings → Archived threads grouped by project with
Unarchive / Delete. Three-way distinction: Settle = still visible in the shelf,
Archive = hidden but kept, Delete = gone.

### 1.4 Running indicator

The sidebar resolves one status per thread, in strict priority:

1. **Pending Approval** (amber) — `pending_approval_count > 0`
2. **Awaiting Input** (indigo) — `pending_user_input_count > 0`
3. **Working** (sky, pulsing) — session `running`; **Connecting** for `starting`
4. **Plan Ready** (violet)
5. **Failed** — session `error`
6. **Completed** (emerald) — only while the completion is unseen
7. nothing — idle/settled rows simply recede

Working rows show an elapsed-time label. Status reaches the client over one
websocket "shell" subscription: server pushes `thread-upserted` events with
sequence numbers; the client reduces them into a store and can resume from
`afterSequence`.

### 1.5 Projects and ordering

Projects are strictly one-per-filesystem `workspace_root` (not arbitrary
folders). The sidebar groups threads by project client-side, with a grouping
mode (`repository | repository_path | separate`) so several worktrees of one
repo collapse into one group. New threads inherit the project you're scoped
to. Project sort is by last activity by default.

Within a project the partition is: `pinned`, `active`, `snoozed`, `settled`.
Active ordering is `max(created_at, unsettled_at)` — **activity never reorders
the list**. Server ships the full non-archived set unpaginated; archived is a
separate on-demand query.

---

## 2. Where SJC OS is today

Threads are `ai_conversations` (`db/schema.sql:2309`): `agent`, `title`,
`claude_session_id`, `archived boolean`, timestamps. No entity link, no
folder, no settled state. Runs are `dev_agent_runs` with
`status ∈ pending | running | done | error` and a 5-second heartbeat on
`updated_at`. Questions and CLI permission prompts are `agent_interactions`
(`kind ∈ question | permission`, `status = 'pending'`); owner grants pending
approval are `owner_grants.status = 'requested'`.

The rail (`components/panel/ThreadList.tsx`) lists `updated_at DESC LIMIT 100`
with a single `live` boolean (`EXISTS running run`) rendered as a pulsing dot,
plus Rename / Archive / Delete on hover and a "Show archived" toggle. It
refreshes on a 30-second timer and on any `run` message over the panel
BroadcastChannel. Per-tab selection is in `panelStore.ts` (sessionStorage) with
a 15-second claim heartbeat so two tabs don't seed onto the same thread.

The only thread↔job link today is per run: `run_effects` records the entity
each MCP call touched, and `lib/run-focus.ts` resolves the latest one to a page.

---

## 3. Design

### 3.1 Data model changes (`db/schema.sql` + a new `db/apply-thread-folders.mjs`)

```sql
CREATE TABLE ai_folders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  entity_kind   text CHECK (entity_kind IN ('project','lead','client','vendor','sub')),
  entity_id     text,                        -- slug or uuid, same convention as run_effects
  color         text,
  sort_key      text,                        -- fractional index for manual order
  collapsed     boolean NOT NULL DEFAULT false,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_folders_entity_idx ON ai_folders (entity_kind, entity_id)
  WHERE entity_id IS NOT NULL;

ALTER TABLE ai_conversations
  ADD COLUMN folder_id        uuid REFERENCES ai_folders(id) ON DELETE SET NULL,
  ADD COLUMN settled_override text CHECK (settled_override IN ('settled','active')),
  ADD COLUMN settled_at       timestamptz,
  ADD COLUMN unsettled_at     timestamptz,
  ADD COLUMN pinned_at        timestamptz,
  ADD COLUMN pin_order_key    text,
  ADD COLUMN snoozed_until    timestamptz,
  ADD COLUMN snoozed_at       timestamptz,
  ADD COLUMN last_activity_at timestamptz,   -- last user or assistant message
  ADD COLUMN archived_at      timestamptz;   -- backfill from archived=true; keep the boolean for one release

CREATE INDEX ai_conversations_rail_idx
  ON ai_conversations (archived_at, folder_id, settled_override, created_at);
```

Decisions baked in:

- **Folders are nameable and free-standing.** Unlike T3, a folder is not tied
  to a filesystem path. It *may* be bound to one SJC OS entity (a project, a
  lead, a client). A bound folder's display name follows the entity name when
  `name` is blank, and clicking the header opens that entity's page.
- **One folder per entity, many free folders.** The partial unique index keeps
  "Larson kitchen" from being created twice, while unbound folders like
  "Admin / bookkeeping" can be anything.
- **Settled is the same tri-state as T3.** Copying the `'active'` override is
  what makes "keep this one around" survive the auto sweep.
- `last_activity_at` is maintained by the message insert path so the sweep and
  the shelf sort don't have to scan `ai_messages`.

### 3.2 Thread status (server-side, one query)

Replace the `live` boolean in `lib/ai-chat.ts listAllConversations` with a
computed `status`, resolved in the same priority order T3 uses:

```sql
SELECT c.*,
  f.name AS folder_name, f.entity_kind, f.entity_id,
  EXISTS (SELECT 1 FROM owner_grants g
          WHERE g.conversation_id = c.id AND g.status = 'requested')            AS needs_approval,
  EXISTS (SELECT 1 FROM agent_interactions i
          WHERE i.conversation_id = c.id AND i.status = 'pending')              AS needs_input,
  EXISTS (SELECT 1 FROM dev_agent_runs r
          WHERE r.conversation_id = c.id AND r.status IN ('pending','running')) AS working,
  (SELECT r.status FROM dev_agent_runs r WHERE r.conversation_id = c.id
     ORDER BY r.created_at DESC LIMIT 1)                                       AS last_run_status,
  (SELECT r.created_at FROM dev_agent_runs r WHERE r.conversation_id = c.id
     AND r.status IN ('pending','running') ORDER BY r.created_at LIMIT 1)      AS working_since
FROM ai_conversations c LEFT JOIN ai_folders f ON f.id = c.folder_id
WHERE c.archived_at IS NULL
```

Then in TypeScript:

```ts
type ThreadStatus = "approval" | "input" | "working" | "failed" | "completed" | "idle";
// approval > input > working > failed (last run error, not yet seen) > completed (unseen) > idle
```

"Unseen" uses a per-tab `seenRunIds` set in `panelStore` (session scope), the
same way T3 keeps `hasUnseenCompletion` client-side. `working_since` feeds the
elapsed label. Both `agent_interactions` and `owner_grants` already carry
`conversation_id` (`db/schema.sql:2907`, `:2852`), so no join through runs is
needed. Note `agent_interactions.kind = 'permission'` (CLI permission prompt)
is a "needs input" state here, not an owner grant; only `owner_grants` counts
as approval.

### 3.3 Settle / un-settle rules

- **Manual settle** (`settleConversationAction`): reject if `working`,
  `needs_approval`, or `needs_input`. Sets `settled_override='settled'`,
  `settled_at = last_activity_at`, clears `pinned_at` and `snoozed_*`.
- **Un-settle** (`unsettleConversationAction`): sets `settled_override='active'`,
  `settled_at = NULL`, `unsettled_at = now()`.
- **Activity un-settle**: in `sendMessageAction`, before starting the turn,
  `UPDATE ai_conversations SET settled_override = NULL, settled_at = NULL,
  unsettled_at = CASE WHEN settled_override IS NOT NULL OR snoozed_until IS NOT NULL
  THEN now() ELSE unsettled_at END, snoozed_until = NULL`. Only a real
  re-entry re-anchors the list.
- **Auto settle sweep** (`lib/dev-agents.ts`, next to `failStaleRuns`, which
  already runs on every poll; also add it to the existing systemd timer that
  drains push/drip so it runs while nobody is watching):
  candidate = not archived, `settled_override IS NULL`, no working run, no
  pending interaction/grant, and `last_activity_at < now() - interval '3 days'`.
  The 3-day value goes in `app_settings` as `panel.autoSettleAfterDays`
  (null disables). Settle stamps `settled_at = last_activity_at`.
- No PR-merge trigger here. The SJC OS analogue worth adding later is
  "the linked work item was completed" (via `subject_work_item_id`), which
  would settle the thread on the next sweep.

### 3.4 Archive

Keep the existing actions but move to `archived_at` and block archiving a
`working` thread (return an error the rail shows as a toast). "Show archived"
stays in the rail footer rather than moving to Settings, because Joe already
uses it; archived rows keep Restore / Delete. Archived folders (a finished job)
hide all their threads from the rail in one move and show under the same
toggle.

### 3.5 Rail ordering and partition (client, `ThreadList.tsx`)

Per folder, and for the Unfiled group:

```
[pinned by pin_order_key] ─divider─ [active by max(created_at, unsettled_at) DESC]
[snoozed, soonest wake first]   (only if snooze ships, see 4.5)
▸ Settled (N)  collapsed by default, settled_at DESC, show 10 then +25
```

Adopt T3's rule that **activity does not reorder** the active list. This is a
change from today's `updated_at DESC`, and it is the change that stops the
rail jumping while several agents run. Folder order: last activity of any
non-archived thread inside, with a manual override via `sort_key` (drag)
available later. Folder headers are collapsible; collapsed state is stored on
the folder row so it is the same in every tab and window.

The currently open thread is always force-included even if it would sit in a
collapsed shelf, so a `/today?c=<id>` deep link never opens onto a hidden row.

### 3.6 Folders UI

- **Folder header:** name (or bound entity name), status roll-up dot (highest
  priority status among its threads, so a folder with a run waiting on
  approval glows amber even when collapsed), count, chevron.
- **Header menu:** New thread here, Rename, Link to project/lead…, Collapse,
  Archive folder, Delete folder (threads become Unfiled; refuse when any
  thread is working).
- **Thread row menu** gains: Move to folder… (searchable list + "New folder"),
  Pin / Unpin, Settle / Un-settle.
- **New thread default folder:** plain **New** (chat header, rail header) is
  always Unfiled. Filing is an explicit choice: a folder header's **+**, the
  rail's **New chat in job…** picker (any project / lead / vendor / sub — its
  folder is created on first use), or **New** while the rail is scoped to a
  folder. The chosen home shows as a "New in …" chip in the chat header (✕ =
  Unfiled after all) until the first send creates the thread; it is cleared
  by opening another thread. *(Revised 2026-09-21: the earlier rule — file
  under whichever job page the app view is on — silently put every chat
  started beside a project page in that project's folder.)*
- **Folder scope:** clicking a folder header title scopes the rail to that
  folder (like T3's project scope). "All" clears it. Scope is per tab
  (`panelStore` session scope) so two tabs can sit on two jobs.
- **Auto-file suggestion:** after a run ends, if the thread is Unfiled and
  `run_effects` for that run resolve to exactly one project/lead, show a
  one-click "File under Larson kitchen?" chip in the rail row. Never auto-move
  silently; a thread that touched two jobs stays where Joe put it.

### 3.7 Live updates

Keep the BroadcastChannel + 30-second poll for now. Extend the `run` bus
message with `status` so other tabs flip the pill immediately, and add bus
messages for `interaction` (question/permission raised) and `grant`
(requested) so amber/indigo appear without waiting for the poll. A single
server-sent-events shell stream like T3's is the right end state but is not
needed for one operator; note it as a follow-up in the stretch list.

### 3.8 Agents and MCP

Expose the folder on the run's context so an agent knows which job a
conversation belongs to: `startBackgroundTurn` adds
`Folder: <name> (project <slug>)` to the page context block it already builds.
Add read-only MCP tools later (`list_agent_threads`, `get_agent_thread`)
only if Joe wants agents to consult earlier conversations for the same job.
No write tools for folders from MCP.

---

## 4. Phases

Each phase ships on its own and is verified with the side-copy recipe
(`next dev -p 3099` on a copy, minted session cookie). No `next build` while
`sjcos.service` is up; deploy is build then restart.

### Phase 1: schema + status query (½ day)

- `db/schema.sql` + `db/apply-thread-folders.mjs` (idempotent ALTERs, backfill
  `archived_at` from `archived`, `last_activity_at` from max message time).
- `lib/ai-chat.ts`: new `listThreadRail()` returning folders + threads with
  `status`, `working_since`, lifecycle columns. Keep `listAllConversations`
  as a thin wrapper until the rail is switched.
- Maintain `last_activity_at` in the message insert helpers.

### Phase 2: status pills, settled shelf, archive block (1 day)

- `ThreadList.tsx`: replace the dot with `ThreadStatusLabel` (six states,
  pulse for working, elapsed label), recede styling for idle/settled rows,
  collapsed Settled shelf with pagination, hover ✓ settle / ↶ un-settle.
- Actions: settle, unsettle, activity un-settle in `sendMessageAction`,
  archive guard.
- Sweep: `autoSettleQuietThreads()` next to `failStaleRuns()`, setting in
  `app_settings`.
- Ordering switch to `max(created_at, unsettled_at)`.

### Phase 3: folders (1–1½ days)

- Actions: create / rename / bind / collapse / archive / delete folder,
  move thread, pin / unpin.
- Rail grouping with headers, roll-up status, Unfiled group, folder scope
  per tab, "Move to folder…" picker.
- New-thread default folder from page context (project / lead / client
  routes), creating the bound folder on first use.

### Phase 4: auto-file chip + agent context (½ day)

- `run_effects` → single-entity resolution → "File under …?" chip.
- Folder line in the agent's page-context block.

### Phase 5 (stretch)

- Snooze with presets and "raised hand" early wake, mirroring T3's derived
  wake (no timer event; the rail re-partitions at the wake boundary).
- Drag reorder for pinned threads and folders using a fractional index
  (port T3's `pinOrderKeyBetween` idea; base-26 string keys).
- SSE shell stream replacing the poll.
- Settle-on-work-item-complete.

---

## 5. Open questions for Joe

1. Should archiving a folder also settle/archive its threads, or only hide
   them? (Plan assumes hide, reversible.)
2. Auto-settle default: 3 days like T3, or longer given job conversations can
   idle a week between site visits? (Plan ships 3, editable in settings.)
3. Is per-tab folder scope wanted, or should scope be global like the
   docked/window preference? (Plan: per tab, matching thread/agent/model.)
