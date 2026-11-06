SCORES: design=9 completeness=9

# Build round 5 — Phase 0 — Design & UX judge

Branch `t3/in-app-browser-agent-tools` at `0cc5287b`. Round-4 review: `build-p0-r4-design.md` (9/8).

Evidence:
- `/home/joe/qa-sjcos/abc/shots/p0-r5-normal/` (45 shots) and `p0-r5-paused/` (20 shots), each with its `p0r5-log.json`. Every entry has `errors: []`, `overflowPx: 0` and `leakedTheirs: false`.
- The diff of `0cc5287b`: `components/shell/{backgroundAuth.ts,LiveUpdates.tsx}`, `lib/background-result.ts`, `lib/actions/{live,today,workbench,calls,inbox-drafts}.ts`, `components/panel/{useAgentChat.ts,LiveActionNav.tsx,PanelQueueProvider.tsx,WorkbenchPanel.tsx}`, `components/today/TodayQueueContext.tsx`, `components/{calls,inbox,floor,unsorted}/*`, `app/api/ai/status/route.ts`, `lib/ask-health.mjs`.

## Round-4 REQUIRED 1: a background poll must never navigate on expiry

**Fixed and on screen.**
- `lib/actions/live.ts:10–12` returns `{ok:false, code:"SIGN_IN_AGAIN"}` instead of calling `requireUser()`. Five more background reads do the same: `refreshTodayQueue`, `getWorkbenchAction`, `loadCall`, `loadDrafts` and `saveDraft`.
- `components/shell/backgroundAuth.ts` latches once per document. `LiveUpdates`, the queue, Workbench, LiveActionNav, the inbox drafts, the browser phone, the floor designer and Unsorted all stop polling and stop `router.refresh()` after the latch.
- `useAgentChat.ts:371` subscribes to the latch, so Ask shows the line **without** waiting for Send. `retry` and a successful `loadConversation` call `resumeBackgroundAuth()`.
- `owner-desk1280-session-expired`:
  - The URL stays `/panel`.
  - "Sign in again to continue." with **Sign in** appears under the Threads header and above the composer.
  - The composer still holds "QA draft before expiry".
  - The log has `signInHref=/login?returnTo=%2Fpanel` and `draftKept:true`.
- `owner-phone360-session-expired` shows the same on the Chat tab, with the settings rows intact and no overflow.
- `owner-*-login-with-return` shows "Sign in to return to your page." above the form at both widths.
- Signing in and landing back on `/panel` was not captured. The `validateAppReturnPath` round trip was already checked in round 4, so this is not blocking.

## Next-round capture list from round 4

- **Row ⋯ menu:** done for owner and staff. Delete is dimmed, with the visible second line "Chat deletion is not ready yet. Try again later." The menu fits inside the 1280 rail.
- **Empty folder:** accepted as reported.
  - Tierney expands to "Settled (7)", so it is not empty and the empty copy correctly stays hidden.
  - The empty case is covered by `ThreadList.tsx` and the SSR test.
- **/today 900 sheet:** the loaded state was captured. Threads sits beside Chat with the viewer's own chats (Unfiled 2 · Settled 111, then job folders). The "immediately after opening" shot is missing. It is the same `ThreadList` branch already captured as immediate at 360/390/800/820, so this is not blocking.
- **Paused:**
  - Both the rail and the composer show "Chats are paused while SJC OS checks its records. Try again in a few minutes." with Try again.
  - The draft is kept, and Send and Attach are dimmed.
  - The queue still renders.
  - There are no errors.

## Regression check of `0cc5287b`

- **Ask / panel:** no regressions in any normal or paused shot. Healthy chats and rails render as they did in round 4.
- **Inbox drafts:** after the latch, the draft sync falls back to its existing "local only" status. Typed text stays in the box and in local storage. Acceptable.
- **Floor designer and Unsorted:** focus and interval refreshes now probe `pollLiveChanges` first, and on expiry they leave unsaved state in place. Acceptable.
- **`/api/ai/status` `diagnosis`:** the route is owner-only and no UI renders the diagnosis. There is nothing to judge visually.
- **Today queue on expiry: NEW DEFECT, REQUIRED 1 below.**
  - `TodayQueueContext.tsx:87` (subscribe) and `:123` (refresh failure) call `setPriorities([]); setWaiting([])` when the latch fires.
  - `LiveUpdates` is mounted on every `(os)` page, so within about 2.5 s of expiry a `/today` tab left open shows:
    - "Work list" with a count of 0
    - an empty "Up next" box
    - "The rest 0 · Nothing else on the list." (`QueueList.tsx:61–62`)
  - Nothing on the page says the person was signed out.
  - This screen tells Joe his work is done when the page has only lost its session. That is a false all-clear.
  - The panel shows the same blank state. In `owner-desk1280-session-expired`, the Queue · Priorities pane is blank apart from a bare "Waiting on me" header. On a phone the Queue tab has no sign-in line at all, because the line is on the Chat tab.
  - Clearing private rows after sign-out is the right privacy call. The page just has to say why it is empty.

## REQUIRED fixes

1. **A queue cleared by sign-out must say so, not look empty.**
   - **`components/today/TodayQueueContext.tsx`:**
     - Add `const [signedOut, setSignedOut] = useState(false)`.
     - Set it to `true` in the `subscribeBackgroundAuth` callback at `:87`.
     - Also set it to `true` in the `refresh` failure branch at `:123–124` when `snap.code === "SIGN_IN_AGAIN"`.
     - Add `signedOut` to `QueueState` and to the provider value.
   - **`components/today/TodayCards.tsx:70–90`:**
     - When `signedOut` and `view === "active"`, render this in place of the "Up next" block and `<QueueList>`:
       ```tsx
       <div className="rounded-lg border border-rule-soft bg-card px-3 py-2">
         <p className="text-body text-ink-2">Sign in again to continue.</p>
         <AskSignInLink />
       </div>
       ```
     - Omit the `count` on the "Work list" segment while signed out. Use `count: signedOut ? undefined : onYou`.
   - **`components/panel/QueueRail.tsx:31` and the panel's "Waiting on me" block:**
     - When `signedOut`, render the same two lines, "Sign in again to continue." plus `<AskSignInLink />`, under the "Queue · Priorities" header.
     - Do not render the empty list or the bare "Waiting on me" header.
   - `AskSignInLink` already builds `returnTo` from the current URL, so `/today` returns to `/today`. It can move to `components/shell/` if you prefer a neutral home, but the copy and behaviour stay the same.
   - Capture `owner-desk1280-today-session-expired` as follows:
     1. Open `/today`, expire the cookie and wait 4 s.
     2. Expect the URL to stay `/today`.
     3. Expect the line "Sign in again to continue." with Sign in at `href="/login?returnTo=%2Ftoday"`.
     4. Expect no "Nothing else on the list."
   - Recapture `owner-desk1280-session-expired` and `owner-phone360-session-expired`. On the phone, expect the Queue tab to show the same line.

## Optional

- `refreshTodayQueue` returning `ACCESS_DENIED` also clears the queue with no copy (`TodayQueueContext.tsx:122`). Use "You no longer have access to Today." when a staff login loses the area mid-session.
- Pages other than Today and Ask keep their last data with no notice until a user action redirects to a bare `/login`. This matches pre-round-4 behaviour, so it is not a regression. A later app-wide pass could subscribe one banner in `app/(os)/layout.tsx` to `subscribeBackgroundAuth`, with the copy "Sign in again to continue." plus `AskSignInLink`.
- Carried from round 4:
  - ⌘K "thread ·" has a dangling dot (`CommandPalette.tsx:77`).
  - User-initiated non-Ask actions redirect without `returnTo` (`lib/dal.ts:104`).
  - At 800×360 the settings rows squeeze the transcript.
