# SJC OS — review punch list

Joe's page-by-page review (started 2026-06-18). Headlines captured here as he
reviews; detail added per page. Status: ⬜ todo · �doing · ✅ done.

## Global
- ✅ **Site is slow.** Root cause: AI pages blocked SSR on local Qwen (CPU,
  10–20s/call). Fixed via `components/ui/AiStream.tsx` (Suspense streaming) —
  the AI bubbles now stream in while the shell paints instantly. TTFB:
  /today 19.4s→0.08s, /compliance 12.3s→0.02s, /warranty 8.5s→0.02s,
  /schedule 4.3s→0.02s. (Pattern: lib returns the AI *input* + a separate
  `getXSummary()`; page wraps it in `<AiStream load={…}/>`.) **Remaining AI
  pages to convert if they feel slow: /search, /ai** (/cmdk already streams via
  TodayBody).
- ⬜ **Create dialogs double-submit.** Creating a client/lead/etc. doesn't close
  the dialog and fires multiple inserts on repeated clicks → duplicate rows.
  Fix: disable on pending + close on success (all New* modals).

## Topbar / nav counts
- ⬜ Inbox nav item → real unread **email** count.
- ⬜ Team chat nav item → real unread count.
- ⬜ Leads nav item → real count.

## /today
- ⬜ AI summary = "what needs to be done today" (real brief; Qwen skill later).
- ⬜ Today's schedule = summary of the **actual** schedule.
- ⬜ "Waiting on me" must work (real data, not showcase).
- ⬜ "Reprioritize" button in the brief box should actually reprioritize.

## /inbox
- ⬜ Load **all** emails (currently capped at 50) — pagination / load-more.
- ⬜ Labels: load all (not just those on the fetched window).
- ✅ star toggle + ⋮ menu built (live after deploy re-consent — F).

## /chat (team chat)
- ⬜ Entire page is demo-only. Build real functionality (needs a messages
  table + send + channels). Currently UI/mock only.

## /leads
- ⬜ Delete a lead.
- (double-submit on create → see Global.)

## /projects
- ⬜ Filters must work.
- ⬜ Each project detail: full functionality — tabs are half-baked showcase.

## /schedule
- ✅ The per-day "+" on the week strip now opens the block modal prefilled to
  that day's date (`ScheduleBlockModal`, reused by the header "Block" button).
- ✅ Daily-log cards are clickable (`LogCard`) and open the full log entry.

## /subs
- ⬜ Each sub detail is demo-only — real functionality.

## /files
- ⬜ Half functional — real functionality (Drive mirror was deferred; clarify scope).

## /catalog
- ⬜ Half functional — real functionality (table-less today; clarify scope).
