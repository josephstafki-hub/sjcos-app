# SJC OS — review punch list

> **📌 Historical snapshot (2026-06-18/19) — closed.** Every item on this list
> was fixed before the 2026-06-26 deploy. Kept for the root-cause notes (the
> AI-streaming fix, the double-submit fix, the real nav counts), which still
> describe how those parts of the app work. Not a live backlog.

Joe's page-by-page review (started 2026-06-18). Headlines captured here as he
reviewed; detail added per page. Status: ⬜ todo · 🟡 doing · ✅ done.

## Global
- ✅ **Site is slow.** Root cause: AI pages blocked SSR on local Qwen (CPU,
  10–20s/call). Fixed via `components/ui/AiStream.tsx` (Suspense streaming) —
  the AI bubbles now stream in while the shell paints instantly. TTFB:
  /today 19.4s→0.08s, /compliance 12.3s→0.02s, /warranty 8.5s→0.02s,
  /schedule 4.3s→0.02s. (Pattern: lib returns the AI *input* + a separate
  `getXSummary()`; page wraps it in `<AiStream load={…}/>`.) **Remaining AI
  pages to convert if they feel slow: /search, /ai** (/cmdk already streams via
  TodayBody).
- ✅ **Create dialogs double-submit.** Shared `components/ui/SubmitButton.tsx`
  (useFormStatus disables while pending) + close-on-success on all New* modals.

## Topbar / nav counts
- ✅ Inbox nav item → real unread **email** count (Gmail INBOX threadsUnread).
- ✅ Team chat nav item → real unread count.
- ✅ Leads nav item → real count (flag_kind='flag'). (`lib/actions/nav.ts`.)

## /today
- ✅ AI summary, today's schedule, "waiting on me" now derive from DB
  (`getTodayData`), and "Reprioritize" runs a real AI reorder.

## /inbox
- ✅ Load **all** emails — pagination / load-more (`fetchThreadPage`).
- ✅ Labels: rail shows all labels.
- ✅ star toggle + ⋮ menu built (live after deploy re-consent — F).

## /chat (team chat)
- ✅ Real chat: `chat_messages`+`chat_reads` tables, send, @claude, per-channel
  unread, read-clearing (DMs still display-only).

## /leads
- ✅ Delete a lead (owner-gated, confirm).
- ✅ (double-submit on create → see Global.)

## /projects
- ✅ Filters work (All open/Active/Pre-con/Closeout).
- 🔶 Each project detail — partial. **Punch tab is now real** (`project_punch`
  table; checkboxes toggle/persist via `setPunchDone`). Status advance + progress
  already real. Remaining showcase tabs are tied to deferred subsystems:
  Selections (no table yet), Comms (→ email/chat), Money/Draw schedule
  (→ accounting/QuickBooks, deferred-forever this round), Daily log (→ per-project
  daily_logs link). Header "Log update"/"Send invoice" are still AckButtons.

## /schedule
- ✅ The per-day "+" on the week strip now opens the block modal prefilled to
  that day's date (`ScheduleBlockModal`, reused by the header "Block" button).
- ✅ Daily-log cards are clickable (`LogCard`) and open the full log entry.

## /subs
- 🔶 Sub detail — partial. **Notes tab is now real** (editable `subs.notes`,
  persisted via `setSubNotes`). Card data (rate/COI/rating/contact, Call/Chat)
  was already real. Reliability metrics / recent jobs / paperwork remain curated
  showcase — they need a project↔sub assignment join (no table yet) to derive
  real job history; folded into the deferred ops-data work.

## /files
- ✅ **Real uploads** (Joe chose server/DB over Drive mirror). `files` table gains
  `storage_path`+`mime_type`; blobs stored under `uploads/` (gitignored).
  `uploadFile` server action (owner-gated, 25MB) + `GET /api/files/[id]` serve
  route; Upload button + Open/Download links are live. Showcase rows keep the
  preview overlay. Drive mirror still deferred.

## /catalog
- ✅ **Real catalog** (Joe chose table + CRUD). New `catalog_items` table
  (seeded), DB-backed grid with real material/supplier counts; owner adds via the
  Add-material modal (`createMaterial`) and removes via a per-card trash control
  (`deleteMaterial`). "Browser capture" (supplier scrape) stays deferred.

---

**First page-by-page pass addressed.** Detail-page tabs tied to deferred
subsystems (project Money/Comms/Selections, sub reliability/job-history) remain
showcase by design — they need accounting / email / a project↔sub join, out of
scope this round.

---

## Review round 2 (2026-06-18, live preview)

- ✅ **AI labels say "Qwen"** where the assistant is Qwen (`lib/ai-name.ts`,
  `NEXT_PUBLIC_AI_PROVIDER`). Automate page stays "Claude" (it uses the Claude CLI).
- ✅ **/today items clickable** — priorities, today's schedule, week-day cells,
  and "waiting on me" link to their source record.
- ✅ **/leads Call** reveals the number (desktop-usable popover + copy);
  **Email** opens the in-app Gmail composer prefilled to the lead (not mailto:).
- ✅ **Lead photos are real** — owner uploads images (stored like files, tagged
  lead_slug), rendered for real in the grid + lightbox.
- ✅ **"Notifications take forever"** root cause fixed: clicking a notification
  opened a lead/project that blocked SSR on Qwen (11s/23s). Streamed both
  (getLeadTriage / getProjectWeeklyStatus) → TTFB ~instant. **+ click marks the
  notification read** (persists on return).
- 🔶 **/inbox**: ✅ **email bodies now render rich HTML with images** — new
  `fetchThreadHtml` (lib/gmail.ts) returns the latest message's sanitized HTML
  (`sanitize-html`: drops scripts/handlers/unknown schemes, keeps formatting +
  http(s)/data images, forces `target=_blank rel=noopener`) with `cid:` inline
  images (signature logos) resolved to data URIs; `getThreadHtmlAction` fetches
  it lazily on thread open; `ReaderBody` renders it for the latest message
  (plain-text paragraphs remain the fallback + cover earlier messages).
  ✅ **clicking a label now server-fetches that label's mail, paginated** —
  `fetchThreadPage(max,token,labelId)` passes `labelIds:[id]` to Gmail;
  `loadLabelInbox`/`loadLabelInboxAction` build a label-scoped page;
  `InboxClient` holds label-scoped state with its own "Load more" token (the
  old client filter stays as the instant fallback while the fetch lands). A
  label with more mail than the loaded inbox window now shows in full.
  Remaining: label create/delete (**label write needs the gmail.modify
  re-consent — deferred to deploy**).
- 🔶 **/chat**: ✅ **DMs are now real send/persist conversations** — modeled as
  `dm:<sub-slug>` channel keys in the existing `chat_messages`/`chat_reads`
  tables (no new table). `getChatData` derives DM partners from the subs Joe
  coordinates with most (favourites + open jobs first), builds a `ChannelView`
  per DM, and computes per-DM unread; `ChatClient` makes the Direct rail rows
  clickable/selectable with unread badges and read-clearing; sending posts to
  the DM key via the existing `sendChatMessage` (@claude still works inside a
  DM). Seeded showcase transcripts for `dm:marco` + `dm:tomas`.
- ✅ **Add/remove channel participants** — new `chat_members` table (channel_key
  + sub_slug; owner + AI are implicit). `getChatData` resolves per-channel
  members from the sub roster and builds the avatar stack from them;
  `addChannelMember`/`removeChannelMember` (owner-gated) persist changes; the
  channel header has a manage-participants popover (current members with remove,
  plus the remaining subs to add). DMs have no member editor. Seeded sensible
  memberships per channel/room.

Next milestone after round 2: **Phase 8 deploy.**

---

## Review round 3 (2026-06-18) — extensive page-by-page punch list

Approved 6-session plan: `~/.claude/plans/serene-skipping-kernighan.md`.
Scope decisions: design tools = pragmatic MVP; money = native invoices+retainers;
Qwen page-awareness = structured text context; sequence = quick wins first.

### Session 1 — quick wins ✅ DONE
- ✅ **Today**: removed duplicate date (kept Topbar breadcrumb); greeting now
  reflects time of day (morning/afternoon/evening); week-strip day cells expand
  an inline day summary (schedule blocks) instead of linking to /schedule;
  "Waiting on me" is an expandable list (Show all). Header chips were already
  live (A/R, flagged leads, active jobs).
- ✅ **Search removed entirely** — Topbar input, sidebar link, /search +
  /api/search routes, lib/search.ts all deleted (it was static demo).
- ✅ **Single Qwen entry** — removed Topbar "Ask" button; CommandBar (⌘K) is now
  a real Ask-Qwen prompt (askQwen action; page-context wiring deferred to S4);
  bottom pill relabeled "Ask Qwen".
- ✅ **Settings gear removed** from sidebar (settings via the profile card).
- ✅ **Compliance**: filter chips really filter (ComplianceClient); timeline rows
  expand to detail + resolve.
- ✅ **Warranty**: active claims open into expandable detail + real Resolve
  (resolveWarrantyClaim).
- ✅ **Files**: year-folder tree rows are real expand/collapse toggles.
- ✅ **Portals**: owner-only "Return to SJC OS" link in both portal headers.
- ✅ **Catalog**: removed "Browser capture" button (→ Chrome extension).
- ✅ Lead delete already had a native confirm() double-check.

### Session 2 — lead lifecycle ✅ DONE
- ✅ **5-stage pipeline** — intake/qualified/discovery_call/rough_estimate/
  precon_signed (migrated leads + STAGES; e34b1b8).
- ✅ **Removed Selections tab** from lead detail (e34b1b8).
- ✅ **Real intake answers** — `lead_intake` table + 5 canonical questions,
  editable; **real Activity log** (`lead_activity`); **editable contact info**
  (33e0ed8).
- ✅ **Qwen rough estimate + send** — AI drafts line items, emailed to the lead
  via Gmail (ad86f5c).
- ✅ **Lead → project conversion** — signed leads get a "Convert to project"
  button → creates a `pre_construction` project linked back via
  `projects.lead_id`, logs the activity, redirects to the new project.
  Idempotent (re-converting opens the existing project; once converted the lead
  shows "View project →"). `convertLeadToProject` owner-gated; project named
  "<LastName> · <scope head>", job-site address pulled from the intake "Address"
  answer.

### Session 3 — project lifecycle + per-stage tools ✅ DONE
- ✅ **9-stage lifecycle** replaces pre_construction/active/closeout/complete:
  precon_signed → floor_plan → mood_board → selections → bidding →
  construction_contract → construction → closeout → warranty. Updated
  `ProjectStatus`, `PROJECT_STATUSES`, `statusGroup()` (4 display groups:
  pre-con·design / construction·on-site / closeout / warranty), schema CHECK
  (idempotent DROP→remap→ADD migration) + seed remap, and the projects-list
  filter chips. New-project default = `precon_signed`; lead→project convert lands
  at `floor_plan`. `lib/today.ts` + `lib/automate.ts` status refs updated.
- ✅ **Stage move (manual + Qwen)** — kept "Move to {next stage}"; added a
  **"Stage check"** button → `suggestProjectStage(slug)` (owner-gated, Qwen
  one-liner on readiness; degrades gracefully). Owner still confirms the move.
- ✅ **Stage → tool mapping** — `stageToolTab(status)` opens the project on its
  stage's tool tab (floor_plan→Floor, mood_board→Mood, selections→Selections,
  bidding→Subs, construction→Daily log, closeout→Punch; others→Overview).
- ✅ **Mood + Floor tabs** added to ProjectTabs (MVP placeholder panels; the
  actual boards land in Session 5's design-tools build).

### Session 4 — notifications engine + Qwen page context ✅ DONE
- ✅ **Emit engine** — `lib/notify.ts` `emit({kind,title,…})` inserts a
  notifications row (best-effort, never throws). Wired into real events:
  createLead → INTAKE (`kind=job`,`tag=Intake`), lead→project convert → JOB,
  advanceProjectStatus → JOB (stage change), askClaudeInChannel → MENTION
  (Claude posted). Each revalidates `/notifications`.
- ✅ **Time-based derive** — `syncComplianceNotifications()` creates a flagged
  COMPLIANCE notification for each unresolved compliance item due within 14 days;
  idempotent (deduped on title), run "on read" from `getNotificationsData()`.
  Verified: one card ("Auto policy renewal · due Jun 28"), no dupes on re-read.
- ✅ **Qwen page context** — `lib/page-context.ts` serializers (lead/project/
  today) turn the page's loaded records into a compact text brief; pages pass it
  to `<Shell aiContext>` → `CommandBar` → `askQwen(prompt, aiContext)`. The
  ⌘K/Ask-Qwen bar now answers from what's on screen; `/ai` stays general.
  (MONEY/DECISION emit points for invoices land with Session 5's money tables.)

### Session 5 — money + design tools MVP ✅ DONE (plan: ~/.claude/plans/gentle-dazzling-castle.md)
Sub-phases, each its own commit (RESUME POINT in the plan file):
- ✅ **5A money** — `invoices` + `retainers` tables/seed (henderson draws),
  `lib/money.ts` (`getProjectMoney`, derived balance), `lib/actions/money.ts`
  (createInvoice w/ Qwen line items → firm $; sendInvoice via Gmail + MONEY emit;
  markInvoicePaid + MONEY emit; collect/applyRetainer), `components/projects/MoneyPanel.tsx`
  wired into the project Money tab; Overview rail shows real paid/next-draw/retainer.
  Closes S4's deferred MONEY emits.
- ✅ **5B** catalog image upload — optional product image on createMaterial via
  shared `lib/upload-store.ts` (blob under uploads/ + files row), `catalog_items.
  image_file_id`, card renders via `/api/files/<id>` (catalog owner-only). commit 0717523.
- ✅ **5C** selections board + client approval — `project_selections` table (area/
  choice/catalog_id/image_file_id/status draft→pending→approved/declined), seeded
  henderson (2 approved, 2 pending, 1 draft). `lib/selections.ts` (owner board +
  client view + image resolver), `lib/actions/selections.ts` (add/push/remove +
  owner-or-scoped-client decide, emits DECISION). Client-scoped image route
  `/api/portal/selection-image/[id]` (leaves owner-only /api/files untouched).
  `SelectionsBoard` (project Selections tab: image grid, add w/ catalog-pick or
  upload, push-to-client, remove) + `ClientSelections` (portal Approve/Decline).
- ✅ **5D** mood boards — `project_mood` table (room/image_file_id NOT NULL/note,
  grouped by room; no seed — image-only, empty state until upload). `lib/mood.ts`
  (`getProjectMood` grouped by room), `lib/actions/mood.ts` (addMoodImage via
  shared storeUpload / removeMoodImage, owner-gated), `components/projects/
  MoodBoard.tsx` (room-grouped square grid, add modal room+image+note, hover-X
  remove) wired into the project Mood tab (images owner-only via /api/files).
- ✅ **5E** floor-plan viewer — `project_floorplans` table (version/file_id/notes,
  no seed). `lib/floorplans.ts` (newest-first, isPdf from mime), `lib/actions/
  floorplans.ts` (uploadFloorplan image|PDF version=max+1 / updateFloorplanNotes /
  removeFloorplan, owner-gated), `components/projects/FloorPlan.tsx` (version
  preview img|PDF-iframe, switchable version list + remove, editable notes,
  upload modal) wired into the project Floor tab.
- ✅ **finalize** — full schema+seed apply from scratch (all S5 tables/cols),
  build clean, owner /projects/henderson + /catalog + client /client-portal all
  200; client sees the 2 pending Henderson selections w/ Approve/Decline via the
  client-scoped /api/portal/selection-image route. **Shared upload helper
  `lib/upload-store.ts`** (`storeUpload`) backs catalog/selections/mood/floor
  uploads. **Session 5 complete; next = Session 6.**

### Session 6 — subs perf, schedule, portals, settings ✅ DONE
- ✅ **Subs load perf** (c160917) — sub-detail AI reliability summary split into
  `aiSummaryInput` + `getSubSummary()` resolved in an `AiStream` Suspense slot
  (mirrors lead/project detail); page no longer blocks on CPU Qwen.
- ✅ **Schedule overview** (b513d94) — `/schedule` is now a cross-project
  overview. `schedule_blocks.project_id` (nullable FK → projects) links a block
  to a job; blocks render their project as a link or "Standalone". The Block
  modal gained a project picker; a new "New meeting" button creates a standalone
  (NULL-project) event. `createScheduleBlock` persists the optional project_id.
  Per-project Schedule tab stays project-scoped.
- ✅ **Portals build-out** (d8e2026) — client portal Money is now the project's
  real invoices + retainer (`getProjectMoney`); the decision bell reflects the
  real count of pending selections; both portals get a real "Message Joe" thread
  (`PortalMessenger` → `sendPortalMessage`, persisted to chat_messages + owner
  notification; subs use their `dm:<slug>` channel readable in /chat, clients use
  `portal:<slug>`). Channel derived server-side from identity. Selections
  approval was already real (S5C); Return-to-SJC link kept.
- ✅ **Settings rationalization** (d3c4b3e) — dropped the 3 read-only fiction
  categories (Workspace/Subscription/Data); kept Profile/Team/Integrations/AI/
  Notifications (all functional). Integrations now derived from real config
  (Gmail/Ollama/Postgres connected; QuickBooks/Drive/Stripe honestly not).

**Session 6 complete. Round-3 plan done — next milestone = Phase 8 deploy.**
