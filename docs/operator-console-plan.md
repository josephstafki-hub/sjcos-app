# Operator Console (`/operator`) — Implementation Spec

**Status: promoted (2026-08).** The console shipped and then evolved past this
spec: its queue + chat columns are now the persistent **universal operator
panel** (`components/panel/`, mounted by `app/(os)/layout.tsx` — resizable
dock, detachable `/panel` window, voice rounds, auto-routing with Claude
review); the workbench column became the `/workbench` page; `/today-preview`
redirects to `/today`. The chat-mechanics gotchas and §7 guardrails live on in
`components/panel/useAgentChat.ts` and `lib/orchestrator/`. Kept for history —
sections below describe the pre-promotion design. (Original status: plan only.)
**Author intent:** written so a small model (Haiku-class or a local model) can build it phase-by-phase. Every phase lists exact files, signatures, and a "done when" checklist. **Read §7 Guardrails before writing any code.**

**Working name:** `/operator` — "Operator Console". Sidebar label: **Operator**. (Matches the existing voice — Engine, Automate, Today — and avoids the gimmicky "Mission".)

**One-sentence pitch:** one screen where Joe talks to Hermes/Claude/Qwen, the model presents the Today queue, Joe says "do it," and the right-hand **Workbench** panel shows the actual lead/project/warranty record changing in real time while the agent works it.

---

## 0. Architecture summary (read first)

The console is an assembly of three existing systems plus one genuinely new piece:

| Panel | What it shows | Built from |
|---|---|---|
| Left: **Queue rail** | Priorities (5-slot) + Waiting on me | Existing `TodayQueueProvider`, `PriorityCard`, `WaitingList` — reused as-is |
| Center: **Chat** | Agent picker, transcript, activity line, composer | Port of `components/today/TodayFeed.tsx` chat mechanics (same server actions, same 2s `pollAgentRun` loop) |
| Right: **Workbench** (new) | The entity the agent is working on — header fields + unified event timeline, diff-highlighted every 3s | **Net-new**: `lib/workbench.ts` + `components/operator/WorkbenchPanel.tsx` |

Key decisions (justified inline in later sections):

1. **No SSE, no websockets.** Everything is short-interval polling via server actions, exactly like the app already does (`pollAgentRun` every 2s; workbench snapshot every 3s while a run is active). There is no `EventSource`/`ReadableStream`/websocket anywhere in the app today — do not introduce one.
2. **Zero new tables, zero DDL.** The workbench event timeline is a read-time `UNION ALL` over `lead_activity` + `agent_receipts` + `agent_runs` (§4.3). The phase-7 `agent_steps` table is explicitly **not** built here.
3. **The queue narration ("the model presents the to-dos") is deterministic app text, not a model call** for the pinned opening message; the live queue snapshot is injected as `pageContext` on every turn so the model can also discuss it (§2).
4. **Hermes "thinking" visibility = a heartbeat writer** into the existing `dev_agent_runs.activity` column (~15 lines in two existing call sites); Hermes "doing" visibility comes free from the workbench polling `agent_receipts`/`agent_runs`, which Hermes already writes via MCP (§3).
5. Chat mechanics are **copied, not refactored**. Do NOT extract a shared hook out of `TodayFeed.tsx` — that risks breaking the live `/today` page. Duplicate the ~60 lines of poll/send logic into the new component.

> Note on line numbers: this doc cites functions as "`name` (~line N)". Line numbers drift; always locate by **function/symbol name**, and treat the number as a hint only.

---

## 1. Concept & layout

### 1.1 Route and shell

- New route: `app/operator/page.tsx`, server component, `export const dynamic = "force-dynamic";` (same as `app/today/page.tsx`), wrapped in the standard `<Shell breadcrumb="Operator">`. Copy the shell/wrapping pattern from `app/today/page.tsx` verbatim.
- Data: call the existing `getTodayData()` from `lib/today.ts` (it already returns priorities, waiting, schedule, header chips, and `briefInputs`). No new query layer for the queue.
- Nav: add to the nav array in `components/shell/Sidebar.tsx` (array starts ~line 46), directly after Today:

```ts
{ label: "Operator", href: "/operator", icon: Radar },
```

(`Radar` from `lucide-react`; add it to the existing import list at the top of the file. If `Radar` is already imported or collides, use `Gauge` or `Crosshair`.)

### 1.2 Component tree

```
app/operator/page.tsx                       (server, force-dynamic)
└─ <Shell breadcrumb="Operator">
   └─ components/operator/OperatorBody.tsx  (server — mirrors TodayBody.tsx)
      └─ <TodayQueueProvider initialPriorities={data.priorities} initialWaiting={data.waiting}>   (REUSED, unchanged)
         └─ components/operator/OperatorGrid.tsx        (client — layout + shared run state)
            ├─ components/operator/QueueRail.tsx        (client — left panel)
            │   ├─ PriorityCard × N                     (REUSED from components/today/PriorityCard.tsx, unchanged)
            │   └─ WaitingList                          (REUSED from components/today/WaitingList.tsx, unchanged)
            ├─ components/operator/OperatorChat.tsx     (client — center panel; ported TodayFeed chat mechanics)
            └─ components/operator/WorkbenchPanel.tsx   (client — right panel; NET NEW, §4)
```

Reuse rules:

- `TodayQueueProvider` (`components/today/TodayQueueContext.tsx`) is imported and used **unchanged**. It already gives `priorities`, `waiting`, `refresh()`, `complete()`, `snooze()`, `handleCardClick()`, and the 30s focus-refresh. All three panels read it via `useTodayQueue()`.
- `PriorityCard` is imported **unchanged**; its `onHandOff(p, kind)` prop is wired to `OperatorChat`'s hand-off function (passed down through `OperatorGrid` — see §1.4).
- `TodayFeed.tsx`, `TodayBody.tsx`, and `/today` itself are **not modified in any phase**. `/today` keeps working exactly as it does now.

### 1.3 Layout (responsive)

`OperatorGrid.tsx` renders a grid that goes three columns → two → one:

```tsx
<div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.2fr] xl:grid-cols-[minmax(260px,0.9fr)_minmax(380px,1.4fr)_minmax(300px,1fr)]">
  {/* xl (>=1280): queue | chat | workbench (three columns) */}
  {/* lg (1024-1279): chat(+inline queue cards) | workbench (two columns) */}
  {/* base (<1024): single column — chat with inline queue cards, workbench in a collapsible <details> */}
</div>
```

Concrete responsive rule (keep it this simple, no JS media queries):

- **≥ xl (1280px):** three panels side by side. `QueueRail` visible (`hidden xl:flex`), inline queue copy hidden (`xl:hidden`).
- **lg (1024–1279px):** two panels. `QueueRail` hidden; render the `PriorityCard` list at the top of `OperatorChat`'s scroll area (exactly like `/today` does today). `WorkbenchPanel` on the right.
- **< lg:** single column: chat (with inline queue cards) first, `WorkbenchPanel` below inside a `<details>` element (`<summary>Workbench</summary>`) so it doesn't dominate a phone screen.

Implement by rendering the queue cards in both places and toggling with Tailwind visibility classes.

### 1.4 Shared client state between panels

Chat and Workbench must both know "which run is active and which entity it's about." Do NOT invent a second context; use component state in `OperatorGrid` and pass props:

```tsx
// components/operator/OperatorGrid.tsx (client)
import type { DevAgent } from "@/lib/dev-agents-meta";

export interface ActiveRun {
  runId: string;
  agent: DevAgent;
  subjectId: string | null;    // TodayPriority.id — a work_items uuid OR a synthetic id like "lead:slug"
  startedAt: number;           // Date.now()
}

const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
const [focusedSubjectId, setFocusedSubjectId] = useState<string | null>(null);
// focusedSubjectId: what the Workbench shows. Set when (a) a run starts with a subject,
// (b) Joe clicks a queue card's new "Inspect" affordance (Phase 3). Kept after the run
// completes so Joe can review what changed.
```

`OperatorChat` receives `onRunStart(run: ActiveRun)` and `onRunEnd()`; `WorkbenchPanel` receives `subjectId={focusedSubjectId}` and `runActive={activeRun !== null}`. `QueueRail`'s cards get an extra small "Inspect" chip (Phase 3) that calls `setFocusedSubjectId(p.id)` — a new, tiny, app-rendered chip added in `QueueRail` (wrap `PriorityCard` in a div with the chip below it; **do not modify `PriorityCard` itself**).

---

## 2. The model presenting the to-dos

### 2.1 Opening narration (deterministic — invariant 4)

The console opens with a pinned assistant-styled bubble that narrates the queue. This is **app-generated text, not a model call** (instant, free, can't hallucinate ids). Net-new pure function:

```ts
// lib/operator-narration.ts  (pure string builder, no db imports — mirrors lib/today-directives.ts)
import type { TodayPriority, WaitingItem } from "@/lib/today";

/** Deterministic opening message for the Operator console. Numbered so Joe can
 *  say "do #2". Lanes explain what a hand-off can do. */
export function queueNarration(
  priorities: TodayPriority[],
  waiting: { items: WaitingItem[]; total: number },
): string {
  const lines = priorities.map((p) => {
    const laneNote =
      p.lane === "chat" ? "agent can complete" : p.lane === "quick" ? "one click" : "needs you";
    return `${p.rank} [${p.tag}] ${p.title} — ${p.sub} (${laneNote})`;
  });
  return [
    `Here's the queue right now:`,
    ...lines,
    waiting.total ? `…plus ${waiting.total} more waiting on you.` : `Nothing else is waiting.`,
    ``,
    `Tell me which one to take — "do #2", or use the chips on a card. I'll draft anything client-facing for your approval instead of sending it.`,
  ].join("\n");
}
```

Rendered by `OperatorChat` as the first transcript entry (styled like an assistant bubble — reuse the assistant-bubble styling from `TodayFeed.tsx`, e.g. its `bg-ai-soft` class). It re-renders from live `useTodayQueue().priorities`, so it always reflects the current queue.

### 2.2 Queue context on every turn (so the model can discuss the queue)

Every `sendMessageAction` call passes `pageContext`. Reuse the existing builder `todayContext(data)` from `lib/page-context.ts` (~line 86; already includes priorities with tags, schedule, waiting list). Add work-item ids so the model can act on specific items via MCP — new function in `lib/page-context.ts`:

```ts
/** Operator console context: todayContext plus the priority ids agents need for
 *  MCP calls (get_work_item / update_work_item_status take real work_items ids). */
export function operatorContext(data: TodayData): string {
  const ids = data.priorities
    .filter((p) => p.checkable) // only real work_items uuids; never synthetic ids
    .map((p) => `  - ${p.rank} "${p.title}" -> work_item_id ${p.id}`)
    .join("\n");
  return [todayContext(data), ids && `Work item ids for the priorities above:\n${ids}`]
    .filter(Boolean)
    .join("\n");
}
```

`OperatorBody` computes this on the server and passes it into `OperatorGrid` as `aiContext: string` (same pattern as `TodayBody` → `TodayFeed`).

### 2.3 Instruction routing

Three paths, in increasing generality:

1. **Card chips (deterministic, primary).** `PriorityCard`'s existing `onHandOff(p, "do" | "prep")` → `OperatorChat.handOff()`, a direct port of `TodayFeed.handOff()` (~line 163): "do" forces the Hermes agent + `doItDirective(p)` from `lib/today-directives.ts`, sent via `sendMessageAction(convId, doItDirective(p), aiContext, undefined, undefined, p.id)` with `subjectWorkItemId = p.id`; "prep" uses `prepDirective(p)` on the selected non-Claude agent. **One console addition:** when a hand-off starts, call `onRunStart({ runId, agent, subjectId: p.id, startedAt: Date.now() })` and `setFocusedSubjectId(p.id)` so the workbench snaps to that entity.
2. **Free text ("do #2 then draft the warranty reply").** Sent as a normal chat turn with `operatorContext` as `pageContext`. Hermes has the ids in context and its MCP tools; it does the work itself. The app does **NOT** parse the model's reply for actions (that's the out-of-scope Phase-7 action-chips plan). After the turn resolves, always call `refresh()` on the queue (not only when `subjectId` is set — free-text turns can change any item). **Workbench targeting for free text:** if the run row has no `subject_work_item_id`, the workbench keeps its current focus; Joe can click "Inspect" on any card.
3. **"Run the chat lane" button (Phase 4, deterministic multi-item).** A single app-rendered button above the queue rail: for each priority with `lane === "chat" && checkable`, sequentially (never parallel) run the full "do" hand-off and await its poll loop before starting the next; update `focusedSubjectId` to each item as it starts. Abortable via a "Stop after current" button (a boolean ref checked between items). No model-side planning involved.

Claude behaves differently from `/today`: selecting Claude and sending launches a Claude run **in this console** (do NOT redirect to `/ai` like TodayFeed does). Claude runs poll fine here and its `activity` column is the richest. Use `sendMessageAction` with the conversation created for agent `"claude"`; poll identically.

---

## 3. Thinking / doing visibility

### 3.1 What exists

- `dev_agent_runs.activity` (text, newline-joined progress lines) is polled every 2s by `pollAgentRun(runId)` (`lib/actions/dev-agents.ts`, returns `{ ok, status, activity }` or the final answer).
- **Claude:** `scripts/run-claude-agent.mjs` already streams rich lines ("Reading X", "Editing Y", "Running: …", thinking snippets) into `activity`. Nothing to do.
- **Qwen:** synchronous-ish, seconds-fast, no tools. Nothing to do; a static "Qwen is thinking…" line is fine.
- **Hermes:** the gateway is opaque (one blocking HTTP call in `hermesChat`, `lib/dev-agents.ts` ~line 151). The run row is created with `activity = 'Hermes is thinking…'` and never updated until done. During a multi-minute tool loop Joe sees a frozen line.

### 3.2 Options considered

- **(A) Heartbeat writer** — an interval in the two places that run Hermes turns updates `activity` with elapsed seconds. ~15 lines, no gateway changes, no MCP changes. Shows *liveness*, not *content*.
- **(B) MCP breadcrumb tool** — a new `report_progress` MCP tool writing lines to the run row. Requires: MCP server change, a prompt-directive change so Hermes remembers to call it, and plumbing the run id into Hermes's MCP session (which does not exist today — the gateway session is keyed by conversation, not run). Materially more work and fragile.

**Recommendation: (A) heartbeat.** (B)'s real payoff — seeing what Hermes is *doing* — is already delivered by the Workbench: Hermes's `doItDirective` instructs it to call `record_agent_run` + `record_receipt`, and the workbench polls those tables every 3s (§4). So "thinking" = heartbeat in the chat panel; "doing" = receipts/activity rows appearing live in the workbench. (B) is out of scope here.

### 3.3 Heartbeat implementation (exact)

Two call sites run Hermes turns; add the same block to both.

**Site 1 — `lib/actions/ai-chat.ts`, inside the `void (async () => { ... })()` background block that runs Hermes/Qwen turns (~lines 178–197):**

```ts
const hbStart = Date.now();
const hb = setInterval(() => {
  const s = Math.round((Date.now() - hbStart) / 1000);
  void query(
    `UPDATE dev_agent_runs SET activity = $2, updated_at = now()
      WHERE id = $1 AND status = 'running'`,
    [runId, `${label} is working · ${s}s elapsed · tool calls may be running`],
  ).catch(() => {});
}, 5000);
try {
  // …existing hermesChat/qwenChat + insertMessage + UPDATE done…
} catch {
  // …existing error path…
} finally {
  clearInterval(hb);
}
```

(`label` already varies by agent at this site — Qwen turns get a heartbeat for free. Wrap the existing try/catch bodies; the only additions are `hbStart`, `hb`, and the `finally`.)

**Site 2 — `lib/dev-agents.ts` `runHermesTurnTracked()` (~line 367):** identical pattern around the `hermesChat(...)` await, `label = "Hermes"`.

> **Stale-run check:** the heartbeat sets `updated_at = now()`, which keeps healthy long runs alive. Before shipping, open `failStaleRuns()` in `lib/dev-agents.ts` and confirm its staleness predicate is on `updated_at` (not `created_at`). If it's on `created_at`, **leave `failStaleRuns` alone** and note it in the PR — do not "fix" it as part of this feature.

**Chat-panel rendering** (identical to TodayFeed): while `pending`, show `{meta.label} is working · {elapsed}s` plus the mono `activity` line. For Claude, render `activity` split on newlines and show the **last 4 lines** in a stack (a net improvement over TodayFeed's single line; trivial: `activity.split("\n").slice(-4)`).

---

## 4. Live entity workbench

### 4.1 Entity references

```ts
// lib/workbench.ts (server-only; imports lib/db — never import runtime values from a client component)
export type EntityRef =
  | { kind: "lead"; slug: string }
  | { kind: "project"; slug: string }
  | { kind: "warranty"; id: string };   // warranty_claims.id
```

Resolution from a `TodayPriority.id` / `subject_work_item_id`. The synthetic-id formats come straight from `lib/today.ts` (`warranty:{id}`, `lead:{slug}`, `job:{slug}`, `compliance:…`, `schedule:…`, `all-clear`):

```ts
import { query, queryOne } from "@/lib/db";

/** Map a Today queue id (work_items uuid OR synthetic "lead:slug"/"warranty:{id}"/
 *  "job:slug"/…) to the entity the workbench should show. Null = nothing to show
 *  (compliance:/schedule:/all-clear ids, or an unlinked work item). */
export async function resolveEntityRef(subjectId: string): Promise<EntityRef | null> {
  if (subjectId.startsWith("lead:"))     return { kind: "lead", slug: subjectId.slice(5) };
  if (subjectId.startsWith("warranty:")) return { kind: "warranty", id: subjectId.slice(9) };
  if (subjectId.startsWith("job:"))      return { kind: "project", slug: subjectId.slice(4) };
  if (subjectId.includes(":"))           return null; // compliance:/schedule:/all-clear
  // Otherwise a work_items uuid — guard against malformed strings before querying.
  if (!/^[0-9a-f-]{36}$/i.test(subjectId)) return null;
  const row = await queryOne<{ lead_slug: string | null; project_slug: string | null }>(
    `SELECT l.slug AS lead_slug, p.slug AS project_slug
       FROM work_items w
       LEFT JOIN leads l    ON l.id = w.lead_id
       LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.id = $1`,
    [subjectId],
  );
  if (!row) return null;
  if (row.lead_slug)    return { kind: "lead", slug: row.lead_slug };
  if (row.project_slug) return { kind: "project", slug: row.project_slug };
  return null;
}
```

### 4.2 Snapshot shape

```ts
export interface WorkbenchEvent {
  /** Stable unique id across sources, e.g. "lead_activity:123", "receipt:<uuid>", "run:<uuid>". */
  id: string;
  source: "lead_activity" | "agent_receipt" | "agent_run";
  kind: string;          // lead_activity.kind | receipt_kind | run status
  summary: string;
  actor: string;
  createdAt: string;     // ISO
  when: string;          // relativeAge() label, computed server-side
}

export interface WorkbenchField { label: string; value: string; }

export interface WorkbenchSnapshot {
  ref: EntityRef;
  title: string;             // "Kowalski — kitchen remodel" / claim issue
  subtitle: string;          // stage/status line
  href: string;              // deep link: /leads/{slug} etc.
  fields: WorkbenchField[];  // the diffable header fields (fixed labels per kind — see below)
  openWorkItems: { id: string; title: string; status: string }[];
  events: WorkbenchEvent[];  // newest first, LIMIT 30
  fetchedAt: string;         // ISO, server time
}

export async function getWorkbenchSnapshot(ref: EntityRef): Promise<WorkbenchSnapshot | null>;
```

Fixed field sets (labels must be **stable strings** — the client diffs by label):

- **lead:** `Stage`, `Flag` (`flag_label ?? "—"`), `Last contact` (relative), `Value` (`value_display ?? "—"`), `Scope`, `Email`, `Phone`. (Columns verified: `leads.flag_label`, `leads.value_display` exist.)
- **project:** `Status`, `Stage label`, `Progress` (e.g. `"62%"`), `Contract`, `Collected`, `Target end`. (Money is dollars on projects — reuse whatever dollar formatter `lib/today.ts`/projects use.)
- **warranty:** `Project`, `Client`, `Acknowledged` (`"yes"/"no"`), `Ack deadline`, `Resolve deadline`, `Step`, `Resolved`.

Use `relativeAge(seconds)` from `lib/lead-activity.ts` for the `when` labels and any relative timestamps.

### 4.3 Unified event source: UNION, not a new table — decision

**Chosen: (a) read-time `UNION ALL` in the snapshot query.** Justification: (b) `agent_steps` (phase-7 plan) requires new DDL, new MCP write paths, and starts empty (no history). The UNION is read-only, needs zero DDL, is automatically populated by everything agents already do (`record_receipt`, `record_agent_run`, `logLeadActivity`), and the tables already carry the needed indexes. Volume is single-owner scale; a 3-way UNION with `LIMIT 30` is milliseconds. If phase-7 later adds `agent_steps`, it becomes a fourth UNION branch — this design doesn't block it.

Lead events query:

```sql
SELECT * FROM (
  SELECT 'lead_activity:' || a.id AS id, 'lead_activity' AS source, a.kind,
         a.summary, a.actor, a.created_at
    FROM lead_activity a
   WHERE a.lead_id = $1
  UNION ALL
  SELECT 'receipt:' || r.id, 'agent_receipt', r.receipt_kind,
         COALESCE(NULLIF(r.label, ''), r.receipt_kind), 'agent', r.created_at
    FROM agent_receipts r
    JOIN work_items w ON w.id = r.work_item_id
   WHERE w.lead_id = $1
  UNION ALL
  SELECT 'run:' || ar.id, 'agent_run', ar.status,
         COALESCE(NULLIF(ar.output_summary, ''), NULLIF(ar.input_summary, ''), ar.runtime_name),
         ar.runtime_name, ar.started_at
    FROM agent_runs ar
    JOIN work_items w ON w.id = ar.work_item_id
   WHERE w.lead_id = $1
) ev
ORDER BY ev.created_at DESC
LIMIT 30
```

- **project:** same three branches with `w.project_id = $1`; drop the direct `lead_activity` branch (projects have no lead_activity), but if `projects.lead_id` is set, add a branch on `lead_activity WHERE lead_id = (SELECT lead_id FROM projects WHERE id = $1)` so precon history shows.
- **warranty:** resolve `warranty_claims.project_id`; use the project branches with that project id, and prepend one synthetic event built in TS from the claim row (`kind: 'claim'`, summary = `issue`, createdAt = `opened_at`).

`openWorkItems`: `SELECT id, title, status FROM work_items WHERE (lead_id = $1 OR project_id = $1) AND status NOT IN ('done','cancelled') ORDER BY updated_at DESC LIMIT 10` (adapt the WHERE per kind).

### 4.4 Server action

```ts
// lib/actions/workbench.ts
"use server";
import { requireRole } from "@/lib/dal";
import { resolveEntityRef, getWorkbenchSnapshot, type WorkbenchSnapshot } from "@/lib/workbench";

export type WorkbenchResult =
  | { ok: true; snapshot: WorkbenchSnapshot }
  | { ok: true; snapshot: null }        // subject has no workbench entity
  | { ok: false; error: string };

/** Read-only. subjectId = a TodayPriority.id or dev_agent_runs.subject_work_item_id. */
export async function getWorkbenchAction(subjectId: string): Promise<WorkbenchResult> {
  await requireRole("owner");
  try {
    const ref = await resolveEntityRef(subjectId);
    if (!ref) return { ok: true, snapshot: null };
    const snapshot = await getWorkbenchSnapshot(ref);
    return { ok: true, snapshot };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

**This action performs zero writes.** No `revalidatePath`. Nothing else.

### 4.5 Client panel + polling/diffing

```tsx
// components/operator/WorkbenchPanel.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getWorkbenchAction } from "@/lib/actions/workbench";
import type { WorkbenchSnapshot, EntityRef } from "@/lib/workbench";   // type-only import: safe in client code

const ACTIVE_MS = 3000;   // a run is in flight
const IDLE_MS = 30000;    // focused but idle

function sameRef(a: EntityRef, b: EntityRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "warranty" && b.kind === "warranty") return a.id === b.id;
  return (a as { slug?: string }).slug === (b as { slug?: string }).slug;
}

const BADGE: Record<WorkbenchSnapshot["events"][number]["source"], string> = {
  lead_activity: "activity",
  agent_receipt: "receipt",
  agent_run: "run",
};

export function WorkbenchPanel({ subjectId, runActive }: { subjectId: string | null; runActive: boolean }) {
  const [snap, setSnap] = useState<WorkbenchSnapshot | null>(null);
  const [error, setError] = useState("");
  const [changedFields, setChangedFields] = useState<Set<string>>(new Set());
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const prev = useRef<WorkbenchSnapshot | null>(null);

  useEffect(() => {
    if (!subjectId) { setSnap(null); prev.current = null; return; }
    let cancelled = false;

    const tick = async () => {
      const r = await getWorkbenchAction(subjectId);
      if (cancelled) return;
      if (!r.ok) { setError(r.error); return; }
      setError("");
      const next = r.snapshot;
      if (next && prev.current && sameRef(prev.current.ref, next.ref)) {
        const prevVals = new Map(prev.current.fields.map((f) => [f.label, f.value]));
        setChangedFields(new Set(next.fields.filter((f) => prevVals.get(f.label) !== f.value).map((f) => f.label)));
        const prevIds = new Set(prev.current.events.map((e) => e.id));
        setNewEventIds(new Set(next.events.filter((e) => !prevIds.has(e.id)).map((e) => e.id)));
      } else {
        setChangedFields(new Set());
        setNewEventIds(new Set());
      }
      prev.current = next;
      setSnap(next);
    };

    void tick();
    const iv = setInterval(tick, runActive ? ACTIVE_MS : IDLE_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [subjectId, runActive]);

  if (!subjectId) return <Placeholder text="Hand a card to an agent — the record it touches shows here." />;
  if (error) return <Placeholder text={`⚠️ ${error}`} />;
  if (!snap) return <Placeholder text="No linked record for this item." />;

  return (
    <section className="flex max-h-[calc(100vh-160px)] flex-col overflow-hidden rounded-[10px] border border-rule bg-paper shadow-card">
      <div className="border-b border-rule px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${runActive ? "animate-pulse bg-ai" : "bg-ink-4"}`} />
          <Link href={snap.href} className="font-serif text-[15px] font-semibold text-ink hover:underline">
            {snap.title}
          </Link>
        </div>
        <div className="text-[11.5px] text-ink-3">{snap.subtitle}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5">
        {snap.fields.map((f) => (
          <div key={f.label} className={changedFields.has(f.label) ? "rounded bg-ai-soft transition-colors" : ""}>
            <div className="font-mono text-[9.5px] uppercase tracking-wide text-ink-4">{f.label}</div>
            <div className="text-[12.5px] text-ink">{f.value}</div>
          </div>
        ))}
      </div>

      {snap.openWorkItems.length > 0 && (
        <div className="border-t border-rule px-4 py-2 text-[11.5px] text-ink-2">
          {snap.openWorkItems.map((w) => (
            <div key={w.id} className="truncate">• {w.title} <span className="text-ink-4">({w.status})</span></div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto border-t border-rule px-4 py-2">
        {snap.events.map((e) => (
          <div key={e.id} className={`flex gap-2 py-1 text-[12px] ${newEventIds.has(e.id) ? "rounded bg-ai-soft" : ""}`}>
            <span className="w-14 flex-none font-mono text-[10px] text-ink-4">{e.when}</span>
            <span className="flex-none font-mono text-[10px] text-ink-3">{BADGE[e.source]}</span>
            <span className="text-ink-2">{e.summary}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <section className="flex min-h-[200px] items-center justify-center rounded-[10px] border border-dashed border-rule bg-paper p-6 text-center text-[12.5px] text-ink-3">
      {text}
    </section>
  );
}
```

The "receipt: email draft created" moment Joe wants comes from the `agent_receipt` branch lighting up with `bg-ai-soft` within ≤3s of Hermes calling `record_receipt`.

> Tailwind class names above (`bg-ai`, `bg-ai-soft`, `text-ink`, `border-rule`, `shadow-card`, etc.) are the app's design tokens. If any doesn't exist, grep `components/today/*.tsx` for the equivalent and match it — do not invent new tokens.

---

## 5. DB changes

**None. Zero DDL.** Everything reads existing tables (`work_items`, `leads`, `projects`, `warranty_claims`, `lead_activity`, `agent_receipts`, `agent_runs`, `dev_agent_runs`, `ai_conversations`, `ai_messages`) and writes only through existing paths (`sendMessageAction`, the queue actions, and the heartbeat `UPDATE dev_agent_runs SET activity …` on an existing column).

If, during Phase 3, `EXPLAIN ANALYZE` on the lead UNION shows a seq scan on `lead_activity` (unlikely — it's joined on `lead_id`), the **only** permitted DDL is:

```sql
CREATE INDEX IF NOT EXISTS idx_lead_activity_lead ON lead_activity(lead_id, created_at DESC);
```

appended idempotently to `db/schema.sql` and applied with `psql "$DATABASE_URL" -f db/schema.sql`. Nothing else.

---

## 6. Phases

Conventions for every phase:

- Dev verification runs on a **non-prod port**: `npm run dev -- --port 3018`. **Never** run `npm run build` or touch the systemd service (prod is `next start` on :3017; a build while it's live breaks the site).
- Static checks that must pass before a phase is "done": `npx tsc --noEmit` and `npm run lint`.
- Log in as Joe (owner) in the dev instance; every new server action starts with `await requireRole("owner");`.

### Phase 0 — Demo (no app code changes)

Goal: show Joe the concept before building.

1. **Static mockup:** one self-contained HTML file at `docs/reference/operator-console-mock.html` (the `docs/reference/` dir already exists) — no build step, open directly in a browser. Three panels matching §1.3, including a scripted "live" moment: a "▶ simulate run" button that, over ~10 seconds, (a) appends fake activity lines to the chat and ticks a `Hermes is working · Ns` counter, (b) flashes the lead's `Flag` field from "Needs reply" to "—", and (c) prepends a highlighted receipt row ("receipt: email draft created — Kowalski follow-up"). Use the app's palette loosely (paper background, ink text, one accent) — it's a sketch, not a pixel spec.
2. **Walkthrough script** (in the mock's header comment): (1) open mock → queue narration visible; (2) point at card #2's "Have Hermes do it"; (3) press "▶ simulate run"; (4) narrate the three simultaneous updates: chat heartbeat, workbench field flash, receipt row.
3. Optional live-data teaser (skippable): run the real queue query read-only from `psql` and paste Joe's actual titles into the mock.

**Done when:** the HTML file opens from disk, the simulate button plays the sequence, and Joe has said "yes, build it" (or adjusted the layout). `git status` shows only the new mock file under `docs/` — no source files changed.

### Phase 1 — Route, layout, queue rail, narration (read-only console)

Create:
- `app/operator/page.tsx` (copy structure from `app/today/page.tsx`: force-dynamic, `getTodayData()`, `<Shell breadcrumb="Operator">`, render `OperatorBody`).
- `components/operator/OperatorBody.tsx` (server): computes `aiContext = operatorContext(data)`, renders `TodayQueueProvider` wrapping `OperatorGrid`.
- `components/operator/OperatorGrid.tsx` (client): §1.3 grid + §1.4 state; this phase the center panel is a static card showing `queueNarration(...)` output + a disabled composer; right panel is a `Placeholder`.
- `components/operator/QueueRail.tsx` (client): `useTodayQueue()`, renders `PriorityCard` list (hand-off no-ops this phase: `onHandOff={() => {}}`) + `WaitingList`.
- `lib/operator-narration.ts` (§2.1).

Modify:
- `lib/page-context.ts`: add `operatorContext` (§2.2).
- `components/shell/Sidebar.tsx`: add the Operator nav item (§1.1).

**Done when:**
- `npx tsc --noEmit` and `npm run lint` pass.
- On :3018, `/operator` renders three panels at ≥1280px, two at ~1100px, one column at ~500px (browser devtools responsive mode).
- The queue rail shows the same 5 priorities as `/today` (open both, compare titles).
- Clicking "Mark done" on a checkable card removes it and backfills (proves `TodayQueueProvider` reuse works).
- The narration bubble lists the same items with `#n` ranks.
- `/today` is unchanged (`git diff --stat` shows no files under `components/today/` or `app/today/`).

### Phase 2 — Chat panel + hand-offs + Hermes heartbeat

Create:
- `components/operator/OperatorChat.tsx` (client): port from `components/today/TodayFeed.tsx` — agent picker (`AGENT_ORDER`/`AGENT_META` from `lib/dev-agents-meta.ts`), `newConversationAction`/`sendMessageAction`/`pollAgentRun` mechanics, `pollTurn` (~lines 42–66), `handOff` (~lines 163–205 **minus** the Claude-redirect — Claude runs in place per §2.3), composer, elapsed timer, multi-line Claude activity (§3.3). New props: `aiContext: string`, `onRunStart(run: ActiveRun)`, `onRunEnd()`. Call `onRunStart` whenever a pending run begins (with `subjectId` for hand-offs, null for free text) and `onRunEnd` when `pollTurn` resolves. After ANY resolved turn call `useTodayQueue().refresh()`.

Modify:
- `components/operator/OperatorGrid.tsx`: replace the static center panel; wire `QueueRail`'s `onHandOff` through to the chat's `handOff` (simplest: `const handOffRef = useRef<(p: TodayPriority, kind: "do" | "prep") => void>()`; `OperatorChat` assigns `handOffRef.current`; `QueueRail` calls `handOffRef.current?.(p, kind)`).
- `lib/actions/ai-chat.ts` + `lib/dev-agents.ts`: heartbeat blocks (§3.3, both sites, with `finally { clearInterval(hb) }`).

**Done when:**
- From `/operator`, asking Qwen a question returns an answer in the transcript.
- "Have Hermes do it" on a chat-lane card: transcript shows the hand-off line, the working line ticks (`Hermes is working · Ns elapsed…` updates at least every ~7s — proves the heartbeat), and on completion the queue refreshes (card checks off if Hermes closed it).
- A Claude turn started from `/operator` shows multi-line activity ("Reading …") and completes in place **without** navigating to `/ai`.
- `dev_agent_runs` rows for hand-offs carry `subject_work_item_id` (`psql`: `SELECT agent, status, subject_work_item_id, activity FROM dev_agent_runs ORDER BY created_at DESC LIMIT 5;`).
- **Regression:** the approval-ping path still works (heartbeat touched `runHermesTurnTracked`) — approve any agent-owned work item and confirm a run row appears and resolves.

### Phase 3 — Workbench (the live entity panel)

Create:
- `lib/workbench.ts`: `EntityRef`, `WorkbenchEvent`, `WorkbenchSnapshot`, `resolveEntityRef`, `getWorkbenchSnapshot` (§4.1–4.3; reuse `relativeAge` from `lib/lead-activity.ts` for `when`).
- `lib/actions/workbench.ts`: `getWorkbenchAction` (§4.4).
- `components/operator/WorkbenchPanel.tsx` (§4.5).

Modify:
- `components/operator/OperatorGrid.tsx`: mount `<WorkbenchPanel subjectId={focusedSubjectId} runActive={!!activeRun} />`; set `focusedSubjectId` on hand-off start; add the small "Inspect" chip under each card in `QueueRail` (§1.4).

**Done when:**
- Clicking "Inspect" on a lead-linked card populates the panel with the lead's fields and a timeline matching the Activity tab on `/leads/{slug}`.
- With the panel focused on a lead, run in `psql`: `INSERT INTO lead_activity (lead_id, kind, summary, actor) SELECT id, 'note', 'workbench poll test', 'test' FROM leads WHERE slug = '<slug>';` → the row appears highlighted within ≤30s idle / ≤3s if a run is active. Delete the test row after.
- `UPDATE leads SET flag_label = 'poll test' WHERE slug = '<slug>';` → the Flag field flashes on next poll. Revert it.
- End-to-end: "Have Hermes do it" on a chat-lane lead card → while the run is live, at least one receipt/run event appears in the workbench before the chat answer lands.
- Non-entity ids (a compliance card) show the calm "no linked record" state — no error, no crash.
- `getWorkbenchAction` / `lib/workbench.ts` contain **no** INSERT/UPDATE/DELETE (grep to confirm).

### Phase 4 — Polish + multi-item runner

- "Run the chat lane" sequential runner (§2.3.3) with "Stop after current".
- Persist last-used agent + last-focused subject in `sessionStorage` (keys `operator:agent`, `operator:subject`) so a reload restores the view.
- Cost display on Claude replies (render `costUsd` like `/ai` does).
- Optional: CommandBar JumpRow entry for `/operator`.

**Done when:** the runner completes 2+ chat-lane items strictly sequentially (verify run rows don't overlap in time); Stop halts after the in-flight item; reload restores agent + workbench focus; tsc/lint pass.

### Deploy note (for Joe, not the builder)

The builder verifies on :3018 dev only. Joe deploys by his normal flow (build + restart the systemd service during a quiet window). Nothing here requires schema application unless the optional Phase-3 index was added.

---

## 7. Guardrails — what the builder MUST NOT do

1. **`work_items.promoted_at` is app-owned.** Never write it outside the existing paths in `lib/today.ts` / `lib/actions/today.ts`; never expose it to a model or MCP. This feature adds NO new writers of it.
2. **Agents never send anything client-facing.** The console adds no send paths. Directives stay exactly `doItDirective` / `prepDirective` from `lib/today-directives.ts` (drafts + `submit_draft_for_approval` only). Do not "improve" the directive text to permit sending.
3. **Every new server action begins with `await requireRole("owner");`** (`getWorkbenchAction`, and any others). No exceptions; no new API routes without auth.
4. **The app renders all interactive affordances.** Do NOT parse model replies for actions, render model-suggested buttons, or auto-execute anything a model asks for in text. The only actions are the deterministic chips/buttons specified here, verified server-side by the existing actions.
5. **No model/MCP writes from the workbench.** `getWorkbenchAction` and everything in `lib/workbench.ts` is strictly read-only SQL.
6. **Do not modify** `components/today/*`, `app/today/*`, `mcp/sjcos-mcp.mjs`, or `scripts/run-claude-agent.mjs`. The only existing files modified in the whole plan: `components/shell/Sidebar.tsx`, `lib/page-context.ts`, `lib/actions/ai-chat.ts` (heartbeat), `lib/dev-agents.ts` (heartbeat). Anything beyond that list needs Joe's sign-off first.
7. **No `npm run build`, no prod restarts, no systemd changes.** Prod serves on :3017; all verification is `npm run dev -- --port 3018`.
8. **No new tables/columns** except the single optional index in §5.
9. **No SSE/websocket/streaming endpoints.** Polling only, at the intervals specified (2s runs, 3s active workbench, 30s idle).
10. **Client components must not import server runtime values:** `lib/workbench.ts` types via `import type` only; narration lives in a pure module with no db imports (pattern: `lib/today-directives.ts` / `lib/dev-agents-meta.ts`).

## 8. Out of scope

- Phase-7 autonomous loop: `agent_steps` table, propose→approve→execute catalog (`docs/phase-7-autonomous-loop-plan.md`).
- Model-emitted action chips (```` ```sjcos-actions ```` parsing — `docs/today-interactive-plan.md` Phase 7).
- Hermes gateway/MCP changes of any kind (including a `report_progress` breadcrumb tool — §3.2 option B).
- SSE/websocket transport; streaming tokens into the chat.
- Replacing or redirecting `/today` or `/ai` (both stay; `/operator` is additive).
- Mobile-native anything; notification pings; multi-user roles.
- Editing entities from the workbench (it is a viewer; edits happen on the entity's own page via `href`).

## 9. Milestone acceptance (the "especially cool" demo, end state)

On `/operator`: Joe clicks "Have Hermes do it" on "Reply to Kowalski estimate question." Within seconds the chat shows the hand-off + a ticking heartbeat; the workbench snaps to the Kowalski lead; during the run a highlighted `receipt: email draft created` row appears in the timeline and the `Flag` field flashes when Hermes's work clears it; when the answer lands, the card checks off the queue and the next backlog item promotes in — all without a page reload.

---

## Critical files for implementation

- `components/today/TodayFeed.tsx` — the chat mechanics being ported (poll loop `pollTurn` ~L42, `handOff` ~L163, directives wiring).
- `components/today/TodayQueueContext.tsx` — the queue provider reused unchanged.
- `components/today/PriorityCard.tsx` / `WaitingList.tsx` — reused unchanged.
- `lib/actions/ai-chat.ts` — `sendMessageAction` (send path + the Hermes/Qwen background block that gets the heartbeat).
- `lib/dev-agents.ts` — `runHermesTurnTracked` (second heartbeat site), `hermesChat`, `startClaudeRun`, run-row lifecycle the console polls; `notifyAgentOwner` (approval-ping regression surface).
- `lib/actions/dev-agents.ts` — `pollAgentRun`.
- `lib/dev-agents-meta.ts` — `DevAgent`, `AGENT_META`, `AGENT_ORDER`.
- `lib/today.ts` — `getTodayData`, `getQueueSnapshot`, `TodayPriority`, and the synthetic-id formats the resolver honors.
- `lib/page-context.ts` — `todayContext` (~L86), site of new `operatorContext`.
- `lib/lead-activity.ts` — `getLeadActivity`, `relativeAge`.
- `lib/db.ts` — `query` (~L20), `queryOne` (~L28).
- `lib/dal.ts` — `requireRole` (~L63).
- `db/schema.sql` — table shapes (`work_items`, `leads`, `agent_receipts`, `agent_runs`, `dev_agent_runs`, `lead_activity`, `warranty_claims`).
- `app/today/page.tsx`, `components/today/TodayBody.tsx`, `components/shell/Shell.tsx`, `components/shell/Sidebar.tsx` — the page/shell/nav pattern to mirror.
