SCORES: design=9 completeness=8

# Round 3 — Design & UX judge — in-app agent browser (`agent-browser-plan.md`)

Judged at committed HEAD `7229247b`. The browser plan was last changed there. `_ask-pane-host.md` was last changed at `4f22bd30` and has no uncommitted edits. (`ask-canvas-plan.md` has uncommitted edits by another session; I judged its committed text.)

Read against:
- the context file (decisions 1–9)
- my round-1 and round-2 reviews
- the host file H1–H5
- the real code: `PanelHost.tsx` (sheet header labels, left dock), `PanelDock.tsx:77` (one `Segmented`), `proxy.ts:159–169` (signed-out redirect), `app/login/page.tsx`, `lib/dal.ts:118–123` (`homeForRole`)

I walked these flows at 360×800, at 820 iPad portrait with the keyboard, in the 420 dock and at 1280:
- Joe's one-minute review from a phone ping
- take-over of a public page
- delegated login plus staff 2FA
- Joe reviewing a staff task

## Round-2 items: verified / not fixed

All 12 are **verified fixed** in the text. Four fixes create a new problem when you walk the whole flow. Those are new required items below; they do not reopen the round-2 items.

| # | Status | Where / note |
|---|---|---|
| 1 Short review window | Verified. ≤60 s variant end to end: "…needs your OK in the next minute…", "Expires in 0:48", staff lapse copy, one item per task, staff Sites line. **New issue:** the later pages of a multi-page form now alert silently (item 1). | §3.3, §6.3, §7.1 |
| 2 Deep link + logins route | Verified. `/today?browser=&review=` goes through the `(os)` PanelHost, Back goes to Today, `/logins` sits in `(os)`, and all three Saved logins entry points are named. **New issue:** a signed-out tap loses the review (item 2). | §6.2, §6.3, §10.2 |
| 3 Public take-over cost | Verified. Confirm copy, Joe-only Don't ask again, "Private — you took over…", fresh-browser give-back, and Phase 1 permanent privacy all agree in §5.2, §6.1, §6.5 and §12. | §5.2, §12 Phase 1 |
| 4 Decision 5 on screen | Verified (a)–(d). The share-sheet limit, the "not usable on this site yet" row, and Sign in once / 2FA copy, which is honestly deferred to the Phase 4 delegated pane. **New issue:** the v1 "Ask Joe to finish" hand-off is undefined (item 6). | §5.2, §6.4 |
| 5 Don't send | Verified. Every Joe card has a refusal. Take over appears only on Joe's own tablet/computer task. | §6.3, §6.5, §1 |
| 6 Lookup card | Verified. Exact card. Facts are informational only. "Each lookup with job details needs Joe's OK." Blocked in Phase 1. | §6.3, §8.1 |
| 7 One waiting template | Verified. One template, See request vs Open review, expired/decided copy, bell outcome. **New issue:** [Ask Joe again] doesn't ask Joe (item 4). | §6.3, §6.5 |
| 8 Frames match host | Verified. The 360 selector + 44 px status row, the real 420 dock header (`follow / pop out / collapse` matches PanelHost:156–177), the 1280 left dock with the pane replacing the app view, a separate pop-out with ×, and H1 Back to app wording. | §6.3 |
| 9 Owner review layer | Verified. `OwnerBrowserReviewClaim` top layer, "‹ Back · Abigail's browser · Larson bath", no selector, Joe's thread untouched. **New issues:** Watch's Escape pauses staff (item 3); no ≥1024 placement (item 7). | §6.2 |
| 10 820 keyboard open | Verified. One 44 px row, image takes the rest, chip strip, Type it never opens the keyboard. | §6.3 |
| 11 Copy fixes | Verified, all six, including H5's adoption line. | §6.5, host H5 |
| 12 Escape order | Verified. Browser layers and nested confirms are registered. Sites review Close closes only that sheet. The public take-over confirm sits above Browser. | §6.2, host H3 |

## What's strong

- **The short-window design is now honest.** It has the exact server deadline, a seconds countdown with announcements at open/15 s/expiry, "Joe may see less than a minute", and a separate 5-minute adapter variant. An old URL resolves only its own immutable action. Joe can't approve a newer request through a stale link.
- **The owner layer is a real answer to "Joe can't open Abigail's chat".** It authorizes display only. It saves Joe's own selection and restores it untouched. Reload, logout and area loss are all covered. One owned history entry sits on top of whatever Joe already had.
- **Public take-over is now told up front,** and it costs exactly what the security model says. "Open a fresh browser" says plainly what it loses ("Pages you signed in to will need signing in again").
- **Staff/owner authority reads the same in every section.** §6.3 cards, §6.5 rows, §7.2 table and §10.2 routes agree that staff never get a working Approve button and that only login-only steps can be self-approved.
- **The 820 keyboard-open layout** is specific enough to build without guessing. It covers the 44 px row, letterboxed image, chip strip, Keyboard as the only way to open the soft keyboard, and Give back closing capture first.

## Required to reach 10

1. **§6.3 "One bell item + one editable Telegram item per task", §6.5, §12 Phase 3: every new decision must alert Joe. Only outcomes may update silently.**
   - The plan says subsequent pages and re-asks "edit the same message silently". A Telegram edit never buzzes the phone. So on a five-page staff form, Joe is alerted for page 1 only. Pages 2–5 each expire in under a minute without Joe knowing they exist.
   - (My round-2 "update one item per task" caused this.)
   - **Change:**
     - Keep one item per task.
     - A **new pending decision** re-alerts. On Telegram, delete the previous message and send a fresh one, so the chat still holds one live item. The bell item moves to the top, unread, with the normal alert.
     - Only outcome changes edit silently: approved, denied, expired, cancelled, confirmed, unknown.
     - Follow-up copy: **"Abigail needs your OK in the next minute: Send page 4 to city.example · Larson bath"**.
   - **Keep Joe on the review after he decides:**
     - The owner layer stays open showing **"Sent. Waiting for Abigail's next page."** with [‹ Back].
     - When the same task raises its next review, it replaces that content in place. No new history entry. Focus moves to its heading, with an assertive announcement **"New request from Abigail: Send page 4"**.
     - That way Joe can approve a multi-page form from one screen without going back to Telegram each time.
   - Add both to the Phase 3 notification tests.

2. **§6.3 deep link, §4.1, §10.2, §13 "What Joe must do": a signed-out tap must land back on the review.**
   - The path today:
     - `proxy.ts:159–169` sends an unauthenticated request to `/login` and **clears the query**.
     - `/login` then redirects to `homeForRole` (`lib/dal.ts:118–123`), which is `/today` with no `browser`/`review`.
   - §4.1 also forces every legacy JWT to sign in again for Browser. So Joe's first phone review after rollout lands on plain Today, and the minute runs out.
   - **Specify:**
     - **(a)** A validated same-origin return path, allowed for `/today?browser=<uuid>&review=<uuid>` (and Watch) only and carried through `/login`. After sign-in it reopens the owner layer against the server deadline. If the review has lapsed, show the existing expired copy.
     - **(b)** The login notice must not name staff or the job before sign-in: **"Sign in to open the review."**
     - **(c)** The native-app line becomes a 48 px button: **"Open in Safari to review this. [Open in Safari]"**, which opens the same URL.
     - **(d)** Under "What Joe must do", one line: set Telegram's link setting to open in Safari, so reviews use his signed-in Safari session instead of Telegram's own browser.

3. **§6.2 owner layer, Watch: leaving must not pause Abigail.**
   - Today:
     - Back, ‹ Back and Close only close Joe's viewer.
     - But "On Watch of an active task, Escape first requests owner-authorized **pause**".
   - So Joe peeks at Abigail's running task on iPad or desktop, presses Escape to leave, and stops her agent. Two exits from the same layer behave differently.
   - **Change:**
     - On Watch with no Joe control and no open review, Escape, Back, ‹ Back and Close all close only Joe's viewer. Abigail's task is untouched.
     - "Escape = Keep paused" stays for the **review sheet** only.
     - If Joe wants to stop her, give him an explicit control: **[Pause agent]** → **"Pause Abigail's agent? She'll need to tap Continue. [Pause agent] [Cancel]"**. Staff then see **"Joe paused the agent. [Continue]"**.
   - Add that state to §6.5 and to the owner-layer tests.

4. **§6.3 lapse copy, §6.5 "Approval expired", §1 Words: [Ask Joe again] must not be a button that doesn't ask Joe.**
   - On a generic lapse, the plan's [Ask Joe again] "reveals/focuses that instruction/current page" and "never replays". Staff will tap it, believe Joe was pinged, and wait.
   - **Generic held-request lapse:** **"Joe didn't answer in time. Nothing was sent. To ask again, click the button on the page again. [Back to the page]"**.
   - **Final variants:** "…Nothing was {submitted | paid | signed}. To ask again, click the button on the page again. [Back to the page]".
   - Keep **[Ask Joe again]** only for the Phase 4 pre-click adapter, where it really builds a fresh request. Update the §6.5 row and Words to match.

5. **§6.1 give-back, §5.2 step 6, §6.3 820 frames, §6.5 "Person live", §1 Words: there is no v1 "give back".**
   - In v1, every take-over context is permanently private and there are no reviewed steps.
   - Yet the plan:
     - still draws **[Give back to agent]** (820 frame and keyboard-open row)
     - still defines it as "explicitly resume"
     - still shows §6.1's **"Let the agent continue?" [Continue] [Keep paused]**
     - still uses the vault reason **"…I can fill the steps this site supports; take over for the rest."**
   - In v1 none of these can happen. Joe signs in, taps Give back expecting the agent to carry on filling, and gets a promise the product can't keep. (The "I" voice is also the only first-person agent copy in the plan.)
   - **Change, when the context is private and has no reviewed steps (all of v1):**
     - The control reads **[Done]**.
     - Login/restore case: **"Browser paused. The agent can't see pages you signed in to. Finish the form yourself — your answers are below. [Take over again] [Stop browser]"**.
     - Public take-over case: keep **"The agent can't read this page anymore. [Open a fresh browser] [Keep paused]"**.
   - Reserve **Give back to agent** and **"Let the agent continue?"** for contexts with reviewed steps (Phase 4).
   - Rewrite the vault reason without "I": **"Login pages stay private. The agent can only do this site's supported steps."**

6. **§5.2, §6.4, §6.5 "Delegated site unsupported", §10.2: define the v1 "Ask Joe to finish" hand-off.**
   - This is the only thing decision 5 does for staff in v1. Today it is one clause: "Ask Joe instead refers him to his own private sign-in task". The state row has no button, and nothing says what Joe receives or what Abigail sees afterwards.
   - **Specify:**
     - **Staff button** on that state: **[Ask Joe to finish]** → confirm **"Joe will see this task's job, sites and your answers. [Ask Joe] [Cancel]"**.
     - **Abigail's task then pauses:** **"Sent to Joe. He'll finish this in his own browser. [Close browser]"**.
     - **Joe's notification** (normal, not the one-minute variant): **"Abigail asked you to finish on city.example · Larson bath" [Open]**.
     - **What Open does:** it opens Joe's **Sites review**, prefilled for a **new Joe-owned task** in a new chat, **"Finish for Abigail: Apply for Larson permit"**:
       - same job and sites
       - Abigail's confirmed answers in Your answers, labelled **"From Abigail"**
       - no staff chat or transcript
     - **Outcome back to Abigail** as a fixed event on her task: **"Joe finished this."** / **"Joe didn't finish this."**. Any receipt reaches her only through project files Joe saves.
   - Add the route/action to §10.2 and a test to Phase 2.

7. **§6.2/§6.3: place the owner layer at ≥1024 (1280 dock, 1180 iPad landscape) and in pop-out.**
   - Only the 360 frame exists. "Top layer above `AskContentPane`" inside a 420 dock leaves Joe's Watch image at about 396×248. Joe would be confirming **"Take over from Abigail? Their control ends."** and then working the site in that space.
   - **Specify:**
     - At ≥1024 docked, opening the owner layer uses H1's explicit expansion. One header, **"‹ Back · Abigail's browser · Larson bath"**, spans the dock column and the replaced app view.
     - The left ~420 column holds task status and the review card (sticky 48 px buttons).
     - The right pane holds the live image or review image.
     - ‹ Back / browser Back restores the app view and Joe's own chat. The dock width never changes.
     - In pop-out ≥840: the same split under that header. Below 840: the 360 layout.
   - Draw one 1280 frame. Add 1280/1180/pop-out owner-layer cases to the shared fixture list.

8. **§6.3, §6.5, §7.2: remove contradictory and wrong-phase copy.**
   - **(a)** Delete §6.3's opening sentence **"Sheet chevron/× disabled in content with 'Return to Chat to close Operator.'"**. It contradicts H1/H3 and the same section's own later rule "No disabled chevron/×: content hides chevron; working × closes Operator".
   - **(b)** §7.2's **"This site needs you for the next step. Take over and click the button on the page…"** and §6.5's "Unsupported private portal" both send a phone user to a Take over control that doesn't exist on a phone. Add the phone variant: **"This site needs you for the next step. Open SJC OS on your iPad or computer to take over."**
   - **(c)** Sites review in Phase 1: show only **"This version reads public pages only. Sending job details isn't available yet."**. Hide "Each lookup with job details needs Joe's OK." and "Joe has to OK each page you send on this site…" until Phase 3. Otherwise staff are told both that pages need Joe and that nothing can be sent.

## Optional

- Host H5 ("Browser adopts this file in §6.2 (at `89b1bd6e` … its next revision consumes these corrections)") and the Canvas appendix intro still name `89b1bd6e`. Browser now re-adopts at `4f22bd30`; update both lines.
- "Open browser" means *start* in Words and the Sites review, but *show the running task* on chat cards (H1's explicit-open sense). Define both meanings in Words, or use "Show browser" on a running task's card.
- Draw a 360 Watch frame. It is the same layer with a live image and the [Pause agent] control from item 3.
- Take "Joe" in owner copy from the owner's display name.
- One-time phone tip: **"Turn your phone sideways for a bigger view."**
