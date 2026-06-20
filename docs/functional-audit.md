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

1. **Overview** ❌ read-only dashboard.
   - Milestones / This-week / Latest-log / Money / Subs / Files cards don't link
     to their tabs — nothing on the page is clickable in a useful way.
   - "Review" on the drafted weekly-status email is a fake `AckButton`.
   - **Done =** cards click through to their tab; the weekly-status email is a
     real action (send via Gmail or open the composer); pulse/status stay AI text.

2. **Floor** ✅ real (S5E: image/PDF upload, versioning, notes). Full CAD editor
   is the deferred floor-planner epic — confirm it stays deferred for v1.

3. **Mood** ✅ real (S5D: per-room image boards).

4. **Selections** 🟡 — owner can add / push-to-client / remove, client can
   approve/decline (in the client portal). **Missing (Joe's asks):**
   - **Edit** an existing selection (currently only add/remove).
   - **Group into rooms / sections.**
   - **Per-room/section budgets.**
   - **Running total + remaining-budget** shown to the client as they choose
     ("how much budget is left" / "how things add up").
   - **Done =** selections grouped by room/section, each with a budget; choosing
     options rolls up a live total + remaining; client sees it on their dashboard
     and approves/declines per item.

5. **Schedule** ❌ read-only curated (this-week + milestones). Now that
   `schedule_blocks` has `project_id`, this tab can show the project's real
   blocks. **Done =** project-scoped real schedule: add/edit/remove blocks here,
   and Qwen can propose/auto-place blocks (interactive by user **and** Qwen).

6. **Subs** ❌ read-only roster. **Done =** assign/remove subs to the project,
   see/manage COI + contact, from this tab. Needs a project↔sub join table
   (today there's no real job-history link).

7. **Files** ❌ read-only curated list, **no upload.** The global `/files` has
   real upload; this tab doesn't. **Done =** upload (reuse `storeUpload`/uploads
   infra) + download, scoped to the project.

8. **Money / Invoices** 🟡 — `MoneyPanel` is actually interactive (New invoice →
   Qwen drafts line items, Send → Gmail, Mark paid, retainer collect/apply). But:
   - Only **henderson** is seeded, so every other project's Money tab looks empty
     ("not interactive").
   - Line items can't be **edited** after Qwen drafts them.
   - No **client-facing** invoice view / "mark received" in the portal.
   - Qwen drafting is **slow** (CPU, 10–20s) and can fall back to mock.
   - **Done =** editable line items; client sees invoices on their dashboard;
     drafting streams; empty projects have a sensible first-invoice flow.

9. **Daily log** ❌ read-only latest entry, **no add.** **Done =** add a daily
   log (text + photos) from here, see history (not just latest). Reuse
   `daily_logs`; the sub portal "Log your day" should feed the same table.

10. **Comms** ❌ read-only curated thread, **no composer.** Joe: "communications
    via client dashboard." **Done =** wire Comms to the real client-portal
    message thread (`portal:<slug>`, the `PortalMessenger` built in S6) with a
    composer, so owner ⇄ client talk in one place.

11. **Punch** 🟡 — toggling done works; **no add/remove.** **Done =** create /
    edit / delete punch items (owner, and ideally sub-flaggable).

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

These each capture intent then revert — no backend. Decide per item: implement,
or remove for v1.

- **Sub portal:** Add photos · Record voice note · Photo-from-Joe · Submit final
  invoice. (Logging + invoice submit should be real; voice note can defer.)
- **Project Overview:** Review weekly-status email (+ the email itself).
- **`/ai`:** 2 action chips.
- **Schedule:** "Auto-log from photos".
- **Compliance:** "Auto-collect docs".
- **Warranty:** AI claim action.
- **Subs detail / Leads detail:** 1 each.
- **Client portal:** "Decide" on the decision card (selections approve/decline
  IS real — this top card is a separate fake).
- **Files:** "Share" (global upload itself IS real).

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

## Suggested build order (once scope is set)

1. **Qwen actually answers** (B) — small, high-visibility; unblocks "ask from any
   page."
2. **Project tabs to real** (A) — Daily log add, Punch add, Files upload, Comms
   composer, Subs management, Schedule project-scoped — mostly reuse existing
   patterns (owner-gated action + optimistic client cmpt).
3. **Selections rooms/sections + budgets** (A4) — the largest single feature.
4. **Money polish** (A8) — editable line items + client invoice view.
5. **Overview wiring + AckButton cleanup** (A1, C).
6. **Placeholder screens** (D) — only if pulled into scope.
</content>
