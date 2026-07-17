# SJC OS Autonomous Todo Sweep — Task Spec

Source: Joe's todo list (2026-07-14). Work these **in order**, top to bottom.
Finish all of PRIORITY 1 before starting PRIORITY 2.

Legend:
- `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` PARKED (needs Joe)
- **GATE:** an approval/guardrail that stops full completion — build to the safe point, then park.

Update the checkbox here AND append a detailed entry to `PROGRESS.md` every iteration.

---

## PRIORITY 1

### P1-A · All pages (global)
- [x] **P1-A1** Fix bottom-of-page chrome: when scrolled to the bottom, the menu/nav bar loses its green background and the account info becomes invisible. Make the bar stay green and account info visible at all scroll positions, on every page.
- [x] **P1-A2** Replace model-specific labels ("Ask Qwen", etc.) with generic wording ("Ask AI") everywhere a model picker/multiple models are available. Keep it generic across the app.

### P1-B · Projects, Leads, Warranties
- [x] **P1-B1** AI chat box in Projects, Leads, and Warranties must accept file uploads.
- [x] **P1-B2** AI chats persist per-page across navigation (stay active when you leave and come back). Add a **Clear** button; also auto-clear on hard refresh.
- [x] **P1-B3** Mood board = a real mood-board *creator* (Houzz Pro style) that pulls items from the catalog.
- [x] **P1-B4** Fix Selections board — currently cannot create sections. Make section creation work.
- [x] **P1-B5** Fix Subs feature: assigning a sub to a project doesn't show on the sub's record ("not assigned to any job"). Wire the assignment both ways.
  - On assignment, the sub gets an email with a link to the **sub portal**. **GATE:** build the email + trigger, but DO NOT actually send — queue/park for Joe.
  - Sub portal recognizes the person via a cookie so they don't have to log in / create an account.
- [x] **P1-B6** Reorganize project tabs. First **inventory every tab + its use case** (write it into PROGRESS.md), identify duplicates (estimates/invoices/change-orders have own tabs while sign-off handles the rest plus some of those), then consolidate/eliminate duplicates. Document decisions.
- [x] **P1-B7** Remove the **retainer system** — it's obsolete. SJC does fixed-price contracting only; no billing against retainers. Remove/neutralize retainer UI, logic, and billing paths. Be careful: preserve historical data, don't break accounting. Document what was removed.
- [x] **P1-B8** Remove the **Stage Check** button in projects. Audit all other project buttons for usefulness before keeping; remove the "avatar" boxes next to lead/project/warranty names (not useful in current state). Document button-by-button decisions.

### P1-C · Inbox
- [x] **P1-C1** Add a regular **Inbox** tab.
- [x] **P1-C2** Evaluate "Needs reply / Awaiting them / Snoozed / Done today" for real usefulness + whether they actually work + implementation difficulty. Make the worthwhile ones work; remove the rest. Document the call for each.
- [x] **P1-C3** Make **Channels** work.
- [x] **P1-C4** Add important Gmail views: read/unread, spam, trash, etc.
- [x] **P1-C5** Fix label counts — they don't accurately show the number of emails contained, and may not display all contained emails.
- [x] **P1-C6** "Draft response with Qwen" → make the AI **model selectable**; while drafting, the model should also pull any related context for that email from Open Brain/Engine.
- [x] **P1-C7** Evaluate Clients/Subs/Money/Filters — make smarter if possible, else remove if not useful. Document.

### P1-D · Team Chat
- [x] **P1-D1** Remove hardcoded channels; add ability to **create and remove channels**. Team members, subs, and AI models can each be added to channels **independently**. AI models only respond when invoked via `@model_name`. — DONE: channel create/remove, independent sub + AI membership, `@model_name`-gated AI (2026-07-17), and now independent **team-member** add via a new internal-team roster (`team_members` + `chat_team_members`, built inline from the participants menu). See PROGRESS 2026-07-17 (two entries).
- [x] **P1-D2** **Project rooms** auto-created when a new lead/project/warranty case is created. Any sub added to that entity is auto-added to its room. Clients can be added but manually only. When the entity is lost/completed/closed, auto-close the room. — DONE (2026-07-17): persistent `chat_rooms`/`chat_room_clients`, rooms auto-open on **all** lead creation paths (manual form + inbound funnel), project create, and lead→project convert; project completion (→warranty) closes the project room and opens a warranty room, carrying participants; subs auto-added/removed on assign/unassign; clients added manually (create-only, no delivery — that's D4); auto-close on lead lost/deleted/converted. **One deferred sub-clause:** warranty-room auto-close has no product event to hook yet — the `closeEntityRoom(warrantyRoomKey(slug))` primitive is wired-ready and will be called from **P1-F1** (warranty expiry) when that lands. See PROGRESS 2026-07-17.
- [x] **P1-D3** DMs with clients/subs/team: add a person-lookup step before creating the DM "channel". — DONE (2026-07-17): new `chat_dms` table + `dm:team:`/`dm:client:` key namespaces (subs keep `dm:<slug>`); a "New message" person-lookup in the Direct rail searches subs + team + a derived client roster (projects + open leads) and opens/creates a persistent DM; `openDirectMessage` action (owner-gated, idempotent, no outbound); inbox `loadPortalThreads` excludes team/client DMs. See PROGRESS 2026-07-17.
- [x] **P1-D4** All communications here are delivered to the sub/client **portals**. **GATE:** wire delivery, but any actual outbound send to a real client/sub stays parked for Joe. — DONE (2026-07-17): a **parked portal-delivery outbox**. Owner/AI messages in entity rooms (`room:*`) and client DMs (`dm:client:*`) enqueue `portal_deliveries` rows (`queued`); nothing reaches a real sub/client until Joe clicks **Release** in the new Team-chat "Portal outbox" rail panel (Release copies the message into the target portal thread — `dm:<sub-slug>` / `portal:<project-slug>`). Sub DMs already ARE the sub-portal thread (self-deliver, excluded); also **closed a pre-existing gap**: `@`-mentioning an AI in a sub DM no longer pushes unreviewed AI content to the real sub. See PROGRESS 2026-07-17.

### P1-E · Schedule
- [x] **P1-E1** Schedule auto-pulls schedule data from all Projects, Leads, and Warranty tickets. — DONE (2026-07-17): /schedule week strip now surfaces read-only auto-derived entries live from Projects (start + target-end dates), Leads (open follow-up tasks w/ due dates, lost leads excluded), and Warranties (warranty end dates + claim ack/resolve deadlines) — merged after manual blocks, tagged "AUTO", nothing persisted. See PROGRESS 2026-07-17. Known follow-up: weekend-dated deadlines fall outside the Mon–Fri strip.

### P1-F · Warranty
- [x] **P1-F1** Projects under warranty list what specifically is warrantied, with expiration dates per MN guidelines. Items drop off as they expire; when all items expire the whole project is removed from warranty. (Research MN residential warranty statutory periods; encode them.) — DONE (2026-07-17): encoded the three Minn. Stat. §327A.02 subd. 1 statutory tiers (1-yr workmanship/materials, 2-yr systems, 10-yr major structural) in new `lib/warranty-mn.ts`; the under-warranty grid now derives each project's coverage from its warranty start (closeout date) live against CURRENT_DATE — lapsed tiers drop off the card's item list, and a project whose every tier has lapsed is removed from the grid (count drops too). For fully-lapsed **live** warranty-stage projects this also fires `closeEntityRoom(warrantyRoomKey(slug))`, wiring the **P1-D2** deferred warranty-room auto-close. Read-only derivation (no persistence, no writes except the idempotent best-effort room close). See PROGRESS 2026-07-17. **Note:** because MN structural runs 10 years, a job stays *listed* (structural only) for a decade while the 1- & 2-yr items visibly drop off; full removal at 10 yrs. Deferred: per-project **custom** warrantied line items (beyond the 3 statutory tiers) would need a stored `warranty_items` table — not built.

### P1-G · Commit
- [x] **P1-G1** Ensure everything is committed and pushed to GitHub (the loop does this every iteration; this item = final sweep/verify nothing is left uncommitted). — DONE (2026-07-17): full sweep verified — working tree clean, no stashes, no stray sweep branches, local HEAD == `origin/auto/todo-sweep-2026-07-14` (0 ahead / 0 behind), `npx tsc --noEmit` clean, `npm run lint` 0 errors (11 pre-existing warnings). All of PRIORITY 1 (A–F) is committed and pushed. See PROGRESS 2026-07-17. **PRIORITY 1 COMPLETE.**

---

## PRIORITY 2

- [x] **P2-1** Voice-to-text for text inputs (app-wide where sensible). — DONE (2026-07-17): turned the existing 2-composer voice memo (whisper.cpp, `/api/transcribe`) into a **drop-in, self-gating** primitive and wired it into every high-value prose composer. New GET `/api/transcribe` availability probe + module-cached `useVoiceAvailable()` hook → `VoiceButton` now self-gates (renders nothing when voice isn't set up) with a `compact` icon-only variant, so any input adds a mic with one line and no server-prop threading. Added `mergeTranscript()` for controlled React-state inputs (the old ref-based `appendTranscript` now shares it). Wired: **AI chat** composer (AssistantChat — Projects/Leads/Warranties/ai), **Team chat** (ChatClient), **Inbox** reply + new-message body (InboxClient); pre-existing project + sub daily logs still work. Guardrail-safe: dictation only *fills* text boxes — sends stay user-initiated; whisper is local/offline (no outbound/cloud). See PROGRESS 2026-07-17. Deferred (sensible non-targets or lower value): single-line fields (To/Subject/names/numbers), and misc small note fields — trivial to add later via the new drop-in `<VoiceButton compact onText=… />`.
- [!] **P2-2** Operator console — plan at `docs/operator-console-plan.md`. **GATE:** build the DEMO, then STOP and park for Joe's approval before implementing further. (He wants to see/like it first. Talking with the models on this page is a stretch goal he called out.) — **DEMO BUILT & PARKED (2026-07-17):** Phase 0 self-contained mock at `docs/reference/operator-console-mock.html` — opens from disk, three panels (Queue rail / Operator chat / live Workbench) using the app palette + Joe's **real** Today-queue titles; a "▶ Simulate run" button plays the ~10s scripted moment (ticking "Hermes is working · Ns" heartbeat + activity lines, the lead's Flag flashes `Needs reply`→`—`, a highlighted `receipt: email draft created — Dembinski follow-up` row drops into the workbench timeline, card checks off, draft parked — nothing sent). Walkthrough script in the file header. **STOPPED per GATE — awaiting Joe's "yes, build it" before any Phase 1+ app code.** No source files changed (git status = mock only). See PROGRESS 2026-07-17.
- [ ] **P2-3** iPhone/iPad apps (see `/home/joe/sjcos-mobile`).
- [ ] **P2-4** Website content composer — replaces the current Site tab. On project close-out it writes the blog post about that project and asks for relevant photos/video if not uploaded. **GATE:** never auto-publishes anything outward.
- [ ] **P2-5** Newsletter builder — design from a template, edit it, send to a mailing list; auto greeting email when a new contact is added; read/open receipts if possible; AI assistant to help write. **GATE:** never sends real email to a real list without Joe.
- [ ] **P2-6** Mobile browser site.
- [ ] **P2-7** Android apps.

---

## GLOBAL GUARDRAILS (apply to every item)
1. **Never** run `npm run build` / `next build` in this repo — it corrupts the live `.next` and kills the running site.
2. **Never** restart `sjcos.service` or touch the running process/port 3017.
3. **Never** merge to `main` or deploy. Work only on branch `auto/todo-sweep-2026-07-14`.
4. **Never** send anything outward to a real client/sub/contact (email/SMS/portal push). Build + queue + park.
5. Verify each item with `npx tsc --noEmit` and `npm run lint` — both must stay green before committing.
6. For research/product-judgment items, make a reasonable decision, DO it, and document the reasoning in PROGRESS.md for Joe to review.
7. If an item is too large/ambiguous for one pass, split it: do a coherent slice, commit, and leave a clear PROGRESS note on what remains.
