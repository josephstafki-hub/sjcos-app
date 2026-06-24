# Functional audit — what's still demo vs. real (2026-06-19)

Joe's call: **do not deploy until the app is completely functional.** This is a
page-by-page audit of what currently works vs. what is showcase/read-only. Source
of truth for the "make it real" round. Each gap lists the current state and what
"done" means.

Legend: ✅ real · 🟡 partial · ❌ demo/read-only.

---

## A. Project detail (`/projects/[slug]`) — the biggest concentration of gaps

Tabs: Overview · Floor · Mood · Selections · Schedule · Subs · Files · Money ·
Daily log · Comms · Punch. The project opens on its lifecycle stage's tool tab.

1. **Overview** ✅ real (audit A1) — cards now click through to their tab via a
   `TabNavContext` that `ProjectTabs` provides (header band is passed into
   ProjectTabs so it sits inside the provider): Milestones / This-week → Schedule,
   Latest-log → Daily log, Money/Subs/Files → their tabs (a "View →" affordance);
   header "Log update" → Daily log, "Send invoice" → Money. The weekly-status
   email "Review" fake is now **`WeeklyStatusSend`** — emails the AI draft to the
   client via Gmail (`sendWeeklyStatusEmail`, owner-gated, MONEY/Update notif).
   Pulse/status stay AI text. (The "…" overflow stays an honest `AckButton`.)

2. **Floor** ✅ real (S5E: image/PDF upload, versioning, notes). Full CAD editor
   is the deferred floor-planner epic — confirm it stays deferred for v1.

3. **Mood** ✅ real (S5D: per-room image boards).

4. **Selections** ✅ real (audit A4) — selections grouped into **budgeted
   sections (rooms)**: `project_sections` table (name + budget) + `section_id` /
   `price` on `project_selections`. Owner manages sections (add/edit/remove, FK
   `ON DELETE SET NULL` so picks survive into an "Ungrouped" bucket), adds/edits
   selections with a price, pushes drafts. Approved picks roll up **spent /
   remaining** per section + a grand total; the client portal shows the running
   budget ("Budget so far · $X of $Y · $Z remaining") and approves/declines per
   item. (Qwen-suggested options/auto-pricing is a later enhancement.)

5. **Schedule** ✅ real (project-scoped `schedule_blocks` via `project_id`;
   add/remove blocks; they surface on the cross-project /schedule overview too).
   Qwen auto-place is a later enhancement (manual add/remove done).

6. **Subs** ✅ real — new `project_subs` join table; assign from roster /
   remove, COI status chip + tel/mailto contact per sub.

7. **Files** ✅ real — `getProjectFiles` (project_key = slug) + project-scoped
   `uploadProjectFile` (reuses `storeUpload`); upload + per-row download via
   `/api/files/[id]`. Curated names kept muted as a Drive-mirror-pending index.

8. **Money / Invoices** ✅ real (audit A8) — `MoneyPanel`: New invoice (Qwen
   draft **or** "Start blank" — no slow inference needed for any project), **edit
   draft line items** (add/remove/edit rows + live total via `updateInvoice`),
   delete draft (`deleteInvoice`), Send → Gmail, Mark paid, retainer collect/
   apply. Every invoice shows its line breakdown. The **client portal** now lists
   their sent + paid invoices (number, milestone, amount, line items, due/paid
   status) — drafts stay internal. (Streaming the Qwen draft + client "mark
   received" deferred — the blank path covers the slowness; payment confirmation
   stays owner-driven.)

9. **Daily log** ✅ real — `daily_logs.project_id` (global /schedule log stays
   `project_id IS NULL` via partial unique indexes); `getProjectDailyLogs` +
   `addProjectDailyLog` (upsert per day). Dated composer + history. (Photo
   attachments on a log entry still TODO — `photos` is a count today.)

10. **Comms** ✅ real — wired to the live `portal:<slug>` thread (same store the
    client sees on their dashboard) via `sendProjectMessage` + `ProjectComms`.

11. **Punch** ✅ real — add (`addPunchItem`) / remove (`deletePunchItem`) on top
    of the done toggle. Edit-in-place still TODO (low priority).

---

## B. Ask-Qwen — does not actually answer

- **Ctrl+K / Ctrl+J** both open the `CommandBar`, which routes the question
  through `ai.suggest({ kind: "ai-thread" })` — a method built to emit canned
  analysis **bullets**, not answer a free-form question. Result: it returns
  generic Henderson bullet points regardless of what you typed (and falls back to
  the mock when Ollama is cold). ❌
  - **Done =** a real free-form `ai.ask` / chat method (Ollama `/api/chat`,
    streamed), the CommandBar shows a genuine streamed answer, page-context kept.

- **`/ai` page** ❌ static demo: a "context loaded" rail + a canned thread +
  `AckButton`s, **no input box.** **Done =** a real chat surface (input +
  streamed replies + history), or fold it into the upgraded CommandBar.

---

## C. App-wide showcase controls (`AckButton` = looks clickable, does nothing)

These each capture intent then revert — no backend. Triaged (audit item 5):
**wired** the ones with infra, **kept honest** the ones that map to a subsystem
explicitly deferred this round.

- ✅ **Project Overview:** weekly-status email is now a real Gmail send
  (`WeeklyStatusSend`); header Log-update/Send-invoice route to their tabs.
- ✅ **Client portal:** the fake "Decide" card is replaced by a real
  pending-selections summary (approve/decline below is real).
- ✅ **Sub portal** (logging + invoice): **Log your day** is a real composer
  (note + optional photo → `sub_logs`, notifies Joe) with a recent-logs history;
  **Submit final invoice** is real (amount + note → `sub_invoices`, notifies
  Joe) with a submitted-invoices list. Both scope to the sub's current project
  (`project_subs`). Joe reviews them on the sub-detail **Jobs** tab + in
  Notifications. Photo-from-Joe stays an honest AckButton; voice note dropped
  (defers regardless).
- ⏸️ **Kept honest (deferred subsystems):** Schedule "Auto-log from photos" +
  Compliance "Auto-collect docs" (Qwen is text-only, no vision; Drive auto-
  collect deferred), Files "Share" (Drive), `/ai` action chips, Subs-detail
  "Assign to job" (needs a project picker), Leads-detail "Run triage again"
  (triage already auto-streams), Warranty AI claim action. `AckButton` is the
  honest representation for these until their subsystem lands.

---

## D. Placeholder screens — scope decision needed

Historically excluded from this round: **/site**, **/newsletter**, **/books**,
and the **full floor-planner** (CAD). "Completely functional before deploy" may
pull some of these in. **Need Joe's call:** in scope for v1, or stay deferred?

---

## What's already solid (so we don't re-touch)

Inbox (real Gmail read/send/labels/threads), Notifications (event-driven),
Compliance/Warranty resolve, Leads lifecycle + rough-estimate email + convert-to-
project, Catalog CRUD, global Files upload, global Schedule overview (S6), Team
chat + DMs, Settings (rationalized S6), Auth + portals identity-scoping, portal
Money + messaging (S6), Today (real metrics + reprioritize).

---

## Build order / progress

1. ✅ **Qwen actually answers** (B) — `ai.ask` + real /ai chat (commit ebeccd1).
2. ✅ **Project tabs to real** (A) — Punch add/remove (769d98f), Files upload
   (e540e92), Comms composer (221e0aa), Schedule project-scoped (44d8b34), Subs
   management (6e7e056), Daily-log add+history (d9350a9). Remaining tab polish:
   punch edit-in-place, daily-log photo attachments (low priority).
3. ✅ **Selections rooms/sections + budgets** (A4) — `project_sections` table +
   `section_id`/`price`; grouped budgeted board, per-section + grand roll-up,
   edit selection, client sees running total/remaining.
4. ✅ **Money polish** (A8) — editable draft line items + delete + blank-create
   path; client portal lists their sent/paid invoices with line breakdown.
5. ✅ **Overview wiring + AckButton cleanup** (A1, C) — Overview cards/header
   click through to tabs (`TabNavContext`), weekly-status email real
   (`WeeklyStatusSend` → Gmail), client-portal "Decide" fake replaced;
   remaining AckButtons triaged (kept honest for deferred subsystems; sub-portal
   logging/invoice left for a focused pass).
6. ✅ **Sub-portal logging + invoice submission** — real `sub_logs` /
   `sub_invoices` (composer + submit + Joe notification + owner review on
   sub-detail Jobs tab).
7. **Placeholder screens** (D) — `/site`, `/newsletter`, `/books`, full
   floor-planner CAD. Still deferred by default. **NEXT — needs Joe's scope
   call** before Phase 8 deploy.
</content>
