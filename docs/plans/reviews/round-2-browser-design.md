SCORES: design=8 completeness=8

# Round 2 — Design & UX judge — in-app agent browser (`agent-browser-plan.md`)

Judged at branch HEAD `7405f261`. The browser plan was last changed in `89b1bd6e`; `_ask-pane-host.md` was last changed in `dc36db88`. I read these against:
- the context file (Joe's decisions 1–9)
- my round-1 review
- `ask-canvas-plan.md` §1 Words, §3 and §4
- the real panel code: `PanelHost.tsx` (the dock `<aside>` comes first, so it is on the **left** and the app view is to its right; there is a 66dvh drawer), `PanelWindow.tsx` (the `/panel` route), `PanelDock.tsx` (the `Segmented` view switch, 560/880), and `app/(os)/*` routes.

## Round-1 items: verified / not fixed

All 15 are **verified fixed**. A few have new problems from the fix itself; those are listed as new items below.

| # | Status | Where |
|---|---|---|
| 1 Shared pane contract | Verified. Both plans now adopt `_ask-pane-host.md` H1–H5: `AskContentPane.tsx`, split at 840 px, Chat 340 / pane 480 / 12 px gutter, the dock never auto-expands, one `Segmented` control, and a fixed attention priority. Leftovers are in items 8 and 11. | §6.2, Canvas §3 |
| 2 "Operator" name + defined words | Verified. | §1 Words |
| 3 Presence survives Chat/Canvas | Verified. The pause copy is "You left the browser. The agent paused. [Continue]". | §3.3, §6.1, §6.2 |
| 4 Chat side of a running task | Verified: status row, event card, activity lines, and the outcome card above `<details>`. The wireframe has no view selector (item 8). | §6.3 |
| 5 Start flow + Sites review | Verified: Browser button beside Attach, the agent's proposal card, derived "Staff need", Add a site, grouped resource sites, the 32-origin limit. | §6.3, §8.1 |
| 6 "Send this page" card | Verified: separate from the final card, Phase 1 copy, agent paused. Joe has no "don't" button (item 5). | §6.3, §6.5 |
| 7 Private portal flow | Verified: field picking, Your answers, the up-front expectation. | §6.3, §6.4 |
| 8 Joe's phone review | Verified: notification copy, 360 sheet, presence states, decision states. The deep link is wrong (item 2). | §6.3 |
| 9 Decision 6 | Verified. §7.2 has no staff company category, and §14 points at decision 5. | §7.2, §14 |
| 10 Missing states | Verified, all ten. | §6.5 second table |
| 11 Copy (sharing labels, file names, device text) | Verified. | §6.3, §6.4 |
| 12 Wireframe fixes | Verified: one action, toolbar, no address bar, Page up/down only when paused, 1180, sheet chrome. | §6.3 |
| 13 Type tokens + targets | Verified: 13/14/17 and 44/48/56. | §1, §6.2 |
| 14 Accessibility loose ends | Verified: accessible name, reduced motion, Pause live view, capture bar, focus order. | §6.1, §6.5 |
| 15 Joe's In use list | Verified, and the identity limit now applies only to staff. | §3.3, §6.3 |

## What's strong

- **The shared host file is the right fix.** Both plans now point to one source for placement, Back/Escape, and which pane wins. The Browser plan fills every "Browser plan decides" slot explicitly (§6.2). One example: the take-over leave guard **"Pause browser and return to Chat? [Pause and return] [Keep browser open]"** never quietly hands control back to the agent.
- **Staff vs owner is honest everywhere.** Staff never see a working Approve button. Joe's phone review gives the reason when Pay is disabled ("Abigail left the browser…"). Required areas are derived, never picked.
- **The states table is now close to complete,** with careful wording such as "Fee: not shown", "The site may have received it…" and "Nothing was submitted by this approval."
- **Your answers + Type it** solves the most common v1 job (filling an unknown city portal) without a clipboard and without the model reading the page.
- **Tokens, targets and accessibility** are stated in the app's own terms and match Canvas.

## Required to reach 10

1. **§6.3 phone review, §6.5, §7.1: design the short review window that most v1 reviews will have.**
   - §7.1 says a review that depends on a held network request goes stale at **60 s**. Only a reviewed adapter's pre-click review gets 5 min.
   - v1 has no adapters (decision 4). So a staff take-over click on Next or Submit on a generic portal, or a disguised final click, gives Joe about one minute from a Telegram ping in the field.
   - Every screen in the plan shows "Expires in 3:12" and "expires 2:41 PM", so none of them fits this case.
   - Specify the short variant end to end:
     - Notification: **"Abigail needs your OK in the next minute: Send page 3 to city.example · Larson bath"**
     - Countdown on the phone: **"Expires in 0:48"**
     - Staff side: **"Waiting for Joe · keep this screen open · 0:48 left"**
     - When it lapses, staff see: **"Joe didn't answer in time. Nothing was sent. Click the button on the page again to ask Joe again."**
   - Say whether the bell and Telegram items are updated or new on each re-ask. Recommended: update one item per task, so a five-page form doesn't send Joe five separate pings.
   - Add one line to the Sites review, shown to staff on a company task that has no reviewed steps: **"Joe has to OK each page you send on this site, usually within a minute. Let him know before you start."**

2. **§6.3, §6.2, §10.2: the phone deep link and the logins page point at the pop-out window.**
   - `app/panel/page.tsx` renders `PanelWindow`. On mount it calls `writePanelState({where:"window"})`, which hides the dock in every other app tab in that browser. It has no Shell, no tab bar, and none of the "Operator ⌃ ✕" sheet chrome the 360 review wireframe draws.
   - So `/panel?review=<actionId>` would open the pop-out on Joe's iPhone and un-dock his other tabs.
   - **Fix:** link to an `(os)` route that `PanelHost` handles with the H3 pane query, e.g. **`/today?browser=<taskId>&review=<actionId>`**. That opens the Operator sheet full-height straight into the review. Say what Back does there: it goes to Today, never to a blank pop-out.
   - Move **`/panel/logins`** into `(os)` too (e.g. `/logins`, `ai` area), so it has the normal shell on a phone.
   - Name the entry points to Saved logins: the Browser empty state link **"Saved logins"**, the toolbar button (already drawn at 1280), and the Settings › Team area for Joe's sharing.

3. **§5.2 step 5–6, §6.1, §6.3, §6.5, §12 Phase 1: show what Take over costs on a public page.**
   - Rule: every take-over context becomes private for the rest of its life. So taking over a public page just to close a cookie banner or scroll means the agent can never read that page again.
   - The plan never tells the person this before they tap.
   - After give-back, the copy they get is "Login pages stay private…", and the page label says "Private — login or account details" even though no login was involved.
   - Specify the following:
     - **Confirm on a public page:** **"Take over? After you take over, the agent can't see this page anymore. To let it keep reading, open a fresh browser afterwards. [Take over] [Cancel]"** (Joe can tick **"Don't ask again"** for himself.)
     - **Label after a public take-over:** **"Private — you took over. The agent can't see this page."**
     - **Give-back copy, public case:** **"The agent can't read this page anymore. [Open a fresh browser] [Keep paused]"**
     - **What "Open a fresh browser" does:** "Starts a new browser for this task on the same sites. Pages you signed in to will need signing in again."
     - **Phase 1:** it lists desktop/iPad take-over, but private take-over is only enabled in Phase 2. Say that Phase 1 take-over is already permanent-private (or that Phase 1 has no take-over), and make the §12 phase lists agree.

4. **§5.2, §6.4, §6.5, §7.2: say on screen what decision 5 can do in v1, and cover staff sign-in on Joe's login.**
   - Shared logins only work through a reviewed adapter, and v1 ships none. So when Joe ticks Abigail on "City permit office", her every use ends in "This site can't safely share a login yet."
   - Specify:
     - **(a) Share sheet line under the names:** **"Abigail can use this login only on sites with supported steps. City permit office: not supported yet — Joe signs in for her."** Staff rows then read **"From Joe · not usable on this site yet"** until an adapter exists.
     - **(b) The staff sign-in card** for a delegated login, which §7.2 allows but which has no copy: **"Sign in to city.example with Joe's saved login? [Sign in once] [Don't sign in]"**. Add it to Words and to §6.5.
     - **(c) Staff 2FA/CAPTCHA on Joe's login.** Staff can't take over, and Joe can't take over on a phone.
       - Staff copy: **"This site wants a code. Joe has to finish signing in on an iPad or computer. [Ask Joe]"**
       - Joe's notification: **"Abigail needs you to finish signing in to city.example · Larson bath"**. This opens the In use row on a tablet or computer; on a phone it shows the tablet instruction.
     - **(d) The delegated staff pane** (adapter controls, no image): draw one 360 frame, or state plainly in §6.4 that it ships with the first adapter (Phase 4) and that v1 staff see (a)–(c) only.

5. **§6.3, §6.5, §8.2, §1 Words: every review card needs a "don't" button for Joe.**
   - **Mid-form card:** Joe currently gets **[Send once] [Take over]**. That gives him no way to refuse, and Take over doesn't work on his phone or on a staff task. Use **[Send once] [Don't send]**, and add Take over only on Joe's own task on a tablet or computer.
   - **Upload row:** "Send this file / Cancel" → **[Send once] [Don't send]**.
   - Add **"Don't send"** and its outcome **"Not sent."** to Words and §6.5.

6. **§8.1 outbound data policy, §6.5, §7.2: design the lookup card.** Any read or search that sends job facts (address, parcel, license) needs a person's review, and company facts need Joe. That is the first thing a permit task does, and there is no card for it.
   - Copy: **"Look up 123 Main St on city.example? This sends the job address to the site."**
     - Joe: **[Send once] [Don't send]**
     - Staff: **"Waiting for Joe."**
   - State where it sits (the same place as the mid-form card) and that it uses the short window from item 1 if a request is being held.
   - Recommended, if the security lens agrees: a **"Facts this task may send"** list on the Sites review (address, parcel #, license #, each with its exact value and site). Joe OKs it once there, so lookups with exactly those values don't ping him each time.
   - If that is rejected, the Sites review must say: **"Each lookup with job details needs Joe's OK."**

7. **§6.3, §6.5, §7.2: one staff "Waiting for Joe" card, plus the expiry and decided states for both people.** Today there are four variants:
   - "Waiting for Joe. Nothing has been submitted."
   - "…Nothing has been paid."
   - "Waiting for Joe · keep this screen open · 3:12 left"
   - §7.2's "Cannot approve. Waiting for Joe…"

   Pick one template and use it everywhere: **"Waiting for Joe to {submit the application | pay $125.00 to City of Fargo | sign | send this page}. Nothing has been {submitted | paid | signed | sent}. Keep this screen open · {m:ss} left. [Cancel request]"**. Then add:
   - Staff after expiry: **"Joe didn't answer in time. Nothing was {verb-ed}. [Ask Joe again]"**
   - Joe opening an expired or already-decided link: **"This review expired at 2:41 PM. Nothing was paid. Abigail can ask again."** / **"You already said don't pay."** / **"Already paid — Receipt saved."**
   - The bell item changes to the outcome; it is not left as "needs your OK".
   - The staff "Open review" button: the Words table makes it mean two things. Recommended: staff see **[See request]**, and "Open review" stays Joe's decision.

8. **§6.3 wireframes: match the host contract and the Canvas frames.**
   - **(a) 360 Chat-during-task frame.** Draw the H2 selector row **"Queue · Chat · Canvas · Browser•"** between "Operator ⌃ ✕" and the agent header, as Canvas §3.1 does. Also draw the **420 dock** version with the real docked header ("Operator [follow] [pop out] [collapse]", no ⌃ ✕). Say when the 44 px status row disappears: no task, or "Browser closed."
   - **(b) 1280 dock frame.** Redraw it like Canvas §3.1's dock frame: the ~420 Operator column with its own header and selector on the left, and the pane replacing the app view with **Back to app** at the pane's top. Remove the full-width "Operator · Larson bath [Back to app] [Dock back if popout]" header; pop-out is a separate split frame with × `aria-label="Close browser"`, per H1.
   - **(c) Wording.** Change "Back to app restores prior width without writing layout.width" to **"Back to app restores the app view (route, scroll) and focus; the dock width never changes"**, matching H1.

9. **§6.2/H3: owner review and In use watch need a home in the host model.**
   - H2 selection is per person and thread, and a Browser snapshot's `thread_id` is the *staff* task's conversation. Joe can't open Abigail's chat.
   - So "‹ Chat" on Joe's review sheet, and the Queue/Chat/Canvas/Browser row drawn above it, have no defined meaning.
   - **Fix:** a cross-person owner review or watch opens as its own top H3 layer over whatever Joe was viewing:
     - header **"‹ Back · Abigail's browser · Larson bath"**, with no view selector
     - one owned history entry
     - Escape = **Keep paused**
     - closing it returns to Joe's own thread untouched
   - Redraw the 360 owner review frame with that header, and use the same layer for the In use row's join.

10. **§6.3 820 iPad portrait: say what collapses when the soft keyboard is up.**
    - At 820×1180, the stacked rows (sheet header, selector, ‹ Chat, site, tabs, state, capture bar), a ≈490 px image, the 56 px toolbar and four answer rows add up to ≈1000 px. With the keyboard open, only ≈780 px is visible. "Your answers remains usable above soft keyboard" can't be true as drawn.
    - Specify the keyboard-open layout:
      - the chrome collapses to one 44 px row: **site · You're in control · [Give back to agent]**
      - the image keeps the rest of the height
      - Your answers becomes one horizontally scrolling row of 44 px **[Address ▸]** chips directly above the keyboard
    - **Type it** never needs the soft keyboard, so tapping it must not open it.

11. **§6.5 and `_ask-pane-host.md`: small copy and consistency fixes.**
    - "Other controller: 'Open on your other device.'" reads as an order. Use **"You're in control on your other device. [Take over here]"**.
    - The Phase 1 final card **"This version stops here. Nothing was submitted. [Don't submit] [Close]"** has two buttons that do the same thing → **[Close]** only.
    - In use row: **"Abigail · Permit — Larson bath · Agent is working [Watch]"**. "Open review" is reserved for a decision (item 7).
    - Merge the two "Idle warning" rows into one, keeping the newer one with [Keep open] and the pending-review rule.
    - "Start/run ended: Continue with Claude" → **[Continue]** (Words).
    - `_ask-pane-host.md` H5's last paragraph ("The companion Browser plan has not been edited by this document's author…") is now false. Replace it with "Browser adopts this file in §6.2."

12. **§6.2/H3: list Browser's layers in the Escape/close order.** H3 lists only Canvas layers. Add Browser's, innermost first:
    - Add a site
    - Sites review / Saved logins / Save to project files sheets
    - review sheet (Escape = Keep paused)
    - "Pause browser and return to Chat?" confirm
    - Browser → Chat (or Back to app)

    Say that the Sites review's **Close** is a sheet close, not a pane exit, so it doesn't conflict with "Canvas/Browser have ‹ Chat, no pane ×".

## Optional

- In content mode the full-height sheet chevron is drawn **⌃(off)**; Canvas draws **⌄(off)**. Use one.
- Take "Joe" in owner copy from the owner's display name.
- iOS app: when a browser review notification opens the native app, show **"Open in Safari to review this."**
- Phone viewing: a one-time **"Turn your phone sideways for a bigger view."**
- Remove-access confirm with the name: **"Remove Abigail's access to City permit office? Their open browser will close."**
