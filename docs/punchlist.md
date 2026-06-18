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
