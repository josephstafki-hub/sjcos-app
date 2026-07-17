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
- [ ] **P1-C5** Fix label counts — they don't accurately show the number of emails contained, and may not display all contained emails.
- [ ] **P1-C6** "Draft response with Qwen" → make the AI **model selectable**; while drafting, the model should also pull any related context for that email from Open Brain/Engine.
- [ ] **P1-C7** Evaluate Clients/Subs/Money/Filters — make smarter if possible, else remove if not useful. Document.

### P1-D · Team Chat
- [ ] **P1-D1** Remove hardcoded channels; add ability to **create and remove channels**. Team members, subs, and AI models can each be added to channels **independently**. AI models only respond when invoked via `@model_name`.
- [ ] **P1-D2** **Project rooms** auto-created when a new lead/project/warranty case is created. Any sub added to that entity is auto-added to its room. Clients can be added but manually only. When the entity is lost/completed/closed, auto-close the room.
- [ ] **P1-D3** DMs with clients/subs/team: add a person-lookup step before creating the DM "channel".
- [ ] **P1-D4** All communications here are delivered to the sub/client **portals**. **GATE:** wire delivery, but any actual outbound send to a real client/sub stays parked for Joe.

### P1-E · Schedule
- [ ] **P1-E1** Schedule auto-pulls schedule data from all Projects, Leads, and Warranty tickets.

### P1-F · Warranty
- [ ] **P1-F1** Projects under warranty list what specifically is warrantied, with expiration dates per MN guidelines. Items drop off as they expire; when all items expire the whole project is removed from warranty. (Research MN residential warranty statutory periods; encode them.)

### P1-G · Commit
- [ ] **P1-G1** Ensure everything is committed and pushed to GitHub (the loop does this every iteration; this item = final sweep/verify nothing is left uncommitted).

---

## PRIORITY 2

- [ ] **P2-1** Voice-to-text for text inputs (app-wide where sensible).
- [ ] **P2-2** Operator console — plan at `docs/operator-console-plan.md`. **GATE:** build the DEMO, then STOP and park for Joe's approval before implementing further. (He wants to see/like it first. Talking with the models on this page is a stretch goal he called out.)
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
