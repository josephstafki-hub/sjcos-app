# Phase 7 — Autonomous task loop (A2) — mini-plan

**Status: PLAN ONLY, not built.** This feature has the AI *take actions*, not just
answer — so it needs Joe's sign-off on the guardrails before any code lands.
Drafted 2026-07-02.

## Goal (roadmap A2)
On `/today`, the AI proposes the single highest-value next action, Joe approves
(or edits/skips), it executes, then proposes the next — a propose → approve →
execute → repeat loop over the real business state. NOT a fully-autonomous agent
that acts unattended.

## Non-negotiable guardrails (the reason this needs review)
1. **Owner-only, human-in-the-loop.** Every action requires an explicit Approve
   click. No step runs without it. No background/cron autonomy in v1.
2. **Nothing outbound without a second confirm.** Any action that leaves the OS
   (email a client/sub, send an invoice, e-sign request) shows a full preview
   and a distinct "Send" confirm — never one-click from a suggestion.
3. **Whitelisted action types only.** The loop can only invoke a fixed catalog
   of existing, already-owner-gated server actions (below). No free-form code,
   no raw SQL, no shell.
4. **Full audit trail.** Every proposal + decision + execution is logged
   (`agent_steps` table) with what ran, inputs, and outcome.
5. **Dry-run first.** Each proposal renders exactly what will happen (target
   record, drafted text, amounts) before Approve. The model proposes; the
   deterministic action executes.
6. **Reversible / low-blast-radius default.** Destructive or high-liability
   actions (delete, collections/lien, payments) are excluded from the catalog.

## Action catalog (reuse existing server actions — nothing new to execute)
Internal / safe (Approve → run):
- Draft a reply to the oldest waiting lead/thread (`draftReplyForThread`) — draft only.
- Re-score / triage a lead (`rescoreLead`).
- Create a schedule block / from template (`createScheduleBlock`, `generateScheduleFromTemplate`).
- Draft a rough estimate (`draftEstimate`) — draft only.
- Add a follow-up task to a lead (`addLeadTask`).
- Advance a lead/project stage (`advanceLeadStage` / `advanceProjectStatus`) — with preview.

Outbound (Approve → preview → explicit Send):
- Send a drafted reply / estimate / weekly status (existing send actions).

Excluded from v1: delete anything, demand letter / lien package, invoice send
without preview, anything touching money owed, user management.

## UX
`/today` gets an "AI next action" card:
- Model picks ONE next action from the catalog given the day's real signals
  (flagged leads, waiting threads, today's schedule, urgent compliance) — reuse
  the existing `getTodayData` inputs + `ai.suggest`.
- Card shows: the action, why, and the dry-run preview.
- Buttons: **Approve** (runs it, logs, proposes next) · **Edit** (tweak inputs) ·
  **Skip** (logs skip, proposes next) · **Stop** (ends the loop).
- A running list of what was done this session sits beneath it.

## Data model
`agent_steps` (id, created_at, action_type, target_ref, proposed jsonb,
decision text [approved|skipped|edited], outcome text, actor). Append-only audit.
No other new tables — execution reuses existing actions.

## Phasing
- **P1 — advisory only.** Propose + preview + log; Approve just marks done (no
  execution). Proves the ranking + UX with zero risk. *(Recommended first drop.)*
- **P2 — execute internal/safe actions** from the catalog on Approve.
- **P3 — outbound actions** with the preview→Send double-confirm.

## Open questions for Joe
1. Start at **P1 advisory-only** (safe, ship first), or go straight to P2?
2. Which actions belong in the auto-executable catalog vs. always preview-only?
3. Should the loop ever run unattended (e.g. a morning batch that queues
   proposals for review), or strictly interactive on `/today`?
4. Any action types you want explicitly **banned** from the loop entirely?

## Reuse
`getTodayData` (signals), `ai.suggest`/`ai.ask` (ranking + narrative), all the
existing owner-gated `lib/actions/*` (execution), `lib/notify` (audit → feed).
No new external dependency.
