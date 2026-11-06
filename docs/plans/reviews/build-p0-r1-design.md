SCORES: design=4 completeness=5

# Build round 1 — Phase 0 — Design & UX judge

Branch `t3/in-app-browser-agent-tools` at `10487eb4`. Base for "today" = `e082956a`.
Evidence: `/home/joe/qa-sjcos/abc/shots/p0-r1/*.png` + `p0-log.json`, and the base/head diff of
`components/panel/*`, `lib/thread-access.ts`, `lib/ask-thread-journal.mjs`, `lib/panel-search.ts`,
`components/panel/ThreadList.tsx`, `components/panel/useAgentChat.ts`, `app/login/page.tsx`.

## What's right

- **Desktop dock chrome is unchanged.** At 1100 and 1280 (`*-today.png`), the Operator header has the same
  icon, label, Follow (eye), Pop out and Collapse buttons, padding and order as `e082956a`. The dock is still
  420 and has the same splitter.
- **Phone /today is unchanged** (360/390). The bottom tab bar, Operator tab and the page itself look the same.
- **Sheet chrome is the same as today when nothing is registered.** At 820 and 800×360, the sheet still has the
  grabber, the "Operator" header with ×, and full height on /today. The only change is the intended rename to
  **Close Operator** (H3).
- **The landscape strip is correctly off.** `askPaneLayout` sets `landscape` only when
  `mode==='sheet' && selected && height<600`, and nothing registers a pane yet, so 800×360 shows the ordinary
  horizontal chrome. That matches H3 ("when side content is selected"). Its code matches the host file:
  - a strip at least 64 px wide;
  - **Close Operator** first, then one vertical `tablist` with 48 px tabs;
  - grabber and header suppressed;
  - one selector instance.

  The ≥200 px stage can't be proven until a test registration is mounted (capture list).
- **The tab semantics are new work done right:** `role="tablist"`/`tab`, roving tabIndex, orientation-aware
  arrow keys.
- **Staff /today and the staff dock render normally.** No owner data shows in staff chrome.
- **No horizontal overflow at any width** (`overflowPx: 0` everywhere).
- **The planned paused copy is the right copy.** `lib/canvas-deletion-ledger.mjs:11` has the exact plan string
  (Canvas §4 "recovery gate closed"): plain words, no pronouns, no new nouns.

## REQUIRED fixes

1. **The Chat column is crushed to about 65 px wherever the thread rail shows** (popout 1100/1280, and any dock
   resized to 880 or wider). Screens: `owner-pop1100-panel.png`, `owner-desk1280-panel.png`,
   `staff-desk1280-panel.png`.
   - Cause: `components/panel/PanelDock.tsx:257` now wraps PanelChat in a `flex` row. PanelChat's rail root,
     `components/panel/PanelChat.tsx:915` (`flex h-full min-h-0 gap-2`), has no `flex-1`, so it shrinks to its
     content. Before, it was a grid item and stretched.
   - Fix: make the chat tabpanel wrapper stretch its child. Change line 257's class to
     `` `min-h-0 min-w-0 ${chatVisible?'grid':'hidden'} grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]` ``.
     The `sr-only` h2 is absolutely positioned, so it takes no cell.
   - Re-capture at 880, 1100 and 1280 popout and a 900 dock. The Chat column must match `e082956a`.

2. **The Queue · Chat switch looks different everywhere.** Screens: every dock, sheet and popout shot. Today it
   is a compact pill on the left (`components/ui/Segmented.tsx`: `inline-flex gap-0.5 p-0.5`, buttons
   `h-11 px-2.5 rounded-[5px] font-sans text-label font-medium transition-colors hover:text-ink`). It is now two
   stretched half-width tabs in `text-body` with no hover.
   - Fix at `PanelDock.tsx:239` and `:245`: when `tabs.length===2`, use exactly today's classes: an inline pill,
     not `flex-1`, `h-12`, buttons `h-11`, plus the hover and transition.
   - Apply `flex-1 min-w-0` only when three or more tabs are registered (H2's four-label rule).
   - Keep the new tab semantics.

3. **There are two History buttons in the narrow popout.** Screens: `owner-phone360-panel.png`, `*-phone390-panel.png`.
   - `PanelDock.tsx:252` adds a second clock button labelled "Threads" beside the selector. The chat header
     already has its own clock button labelled "Threads" (`PanelChat.tsx:478`), which drives `threadView`
     through `onThreadViewChange`. Two identical icons are stacked 40 px apart, and screen readers announce
     two "Threads" buttons.
   - Fix: render PanelDock's History button only while a pane is showing, since Chat and its header are hidden
     then. Otherwise rely on the chat header's button.

4. **The paused state never reaches the screen, so Joe would think his chats are gone.**
   - Thread code throws `Error(PAUSED)` and `ASK_*` codes (`lib/ask-thread-journal.mjs:69,72`,
     `lib/thread-access.ts`). Production server actions strip thrown messages. The results:
     - The thread rail's `reload()` (`ThreadList.tsx:182`) rejects, and the rail shows **"Empty — start a chat
       here."** (owner at 1100/1280). The "HTTP 500 /panel" in the log is this server action POST, not a page
       crash.
     - `runTurn` (`useAgentChat.ts:616`) has no catch. Joe's message is pushed as if it was sent, and nothing
       follows.
     - Reopening the remembered thread falls back to "New chat" with no explanation.
   - Fix: the thread actions (rail list, archived list, load, new, send, voice, upload, folder actions) return
     `{ok:false, code, error}` instead of throwing. The client maps the codes to this exact copy:
     - Gate closed / not configured: **Chats are paused while SJC OS checks its records. Try again in a few minutes.**
       - Shown in place of the thread list, with no titles or folders.
       - Shown as one line above the composer. Send is disabled. The typed text stays in the box and is never
         shown as sent.
       - Queue, Today and Search keep working.
     - Thread not owned, deleted or missing (open, deep link `/panel?c=…`, or a ⌘K result):
       **This chat isn't available to this account.**
       - Then a fresh New chat.
       - No title, no owner name, no difference between missing and denied.
     - `ASK_SIGN_IN_REQUIRED`: **Sign in again to continue.** with a **Sign in** link.
     - `ASK_ACCESS_DENIED`, for staff without the AI area: **Chat isn't turned on for this account.**
   - Owner and staff see the same words.

5. **Search (⌘K) breaks completely while chats are paused.** `lib/panel-search.ts:68` uses `Promise.all`, so
   the thread search throwing loses the job, lead and invoice results too, for Joe and for staff.
   - Fix: catch the thread search and return `[]`. Records still return.
   - Optional: one non-link row with the paused sentence.

6. **Delete is still offered, fails silently, and its words are wrong.** `ThreadList.tsx:274`, `:722`, `:869`
   still show Delete with the confirm "Delete this conversation permanently?". The server then throws
   **Chat deletion is not ready yet. Try again later.**, which is stripped in production, so nothing happens.
   - Canvas plan §8 line 704 requires the UI to be disabled too. Fix:
     - Pass a server flag (deletion accepted, yes/no). While it is no, show Delete disabled with that exact
       sentence as its description/title, or hide it and show the sentence in the menu.
     - The action returns `{ok:false,error}` and `flashNotice` shows it.
   - When deletion is enabled, change the confirm to Joe's words and the real behaviour:
     **Delete this chat? It's removed now and erased for good after 30 days.** The word "permanently" is wrong
     under the 30-day purge.

7. **Staff will see their chat list emptied on deploy, with nothing on screen saying why.** Migration 0105
   (lines 15–18) gives every existing thread to the single owner. Before this change the panel was Joe's
   session for anyone (memory "staff per-account separation"), so Abigail could see every chat. After deploy,
   Abigail's list is empty and Joe's is unchanged.
   - Fix (copy): the staff empty thread list reads **No chats yet. Only your own chats show here.**
   - Fix (handoff): add to "What Joe must do" in the Phase 0 handoff:
     **Tell Abigail before deploy: Abigail's chat list starts empty; chats from before this update stay in
     Joe's list, and new chats are private to whoever starts them.**
   - Joe's own list needs no notice.

8. **React hydration error #418 on /panel at every width** (`p0-log.json`). /panel is the only place PanelDock
   is server-rendered.
   - Fix: run the same harness on a base build of `e082956a`.
     - If #418 is already there, record that in the handoff with the base log line.
     - If it is new, find the mismatching node and fix it, so /panel has zero page errors.
   - Joe must not get a client re-render flash on the popout.

9. **QA ran with no journal authority, so this round cannot prove what Joe and staff will see.** Every chat
   read failed, and the foreign-thread shot is identical to the normal one.
   - Fix (handoff): before any deploy, the Phase 0 handoff's release list must say the journal authority env and
     the binding file are installed. Without them, Joe sees the paused line **indefinitely**, not "in a few
     minutes".
   - Fix (QA): next round, configure a QA authority so the working state is captured, and capture the paused
     state separately on purpose (below).

## Next-round capture list

Use the same widths (phone360, phone390, land800, ipad820, pop1100, desk1280). Owner = Joe, staff = Abigail (QA copy).

**Setup:**
- QA journal authority **configured**.
- Seed one thread per person with distinct titles:
  - **"QA Joe – Larson bath"**: owner, admitted after 0105.
  - **"QA Abigail – Spaeth garage"**: staff.
- Keep the restored legacy threads.

**Shots:**
- **Thread privacy, both people:**
  - `/panel` at 1280 with the thread rail visible.
  - The 420 desktop dock on /today with the **chat-header clock (History) open**.
  - phone360 `/panel` with History open.
  - Owner's list shows the legacy threads plus the Joe seed, and never the Abigail seed. Staff's list shows
    only the Abigail seed plus the staff empty-state line if it is the only one.
- **Search:** ⌘K for `QA` as each person. Each sees only their own thread result. Jobs still appear.
- **Deep link to the other person's thread:** `/panel?c=<other id>` as each person. Expect
  **This chat isn't available to this account.** and a fresh chat. Grep the log and network responses for the
  other seed's title: there must be zero hits.
- **Paused state** (authority unset), at 360 and 1280, owner and staff:
  - the thread list with the paused line;
  - the composer with the notice and the draft kept after pressing Send;
  - ⌘K still returning jobs;
  - the Delete control state.
- **Base vs head, side by side:**
  - the 420 dock selector;
  - the popout 360 header (one clock only);
  - popout 1100/1280 and a 900 dock (Chat column width);
  - `p0-log.json` showing whether #418 is present on base.
- **Test registration harness** (from the host handoff), to prove the host when a pane exists:
  - 800×360: the strip, Close + vertical tabs, stage ≥200 px.
  - Content box 839 vs 840 vs 1000: split 348/12/480 and 420/12/568.
  - 1100 popout: compact, one ×.
  - 1280: explicit expansion, then Back to app restores route, scroll and focus, and the dock width is
    unchanged.

## Optional

- In the landscape strip, Close Operator renders a text glyph `×` (`PanelDock.tsx:238`). Use the same lucide
  `X` (size-4, 1.75 stroke) as the sheet header so the icon matches the dock.
- On phones, PanelHost now mounts PanelDock/PanelChat hidden at page load, while the sheet is closed. Before,
  it mounted only when the sheet opened. Check that the hidden chat does not poll or reopen a thread on every
  page load (battery, and calls to the paused journal).
- Login: when someone with an old cookie follows a review link, the flag-coloured box reads
  **Sign in to open the review.** That matches the Browser plan. Consider the neutral `text-ink-3` style rather
  than the warning border, since nothing is wrong.
