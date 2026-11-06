SCORES: design=10 completeness=10

# Build round 7 (confirm): Phase 0, Design & UX judge

Branch `t3/in-app-browser-agent-tools` at `af58f7d7`. Round-6 review: `build-p0-r6-design.md` (9/9).

What I checked:
- The diff: `git show af58f7d7`, which touches `TodayWaitingSummary.tsx`, `PanelChat.tsx` and `tests/ask-panel-ssr.test.mjs`.
- The screenshots in `/home/joe/qa-sjcos/abc/shots/p0-r6b-normal/`: 48 log entries and 48 PNGs. I opened the three expiry recaptures and some regression shots.
- `shoot-p0r6.mjs`, to see what the logged checks actually test.
- `node --test tests/ask-panel-ssr.test.mjs` at HEAD: **85/85 pass**.

## Round-6 REQUIRED 1: hide the Waiting summary while signed out

**Fixed.**
- `TodayWaitingSummary.tsx:8–9` now reads `signedOut` and returns `null` when it is set.
- **`owner-desk1280-today-session-expired`**
  - The right aside no longer shows the "Waiting on me 0" card.
  - The page shows the header, the event strip and Today's brief, then the tabs with no count.
  - Below the tabs is the single "Sign in again to continue." / **Sign in** card, then This week's schedule.
- **`owner-phone360-today-session-expired`**
  - The bottom-of-page "Waiting on me" card is gone.
  - The page ends at This week's schedule, with no leftover gap.
- **Log**
  - Both shots have `todayStayed:true`, `todaySignIn:true` and `todayHref=/login?returnTo=%2Ftoday`.
  - Both have `todayFakeEmpty:false`. The script tests body text against `/Nothing else on the list|Waiting on me|all clear/i`, so this one flag covers the `waitingHidden` and `narrationHidden` checks I asked for.

## Round-6 REQUIRED 2: hide the docked narration while signed out

**Fixed.**
- `PanelChat.tsx:116–117` adds `narrate = showNarration && !signedOut`. It is used at all three call sites:
  - the bubble (`:551`)
  - the starter spacing (`:571`)
  - the transcript divider (`:587`)
- **Docked panel, `owner-desk1280-today-session-expired`**
  - The green "You're all clear…" bubble is gone.
  - The starter chips sit directly under "New chat", with no stray `mt-3` gap.
  - The only status line is the composer's "Sign in again to continue." / **Sign in**. No replacement copy was added, which is what I asked for.
- **New SSR case**
  - Signed out with `showNarration`: the `TodayWaitingSummary` markup is empty, and the PanelChat markup has no "all clear".
  - Signed in with an empty queue: both still render. This positive control guards against hiding them for good.

## Recapture: phone Queue tab after expiry

**Done.**
- `owner-phone360-session-expired-queue` shows "Queue · Priorities" with the sign-in card only.
- It has no "Waiting on me" header and no empty list.
- The log has `queueSignIn:true` and `queueFakeEmpty:false`.

## Regression check of the full normal set

- All 48 log entries have `errors: []` and `overflowPx: 0`, and none has `leakedTheirs: true`.
- **Panel expiry:**
  - `owner-desk1280-session-expired` / `owner-phone360-session-expired`:
    - The page stays on `/panel`.
    - The queue, Threads and composer each show the sign-in line.
    - Sign-in links point to `returnTo=%2Fpanel`.
    - The draft "QA draft before expiry" is kept.
  - `login-with-return` shows the return line at both widths.
- **Delete note:** `owner-desk1280-row-menu-delete` and the staff equivalent show the dimmed Delete with "Chat deletion is not ready yet. Try again later." (`deleteCopy:true`).
- **History and deep links:** same results as round 6.
  - History has `sawMine` with no leaks at every width, for both owner and staff.
  - Deep links to the other person's chat show no notice after reload, and the address has no `?c=`.
- **Signed-in positive control on screen:** the queue rail in `owner-desk1280-row-menu-delete` still shows the priorities list and the "Waiting on me" checklist.
- **`emptyFolderCopy:false`:** this is the same value as round 6. The script's "Tierney" folder expander isn't present in this seed, so it is a harness gap, not a regression.

## REQUIRED fixes

None.

## Optional (carried, not blocking)

- **Stale server-rendered content on `/today` after expiry.** The header ("$513,644 left to collect") and Today's brief ("Up next: …") were rendered at page load and stay visible. They are not false empty states, and the main column says to sign in. This falls under the app-wide expiry banner idea below.
- **`ACCESS_DENIED` on refresh** clears the queue without any copy (`TodayQueueContext.tsx:125`).
- **"Sign in" looks like body text.** Consider `font-medium underline underline-offset-2` on `AskSignInLink`.
- **Non-Ask pages.** They keep stale data after expiry with no banner. A `subscribeBackgroundAuth` banner in `app/(os)/layout.tsx` would cover them.
- **⌘K dangling dot.** "thread ·" still ends in a dangling dot (`CommandPalette.tsx:77`).
- **No `returnTo` on foreground redirects** (`lib/dal.ts:104`).
- **800×360 squeeze.** The settings rows squeeze the transcript.
- **QA harness.** Point the empty-folder probe at a folder that exists in the seed, so `emptyFolderCopy` tests something.
