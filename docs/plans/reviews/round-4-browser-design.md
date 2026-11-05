SCORES: design=9 completeness=9

# Round 4 — Design & UX judge — in-app agent browser (`agent-browser-plan.md`)

I judged the committed HEAD `8cab9027`, where the browser plan was last changed.

- **Host file:** `_ask-pane-host.md` was last changed at `22a48134`. That is the commit the browser plan now adopts (§6.2).
- **Canvas plan:** `ask-canvas-plan.md` has uncommitted edits from another session. I judged only its committed text and ignored any uncommitted phone-landscape Operator work.

I read these against:
- the context file (decisions 1–9)
- my round-2 and round-3 reviews
- the plan's "Round-3 fixes" appendix
- host H1–H5
- the code the plan cites: `proxy.ts:159–179`, `app/login`, `PanelHost.tsx`, `PanelDock.tsx`, mobile `targets.ts`, `lib/providers/telegram.ts:61`, `lib/notify-owner.ts:273`

I walked these flows:
- a multi-page staff form reviewed from Joe's phone ping
- a signed-out tap → sign in → review
- Watch, then Pause agent
- v1 Done after take-over (vault and public)
- staff "Ask Joe to finish", followed to its outcome
- Joe's 1280 / 1180 / pop-out owner layouts
- a check for stale copy and for contradictions with the host file and the committed Canvas plan

## Round-3 items: verified / not fixed

All 8 are **verified fixed**. Walking the new flows turned up gaps at their edges. Those are new required items below; none of them reopens a round-3 item.

| # | Status | Where / note |
|---|---|---|
| 1 Every new decision alerts | Verified. One bell item and one live Telegram item per task. A new pending decision deletes the old message and sends a fresh one; only outcomes edit silently. The page-4 follow-up copy, "Sent. Waiting for Abigail's next page.", in-place replacement, heading focus and the assertive announcement are all present. Phase 3 has `browser-notifications` + `browser-owner-review` tests. **Edge:** Joe can be stuck on the waiting screen (item 3). | §6.3, §6.5, §12 Phase 3 |
| 2 Signed-out tap returns to review | Verified (a)–(d). One validated relative `returnTo` runs through proxy, LoginPage, LoginForm and the auth action. The notice is neutral: "Sign in to open the review." The native app has a 48 px **Open in Safari** button. §13 step 7 covers the Telegram Safari setting and the first legacy-JWT sign-in. **Edge:** hand-off links are deliberately left out of this path, and their native/phone path is undefined (item 1). | §4.1, §6.3, §10.2, §13 |
| 3 Watch exit doesn't pause staff | Verified. All four Watch exits leave Abigail running. Keep paused applies to the review sheet only. The explicit [Pause agent] confirm, its failure path, and "Joe paused the agent. [Continue]" are in place, with tests. | §6.2, §6.5, §12 |
| 4 No fake [Ask Joe again] | Verified. "…To ask again, click the button on the page again. [Back to the page]" plus final-step variants. Ask Joe again appears only for the Phase 4 pre-click adapter. Words and §6.5 agree. | §1, §6.3, §6.5, §12 |
| 5 V1 Done, not Give back | Verified. Done appears in the 820 frame, the keyboard-open row, §6.1, §6.5, the focus order and the control API. Reason-specific paused copy exists. Give back and "Let the agent continue?" are Phase 4 only. The vault line no longer uses "I". **Edge:** what the public Done prompt leaves behind (item 4). | §1, §5.2, §6.1, §6.3, §6.5 |
| 6 Ask Joe to finish | Verified on the staff side: button, confirm, paused copy, fixed outcomes, routes, Phase 2 test. **Not complete on Joe's side** (item 1). | §6.4, §6.5, §10.2, §12 Phase 2 |
| 7 Owner layer ≥1024 / pop-out | Verified. H1 expansion under one spanning header, status and review card on the left (~420), image on the right. Dock width is unchanged. Pop-out ≥840 split / <840 single view. There is a 1280 frame and a 360 Watch frame, and fixture rows. | §6.2, §6.3, §12 |
| 8 Contradictory copy | Verified. (a) The disabled-chevron sentence is gone; the working × is Close Operator. (b) Phone variants added in §7.2 and §6.5. (c) Phase 1 Sites shows only the public-read line; approval guidance is hidden until Phase 3. | §6.3, §6.5, §7.2 |

All five round-3 optional items were also taken:
- Open browser vs Show browser is defined in Words.
- The 360 Watch frame is drawn.
- Owner copy uses the owner's display name.
- The sideways tip is added.
- The browser plan's adoption hash is updated to `22a48134`.

## What's strong

- **The multi-page owner review now actually works from a phone.** Every new page buzzes. Old Telegram messages are deleted rather than left as dead "needs your OK" prompts. Joe can stay on one screen and approve pages 3, 4 and 5 in place, each with fresh authorization. No grant or control carries over to the next page, and an old link still resolves only its own action.
- **Sign-in return is precise without becoming an open redirect.** It covers two exact path shapes, rebuilds the path from validated UUIDs, shows a neutral pre-auth notice, and keeps the original deadline. The plan names all four code points that drop the query today.
- **Watch is safe to look at.** Leaving never changes Abigail's task. Pausing her is a deliberate, confirmed, named act, and only she can continue.
- **V1 copy is honest about what the agent can do after a private page.** Done says what happens ("Finish the form yourself — your answers are below"). No button promises continuation the product can't deliver.
- **The hand-off keeps decision 5 intact.** Staff get one clear button with a confirm, a paused state, and a fixed outcome. Joe gets a new task of his own with "From Abigail" answers. No transcript, password or pixels cross over.
- **Wide owner review uses the space.** The 1280/1180 split and the pop-out rules reuse H1 exactly instead of inventing new geometry.

## Required to reach 10

### 1. §6.4 "V1 Ask Joe to finish", §10.2 "Shell/login/mobile routing", §6.5, §12 Phase 2 — finish Joe's side of the hand-off

The staff half is complete. Joe's half has no screen, and its most likely first contact is his phone, where he cannot finish it.

**What breaks today:**
- The notice "Abigail asked you to finish on city.example · Larson bath [Open]" is a normal bell/Telegram item, so it usually reaches Joe's iPhone.
- §10.2's native special case covers only review/Watch. The native bell's `/today?browserHandoff=` link therefore falls into the generic Today mapping, which drops the query. Joe lands on plain Today.
- In Safari, "GET merely shows an authorized invitation", but the invitation has no frame or copy.
- If Joe accepts on the phone and taps Open browser, the task reaches the site's login. Take-over is tablet/computer only, so the run sits paused and holds a queue slot.
- These have no defined copy or location:
  - "explain he must finish/stop it first"
  - **[Mark finished] [Didn't finish]** "with confirmation"
  - **[Don't finish]**
- Nothing tells Joe where a pending hand-off lives once the bell item is read.

**Specify:**

- **(a) Invitation.** It is shown in Joe's Operator as a card at the top of a new chat, not in the owner layer. Before **Open**, nothing is created.
  - Copy: **"Abigail asked you to finish: Apply for Larson permit · city.example · Larson bath. Her answers come with it. [Open] [Don't finish]"**.
  - **Open** = accept → Sites review prefilled as already specified.
- **(b) Phone (<1024 viewport, or the native app).**
  - The card shows **"Finish this on your iPad or computer. It stays in Browser › Asked to finish."** with only **[Don't finish]** and **[Close]**. Open browser is not offered.
  - Add `browserHandoff` to the native special case: show the same 48 px **[Open in Safari]** button, not generic Today.
- **(c) Where it waits.**
  - Joe's Browser empty state gets a list beside In use: **"Asked to finish"**, with rows like **"Abigail · Apply for Larson permit — Larson bath [Open]"**.
  - Rows stay until Joe marks an outcome.
  - A signed-out tap lands here after sign-in, since the link is outside the returnTo allowlist.
- **(d) Busy.** When Joe already has a live browser: **"Finish or stop your other browser first. This stays in Asked to finish."**
- **(e) Outcome controls.**
  - Show them on the hand-off task's Browser status row and its chat card: **[Mark finished] [Didn't finish]**.
  - Mark finished confirm: **"Tell Abigail you finished this? [Mark finished] [Cancel]"**.
  - Didn't finish and Don't finish confirm: **"Tell Abigail you won't finish this? [Didn't finish] [Cancel]"**. Don't finish records **"Joe didn't finish this."**
  - Escape = Cancel. These confirms are already registered in §6.2's layer list.
- **(f) Tests.** Add phone and native-app routing, the Asked to finish list, and the busy copy to `browser-staff-handoff-db` / `browser-ui`.

### 2. §6.3 "360 Watch" frame, §6.3 In use paragraph, §6.5 — define what Joe sees when he watches a private page, and tell staff

In v1, every staff take-over is permanently private. So the moment Joe is most likely to Watch — Abigail working the portal herself — is a private context.

The plan only says Joe can "choose private view if needed". The 360 frame shows the placeholder "[Authorized live image / private view requires separate access]". The control, its copy and its result are undefined. Staff are never told that Joe is looking at their screen.

**Specify:**
- **Private context during Watch.** Show **"Abigail took over. The agent can't see this page."** with **[Show the page]** (a 48 px button) instead of the image.
  - Tapping it joins as a private owner viewer, with no control.
  - The image is labelled **"Private — only you and Abigail see this page."**
  - Escape or ‹ Back still leave only Joe's viewer.
- **Delegated-secret context.** The Joe-only rule is unchanged; the label is the same.
- **Staff side.** While any owner viewer is joined, the staff status row shows **"Joe is watching."**. It is removed when Joe leaves.
- **Joe after Pause agent succeeds.** Status reads **"Agent paused. Abigail can tap Continue."**
- **§6.5 rows.** Add rows for all of the above, replace the placeholder in the 360 frame, and add cases to `browser-owner-review`.

### 3. §6.3 "Keep Joe on the review", §6.5 "Joe waits for next page" — the waiting screen must end when Abigail's task does

"Sent. Waiting for Abigail's next page. [‹ Back]" has no exit states. If Abigail stops the browser, leaves, or the run ends, Joe sits on a waiting screen that will never change.

**Specify** these in-place updates, each polite-announced, each with [‹ Back]:
- **"Abigail stopped the browser."**
- **"Abigail left the browser. Nothing more will come until she opens it again."**
- **"Agent turn finished. Nothing is waiting for you."**

The final verified outcome keeps its existing copy. Add these to the §6.5 row and to the `browser-owner-review` test.

### 4. §5.2 step 6, §6.5 "Public-page private / Done" — the public Done prompt needs the screen it leaves behind

"The agent can't read this page anymore. [Open a fresh browser] [Keep paused]" is written like a prompt. After **Keep paused**, no copy or controls are defined for the resting state. The only row that lists Take over again for this case is "Start/run ended", which is the run-ended state, not the moment after Done.

A builder who renders the prompt as the persistent state gives Joe a no-op Keep paused button and no way back into the page.

**Specify** the resting state after Keep paused (and on return to the pane):
- **"Paused. The agent can't read this page. [Take over again] [Open a fresh browser] [Stop browser]"**
- On a phone, replace [Take over again] with the tablet/computer instruction.

Add it to the §6.5 table.

## Optional

- **Host H3 wording.** H3 still says the owner review/watch layer has "Escape = Keep paused". Browser §6.2 explicitly limits that to the review sheet. Ask the host owner to change the sentence to: "Escape on an open review = Keep paused; a passive Watch exit leaves only Joe's viewer (Browser §6.2)."
- **Host H5 commit hash.** H5 and the Canvas round-1 appendix still say Browser adopted the host at `89b1bd6e`. Browser now records `22a48134`.
- **Telegram while Joe is already watching.** While Joe's owner layer is visible on the same task, the in-place page-4 replacement already alerts him on screen. Consider sending that one Telegram replacement without sound (`disable_notification`) rather than buzzing his phone a second time. The bell stays unread until he views it.
- **1280 owner frame status line.** The left column reads "Status: Waiting for Joe", which is staff wording shown to Joe himself. Use **"Abigail is waiting for you"**.
- **Words table.** Add **‹ Back** (owner layer: close only Joe's view) beside Back to app / ‹ Chat.
- **Lapse copy on a phone.** "On phone, explain that the new deliberate click needs iPad/computer take-over" has no exact copy. Suggest: **"Joe didn't answer in time. Nothing was sent. To ask again, open SJC OS on your iPad or computer and click the button on the page again."**
