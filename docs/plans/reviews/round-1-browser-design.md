SCORES: design=6 completeness=6

# Round 1 — Design & UX judge — in-app agent browser (`agent-browser-plan.md`)

Judged at HEAD `a30a530b` against the real panel and its context:
- `components/panel/PanelHost.tsx`: docked `<aside>` at `layout.width` on ≥1024 px. Below that, a sheet that is a 66dvh drawer off the home page and full-height on /today. The sheet header reads **"Operator"**, the tablet launcher pill reads **"Operator"**, and the sheet passes a synthetic `PanelDock width={400}`.
- `PanelDock.tsx`: the `Segmented` **Queue / (Threads) / Chat** switch below 560, queue column at 560, thread rail at 880.
- `panelStore.ts`: default dock 420, max 1000.
- `PanelChat.tsx` header: agent picker, job chip, history, New chat. The composer has an Attach button and a mic, but **no tool menu**.
- `MobileTabBar.tsx`: the 5th tab is **"Operator"**.
- `GrantCard.tsx`: "Approve once / Deny".
- `RunReview.tsx`: `<details>` log + changes.
- `lib/permissions.ts` area labels: "Projects", "Compliance", "AI operator panel", …
- Type scale in `app/globals.css`: body 13, subheading 14, heading 17.

Also read: `docs/plans/ask-canvas-plan.md` §3, Joe's round-2 decisions 5–6 in `_context-agent-browser-canvas.md` (added after this plan was written), and the words memory.

---

## What's strong

- **The Words table (§1)** is the right start. It bans "broker / lease / CDP / capability / egress" from the screen. The verb set "Submit once / Pay $125.00 once / Don't pay" matches GrantCard's "Approve once" and never offers an ambiguous Dismiss.
- **The §6.5 states table is long and honest.** "Fee: not shown" is never $0. "The site may have received it. Check the site before trying again." gives no Retry submit. "Review expired. Nothing was submitted by this approval." is careful not to over-claim. "Preparing your review. Nothing has been submitted." is right too.
- **Phone take-over is cut on purpose and said on screen** ("Take over on a tablet or computer"), as the context file requires. Phone viewing and phone approval still work.
- **Control hand-off is safe in the UI as well as on the server.** "Finishing the last step…" fences the click race. Control expiry never returns to the agent by itself. "Let the agent continue? [Continue] [Keep paused]" is explicit. Escape never approves.
- **Staff never see a fake Approve button.** "Waiting for Joe — $125.00 to City permit office. [Open review] [Cancel request]" is right. There is no grant ID and no settings link.
- **Accessibility is considered:** frames are not live regions, state changes are polite, errors are alerts, the review sheet traps focus and returns it to Open review, and a screen-reader Page controls list exists. Remote keyboard capture is opt-in.
- **Measuring the available Ask pane width**, not the viewport, is the right model and matches Canvas's "measured Ask panel content width".

---

## Required to reach 10

1. **§6.2, §6.3, cross-plan: settle one shared pane contract with `ask-canvas-plan.md` §3 and write it the same way in both plans.** Today the two plans conflict on five points:
   - **Host component and owner.** Browser says `AskContentPane.tsx` is "the single host". Canvas says "Canvas owns" `PanelContentPane.tsx`, with `activePane:'none'|'canvas'|'browser'`. Pick one name and one owner. Recommended: `PanelContentPane.tsx` with Canvas's `activePane` reducer, plus Browser's typed `{kind,…,attention}` snapshot as the registry entry.
   - **Split breakpoint.** Browser splits at **720** (chat 320 + browser 380). Canvas splits at **960** (chat 360 + pane 480). Use one breakpoint for both. Recommended: 960 / 360 / 480. A 1280×800 remote page at 380 px is a 0.3× image, too small to take over on.
   - **Default 420 dock at a 1280 viewport.** Browser auto-expands "over the app view to 960 px with Back to app". Canvas says "never unexpectedly grow it… the usual 420 px dock therefore uses tabs". State one rule. Recommended: **Open browser** (an explicit click) expands to a temporary 960 px workspace. It is not written to `layout.width`, and **Back to app** restores the previous width. Canvas never auto-expands. Add the same sentence to Canvas §3.
   - **Narrow selector.** Browser's phone wireframe uses a header "‹ Chat  Browser  ⋯". Canvas uses a tab row `[Chat] [Canvas · New] [Browser]` and "‹ Back to chat". The real dock already shows a `Segmented` Queue/Chat row, so stacking a second segmented row at 360 is too much. Specify one control. Recommended: **extend the existing PanelDock `Segmented`** to `Queue · Chat · Browser · Canvas`, showing only the views that exist. Inside a content view, the back control is **"‹ Chat"** in both plans.
   - **Attention priority.** Canvas says a new canvas never steals focus from a Browser take-over or approval. Browser must say the reverse case: while Canvas is showing, a Browser "Needs you" never switches panes on its own. It shows **"Browser · Needs you"** on the selector, plus the chat chip in item 4.

2. **§1 Words, all wireframes: use the panel's real on-screen name.** Every screen that ships today says **"Operator"**: the sheet header, the docked header, the tablet pill, and the phone tab. The plan's wireframes say "Ask · Lake bath". Either keep "Operator" in UI copy ("Operator · Lake bath"), or make the rename to "Ask" an explicit, app-wide line item. Don't ship one panel called both. Add the chosen word to the Words table. Also add these words, which the plan uses on screen but never defines: "Open review" (Joe only), "Page controls", "Keyboard", "Earlier view", "Back to app".

3. **§3.3 + §6.1: presence must not pause the agent when the person only switches to Chat.** As written, "Closing or hiding a pane drops presence", and 15 s without a visible-view heartbeat pauses the agent. Below the split breakpoint there is only one pane. So on a phone, on an iPad portrait and in the 420 dock, reading or answering the agent in **Chat** pauses the browser, which makes the main loop (watch, answer a question, keep watching) unusable. Define presence as "Operator panel open + `document.visibilityState==='visible'` + the task's conversation selected", not "Browser pane visible". The live stream may stop while the pane is hidden, to save bandwidth, without dropping presence. Say what *does* pause it: the panel closed, the app backgrounded, another thread selected. Copy: **"You left the browser. The agent paused." [Continue]**.

4. **§6.2, §6.3: wireframe the Chat side of a running browser task at 360 and 420.** This is the screen people will look at most, and it is only described in prose.
   - Show where the **"Browser · Agent is working"** / **"Browser · Needs you"** chip sits in the real header. The agent picker, job chip, history and New chat already fill one line at 400, so recommended: a full-width 44 px second row under the header, with the whole row tappable to open Browser.
   - Show the in-transcript event card and its exact copy. For example: **"Browser · city.example · Reading the permit page"** with [Open browser], and at the end of the turn **"Agent turn finished. Browser is paused."**
   - Show what the activity lines say for browser steps: **"Opened city.example"**, **"Filled 6 fields"**, **"Waiting for you to sign in"**. No page text, and nothing at all from a private page.
   - Show the final outcome card that stays in the thread and in RunReview: **"Submitted to city.example · Reference 2026-1182 · [Open receipt]"** and **"May have been received — check the site"**. Say whether it renders above the `<details>` log in `RunReview.tsx`.

5. **§6.2, §8.1: wireframe the start flow. Today it has no screen, and part of it is Joe-hostile.**
   (a) Name the real entry point. There is no "Ask composer tool menu". Pick one: a **Browser** icon button beside Attach in the composer (44 px), a `/browser` slash command, or both. Plus the agent's proposal card **"Use the browser for this task?" [Review sites]**.
   (b) Wireframe the **Sites review** sheet at 360 and 420/side-sheet: purpose (one line, prefilled from chat), job picker (reuse `JobPicker`), site list, [Add a site], [Open browser], [Cancel].
   (c) **Required areas are not a picker Joe fills in.** Derive them from the task kind and job: permit → Projects + Compliance, using the `lib/permissions.ts` labels. Show them read-only on one line: **"Staff need: Projects, Compliance"**. Show that line only to Joe, and only when a staff member could later run the task. Nobody should be asked to pick "areas" to open a website.
   (d) **Add a site** takes a pasted address or a typed name. It shows **"Site: https://www.cityoffargo.com"** before Add, and on a bad entry **"Use an https website address."**
   (e) **Resource origins.** A real portal loads fonts, scripts and payment widgets from several other hosts that Joe can't judge. Specify the screen: the agent's or adapter's proposed resource sites are grouped as **"Also loads files from 5 other sites [Show]"** with one decision for all of them. Say what happens when one of them is blocked mid-task: **"Part of this page was blocked: {origin}. [Allow for this task] [Keep blocked]"**, which only a present person can choose. Then say whether 12 sites per task is enough once resources count toward it.

6. **§7.1, §6.5: design the mid-form "send this page" approval. In v1 it is the most common card, and it has no copy and no wireframe.** §7.1 pauses every unknown POST, every autosave and every "Next" on a generic portal for human review ("Unknown pages may prompt more often"). On a multi-page city form that happens on every page.
   - Define a card that is visibly different from the final Ready-to-submit card. Example copy: **"Send this page to city.example? This saves your answers on the site. It is not the final submit." [Send once] [Take over]**.
   - Say whether it shows a field manifest.
   - Show its 360 placement, and how it reads beside a final card. It must never look like one.
   - Say what happens to the agent while it waits.
   - Add it to the §6.5 table and the Words table.
   - Also define the Phase 1 version. Phase 1 blocks all writes, so even a site **search** form that POSTs is blocked. Copy for that: **"This version can only read pages. This button sends information to the site. [Take over] [Close]"**, not a submit-style card.

7. **§5.2 steps 1 and 5–6: design the private, logged-in portal flow, which is what a v1 permit actually looks like.** Under the strict private-mode rule, once Joe signs in to a generic city portal (no reviewed adapter yet), the agent can't read or fill anything. Joe fills the application himself. The plan only says "the agent can prepare data in chat". Specify:
   (a) **The first-fill field picking**, which "requires a person to pick the username/password fields", with copy and a wireframe: **"Tap the username box on the page." → "Now tap the password box." → [Fill login]**. Add the phone-blocked variant.
   (b) **A "Your answers" side list during take-over**, in the same pane under the image at 820 and beside it at ≥960. It shows the agent's prepared, person-confirmed values (address, scope, license #, owner) with a 44 px **[Type it]** button per row. The button sends that value as committed text into the focused remote field through the existing person-input endpoint. There is no clipboard, and the value comes from chat facts, not from the page. Without this, Joe retypes facts from chat into a 0.6× image with an iPad keyboard.
   (c) **An up-front expectation** on the Sites review when the site has no reviewed steps: **"After you sign in, you'll fill this site's form yourself. The agent will list the answers beside it."** Don't let Joe find this out mid-task.

8. **§6.3, §7.2, §7.3: wireframe Joe's owner review on the phone. It is the most important owner screen, and it exists only as prose.** Joe will usually approve from his iPhone in the field while staff run the task on a computer. Specify all of it:
   - **The notification copy.** Bell + Telegram (notify only): **"Abigail needs your OK: Pay $125.00 to City of Fargo · Larson bath · expires 2:41 PM"** with **Open review**.
   - **The landing route.** Opening `/engine/permissions` in the app is not enough. Recommended: `/panel?review=<actionId>` opens the Operator sheet full-height straight into the review.
   - **The 360 review sheet:**
     - task initiator + job
     - amount / payee / currency, in the trusted style, and visibly set apart from page text
     - [Review image]
     - attachments with names
     - attestation text when present
     - a countdown **"Expires in 3:12"** that respects reduced motion (whole-minute updates, no animation)
     - the sticky buttons **[Pay $125.00 once] [Don't pay]**
   - **The two presence-dependent states,** because §7.3 dispatches only while the initiator is still present:
     - Joe sees **"Abigail left the browser. It can't be paid until they open it again." [Remind Abigail]**, with Pay disabled and the reason shown inline.
     - Staff, while waiting, see **"Waiting for Joe · keep this screen open · 3:12 left"**.
   - **Joe's decision as staff see it:** **"Joe said don't pay."** / **"Joe approved — paying now…"**.

9. **§7.2, §6.3, §6.5: align with Joe's round-2 decision 6.** In v1 Joe approves *every* final step that commits the company (submit, sign, pay), even when a staff run reached it, and staff cannot approve these. The plan still has a staff-approvable "Nonbinding request/form" row, and §6.3 says "For a staff-authorized ordinary submission show Submit once". Change the §7.2 table and the staff wireframe so that a staff final step on a company account always shows **"Waiting for Joe. Nothing has been submitted." [Open review] [Cancel request]**. If a staff-approvable category survives at all, limit it to the person's own personal-account steps (sign-in, their own contact details), and name it in the table in Joe's words. Also update §14's "Which company logins may staff use?" to point at decision 5, since Joe picks per site, with the share-sheet copy.

10. **§6.5: add the missing states, with exact copy.** Each needs a line in the table:
    - **Approved / executing:** "Approved. Submitting now — don't close this." / "Approved. Paying $125.00 now…" (the brief's "approved" state is absent today)
    - **Queue full** (the 8-entry max): "Browser is busy and the line is full. Try again in a few minutes."
    - **Admission offer missed** (30 s): "You missed your turn. [Get back in line]"
    - **Queue entry expired** (5 min): "You left the line after 5 minutes. [Get back in line]"
    - **Third tab blocked:** "The site tried to open another window. Only two are allowed for a task."
    - **Popup open:** a two-tab strip "[city.example] [Payment window]" in the toolbar. Wireframe it at 820.
    - **Redirect to an unapproved site paused** (different from Site blocked): "The site wants to go to {origin}. It isn't on this task's list. [Add a site] [Stay here]"
    - **Joe replacing staff control:** Joe's confirm reads "Take over from Abigail? Their control ends." On staff's side: "Joe is in control."
    - **Card frozen while pending:** "The page is locked while this review is open."
    - **Idle warning while waiting for Joe:** "Browser closes in 60 seconds. [Keep open]". Say whether a pending owner review counts as activity. It should, or Joe's 5-minute card dies at minute 4 behind a staff idle timer.

11. **§6.4, §8.2: fix three pieces of copy that don't read right for the person seeing them.**
    (a) Joe's own login list filter "Only me / People Joe picked" reads oddly to Joe. Owner rows show **"Only me"** or **"Shared with Abigail, Mark"**. Staff rows show **"From Joe"**.
    (b) Private downloads are named "Private browser file 7c1e.pdf" in project files, and that name will sit in the Larson Files tab forever. The Save sheet must ask for a person-typed name, prefilled **"Permit receipt — Larson bath"**, plus the tag (`PERMIT · Receipt`, …). People see that name; the model still sees the generic one. Wireframe the Save sheet at 360.
    (c) "Open on another device" says "authenticated link, no token" but does nothing defined. Replace it with the text **"Open SJC OS on your iPad or computer, then Operator › Browser."** and no button. If a button stays, define what it does.

12. **§6.3: fix the wireframes so they agree with the rules.**
    (a) The 1280 frame shows "Ready to submit [Open review]" in chat *and* a "Ready to pay" card in the pane at the same time. §9.1 allows one pending action per task. Show one.
    (b) Add the toolbar's history controls, which §6.1 says live there: **[‹] [›] [Reload]**. Add the trusted site label, and state "no address bar" in v1.
    (c) The 360 frame offers **[Page down] [Page up]** while "Agent is working". Say they only appear when the agent is paused, or that they are local-image scroll only, so a viewer can't fight the agent.
    (d) Add **iPad landscape 1180**. At ≥1024 it is the docked 420 aside, not the sheet, so say it uses the same temporary 960 expansion as desktop. "Landscape gets split only if ≥720 px content remains" doesn't apply to the docked case.
    (e) Show the sheet's own header. The existing "Operator · ⌃ · ✕" row stays above "‹ Chat · Browser", and the 66dvh drawer becomes full height when Browser opens. Say that the bottom `MobileTabBar` is covered.

13. **§1 type and targets: map onto the app's tokens instead of new raw sizes.** "Body text 17 px, labels ≥14" conflicts with the panel's `text-body` (13) and `text-label` (12), and with Canvas's "≥16 px". State it as tokens:
    - state line and card title: `text-heading` (17)
    - summary rows and amounts: `text-subheading` (14) minimum
    - existing chat: unchanged
    - targets: 44 px minimum everywhere (the shipped `size-11`), 48 px for review-card buttons, 56 px for the touch toolbar in take-over

    Write the same line in Canvas §3 so the shared header has one size.

14. **§6.1, §6.5 accessibility: finish the three loose ends.**
    (a) The live image's accessible name: **"Live view of city.example. Agent is working."** Update it on state change, not per frame.
    (b) "Respect reduced motion" must say what changes: frames keep updating, because they are content, but pulsing "working" dots and transitions stop. Add a **[Pause live view]** control for everyone. Pausing the view does not pause the agent.
    (c) The keyboard-capture indicator copy and placement: **"Keys go to the website · Esc to stop"**, a persistent bar above the image while capture is on. Define the focus order for the take-over toolbar, and that focus moves to the review card when it appears.

15. **§4, §6.2: give Joe a way to see and join staff browser tasks.** §4 says Joe "can review all tasks but must explicitly Open review to join one", and §3.3 says Joe sees the queue "no staff identity/job details". There is no screen for any of it. Add a short **"In use"** list to the Browser empty state for Joe only: **"Abigail · Permit — Larson bath · Agent is working [Open review]"**. Then fix §3.3 so the identity limit applies to *staff* viewing the queue, not to Joe. Joe should see **"Browser is busy. Abigail is using it."**

---

## Optional

- Take owner-facing names ("Joe") from the owner user's display name rather than hard-coding them, so the same copy works if a second owner is ever added.
- The phone image at 328×205 is a 0.26× view. Consider a one-time hint **"Turn your phone sideways for a bigger view."**
- §6.4 "Remove access" confirm: add the person's name, **"Remove Abigail's access to City permit office? Their open browser will close."**
- The iOS app (`sjcos-mobile`): when a push or card for a browser review opens in the native app, show **"Open in Safari to review this."** rather than a dead end, since the native app is unchanged in v1.
