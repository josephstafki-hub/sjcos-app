SCORES: design=9 completeness=9

# Build round 6 — Phase 0 — Design & UX judge

Branch `t3/in-app-browser-agent-tools` at `c42ac209`. Round-5 review: `build-p0-r5-design.md` (9/9).

Evidence:
- Screenshots in `/home/joe/qa-sjcos/abc/shots/p0-r6-normal/` (47 entries in `p0r6-log.json`) and `p0-r6-paused/`.
  - Every entry has `errors: []` and `overflowPx: 0`.
  - No entry has `leakedTheirs: true`.
- The UI diff of `c42ac209`:
  - `components/today/{TodayQueueContext,TodayCards}.tsx`
  - `components/panel/QueueRail.tsx`
  - `components/calls/CallsClient.tsx`
  - `lib/actions/{calls,inbox-drafts}.ts`
- Also read: `TodayWaitingSummary.tsx`, `TodayBody.tsx`, `PanelChat.tsx`, `PanelDock.tsx`, `lib/operator-narration.ts`, `AskSignInLink.tsx`, `BrowserPhone.tsx`.

## Round-5 REQUIRED 1: a queue cleared by sign-out must say so

**Partly fixed.** The surfaces named in round 5 are correct. Two other surfaces that read the same cleared queue still show a false empty state.

Fixed and on screen:
- **`TodayQueueContext.tsx`**
  - The latch callback at `:89` sets `signedOut` to true.
  - The refresh failure at `:126` also sets it, but only for `SIGN_IN_AGAIN`.
  - `ACCESS_DENIED` still clears the queue without the flag. This was optional in round 5 and remains optional.
- **`TodayCards.tsx:72–77`**
  - "Work list" has no count.
  - The card reads "Sign in again to continue." with **Sign in**.
  - "Up next" and "The rest · Nothing else on the list." are gone.
  - On screen in `owner-desk1280-today-session-expired` and `owner-phone360-today-session-expired`.
  - The log has `todayStayed:true`, `todayFakeEmpty:false` and `todayHref=/login?returnTo=%2Ftoday`.
- **`QueueRail.tsx:35–77`**
  - "Queue · Priorities" shows the sign-in card.
  - There is no bare "Waiting on me" header and no empty list.
  - On screen in `owner-desk1280-session-expired`.
  - The phone Queue tab renders the same `QueueRail` (`PanelDock.tsx:256`), so it is correct by construction. It was not captured; see the capture list.
- **`/panel` expiry, both widths**
  - The page stays on `/panel` and shows the sign-in line above the composer.
  - The draft "QA draft before expiry" is kept.

Still a false all-clear while signed out (REQUIRED 1 and 2 below):
- **`TodayWaitingSummary.tsx:8–22`** (the coordinator's observation)
  - The card does not read `signedOut`, so it still says **"Waiting on me 0 — Your remaining work appears here after Up next."**
  - At 360 it sits at the bottom of the page. At 1280 it sits in the right aside, two cards below the sign-in card.
  - Both read as "nothing is waiting on you". This is the same defect class as round 5, just on the one consumer of `waiting` that was missed.
- **Docked panel narration (`PanelChat.tsx:116`, `:208`, `:550`)**
  - In `owner-desk1280-today-session-expired`, the docked Operator panel on `/today` opens with the green bubble **"You're all clear — nothing promoted right now. Ask me anything, or I'll surface the next thing when it lands."**
  - `queueNarration()` (`lib/operator-narration.ts:15–16`) builds that text from the cleared `priorities`. It is a literal all-clear, shown at the same moment the main column says to sign in.
  - The composer's "Sign in again to continue." is at the bottom of the panel, below the bubble and the settings rows.
  - The `/panel` window does not show it, because `showNarration={!inWindow}` at `PanelDock.tsx:259`.

## Regression check of `c42ac209`

**Call selection** (`CallsClient.tsx:85–91` → `loadSelectedCall`)
- An explicit click now uses `requireAccess("comms")`, so on expiry it navigates to `/login`, as a user action should.
- It no longer latches the whole page into "background lost" from a click.
- The previous detail is kept when the result is `null`.
- `BrowserPhone.tsx:284` still polls `loadCall` with the background contract.
- No regression.

**Inbox foreground actions** (`inbox-drafts.ts`)
- `scoped()` now calls `requireAccess("inbox")`. `discardDraft`, `markDraftSent` (`:123`), `dismissSuggestion` (`:136`) and the `:99` action therefore redirect on expiry, where they used to throw a raw `SIGN_IN_AGAIN` error into a toast.
- This is better UX and matches every other foreground action.
- `loadDrafts` and `saveDraft` keep `backgroundScoped`, so typing and autosave still fall back to "local only" without navigating.
- The redirect has no `returnTo`. That is the same `lib/dal.ts:104` gap carried as optional, so it is not new.
- No regression.

**Ask, panel and paused states**
- All normal and paused shots match round 5:
  - history immediate and loaded at 360/390/800/820/900/1100/1280
  - deep links and reloads
  - ⌘K
  - the row ⋯ menu with its visible "Chat deletion is not ready yet. Try again later." line
  - the composer row
- The paused composer and rail copy, the dimmed Send and Attach, and the kept draft are all intact.
- No regression.

## REQUIRED fixes

1. **Hide the Waiting summary while signed out.**
   - In `components/today/TodayWaitingSummary.tsx:8`, change it to `const { waiting, signedOut } = useTodayQueue();`.
   - Directly after that line, add `if (signedOut) return null;`.
   - The main column already holds the only sign-in prompt. A second prompt is not wanted, and an empty "0" card must not be shown.
2. **Suppress the docked narration while signed out.**
   - In `components/panel/PanelChat.tsx:116`, change it to `const { priorities, waiting, refresh, signedOut } = useTodayQueue();`.
   - At `:550`, render the bubble only when `showNarration && !compact && !signedOut`.
   - At `:570` and `:586`, use the same `showNarration && !signedOut` expression so spacing does not leave a gap.
   - Add no replacement copy. The composer's "Sign in again to continue." with **Sign in** already covers it.
   - Add an SSR case to `tests/ask-panel-ssr.test.mjs` (the `__queueState` seam already exists). With `{priorities:[],waiting:[],signedOut:true}` and `showNarration`, the markup must not contain "You're all clear".

Recapture:
- `owner-desk1280-today-session-expired` and `owner-phone360-today-session-expired`. Expect no "Waiting on me" text and no "You're all clear" text, and log `waitingHidden:true` and `narrationHidden:true`.
- Add `owner-phone360-session-expired-queue`: the `/panel` Queue tab after expiry. Expect "Sign in again to continue." and no "Waiting on me".

## Optional (carried, not blocking)

- **`ACCESS_DENIED` on refresh** clears the queue without any copy (`TodayQueueContext.tsx:125`). Suggested copy: "You no longer have access to Today."
- **Sign in looks like body text.** The `AskSignInLink` "Sign in" in `text-ai-2` reads almost as body text in the shots. Consider `font-medium underline underline-offset-2`.
- **Non-Ask pages.** They keep stale data after expiry with no banner. A later app-wide `subscribeBackgroundAuth` banner in `app/(os)/layout.tsx` would cover them.
- **⌘K dangling dot.** "thread ·" still has a dangling dot (`CommandPalette.tsx:77`).
- **No `returnTo` on foreground redirects.** User-initiated non-Ask redirects go without `returnTo` (`lib/dal.ts:104`). This now also covers inbox foreground actions and call selection.
- **800×360 squeeze.** At 800×360 the settings rows squeeze the transcript.
