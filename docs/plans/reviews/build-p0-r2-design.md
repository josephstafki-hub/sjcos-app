SCORES: design=7 completeness=6

# Build round 2 — Phase 0 — Design & UX judge

Branch `t3/in-app-browser-agent-tools` at `1495e052`. Base for "today" = `e082956a`.
Evidence: `/home/joe/qa-sjcos/abc/shots/p0-r2b/*.png` + `p0r2-log.json` (side build of HEAD, QA DB rebuilt
from live, seeds "QA Joe private: Spaeth schedule" / "QA Abigail private: Larson tile order"), the pre-leak-fix
set `p0-r2/`, round 1's `p0-r1/`, and source at HEAD vs `e082956a` for `components/panel/*`, `lib/panel-search.ts`,
`app/login/page.tsx`, `askStatusCopy.ts`, the Phase 0 handoff, context decisions 10–11 and host Amendment A1.

## Round-1 items

| # | Item | Status |
|---|---|---|
| 1 | Chat column crushed beside the thread rail | **Fixed.** The Chat column is 717 px at the 1100 popout, 837 px at the 1280 popout and 584 px in the 900 sheet (`owner-pop1100-panel.png`, `*-desk1280-panel.png`). The three-column popout matches `e082956a`. |
| 2 | Queue · Chat switch restyled | **Fixed.** Two tabs use today's pill: `bg-paper-2`, `h-12`, `h-11` buttons, `px-2.5 text-label font-medium`, hover and transition (`PanelDock.tsx:239,245`). It is left-aligned at every width. Tab semantics are kept. |
| 3 | Two History buttons in the narrow popout | **Fixed.** At 360 and 390 there is one clock, in the chat header. The PanelDock one renders only while a pane is showing (`PanelDock.tsx:252`). |
| 4 | Paused / unavailable / sign-in / chat-off states | **Fixed in code, not captured.** All copy is exact in `askStatusCopy.ts`. Send is disabled and the draft stays. Two regressions in the unavailable path: REQUIRED 2 and 3. The deep-link shot used `?thread=`, but the app reads `?c=` (`useAgentChat.ts:443`, and the ⌘K href at `panel-search.ts:68`). That shot only proves the param is ignored; it never exercised the unavailable state. |
| 5 | ⌘K dies while paused | **Fixed.** The thread search is `.catch(()=>[])` (`panel-search.ts:69`). ⌘K "QA" shows only the viewer's own chat, for both people. |
| 6 | Delete offered, fails silently, wrong confirm | **Fixed in code, not captured.** Delete stays off unless the list says deletion is available. The menu item is disabled and shows "Chat deletion is not ready yet. Try again later." as its description (the A1.1 copy). The confirm reads exactly "Delete this chat? It's removed now and erased for good after 30 days." |
| 7 | Staff list empties on deploy, unexplained | **Superseded by decision 11, half done.** Abigail's list shows her seed plus **Settled (2)**, her two old chats (`staff-desk1280-panel.png`). The empty-state copy exists, but it also shows while loading and inside empty folders (REQUIRED 1). The deploy note is not in Joe's words and leaves out what Joe himself loses (REQUIRED 5). |
| 8 | Hydration #418 on /panel | **Fixed.** `p0r2-log.json` has zero errors at every width, for both people. |
| 9 | QA had no journal authority | **Resolved by A1.1.** With deletion never enabled, chats work without the authority, and this round captured the working state. The paused state was **not** captured deliberately (capture list). |

## New states and copy

- **Paused**: one sentence plus Try again, both in the thread list and above the composer. Titles, folders, the
  transcript, attachments and "Working on" chips are cleared. Send and Attach are disabled, and the typed text
  stays. This is right.
- **Sign in**: "Sign in again to continue." with a Sign in link (44 px). This is right.
- **Chat off**: correct sentence. Try again is harmless here: it recovers if Joe turns the area back on.
- **Delete not ready**: the copy is right. The archived-row trash button explains itself only with `title`
  (`ThreadList.tsx:798`), which a phone never shows. See optional.
- **Deletion pending/error**: "Chat deletion is pending." / "Chat deletion couldn't be confirmed." + Retry deletion.
  No title is shown. This is right.
- **Empty**: "No chats yet. Only your own chats show here." This is the right sentence for an account with no chats.
  It is wrong as a loading state and inside an empty job folder (REQUIRED 1).
- **Privacy, as seen on screen**: Joe sees his seed, 1 unfiled chat, Settled (111) and his job folders, and never
  Abigail's seed. Abigail sees her seed and Settled (2), and never Joe's. ⌘K matches this. No leaks in the log.

## Chrome vs today (`e082956a`)

- **Unchanged:** dock header (Operator, Follow, Pop out, Collapse), sheet grabber and header with ×, popout
  "OPERATOR · WINDOW" / Dock back bar, thread rail header and search, chat header, model/settings rows, and
  /today at all widths.
- **Intended:** the narrow popout loses its Threads tab to the chat-header clock (H2). Close Operator is renamed.
- **Unintended:** three composer buttons grew from 28 to 44 px (`7493890c`): Attach, Voice conversation and Send.
  Sparkle and Mic stayed at 28, so one row now has two button sizes. On desktop, Send is a heavy grey 44 px square.
  At 800×360 the taller row leaves about 12 px of transcript, against about 26 in `p0-r1/owner-land800-today-operator-open.png`
  (REQUIRED 4).

## REQUIRED fixes

1. **The empty copy shows while the list is loading and inside empty folders.** Joe, with 113 chats, sees
   "No chats yet. Only your own chats show here." in the 900 sheet (`owner-dock900-today-operator-open.png`) and
   on phone, landscape and iPad History. The same goes for Abigail during deploy week, which reads as "my chats
   are gone". There are two causes:
   - Before the first load, `groupThreads` still emits an empty Unfiled group, and line 765–766 prints the
     sentence for it.
   - Line 766 also replaced today's per-group copy, so an expanded empty job folder (Tierney, Spaeth …) now reads
     "No chats yet. Only your own chats show here."

   Fix, `components/panel/ThreadList.tsx`:
   - **Line 617:** render `{!loaded ? <p role="status" className="px-2 py-3 text-meta text-ink-4">Loading chats…</p> : threads.length === 0 && folders.length === 0 ? <p …>{ASK_EMPTY_COPY}</p> : scoped.map(…)}`.
     No group is rendered before the first successful load.
   - **Line 766:** restore today's text **Empty — start a chat here.** for empty groups. `ASK_EMPTY_COPY` appears
     only at line 618: loaded, with zero chats and zero folders.
   - **Re-capture:** History at phone360, phone390, land800 and ipad820, and the 900 sheet, immediately after
     opening (expect "Loading chats…") and after the list loads.

2. **"This chat isn't available" wipes the person's whole chat list.** `PanelChat.tsx:525` and `:936` pass
   `chat.failureCode` into ThreadList. `ThreadList.tsx:150` and the effect at `:243–248` treat any code as a list
   failure, so a stale ⌘K result or a foreign `/panel?c=` link empties Joe's list. The list is replaced by the
   sentence and Try again, and the person can't even pick another chat. The unavailable notice is about one chat
   and belongs only above the composer.

   Fix in `ThreadList.tsx`:
   - Line 150: `const failure = (failureCode === 'THREAD_UNAVAILABLE' ? null : failureCode) ?? localFailure;`
   - Line 243: the same guard (`if (!failureCode || failureCode === 'THREAD_UNAVAILABLE') return;`).
   - In `fail()` (`:199`): a `THREAD_UNAVAILABLE` from a row action, such as moving or renaming a chat deleted in
     another window, calls `flashNotice(ASK_STATUS_COPY.THREAD_UNAVAILABLE)` and `void reload()` instead of
     clearing the list.

3. **The unavailable notice offers "Try again", which promises the chat might load.** It only dismisses the line.
   - `PanelChat.tsx:851`: for `THREAD_UNAVAILABLE`, render the sentence with **no button**. It already clears on
     send, on opening a chat and on New chat (`useAgentChat.ts:494,679`).
   - `useAgentChat.ts:443`: after reading `c`, remove `c` and `m` from the address with
     `history.replaceState(history.state, '', <url without c/m>)`. Otherwise a reload of `/panel?c=<foreign>`
     shows the notice again forever.
   - Keep Try again for Paused and Chat off.

4. **Composer buttons changed size on every screen** (`PanelChat.tsx` Attach `:875`, Send `:917`, VoiceRoundButton
   `:1123`).
   - Change `size-11` to `size-11 pointer-fine:size-7` on these three. Touch screens keep 44 px. Mouse and
     trackpad screens get today's 28 px, matching the Sparkle and Mic buttons.
   - Re-capture the 420 dock, the 1280 popout and 800×360 next to `e082956a`.

5. **The deploy notes are in builder words and leave out what Joe loses.** In the handoff, "What Joe/coordinator
   must do" item 3 says "consistent creator evidence", "quarantined" and "No pronoun-based ownership inference".
   Joe would not say these, and the note never says that Joe's own list changes.

   Replace item 3 with exactly:
   > **Tell Joe and Abigail before deploy:** Chats are now private to whoever started them. Abigail's list
   > keeps her 2 old chats. Joe's list keeps his old chats and every chat with no recorded starter. Abigail's 2
   > chats leave Joe's list and Joe can't open them any more. N old chats that more than one person worked in are
   > held aside and show in neither list.

   Fill **N** from the migration dry run on live-shaped data, or write "none" if there are none.

   Also add one line under "Next visual round": recapture the deep link with **`/panel?c=<other id>`**, not `?thread=`.

## Next-round capture list

Same widths: phone360, phone390, land800, ipad820, dock900, pop1100, desk1280. Owner = Joe, staff = Abigail.

- **History, two moments:** immediately after opening (Loading chats…) and after the list loads, at every width.
- **Empty folder expanded** (for example Tierney, 0): "Empty — start a chat here."
- **Deep link, as each person, at 1280 and phone360:** `/panel?c=<other person's seed id>`.
  - The composer line reads "This chat isn't available to this account." with no button.
  - The thread list still shows the viewer's own chats.
  - Chat title "New chat"; the address bar no longer has `c=`.
  - Reload shows no notice.
  - Grep network and log for the other seed's title: 0 hits.
- **⌘K stale result:** open a ⌘K chat result for a chat that was archived or deleted after the search, and expect
  the same.
- **Paused, deliberately** (deletion latch set with no authority, on the QA DB only), owner and staff at 360 and 1280:
  - the list with the sentence and Try again;
  - the composer line, with a typed draft still in the box after pressing Send, and Send/Attach disabled;
  - ⌘K still returning jobs.
- **Sign in:** expire the session mid-chat; capture the line and the Sign in link.
- **Delete, deletion off:** the thread ⋯ menu with Delete disabled and its description, and the archived list's
  trash button.
- **Composer row:** 420 dock and 800×360 next to `e082956a`, after REQUIRED 4.
- **Pane host test registration** (still outstanding from round 1):
  - 800×360 strip (Close + vertical tabs, stage ≥200);
  - content box 839/840/1000;
  - 1100 popout compact;
  - 1280 explicit expansion and Back to app.

## Optional

- ⌘K chat rows read "thread ·" with a dangling dot when there is no folder, status or snippet
  (`CommandPalette.tsx:77`, also on base). Render ` · {detail}` only when `detail` is non-empty. Consider the label
  "chat" to match the new copy.
- Archived-row trash (`ThreadList.tsx:798`): a disabled button explained only by `title` gives no explanation on
  touch. Hide it while deletion is off, since the ⋯ menu carries the sentence.
- Panel "Sign in" links go to bare `/login`, so after signing in Joe lands on Today, not back in his chat. Passing
  `returnTo` today would show "Sign in to open the review.", so that would need its own notice first. Leave it for
  later.
- 800×360 sheet: the transcript is nearly gone even on base, behind the settings rows. Collapsing the
  Model/Context/Mode row behind the existing settings toggle when height < 400 would help. This is pre-existing,
  not Phase 0.
- The old landscape-strip text glyph `×` (`PanelDock.tsx:238`) is still text; the lucide `X` would match the sheet header.
