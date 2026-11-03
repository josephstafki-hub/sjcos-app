# Round 2 — Design & field UX judge
SCORES: sub-agreements design=9 completeness=9 | discovery-call design=9 completeness=9 | in-home-consult design=8 completeness=9

I checked the plan text itself, not only the revision logs, against the real app.
`CallsClient.tsx` uses `@3xl/page` for the list/detail split, and `@6xl/page` is the
default Tailwind container step under `Shell.tsx`'s `@container/page`. `components/shell/`
has `Shell`, `Topbar`, `LiveUpdates` and `MobileTabBar` as the discovery plan says.
`components/ui/` has `Segmented` and `VoiceButton`. There is no `CoverageMark` yet; all
three plans propose it.

All three plans got much better. Almost every round-1 item is fixed in the text. What's
left is small: wireframes that weren't updated when the prose changed, and one shared
component (`CoverageMark`) that the three plans each describe with different words.

---

## 1. Sub agreements (`sub-agreements-plan.md`)

### Round-1 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | §2 has a words table with "Sub agreement", "Scope of work", "Version 2", "Ready to start / Not ready to start: <reason>" and "Start date confirmed", plus a banned-word list. PDF titles match. No banned word appears in screen copy. "release" and "packet" only show up in legal text, SQL and route params. |
| 2 | FIXED | §9.A has Project › Subs cards at phone, tablet and desktop, with the "Ready to start?" lines, one main button chosen by state, and the Bidding award line. The Paperwork job picker is gone, and §9.B moves jobs into Jobs (n) rows. |
| 3 | FIXED | §9.E: `SignaturePad` with name and title above it; two 56 px whole-row consent rows with exact labels, both empty; summary card with exact copy; sticky Jump to; 17 px text; Download PDF; Decline, Expired and Already signed screens. "Sign" names what is still missing. |
| 4 | FIXED | §9.G covers the job, four 56 px types, "What is it?" with `VoiceButton`, photo, "Did you tell the client?", optional $ and days, the receipt, and the Emergency 911 step. |
| 5 | FIXED | §9.H gives both routes, four ways in, the empty state, one main action per state, and a table of status words for Joe and for the sub. See the new issues for gaps inside this screen. |
| 6 | FIXED | §8.4 and §9.F cover `/sign/sub/[packetId]`: no client data, Hand back to Joe with a 2 s hold, and Back stays on the hand-over screen. |
| 7 | FIXED | The §9.C conflict row has three value buttons, "Type a different number", "Check on site", and what each does to the count. |
| 8 | FIXED | §9.D has the portal home at 360/320 px, the empty state, and the three job states. |
| 9 | FIXED | §8.7 and §9.G give the offline banner and the disabled "Send when you have signal" button, with Copy text, Call Joe and Text Joe still working. It warns that closing the page loses the text. |
| 10 | FIXED | `components/subs/StartChecklist.tsx` is named. Blocked buttons stay visible but disabled, with a flag-soft box and Fix links, no toast, and a "Couldn't check paperwork" error. |

### New issues
- **`CoverageMark` words differ between plans.** §9 says the sub list uses "✓ Done / ○ Missing / ! Problem". Discovery §6 owns the component and lists "Covered / Partly / Open / N/A / Heard — confirm / Conflict". Its words table bans "missing", and its `!` means Conflict. One component can't show `!` as both "Problem" and "Conflict" without a defined variant. (See Cross-plan 1.)
- **§9.H change-request states have three gaps.**
  (a) In "Waiting on details", the main action is "[Ask for details]" again. It should be waiting, not asking twice. Nothing says where the sub answers Joe's question: the sub sees "With Joe — Joe asked a question" but has no reply control.
  (b) §8.5 step 5 and §10.3 let required work be approved with "SJC absorbs this; no client price change". The §9.H wireframe never shows that tick box, so for a required fix Joe can't reach **Approve for the sub** without pricing it to the client.
  (c) A client who declines the upsell has no state: there is no "Client declined" row in the Joe/sub word table.
- **§9.D:** the prose says "four main actions", but the wireframe shows five buttons (it adds **Message Joe**).
- **§9.F:** the hand-back is "press and hold 2 seconds" only. The consult version it claims to copy (§6.4) also offers "visitor PIN with accessible keyboard alternative". A hold-only control fails for some users and for keyboard use.

### Required to reach 10
1. **§9 Shared rules:** replace "✓ Done / ○ Missing / ! Problem" with the readiness words from `CoverageMark`'s `ready` variant as defined in discovery §6 (see Cross-plan 1). Recommended: `✓ Done` · `○ Not yet` · `! Problem`. Then update the §9.A and §9.B wireframes to match.
2. **§9.H:**
   (a) Change the "Waiting on details" row to: no main action; show "Waiting for North Star's answer · asked Nov 2 10:20" and the question, with **Decline** as a secondary action. Add one line to §9.G or §9.D: the sub sees Joe's question on the job card under "Joe asked: …", with **Answer** (opening the same "What is it?" field with the mic and photo). Answering returns the request to New.
   (b) In the New and Client reviewing states, when Optional / Required = Required, show the tick box **SJC absorbs this — no client price change**. Ticking it enables **Approve for the sub** directly.
   (c) Add the row **Client declined → closed** (Joe sees "Client declined"; the sub sees "Not approved — the client said no") to the state list and the status-words table.
3. **§9.D:** either say "five actions (Sign · Ask Joe first · Call Joe · Upload papers · Message Joe)", or remove Message Joe from the wireframe. Pick one.
4. **§9.F:** add "or Joe's PIN (keyboard-accessible)" to Hand back to Joe, matching consult §6.4. Show it in the wireframe line.

---

## 2. Discovery call (`discovery-call-plan.md`)

### Round-1 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | (a) `LiveCallBar` in `Shell` under `Topbar`, 48 px, copy for four states, ✕ per call, hidden on its own call (§4.1, §6.1). (b) Lead header, `…` menu and lead row menu, with a confirm sheet (§6.2). (c) Telegram `call_live` link sent on bridge, not on ring. |
| 2 | PARTLY | One tap starts the checklist and the lead is linked later (§4.2). The phone start state I asked for is still not wireframed. In particular, **Finish checklist** has no place on any screen, and the "By hand — AI can't hear this call" label (§4.5) is never placed. |
| 3 | FIXED | (a) Every mark has a word (`CoverageMark`). (b) One set of 13 labels, used everywhere (§1.1, §3). (c) The card shows the exact §3 sentence. (d) Prompt text 22 px serif `--ai-2` on `--ai-soft`; row labels 17 px. |
| 4 | FIXED | Asked it / Later / ✕, plus one Reminders On/Off switch. The screen-vs-phone choice moved to Settings (§7.2, §3.4). |
| 5 | FIXED | §6.3 has the consent card as a full-width 56 px primary button with the 17 px script, a "No" secondary button, the Notes on · Stop chip, and both flag banners. |
| 6 | FIXED | §6.5: 56 px segmented states, mic, collapsed details, Save and Undo pinned. Tapping the state word cycles Open → Covered (§4.2, §6.4). |
| 7 | FIXED | §6.6: the On lead chip in `--ink-2` with Still right ✓, and the three unknown-caller buttons at 48 px. |
| 8 | FIXED | §6.8 has the counts line, Ask in email toggles, editable draft, Submit for approval, and the no-email state. Desktop is described as "summary left, draft right", which is enough. |
| 9 | FIXED | §3.4 is cut down to labels, sentences, questions, on/off and order. The form builder is gone. |
| 10 | FIXED | §6 is restated in `@3xl/page` / `@6xl/page` terms. The checklist replaces the detail body and the header stays. New `PageHeader` meta. |

### New issues
- **No screen shows how a hand-ticked checklist ends.** §4.2 says **Finish checklist** → summary, and §1.1 lists it as the only word for ending one. No wireframe places it. On a business-number call, hanging up ends the session. On Joe's cell (the Phase 1 case) this button is the only way to reach the summary.
- **"They said yes on the recording"** (§5.1 step 5) is the button Joe taps when speaker labels are missing. It is a live control on calls that fall back to consult mode, but it is not in the §1.1 words table, the §6.3 wireframe, or the §6.7 states.
- **`CoverageMark` (§6) says "the sub list uses ✓/○ through the same component"**, but the sub plan uses "Done / Missing / Problem". The consult also uses a different "!" (see Cross-plan 1). This plan owns the component, so it must define the variants.
- Minor, not required: the row sheet shows Undo twice (inline "Changed by hand · Undo" and the pinned Undo).

### Required to reach 10
1. **§6.4 (or a new §6.4a): wireframe the hand-ticked session at phone width.** Header: `[‹ Calls] Checklist · started 10:42` / `Lead: Link later ▾ · Call: none ▾ · Saved`. Under it, the chip **By hand — AI can't hear this call**. Then the nine rows. Then a sticky bottom bar **[Finish checklist]** (48 px, primary). Add one sentence: on a live call with notes on, the summary opens at hangup, and **Finish checklist** sits in the header ⋯ for a call whose hangup the app can't see.
2. **§5.1 step 5, §6.3, §1.1:** add **They said yes on the recording** to the words table. In the §6.3 "after yes" block, show it as the 48 px button that appears in place of the auto-check when the session is in consult mode: `"Okay, we're recording now — and you're fine with that, right?"` then `[They said yes on the recording]` with the 45 s countdown. Add the "Speakers unknown" state row's link to it in §6.7.
3. **§6 `CoverageMark`: define two variants with exact words.** `variant="coverage"`: ✓ Covered · ◐ Partly · ○ Open · — N/A · ◌ Heard — confirm · ! Conflict · ⤳ Return visit (consult only). `variant="ready"` (sub plan): ✓ Done · ○ Not yet · ! Problem. One glyph has one meaning inside a variant, and "!" is never used for plain "Open". Replace the sentence "the sub list uses ✓/○ through the same component" with this.

---

## 3. In-home consultation (`in-home-consult-plan.md`)

### Round-1 items

| # | Status | Note |
|---|---|---|
| 1 | FIXED | §6.4 client view: an allowlisted summary payload, no internals, 20 px, a 2 s hold or PIN with a keyboard option, and it returns to the visitor preview. Wireframes at tablet landscape and phone. It also covers Renovate Right. |
| 2 | FIXED | §6.2 phone bar `● 12:41 · ⇅ 23 · ⋯` with an offline second line, expandable details, Sun mode in ⋯, and the section in the header. |
| 3 | PARTLY | The phone wireframe and prose are fixed: per-field "Skip this field…", Next is defined, and there is a mark column. **The §6.4 tablet wireframe still shows the old bottom-bar `[ Skip… ] [ Next › ]`**, which the new rule "no global second Skip" forbids. |
| 4 | FIXED | §3 and §10.1 have seven labels, and raw values never reach cards. |
| 5 | FIXED | §6.8 has the conflict picker in `--flag`/`#EFD9CF` with icon + "Conflict", a phone review, and "Couldn't apply findings — Retry". The desktop row still reads "⚠ conflict … [pick]", a small leftover. |
| 6 | FIXED | Portrait keypad sheet, Schedule dialog, Before you wrap sheet and the three-pane Settings editor are all wireframed (§6.4, §6.9). |
| 7 | FIXED | §4 and §5.1 add entry points on Overview, Schedule, Ops, the scope page and Today. §6.2 adds Back to SJC OS with an unsynced-only warning and defines in-tool Back. |
| 8 | PARTLY | §5.4 defers helpers to Phase 4. **The §6.4 tablet wireframe still shows "Measuring: Kitchen (phone)"**, the helper-device line from round 1. |
| 9 | FIXED | §9.2 uses the discovery states and `checklist_sessions` with `kind in_home_consult`, consult mode is suggest-only, and the UI shows Open / Partly. |
| 10 | FIXED | §6.3: the chip sits directly under its field with 56 px Use/Edit/Reject, and there are two 56 px buttons "3″ / 3′" plus a sanity check. |

### New issues
- **The tablet wireframe (§6.4) no longer matches the prose.** It still has the global Skip…, the helper line "Measuring: Kitchen (phone)", the AI chip as `[Use] [Edit] [✕]` (phone §6.3 and §9.3 say **Reject**, §5.3 says ✕), and a ☀ icon in the bar (§6.2 moved Sun mode into ⋯).
- **The mark legend is unclear.** §6.1 lists "○ Open … field additions ! Open". The phone wireframe uses "✓ Answered" and "! Open" for fields and "✓ Covered" / "○ Open" for sections. A builder can't tell whether ○ Open and ! Open differ (required vs optional?), or whether "Answered" is a seventh word. It also collides with discovery's "! Conflict" (Cross-plan 1).
- **The prose in §4, §5.2, §5.6 and §5.7 got compressed into internal shorthand** ("offline authorization lease", "asset-cache checksum", "close manifest", "withdrawal epoch", "generation reviewed"). That's fine for engineering. But §5.7 is the failure table, and most rows now have no on-screen copy. Only "Storage full" and "Visit interrupted" are written out. Tab died / audio gap, login expired mid-visit, staff access removed, transcription failed, client said stop, and visit cut short have no words the visitor would see.
- **Get ready has no wireframe.** It is the gate for the whole offline promise, so its states matter most: checking, Ready offline ✓, a check failed with the reason, and no signal ("Open once with signal before the visit"). Today it is one prose paragraph.
- **Consent copy has drifted from the shared pattern.**
  - Consult §8.1: "**Consent not on the recording — confirm again or stop**". Discovery §6.3: "…**ask again or keep it manual.** [Ask again] [Keep it manual]".
  - The consult's "visitor confirms that response" step (`awaiting_recorded_confirmation`) is the same control as discovery's **They said yes on the recording**, but it has no button name here.
  - The yes/no buttons are bare "They said yes / They said no". Discovery's are "They said yes — start notes / They said no — keep it manual".
- **The §3 words table lists nouns only.** It doesn't settle the visitor's controls (Start visit, Get ready / Ready offline, They said yes/no, Heard — confirm, Use / Edit / Reject, Skip this field…, Return visit, Before you wrap, Show to client, Hand back, Close visit, Pause recording, New person, Mark reviewed). That is why ✕ vs Reject and "REC" vs "Notes off" vary between wireframes.

### Required to reach 10
1. **§6.4 tablet wireframe: redraw it to match §6.2/§6.3.**
   - Remove the bottom `[ Skip… ]` and use per-field "Skip this field…".
   - Remove "Measuring: Kitchen (phone)".
   - Change the chip to `[Use] [Edit] [Reject]`, and change §5.3 step 7 to Reject too.
   - Drop ☀ from the bar, or state that tablet shows Sun mode both in the bar and in ⋯.
   - Change the §6.8 desktop row to "! Conflict · phone 36″ / iPad 36½″ [Pick]".
2. **§6.1 mark legend:** list the exact `CoverageMark` words for fields and sections in one table: ✓ Covered (section) / ✓ Answered (field), ◐ Partly, ○ Open, — N/A, ◌ Heard — confirm, ⤳ Return visit, ! Conflict. Required-but-open fields show "○ Open" plus the existing `*` required marker, and "! Open" is retired. Point to discovery §6's `coverage` variant.
3. **§5.7: add a "Visitor sees" column with exact copy for every row.** For example: "Recording stopped for 0:30 — the phone was closed. Gap marked." · "Signed out — your answers are safe on this device. Sign in as Abigail to send them." · "Transcription failed — your forms are fine. Joe will see a repair to-do." · "Recording stopped. Nothing more is recorded." · "Visit closed — 4 open items. A Finish consultation to-do was made."
4. **§5.2: wireframe Get ready at phone width** with its four states:
   - "Getting ready…" with the checks listed and ticking;
   - **Ready offline ✓** [Start visit];
   - "Not ready: storage blocked — [Try again] / use paper";
   - "Open once with signal before the visit."
5. **§8.1 consent copy: match discovery §5/§6.3 exactly.**
   - Buttons: **They said yes — start recording** / **They said no — keep it manual**, or the discovery wording verbatim.
   - The confirm control is named **They said yes on the recording**.
   - The banner reads "Consent not on the recording — ask again or keep it manual. [Ask again] [Keep it manual]".
6. **§3: add the visitor controls listed under New issues to the words table**, one word each, and use those words in every wireframe.

---

## Cross-plan

1. **`CoverageMark` needs one owner definition with variants (discovery §6 owns it).** Today the three plans use different words: discovery "Covered/Partly/Open/N/A/Heard — confirm/Conflict", consult "! Open / ⤳ Return visit / ✓ Answered", sub "Done/Missing/Problem". The "!" glyph means Conflict, Open and Problem in the three plans. Fix: discovery Required #3 + consult Required #2 + sub Required #1.
2. **Consent pattern: the words are close, but the buttons and banner differ.** Discovery has "They said yes — start notes", "They said yes on the recording" and "ask again or keep it manual". Consult has bare "They said yes", an unnamed confirm step and "confirm again or stop". Fix: consult Required #5 + discovery Required #2.
3. **Hold to hand back:** consult has a 2 s hold **or PIN**; sub has the hold only. Fix: sub Required #4.
4. **Matched, no action needed:**
   - engine states `open/partial/covered/not_applicable`, shown as Open / Partly / Covered / N/A;
   - consult mode is suggest-only with "Heard — confirm";
   - shared `checklist_sessions` / `conversation_segments` and the consult adapter (discovery §8.5 ↔ consult §9.2);
   - `evaluate_at` is in the contract;
   - `call_nudge` / `call_live` are calls-only;
   - 48 px / 56 px touch targets are stated the same way in all three plans;
   - `consultScopeFacts` feeds the sub Visit column and the "Field measure by" exclusion;
   - migration order 0073 / 0074 / 0075+;
   - client-facing words (pre-con agreement · rough estimate · formal estimate · Pre-con change · change order · upsell).
