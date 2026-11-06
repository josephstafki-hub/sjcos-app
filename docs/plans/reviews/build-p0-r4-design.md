SCORES: design=9 completeness=8

# Build round 4 — Phase 0 — Design & UX judge

Branch `t3/in-app-browser-agent-tools` at `6efb12a3` (UI `0ade4617`, server `d9675afa`, reconcile `6efb12a3`). Base is `e082956a`.

Evidence:
- `/home/joe/qa-sjcos/abc/shots/p0-r4-normal/` (38 shots) and `p0-r4-paused/` (20 shots), each with its `p0r4-log.json`.
- The capture script `/home/joe/qa-sjcos/abc/shoot-p0r4.mjs`.
- Source at HEAD: `components/panel/{askStatusCopy.ts,AskSignInLink.tsx,ThreadList.tsx,PanelChat.tsx,useAgentChat.ts,useChatAttachments.ts}`, `proxy.ts`, `lib/dal.ts`, `lib/actions/live.ts`, `components/shell/LiveUpdates.tsx`, `lib/web-sessions.ts`, `app/login/page.tsx`, `app/api/{transcribe,tts,ai/status}/route.ts`, `lib/use-voice-available.ts`.
- `tests/ask-panel-ssr.test.mjs`.

**Shots the coordinator listed that are not in the folder:**
- `…-today900-…`: the script's Threads button was not visible, so no shot was taken.
- `…-row-menu-delete`: no `More` button was found.
- A phone360 expired-session shot: the script never takes one.

I judged those three items from code and the SSR test instead.

## Round-3 REQUIRED items

| # | Item | Status |
|---|---|---|
| 1 | Expired session says "Sign in again to continue." with Sign in | **Code fixed, screen not.** `askStatusCopy.ts:33–36` runs the exact 401 probe. `proxy.ts:161` now lets action POSTs reach their own boundary, so Ask actions return `SIGN_IN_AGAIN`. `AskSignInLink` adds `returnTo`, `validateAppReturnPath` strips `c`/`m`/`browser`/`review`, and /login says "Sign in to return to your page." All of that is right. On screen, though, the whole window leaves for a bare `/login` before Joe types anything. See finding (c) and REQUIRED 1. |
| 2 | Not-ready sentence shown on screen, not only as a tooltip | **Fixed in code.** `ThreadList.tsx:1056` renders the description as a visible second line. The SSR test (`ask-panel-ssr.test.mjs:168`) asserts that exact span with "Chat deletion is not ready yet. Try again later." The archived trash renders only when `capabilities.deleteAvailable` is true (`:819`). There is no capture, because the script found no `More` button. |
| 3 | Paused probes are not HTTP errors | **Fixed.** Paused transcribe and tts GETs answer 200 `{available:false}` with `no-store`. The paused log shows `errors: []` on all 20 shots, /today included. Voice re-probes after a successful Try again (the `recoveryGeneration` → `useVoiceAvailable(generation)` path), which also settles the round-3 optional item. |
| 4 | The failure list keeps its header, and the text link goes | **Fixed.** In `owner-phone360-history-loaded` (paused), the header reads "Threads" with ×, and the sentence and Try again sit below it in the body. The "Close Threads" text link is gone. At desk1280 the rail keeps its "Threads" header and its normal width. It has no ×, the same as the healthy embedded rail. |
| 5 | A stale-link New chat can attach | **Fixed.** In `owner-desk1280-deeplink-other`, the paperclip is at full ink beside "This chat isn't available to this account." Picking a file calls `clearUnavailable` (`useChatAttachments.ts:40`). Cancelling the picker leaves the line. |
| 6 | Handoff line for the pane-host deferral | **Fixed.** The exact sentence is under "Next visual round" in `ask-pane-host-phase0-HANDOFF.md`. |

## Coordinator findings — verdicts

**(a) Joe's seed chat is missing from his list.** Accepted as a capture artefact.
- Joe's Unfiled (1), Settled (111) and job folders all load.
- Abigail's "QA Abigail private: Larson tile order" shows only to her, with Settled (2).
- The log has `leakedTheirs:false` on all 58 shots.

**(b) Empty folder.** The copy renders in code; the capture failed again.
- `ThreadList.tsx:763` → `:786–788` renders "Empty — start a chat here." when a folder is expanded and holds no rows.
- `ask-panel-ssr.test.mjs:297` asserts it on an expanded empty Tierney folder.
- In the shot, every folder is still collapsed, so the script's XPath click never reached the chevron.
- For next time, use this locator: `page.locator('div.group\\/f', { hasText: 'Tierney' }).getByRole('button', { name: 'Expand' }).click()`, then wait about 800 ms for `setFolderCollapsedAction`.
- Not blocking: the code and the test agree.

**(c) Expired session jumps the whole window to `/login`. This is still a defect and becomes REQUIRED 1.**

Where the redirect comes from:
- `components/shell/LiveUpdates.tsx:73` polls `pollLiveChanges` every 2.5 s.
- `lib/actions/live.ts:10` calls `requireUser()`.
- With no user, `lib/dal.ts:104` runs `redirect("/login")`.
- Inside a server action, Next turns that into a client navigation of the whole window.
- Round 4 exposed this path when `proxy.ts:161` started passing `Next-Action` POSTs through. Before that, the proxy 307 made the poll fail quietly.

The shot proves the timing:
- The script waits 2.5 s after expiring the cookie, then fills `getByRole("textbox").last()`.
- That textbox was already the login form's **password** field: 15 dots, matching "QA after expiry".
- The email field shows "Please fill out this field."
- The navigation therefore came from the poll before any send.
- The login page also shows no "Sign in to return to your page." line, so the URL carried no `returnTo`.

Why this is not acceptable:
- The typed draft is lost. Panel drafts are not persisted.
- After signing in, Joe lands on Today. In the popout this means the operator window turns into a full app window instead of /panel.
- The `SIGN_IN_AGAIN` line, the Sign in link and the `returnTo` round trip that rounds 3–4 built never get a chance to show.
- It reaches beyond Ask. `LiveUpdates` is mounted in `app/(os)/layout.tsx:47` and `app/client-portal/layout.tsx:103`. Every open page, with any unsaved form, now gets yanked to the staff sign-in within 2.5 s of expiry, and so does a portal client.

The fix belongs at the poll, not the proxy. The proxy passthrough is right for Ask, and user-initiated actions that hit `requireUser` may still go to /login.

**(d) Stale ⌘K open of an archived chat.** Correct as captured.
- Archived chats remain Joe's, and `loadConversation` gates on owner plus `deleted_at`, not on archive.
- `owner-desk1280-cmdk-stale-open` opens "QA Joe private: Spaeth schedule" with the list intact and no notice.
- The no-button unavailable line is already proven by the deep-link shots.

## Captures judged

- **History immediate:** "Loading chats…" with no groups at phone360/390, land800 and ipad820, as both people. This was not captured on the /today 900 sheet, but it is the same `ThreadList` and the same branch.
- **History loaded:** correct for both people at every width. No overflow anywhere.
- **Deep link `?c=<other>`:** at 1280 and 360 the composer line has no button, the viewer's own list stays, `c` leaves the URL, Attach is enabled, and reloading shows no notice. The title is "New chat".
- **⌘K "QA":** returns only the viewer's own chat. The "thread ·" dangling dot is still there; it is pre-existing on base (optional below).
- **Paused:**
  - The phone History shows the header with × and the sentence over Try again.
  - With History closed, the composer at 360 and 1280 keeps "QA draft that must stay", with Send and Attach dimmed and the mic hidden.
  - The rail and composer both read the fixed paused sentence. The queue and Waiting on me still render.
  - `errors: []` throughout.
- **Composer rows:** at 1280 the controls are 28 px. At 800×360 the transcript is squeezed behind the settings rows, which is pre-existing (optional below).

## REQUIRED fixes

1. **A background poll must never navigate on session expiry.**
   - In `lib/actions/live.ts:9–12`, replace the body with:
     ```ts
     export async function pollLiveChanges(since: number | null): Promise<LiveChanges> {
       const user = await getCurrentUser();
       if (!user) return { cursor: since ?? 0, scopes: [], agentScopes: [] };
       return getLiveChanges(since);
     }
     ```
     Import `getCurrentUser` from `@/lib/dal` and drop `requireUser`.
   - This leaves the window where it is. The next Ask call, either the 30 s list reload or Send, returns `SIGN_IN_AGAIN`.
   - `pollNotificationCenter` already returns `null` this way, so leave it alone.
   - Do not revert `proxy.ts:161`.
   - Recapture `owner-desk1280-session-expired` and `owner-phone360-session-expired` as follows:
     1. Open /panel and type "QA after expiry" into the composer **before** expiring the cookie.
     2. Expire the cookie and wait 4 s (past one poll). Assert the URL is still `/panel`.
     3. Press Send.
     4. Expect "Sign in again to continue." with **Sign in** at `href="/login?returnTo=%2Fpanel"`, and the draft still in the box. Open History and expect the same line under the "Threads" header.
     5. Click Sign in. Expect "Sign in to return to your page." Sign in, and expect to be back on `/panel`.

## Next-round capture list

- The expired-session sequence above, at desk1280 and phone360.
- The row ⋯ menu with deletion off, at 1280. Hover the row first (`row.hover()`), then click `getByRole('button', { name: 'More' })`. Expect the second line under Delete: "Chat deletion is not ready yet. Try again later."
- An empty folder expanded with the locator in (b).
- The /today 900 sheet, both immediately after opening History and once loaded.

## Optional

- ⌘K chat rows: "thread ·" has a dangling dot (`CommandPalette.tsx:77`, pre-existing). Render ` · {detail}` only when there is detail, and use the label "chat".
- User-initiated non-Ask actions still `redirect("/login")` with no `returnTo` (`lib/dal.ts:104`). A later app-wide pass could add `returnTo` from the action's Referer through `validateAppReturnPath`.
- The 800×360 sheet transcript is nearly hidden behind the settings rows, which is pre-existing. Fold the Model/Context/Mode row behind the settings toggle when the height is under 400.
