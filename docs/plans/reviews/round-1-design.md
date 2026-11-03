# Round 1 — Design & field UX judge
SCORES: sub-agreements design=6 completeness=7 | discovery-call design=7 completeness=7 | in-home-consult design=8 completeness=8

Judged against the real app: `components/calls/CallsClient.tsx` (list + detail split
at `@3xl/page`, `PageHeader` "Calls", `Chip` kinds, 44 px `min-h-11` mobile targets
that drop to `h-8` at `@xl/page`), project tabs in `app/(os)/projects/[slug]/page.tsx`
(Overview, **Ops** = `RecordOps` stage guidance, Floor, Mood, Selections, Bidding,
Money, Documents, Schedule, **Subs**, Files, Daily log, Client portal, Permits,
Closeout, Safety), `components/subs/SubTabs.tsx` (Overview / Jobs (n) / Paperwork /
Pricing / Notes), `components/esign/{InPersonSigning,SignaturePad}.tsx`,
`components/shell/MobileTabBar.tsx` (phone bottom bar = Today, Projects, Leads, Inbox,
More; **Calls is not on it**; it's in the sidebar), and `docs/design-tokens.md`.

---

## 1. Sub agreements (`sub-agreements-plan.md`)

### What's strong
- The two layers (yearly agreement + per-job scope) fit how subs really work, and the master stays out of the sub's way on each job.
- Clause 7 gives the exact words a sub must say for an upsell, and §8E carries "UPSELL — OPTIONAL ADDITION" into the client's PDF, email subject and signing view, not only a chip.
- §8's state table covers empty, loading, success and error for all five screen families. The copy is honest ("Signatures captured — copy processing", "Cannot check paperwork; start not released").
- After a sub signs, the page never says "go": "Your signature saved. Waiting for Joe" is kept separate from "Ready — Joe confirmed start".
- The readiness reasons come with "Fix" links and a "Why blocked?" link on the PO and schedule release. That is the right way to show why a start is blocked.

### Required to reach 10
1. **§1, §5, §8, all copy: replace the invented nouns with Joe's words, and add a "Words used" table like consult §3.** On screen, "Master Subcontract Agreement" / "master" becomes **"Sub agreement"** (the yearly one), and "Work Order / scope exhibit" becomes **"Scope of work"** (per job). Both words come from to-do `7a003430`. "Work Order" also sits right next to the existing "Purchase orders" and will be read as a PO. Ban these terms from UI text: "mobilization", "readiness", "release", "operative revision", "exhibit", "interfaces". Use "Ready to start / Not ready to start: <reason>", "Start date confirmed", "Version 2". The legal PDF may keep its legal headings; the screens may not.
2. **§8 A: put the job-side card where the job actually lives.** The project page already has a **Subs** tab (`ProjectSubs`) and a **Bidding** tab. Add phone, tablet and desktop wireframes of *Project › Subs* showing one card per sub: trade, scope-of-work state, the "Ready to start?" lines (Sub agreement ✓ / Scope signed ○ / Insurance ✓ / W-9 ✓ / License ✓), and one primary button. Also wireframe the line the Bidding award confirmation adds ("Award recorded. Not ready to start until the scope of work is signed."). Then take the "JOB [Lake bath v]" picker out of the sub's Paperwork phone wireframe. On the sub page, job scopes belong in the existing **Jobs (n)** tab, one row per job. Don't put a dropdown inside Paperwork.
3. **§8 C (sub signs on a phone): fully specify the reading and signing screen.**
   (a) Pick one signature method: reuse `SignaturePad` (drawn), as in-person signing does, with typed name and title above it. Delete "Signature area / typed name".
   (b) Make the two consents full-width 56 px toggle rows whose whole row is the tap target, with exact label text. Neither starts checked.
   (c) Add a plain-language top card with exact template copy: **"What you're doing · What you're not doing · Price $X · Start window · Two rules: ask Joe before changing anything; any optional extra must be called an upsell to the client."**
   (d) The 24-clause sub agreement needs a sticky clause index (jump list), 17 px text, and a "Download PDF" button. Wireframe it at 360 px.
   (e) Wireframe the Decline sheet (optional reason, "Decline" confirm), the expired-invite screen and the already-signed screen with exact copy.
4. **§7 and §8 D: cut the sub's "Ask Joe before changing the work" form to what a sub at a client's house will actually fill.** Required: job (pre-picked when they have one active job), type as four 56 px segmented buttons (Client asked / Found a problem / Optional upsell / Emergency), "What is it?" text with a mic button (reuse `lib/use-dictation.ts`), photo, and "Did you tell the client it's an upsell?" (Yes, I read the words / Not yet). Optional: "Your price, if you know it ($)" and "Extra days". Everything else in §7 ("requested by", affected scope lines, cap, client words, disclosure method, "safe-stopped" checkbox) moves to Joe's triage screen, where Joe fills it in. Money is entered in dollars, never "cents". Wireframe the receipt screen: request number, "Sent to Joe — don't start the extra work", and "Call Joe".
5. **§8 E: name the route and the way into Joe's triage.** For example, `/subs/requests/[id]`, reachable from (a) the Telegram link, (b) a to-do on Today ("Sub asked for a change — Lake bath"), and (c) a "Change requests (n)" section on Project › Subs. Wireframe the request list (empty state "No change requests") and the phone triage screen, with a single primary action per state: Ask for details / Price it for the client / Approve for the sub / Decline. Add a table of which status words the **sub** sees ("With Joe", "Waiting on the client", "Approved — go ahead", "Not approved") and which ones **Joe** sees (the five states in §7.6).
6. **§6 and §8: add in-person signing for subs on Joe's iPad.** Subs often sign in the truck or on site. Reuse the `/sign/[id]` + `InPersonSigning` pattern with an `audience=sub` check, and wireframe the hand-over screen: no client data visible, a "Hand back to Joe" button, and the signed confirmation. Today Phase 0 is wet ink only and Phase 1 is portal only; this gap is where most signatures will actually happen.
7. **§8 B (Joe drafts the scope): wireframe one source-conflict row.** Show "Tile area — Estimate 80 sf · Bid 60 sf · Visit 78 sf (photo)" with three 48 px choice buttons plus "Type a different number" and "Check on site (blocks start)", and what each one does to the unresolved count. Today "Resolve" has no defined interaction.
8. **§8 sub portal home: add the missing wireframe.** Show the job list (address, trade, "Sign scope of work" / "Ready to start Nov 10" / "Not ready — waiting on Joe"), the sub-agreement status card, and the four primary actions. Define the empty state ("No jobs with SJ Carpentry right now") and the 320 px layout.
9. **§8 State contract: add phone-scale copy for the offline sub.** Write the banner text, what the Send button does offline (disabled, with "Saved on this page — send when you have signal", and a "Copy text" button), and how the fallback "Call Joe" behaves (a `tel:` link to Joe's number from settings).
10. **§6 enforcement table, UI side: specify the blocked-action UI on PO send and schedule confirm.** The button stays visible but disabled, with an inline flag-soft box listing the reasons and "Fix" links. Don't show a toast after the click. Use the same component on the Bidding award card, the PO page and the Schedule tab. Name the component (e.g. `components/subs/StartChecklist.tsx`) so it is built once.

---

## 2. Discovery call (`discovery-call-plan.md`)

### What's strong
- The rules for when a nudge may appear are the best part: at most 3 per call, 120 s apart, never while the client is talking, gone at hangup, once per item. This really is "only on a genuine skip".
- §8 gives exact reminder copy, including partial-only wording ("Remember to confirm the city"), with no grading language.
- §7's states table covers ringing, consent pending/declined, lagging, failed, offline and ended, with honest copy ("AI is behind — use the checklist manually").
- The plan correctly says the phone carrying the call can't reliably show the page, and designs for a second screen with optional Telegram.
- The follow-up email draft is short and plain, and it goes through `submit_draft_for_approval`, not a Send button.

### Required to reach 10
1. **§4, §7: how Joe gets to the live checklist when a call starts and he isn't on /calls.** Calls is not on the phone bottom bar. Specify:
   (a) a global live-call bar in the shell (`Topbar`, fed by `components/shell/LiveUpdates.tsx`) on every page: "📞 Alex · Bath — Open checklist", 48 px, dismissible for that call;
   (b) a **Start a discovery call** button on the lead page header and the lead row menu, with a wireframe;
   (c) the Telegram "incoming call" link opening `/calls?open=<id>` directly in the checklist view.
   Without these, the live feature exists but only gets used when Joe had Calls open already.
2. **§4 Phase 1 flow: cut manual start to one tap.** A **Start checklist** button (Calls header, and on any selected call) creates the session with now as the start time and "Link later". Direction, lead and call link become optional fields on the session header, edited afterwards. Wireframe the phone start state. Today it takes four or five choices before the first tick, while the phone is ringing.
3. **§7 wireframes: make them match the plan's own rules.**
   (a) Every row shows a word, not only ✓◐○. At phone width use "✓ Covered", "◐ Partly", "○ Open", "— N/A" as a right-aligned label, because the rule says symbols never stand alone.
   (b) One label set, used on every width and in Settings: **Work · Budget · Timeline · Address · Contact · Who decides · How they found us · Other bids · Years in house / staying**. Today the plan mixes "Description of the work / Work / Description of work" and "House / plan to stay / How long in the house".
   (c) The prompt card heading uses the exact §8 sentence ("Remember to ask if they have a budget in mind."), not "Remember to ask budget".
   (d) Prompt text is 22 px serif `--ai-2` on `--ai-soft` so it reads at arm's length on a desk tablet. Row labels are 17 px.
4. **§5, §7, §8: collapse the four ways to quiet nudges into two controls.** On the card: **[Asked it]** (marks it partly covered and opens the answer) and **[Later]** (until wrap-up), both 48 px, plus a small ✕. In the header: one **Reminders On/Off** switch. The choice between screen only and screen + phone moves to Settings and stays out of the live header. "Mute nudges" + "Mute phone" + "Dismiss" + "Later" + "×" is too many choices mid-sentence.
5. **§7: wireframe the consent-pending state.** **"Everyone agreed — start notes"** is the single most important live control, yet it appears in no wireframe. At consent-pending, show it as the full-width primary button at the top of the detail pane, with the script line above it in 17 px and "No — keep it manual" beside it. Once granted, it collapses to a chip "Notes on · Stop" whose Stop opens the §12 **Stop AI and recording** confirm. Wireframe the "Recording stop not confirmed" flag banner too.
6. **§7: wireframe the row-edit bottom sheet for live use (phone and tablet).** Top: the four state buttons as 56 px segmented controls. Below: an answer field with a mic button (`lib/use-dictation.ts`). Collapsed below that: "Why / suggested questions / evidence". Pin Save and Undo to the bottom. Specify that tapping a row's state label directly cycles Open → Covered without opening the sheet, so the common case is one tap.
7. **§3, §7: show prefilled rows.** "Already on lead — confirm if needed" needs a visual. Use a ghost chip "On lead" plus the stored value in `--ink-2`, and one-tap "Still right ✓". Wireframe one such row, plus the unmatched-caller state ("Unknown caller — [Link to a lead] [New lead] [Not a lead call]") with 48 px buttons.
8. **§7 after-call: add phone and desktop wireframes of the Summary + Follow-up draft.** Show the counts line ("6 covered · 1 partly · 2 missed"), missed items with "Ask in email ☑" toggles, the editable draft, **Submit for approval**, and the no-email state "Confirm their email first [Add email]".
9. **§3 Settings, against over-building: make Phase 1 Settings edit only labels, suggested questions, on/off and order for the nine rows.** Put component fields, fact-target allowlists, 30-row limits and versioned custom items in a later phase. Joe asked for a checklist he can glance at, not a form builder. Keep the version snapshot under the hood.
10. **§7: reconcile with the app's real Calls layout.** The current page splits at `@3xl/page` with a 280 px list, not at 768 / 1200 px breakpoints. Restate the tablet and desktop breakpoints in the container-query terms `CallsClient` uses. Say the "Discovery checklist" panel replaces the existing detail pane's body while keeping its header (`OutcomeChip`, back button). Keep the current `PageHeader` meta, or rewrite it to "Calls, recordings, notes and discovery checklists."

---

## 3. In-home consultation (`in-home-consult-plan.md`)

### What's strong
- §6.1's field rules are right for the job: 56 px targets, 64 px keypad, Sun mode with an icon and word for every state, no swipe-only actions, wake lock, a haptic tick on every save that never waits on the network.
- The feet-inch keypad and the bare-number rule (§6.6) are the right input for tape and laser readings, and every value shows its "reads as" line before it is saved.
- The fixed list of skip reasons, with "Get on return visit" counting as still open, makes completeness checkable without grading the person.
- Words table §3, real scripts (opening, staff variant, closing, consent, Renovate Right) and full module content: nothing is left as TBD.
- Joe's review screen at 1440 shows the source of every value (typed · phone / AI ✓ with the quote / conflict between devices), plus "Estimate gaps closed: 9 · still open: 3".

### Required to reach 10
1. **§6.3, §5.5: define a "client view" for the walk-through summary.** When the device is turned to the client, hide the status bar internals (● REC, sync counts, section progress) and the "Anything that worried you" field. Show only the summary at 20 px plus the initials pad. Exit only through **"Hand back"** to the visitor, which needs a deliberate 2-second hold or the visitor's PIN, so the client can't wander into internal notes. Wireframe it at tablet landscape and phone. The same client-view rule applies to the Renovate Right initials screen.
2. **§6.2: the status bar doesn't fit at 390 px.** "[● REC 12:41] [⇅ Offline · 23 saved] [Kitchen 9/11] [☀] [⋯]" is about 60 characters. Specify the phone version: "● 12:41 · ⇅ 23 · ⋯". Sun mode moves into ⋯, the section name moves to the screen header, and long states move into an expandable sheet when the bar is tapped. Wireframe both normal and offline.
3. **§6.3 field-entry screen: make "Skip…" and "Next" unambiguous.** There are two "Skip…" buttons (one per photo shot, one in the bottom bar). Rename the bottom one **"Skip this field…"** or remove it in favour of per-field skip. Define "Next ›": it scrolls to the next *open required* item in this section, and at the end of the section it goes to the next section with the leave-check banner. Add a field-level ✓ / ! / ⤳ column so a glance down the screen shows what's left.
4. **§3, §10.1: add on-screen labels for the statuses.** `captured`, `incomplete`, `complete` and `reviewed` appear raw on the list card ("Spaeth · Deck Captured"). Display them as **Scheduled / In progress / Visit closed — sending / Needs finishing (n open) / Complete — waiting for Joe / Reviewed / Cancelled**, and add this to the §3 words table.
5. **§6.8: "amber row" isn't a design token.** Conflicts use `--flag` / `#EFD9CF` with an icon and the word "Conflict". Wireframe the conflict picker (two 48 px value buttons with device and time, plus "Enter another"). Also wireframe the review screen's error state "Couldn't apply findings to the scope — Retry", and the phone stacked layout (prose only today).
6. **§6.4, §6.9, §5.1: add the missing wireframes.** Needed: tablet *portrait*, with the keypad docked as a bottom sheet over half the field grid; the **Schedule** dialog on the project (who goes, date, templates pre-ticked, add-ons); the "Before you wrap" sheet; the Settings form editor's three-pane layout (list / field editor / phone preview). These are prose today.
7. **§5.1, §4: discoverability and exiting the full-screen tool.** The Ops tab is stage guidance (`RecordOps`). Also put the **In-home consultation** card on the project **Overview** next to the stage card while the stage is `site_visit_*`, and on the **Schedule** tab entry. Inside `/consult/[id]`, ⋯ needs an explicit **"Back to SJC OS"**, with a warning only when items are unsynced. Define what the browser Back button does: it returns to the section list, never out of the visit.
8. **§5.4: move the second-device / QR helper mode to Phase 4 (over-built for Phase 1).** It's a one-owner company with occasional staff, and same-field conflicts by device clock add review UI to every consult. Phase 1 = one device per consult. Keep `client_event_id` and `device_id` in the schema so it can be added later.
9. **§9.2, cross-plan: use the shared engine's states and copy.** The plan says the engine returns "covered / missing / unclear". The discovery plan's normative states are `open / partial / covered / not-applicable`. Show them in the leave-section banner and Before-you-wrap as the same words the Calls checklist uses ("Open", "Partly"). Write sessions to the shared `checklist_sessions` (kind `in_home_consult`, `source_ref` = consult id) instead of a private segments table, or state exactly how `consult_transcript_segments` adapts to `conversation_segments`. (See Cross-plan 1–3.)
10. **§6.3 AI chip: define the 56 px button sizes inside the chip and where the chip sits relative to the field.** Put it directly under the field it fills, never in a separate list. Specify the "3 or 3 feet?" sanity version as two buttons ("3″" / "3′") instead of Edit-only, so it takes one tap with gloves on.

---

## Cross-plan

1. **Coverage engine states and model differ.** Discovery §5 (normative) uses `open | partial | covered | not-applicable` and Claude **sonnet** with a 3 s deadline. Consult §9.2 says "covered / missing / unclear" and maps fields with **haiku** (its coverage call isn't named). Consult must quote discovery's state enum verbatim. Discovery §5 should add an `evaluate_at: 'live' | 'section_leave' | 'wrap_up'` input so the consult's section-aware timing is a parameter of the one engine, not a fork.
2. **Speaker identity breaks reuse.** Discovery §5 step 4 says "Unknown speaker cannot automatically establish a client fact". Consult uses mono whisper with "Speaker labels out of scope" (§20), so every consult segment is `unknown`. Discovery must define an `in_home_consult` exception (covered → **confirm-only**, never auto, which already matches consult's "a person taps Use"). Consult must say its covered items are always shown as "Heard — confirm", never auto-ticked.
3. **One session and segment store.** Discovery §9 defines `checklist_sessions` (with `kind in_home_consult` and `source_ref`) and `conversation_segments`. Consult §11 defines `consult_transcript_segments` and never mentions the shared tables. Pick one. Recommended: consult writes the shared tables, with the consult id as `source_ref`.
4. **Touch-target sizes.** The app ships 44 px (`min-h-11`) on mobile. Sub and discovery say 48 px; consult says 56 px. State it once: **48 px for office and portal surfaces (Calls, sub portal, review), 56 px for field surfaces (consult, sub change form on site)**, with all three plans pointing to the same line.
5. **Status glyphs.** Discovery uses ✓◐○, consult uses ✓◐○!⤳, and sub uses words. Adopt one shared legend component (`components/ui/CoverageMark`) with icon + word, used by Calls, the consult and the sub "Ready to start" list.
6. **Consent copy.** Discovery's phone consent ("record and use AI to take notes…") and consult §8.1 ("record our conversation on this tablet…") are close but not the same pattern. Both should end with the same "You can tell me to stop at any time" clause, record the same consent fields (`notice_version`, `by`, `method`, `withdrawn_at`), and use the same "They said yes / They said no" button wording.
7. **Telegram.** Discovery uses Telegram for live nudges, and consult forbids Telegram during a visit. That's fine, but both should say the `call_nudge` kind is calls-only, so a consult never inherits it.
8. **Consult → sub scope handoff.** Sub §5 step 3 consumes "a versioned adapter … map it to the consult plan's final schema at implementation". Consult §10.9 defines `consultScopeFacts(projectId, scopeKey)` and MCP `get_consult_scope_facts`. Sub must name that function and show the "Visit" column values coming from it in the §8 B conflict wireframe, including the consult's "Sub/supplier will measure" assumption appearing as an exclusion line.
9. **Words.** Consult has a words table; the other two don't. Each plan needs a §"Words used" table. In particular the sub plan ("Work Order", "master", "mobilization") and the discovery plan ("Discovery checklist" vs "Start a discovery call" vs "Finish checklist" vs "End checklist") must settle their button and noun set.
