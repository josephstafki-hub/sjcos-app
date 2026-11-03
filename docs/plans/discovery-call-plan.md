# Discovery-call checklist and live AI reminders in Calls

Planning only · revised 2026-11-02 (round 3) · to-do B `1c52fa69`, and the call/text visibility needed from C `e0897841`.
Nothing in this plan was built, migrated, deployed or changed in Telnyx. Relevant code paths were re-read in this worktree for round 3. Telnyx documentation and model measurements in §10.2 are inherited round-2 evidence, not re-run or independently reproduced this round; they remain pilot inputs. No models or database were called in round 3.

## 0. Decisions in one place

1. **Phase 1 ships with no telephony and no AI**: a discovery checklist in Calls that Joe ticks by hand, on any call — business number or his personal cell. One tap starts it.
2. Joe can reach it from anywhere: an app-wide **live-call bar**, **Start a discovery call** on the lead page, and a Telegram link straight into the checklist (§4.1).
3. Live listening uses Telnyx's own real-time transcription (`transcription_start`, engine `Telnyx`, both tracks, one leg). Nothing is captured until the client agrees; the client's "yes" is caught on the recording (§5).
4. Reminders appear **on screen first**; a Telegram copy is optional and calls-only. At most three per call. Joe has two buttons on a reminder (**Asked it**, **Later**) and one header switch (**Reminders On/Off**).
5. Live work runs in its **own loop inside the worker process**. Slow post-call work (recording download, notes) cannot hold it up (§10.1).
6. This plan **owns the shared checklist coverage engine contract** (§8). The in-home consult plan uses the same states, tables and evidence shape, and runs in **consult mode**: no speaker labels, so the AI can only *suggest* and a person confirms.
7. Migrations: build order is sub agreements **0073**, **discovery calls 0074 (includes the shared engine tables)**, in-home consult **0075+**. Renumber at build time if anything lands first.

## 1. Problem and outcome

Joe's words (to-do B, 2026-08-14): *a coverage checklist, not a rigid script; no fixed order* — budget (if they have one), description of the work, timeline, location, contact info, decision makers, how they found us, other bids, how long in the house / plan to stay. *If Joe moves past or is wrapping up without covering an item, remind him while he can still act. Nudge only on a genuine skip — no running commentary. After the call: short summary of covered vs missed so Joe can follow up by email.* No report card and no scoring of how Joe handled the call. Today's request adds: *the checklist lives in the Calls tab and shows live during the call with AI prompts.*

**Who and where.** Joe, on a lead call, at his desk or parked in the truck. The call is on his cell (business-number calls ring his cell). The checklist is on a second screen: laptop, desktop or a tablet on the dash or desk. If Joe only has his phone, he can switch to the browser during the call, but iOS may pause the page in the background, so the Telegram reminder is the backup. Staff with Calls access can use it the same way. No native app, PWA install or TestFlight is needed.

### 1.1 Words used (on screen, in Settings, in pushes)

| Thing | Word on screen | Never on screen |
|---|---|---|
| The list | **Discovery checklist** | script, scorecard, coverage |
| Start ticking by hand (no dialing) | **Start checklist** | new session, manual mode |
| Dial a lead from the app with the checklist open | **Start a discovery call** | place call |
| End a hand-ticked checklist | **Finish checklist** | end checklist, close session |
| The card / Telegram line | **Reminder** | nudge, prompt, alert |
| Reminder buttons | **Asked it** · **Later** · ✕ | dismiss, mute, snooze |
| Header switch | **Reminders On / Off** | mute nudges, mute phone |
| Consent buttons | **They said yes — start notes** · **They said no — keep it manual** | grant, consent granted |
| Recorded confirmation (unknown speakers) | **They said yes on the recording** | confirm speaker, auto-consent |
| Ambiguous recorded answer | **That was a yes** · **Stop notes** | assume yes |
| Capture running | **Notes on** · **Stop** | AI listening, recording active |
| Row states | **Open · Partly · Covered · N/A** | missing, unclear, not-applicable |
| AI thinks it heard an answer but can't tick it | **Heard — confirm** | suggestion, low confidence |
| Fact already saved on the lead | **On lead** · **Still right ✓** | prior record, prefilled |
| Next steps (client-facing, matches AGENTS) | pre-con agreement · rough estimate · formal estimate · Pre-con change · change order · upsell | proposal, bid (toward the client) |

The 13 row labels in §3 are the only labels for the rows, at every width, in Settings, in the summary, and in the email draft's internal notes.

**Tap targets (shared rule, all three plans):** **48 px** minimum for office and portal surfaces (Calls, the live-call bar, Settings, sub portal, review screens). **56 px** for field surfaces (in-home consult, a sub's change form on site). Calls is an office surface. The row-edit sheet's state buttons are 56 px because they are used mid-sentence.

## 2. Current state (verified in code) and the gap

| Path | What it does today (verified) | Gap this plan fills |
|---|---|---|
| `app/api/voice/webhook/route.ts` | Ed25519 check on raw body → `persistInbound` into `source_events` **before** 200 → `after()` runs only the immediate Call Control step; 503 on DB failure | Route `call.transcription` events to the live loop and `pg_notify` it; nothing heavy in the route |
| `lib/comms/voice-flow.ts` `parseVoiceEvent` (l. 90–123) | Reads `payload.*` call fields incl. `transcription_text` (post-call recording transcript) | Add `transcription_data.{transcript,is_final,confidence,transcription_track}` |
| `lib/telnyx.ts` `callControl` | `answer, speak, recordStart (dual mp3, optional post-call engine "B"), dial, bridge, playbackStart/Stop, hangup` | **No** `record_stop`, `transcription_start`, `transcription_stop` wrappers — add them (§9.1) |
| `lib/worker/loop.ts` + `scripts/sjcos-worker.mjs` | One sequential loop: sweeps → `claimSourceEvents` (25/provider, 120 s lease) → `processOne` each, awaited → dispatcher → wakeups. Iteration cap 5 min, idle 3 s, heartbeat 15 s. `pg.Pool max 4` | A transcript event claimed here waits behind a slow notes job. A separate live loop is required (§10.1) |
| `lib/commands/source-events.ts` `claimSourceEvents` | Filters by provider only | Add `eventTypes` / `excludeEventTypes` filters |
| `lib/dev-agents.ts` `chatReplyClaude` (l. 565) | Runs a fresh `claude -p --output-format json` subprocess per call through Joe's logged-in CLI ("NOT the paid API", l. 40); default model alias `sonnet`; **returns only text**, discarding usage/cost | New `claudeJson()` adapter that returns usage, cost, model and timings, with a pinned model id and a kill on deadline (§10.2) |
| `lib/call-notes.ts` | Hermes draft → Claude review; truncates transcript to 24,000 chars (l. 83); returns early when `notes_status='done'` (l. 136) | Coverage finalization as its own resumable step; long calls processed in chunks |
| `lib/notify-owner.ts` | `OwnerPushKind` has no live-call kind; quiet hours 07–21 Chicago; four/hour cap; 5-min drain parks pushes. `voice.ts` pushes only voicemail and missed calls (l. 472–474) — **no push when a call rings or connects** | `call_live` and `call_nudge` kinds that expire and are never parked (§7.3) |
| `db/schema.sql` `push_outbox.kind` CHECK | Fixed list (grant … comms) | Add `call_live`, `call_nudge` |
| `components/calls/CallsClient.tsx` | `PageHeader` "Calls" / meta "Call history, recordings and notes for your business number."; list `@3xl/page:w-[280px]`, detail pane with Back (`size-11`) + `OutcomeChip`; mobile targets `min-h-11` | Checklist replaces the detail pane **body**, header kept (§6) |
| `components/shell/MobileTabBar.tsx` | Today, Projects, Leads, Inbox, More — **no Calls** | Live-call bar makes Calls reachable during a call |
| `components/shell/LiveUpdates.tsx` | Polls the change log every 2.5 s and `router.refresh()`es (≥3 s apart) | Feeds the live-call bar for free: a `calls` row change refreshes the layout |
| `app/(os)/leads/[slug]/page.tsx` l. 427–447 | Header actions: stage button, `LeadContact` (Call reveals number / `tel:`), `…` menu | Add **Start a discovery call** |
| `lib/leads/qualification.ts` | 9 `FACT_KEYS`; `photos` is **derived from photo-file count** (l. 81); `syncFactsFromIntake` upserts | 7 new fact keys (§3.3); `photos` is left alone |
| `lib/lead-intake-questions.ts` | Scope, Timeline, Budget, Address, Other bids? | Rows reference these by key, not label regex |
| `lib/transcribe.ts` | whisper.cpp batch, mono, no timestamps | Not used live here (consult plan extends it) |
| `submit_draft_for_approval` | Handler is inline in `mcp/sjcos-mcp.mjs` (~l. 1792) | Extract `stageDraftForApproval()` into `lib/approvals/stage-draft.ts` so the worker can call it (§11) |

Telnyx facts (OpenAPI `TranscriptionEvent`, docs 2026-11-02): `call.transcription` → `data.payload.transcription_data.{transcript, is_final, confidence (number|null), transcription_track ('inbound'|'outbound')}`. The spec says `transcription_track` "is only available when `transcription_engine` is set to `B`" (`B` is the legacy alias of `Telnyx`). **There are no audio-offset or duration fields**; the only time is `data.occurred_at`. Engine `Telnyx` takes `transcription_model` `openai/whisper-tiny` (default) or `openai/whisper-large-v3-turbo` and has **no interim results**. `transcription_tracks` is `inbound` (audio from the leg the command is sent on), `outbound` (the other side), or `both`.

## 3. The checklist — full content

Rows can be covered in any order. Asking a question does not cover it; the client has to answer. Each row is **Open**, **Partly**, **Covered** or **N/A**. A conflict with a saved fact is a separate flag, not a fifth state. "Don't know yet", "no budget yet" and "rather not say" all **cover** a row. N/A always needs a reason.

### 3.1 The nine standard rows (on by default)

| # | Label | Key | Ask (two natural questions) | Covered when | Partly when | Reminder (exact card text) | Partly-only reminder |
|---|---|---|---|---|---|---|---|
| 1 | **Work** | `work` | "Tell me what you're hoping to do." / "What's not working with the space now, and what would you like instead?" | A room or space plus the change wanted ("upstairs bath, tub out, walk-in shower") | "Some work on the house"; a room with no change; Joe's own suggestion the client didn't confirm | Remember to ask what work they want done. | Remember to ask what they'd like to change in the {space}. |
| 2 | **Budget** | `budget` | "Do you have a budget in mind, or are you still figuring that out?" / "Is there a range you'd like us to work within?" | An amount or range, **or** "no budget yet" / "rather not say" | "Reasonable"; "fifty" without units; Joe floats a number and gets no clear answer | Remember to ask if they have a budget in mind. | Remember to confirm the budget amount. |
| 3 | **Timeline** | `timeline` | "When are you hoping to get started?" / "Is there a date you need it finished by, or are you flexible?" | A start or finish window, or "flexible" / "not decided" | "Soon"; a deadline with no date | Remember to ask when they're hoping to start. | Remember to ask if that date is firm. |
| 4 | **Address** | `address` | "Where is the house?" / "What's the project address, including the city?" | Street address and city confirmed by the client (or a saved address reconfirmed) | City only; unclear house number; mailing address not confirmed as the job address | Remember to confirm the project address and city. | Remember to confirm the street address. |
| 5 | **Contact** | `contact` | "What's the best name, number and email for following up?" / "Is this the best callback number, and what email should I use?" | Name, callback number and email read back, or email declined with another way to reach them | Caller ID only; an email that wasn't spelled back; name only | Remember to confirm the best callback number and email. | Remember to read back their email. |
| 6 | **Who decides** | `who_decides` | "Who else will be involved in making decisions?" / "Would your spouse or partner like to be part of the next conversation?" | "Just me", or the other people/roles named | "We" or a spouse mentioned, involvement unclear | Remember to ask who else should be involved. | Remember to ask if {person} should join the next conversation. |
| 7 | **How they found us** | `found_us` | "How did you hear about SJ Carpentry?" / "Did someone refer you, or did you find us online?" | A channel or referrer, or "don't remember" | Joe's guess; "somewhere online" never confirmed | Remember to ask how they found us. | Remember to ask who referred them. |
| 8 | **Other bids** | `other_bids` | "Are you talking with any other contractors?" / "Are you getting other bids, or are we your first conversation?" | yes / no / undecided / declined | "Shopping around" with no context | Remember to ask if they're getting other bids. | — (no partly reminder) |
| 9 | **Years in house / staying** | `years_staying` | "How long have you lived there, and do you plan to stay a while?" / "Is this a long-term home for you, or are you thinking about selling?" | Both parts answered (uncertainty counts; "not moved in yet" counts) | Only one part | Remember to ask how long they've lived there and plan to stay. | Remember to ask how long they plan to stay. |

### 3.2 Four more rows (on by default — Joe decided 2026-11-02; he turns any off in Settings as he goes)

| # | Label | Key | Ask | Covered when | Partly when | Reminder | Partly-only reminder |
|---|---|---|---|---|---|---|---|
| 10 | **Next step** | `next_step` | "What's the best next step for you — should I send the pre-con agreement and set up a time to come out?" | A dated meeting or visit; the client agrees Joe sends the pre-con agreement; or the client says they'll call back | "Sounds good" with nothing agreed | Remember to agree on the next step. | Remember to set a date to come out. |
| 11 | **Photos** | `photos_request` | "Could you text or email me a few photos of the space?" | Yes / no / already sent | — | Remember to ask for photos. | — |
| 12 | **The property** | `property` | "Do you own the home? Is it a house, townhome or condo — any HOA?" | Owner yes/no (buying or renting → whose approval) **and** property type **and** HOA yes/no | Any one or two of the three | Remember to ask if they own the home and if there's an HOA. | Remember to ask if there's an HOA. / Remember to ask if they own the home. / Remember to ask if it's a house, townhome or condo. |
| 13 | **Paying for it** | `paying` | "Will you pay for this out of pocket, or through a loan or insurance claim?" | cash / loan or HELOC / insurance claim / declined | "We'll figure it out" | Remember to ask how they plan to pay. | — |

Why these four are worth having: renting, a condo or an HOA changes who signs and whether association approval is needed, and that comes before price. Paying through a loan triggers the lender material breakdown (bank-approval skill), and "how they'll pay" informs the deposit conversation (Joe's rule: at least half up front on jobs around $44k). Photos speed up the rough estimate. Never suggest a lender, rate or insurance outcome.

**Insurance claim answered → show Joe:** “Don’t offer to cover the deductible, don’t explain their coverage, don’t deal with the adjuster for them (Minn. Stat. § 325E.66).” Do not promise a deductible rebate or act as an unlicensed public adjuster. Create one idempotent lead/rough-estimate to-do: **Include the § 325E.66 written notice with the initial estimate — counsel supplies wording**; carry it into estimate preparation, not just the call summary. [Minn. Stat. §325E.66 subd. 1(a)(1), (a)(3), (b)](https://www.revisor.mn.gov/statutes/cite/325E.66).

**Default reminder priority at wrap-up:** Contact, Work, Address, Budget, Timeline, Who decides, Next step, The property, Other bids, How they found us, Paying for it, Photos, Years in house / staying. Priority only decides which single reminder appears when several rows are open. It does not set the order of the conversation.

### 3.3 Values and where they go

| Key | Stored value (session) | Lead fact written on promotion |
|---|---|---|
| `work` | `{scope, job_type, goals}` literal | existing `scope`, `job_type`, `goals` |
| `budget` | `{response:'stated'\|'not_set'\|'declined', amount_text}` | existing `budget_fit` only when stated, in the dollar-string form `parseBudgetCents` reads; never `$0` |
| `timeline` | `{text, start:date\|null, finish:date\|null, firm:boolean\|null}` | existing `timeline` (original wording kept) |
| `address` | `{street, city, confirmed:boolean}` | existing `address`; `service_area` from city |
| `contact` | `{name, phone_e164, email, preferred_channel, email_declined}` | **new** `contact_info` (lead identity fields change only after Joe taps **Use these contact details**) |
| `who_decides` | `{sole:boolean\|null, people:[{name\|null, role}]}` | **new** `decision_makers` |
| `found_us` | `{channel, referrer\|null, detail, unknown}` | **new** `referral_source` |
| `other_bids` | `{answer:'yes'\|'no'\|'undecided'\|'declined', detail}` | **new** `other_bids` |
| `years_staying` | `{occupancy_text, stay_plan_text}` | **new** `house_history` |
| `next_step` | `{kind:'visit'\|'precon_agreement'\|'client_calls_back'\|'other', date\|null}` | none — feeds the follow-up to-do (`due_at` = the agreed date, so it is snoozed until then) |
| `photos_request` | `{answer:'will_send'\|'sent'\|'no'}` | none — the existing `photos` fact stays derived from real uploaded photos (`qualification.ts:81`) |
| `property` | `{owner:'yes'\|'no'\|'buying'\|'renting', type:'house'\|'townhome'\|'condo'\|'other', hoa:'yes'\|'no'\|'unknown'}` | **new** `property` |
| `paying` | `{method:'cash'\|'loan_heloc'\|'insurance'\|'declined'}` | **new** `paying_with` |

`lead_facts.key` is unconstrained text (`0017_leads.sql`), so no enum migration is needed. The seven new keys are added to the TypeScript `FACT_KEYS` union, `qualificationChecklist`, fact renderers and MCP schemas. They are **not** added to the qualification verdict's required subset, so stage rules and the verdict stay as they are. Intake rows map by key: `work↔Scope`, `timeline↔Timeline`, `budget↔Budget`, `address↔Address`, `other_bids↔Other bids?`. `syncFactsFromIntake` learns the `other_bids` mapping.

**Already on the lead.** When a fact is already `known`, the row shows **On lead** with the stored value in `--ink-2`, plus a **Still right ✓** button (§6.6). That fact stops the reminder, but the row stays **Open** until Joe taps Still right ✓ or the client answers again on the call.

**Discovery facts feed the consult.** Decision makers, the property / HOA, years in house / staying, and the photo-request status are returned by `loadLeadFacts`. The consult plan shows them under "What we know so far" so the client isn't asked twice; the visitor confirms them instead.

### 3.4 Settings › Calls › Discovery checklist (Phase 1 scope)

Owner only. Per row: label (≤40 chars), reminder sentence (≤120), two suggested questions (≤160 each), **On/Off** (optional rows only), **Reminders for this row On/Off**, **Move up / Move down** (no drag). Global: **Reminders go to: On screen only / On screen and phone**; **Send me a link when a call starts** On/Off; **Wrap-up words** (one per line; Phase 3, §7.1). Buttons: **Save**, **Cancel**, **Restore default wording**. Under the hood each Save publishes a new immutable version. Sessions keep the version they started with.

Cut from round 1 as over-built for a one-owner company: custom rows, component editors, fact-target pickers, the 30-row limit. They come back only if Joe asks, as a separate change.

## 4. Getting to the checklist, and the user flows

### 4.1 Reachability

1. **Live-call bar (every page).** `components/shell/LiveCallBar.tsx`, mounted in `components/shell/Shell.tsx` directly under the `Topbar`, full width, 48 px tall. `app/(os)/layout.tsx` loads `activeCallSnapshot()`: one indexed query for calls with `status IN ('ringing','bridged')` started in the last 2 h, only for users with `comms` access. `LiveUpdates` already refreshes the layout when the `calls` row changes (≤2.5 s poll, ≥3 s apart), so no new poller is needed. Copy:
   - ringing: `☎ Incoming — Alex · Bath   [Open checklist]  ✕`
   - on the line: `☎ Alex · Bath — on the line 04:21   [Open checklist]  ✕`
   - unknown caller: `☎ Call from (612) 555-0142 — on the line 00:40   [Open checklist]  ✕`
   - manual checklist open on another device: `☑ Discovery checklist open — Alex   [Open]  ✕`

   ✕ hides the bar for that call in this browser tab (sessionStorage). The bar is hidden on `/calls` while that call is open. On a phone it sits under the top bar and never covers the bottom tab bar.
2. **Lead page.** **Start a discovery call** goes in the lead `PageHeader` actions next to `LeadContact`, and **Discovery checklist** goes in the `…` menu and in the lead row's menu on `/leads`. Wireframe in §6.2.
3. **Telegram.** When **Send me a link when a call starts** is on, the moment a lead or unknown-caller call **bridges**, one `call_live` push: `[SJC OS] On a call with Alex · Bath — open checklist` → `https://os.sjcarpentryllc.com/calls?open=<call-id>&view=checklist`. Nothing is sent while the call is ringing; Joe's phone is already ringing. In quiet hours the push is dropped, never delayed. The text carries no address or budget.
4. **Calls page.** `?open=<call-id>&view=checklist` (and `?checklist=<session-id>` for a hand-ticked checklist with no call) opens the detail pane straight into the checklist.

### 4.2 Phase 1 — hand-ticked checklist, one tap

1. Joe taps **Start checklist**: in the Calls header, on any selected call's detail header, or from the lead page. The session is created immediately with `started_at = now`, lead **Link later** (or pre-linked from the lead page) and direction unset. The first tick can happen within one second.
2. The session header shows `Lead: Link later ▾ · Call: none ▾` as editable fields. Joe can link the lead and a Telnyx call row afterwards. Linking asks "Link to Alex Smith? Facts from this checklist will be saved to that lead." [Link] [Cancel].
3. Tap a row's **state word** → Open becomes Covered (one tap). Tap again → back to Open. Partly becomes Covered. Tap the **label** → row sheet (§6.5) for Partly, N/A (reason required) or an answer. A tick with no typed answer never writes a fact.
4. Each change saves with an `operation_id` and `expected_revision`. The header shows **Saved** only after the server acknowledges it.
5. **Finish checklist** → summary (§6.8). Phase 1 has no AI and no auto-drafted email; Joe can type a follow-up draft and send it for approval.

### 4.3 Offline and lost signal (decision: online reload + pending-edit recovery)

There is **no offline shell or service worker** for Calls, and the plan says so plainly. Calls needs a connection to open. Once the page is open:
- A dropped connection: edits queue in IndexedDB database `sjcos-calls`, store `pending:<user-id>`, keyed by session. Banner: **Offline — 3 changes saved on this device. They'll send when you're back online.** A `beforeunload` warning appears while unsent changes exist.
- Reloading while offline gives the browser's own offline page. When Joe reopens the session online: **3 changes from this device weren't sent — [Send now] [Discard]**.
- Storage denied or full: **Can't save on this device — keep this page open until you're back online.**
- Logout clears the store. Entries expire after 24 h. A different signed-in user never sees another user's queue (the partition is by user id).
- Replay: the server returns the earlier result for an `operation_id` it already has. A revision mismatch returns 409 with both versions, and Joe picks one. Another device's edits are never silently overwritten.
- No audio, transcript or secret is ever stored on the device.

### 4.4 Live flow (after Phases 2–3 are switched on)

1. A business-number call arrives, or Joe uses **Start a discovery call**. The call row exists as today. If the number matches a lead, a session is created at ringing. If not, the detail pane shows the unknown-caller choice (§6.6) and nothing listens.
2. On bridge, the checklist pane shows the **consent card** as its primary action (§6.3). Nothing is captured before **They said yes — start notes** (§5).
3. Notes on: transcript segments arrive, rows tick with evidence, and at most one reminder card shows at a time (§7).
4. If the browser loses signal, the Telnyx call continues. The header says `Last update 40 s ago` and never claims the AI is listening. Rows Joe ticks queue as in §4.3.
5. If the provider or worker fails: reminders stop, **Live notes unavailable — the call is fine. Keep ticking by hand.** The call and its bridge are never affected.
6. Hangup: all reminders expire at once. The final recording transcript (if recording is on) reconciles. Summary and follow-up draft follow (§11).

### 4.5 Routing options (unchanged decision)

| Route | Decision |
|---|---|
| Business number inbound; app click-to-call outbound | Default for lead calls |
| **Start a discovery call** | Build. The confirm click mints the exact-number, single-use `place_call` grant the existing `placeCallAction` uses |
| Conditional forwarding from the personal cell | Optional; never advertised as full coverage |
| Forward every personal call to the business number | Don't — loops back to Joe's cell and records personal calls |
| Telnyx mobile voice / WebRTC app | Later pilot only (Phase 5) |
| Hand-ticked checklist | Always available; labelled **By hand — AI can't hear this call** |

## 5. Consent (shared with the in-home consult plan)

Minnesota allows a party to a conversation to record it (**Minn. Stat. §626A.02 subd. 2(d)**, not 2(c)). An area code does not prove where a caller is, and some states require everyone's consent, so **we ask everyone, every time**. The client's "yes" is captured on the recording, which is the best evidence and costs nothing. The attorney approves the wording, the interstate procedure, the processor disclosure, staff use and retention (§14) before any live capture.

**Shared pattern (both plans use it):** the script names "an AI tool we use" and ends with "You can tell me to stop at any time." The buttons read **They said yes …** / **They said no …**. The same fields are recorded: `consent_notice_version`, `consent_by`, `consent_method` (`verbal_phone` | `verbal_in_person`), `consent_at`, `withdrawn_at`, `consent_evidence_segment_id`, plus capture/deletion epochs and the per-assent clip records (§14). The recorded yes is stored as evidence. A new person joining pauses capture while Joe asks them.

### 5.1 Exact sequence on a call (notice version `call-2026-11`)

1. Bridge. Nothing is recorded or transcribed. (This needs `VOICE_RECORDING=consent`, a new mode, §9.4. Today `all` starts recording at answer, before anyone agrees.)
2. The consent card shows Joe's line at 17 px:
   > "Before we get into it — I'd like to record this call and have an AI tool we use take notes, so I don't miss any of your project details. Is that okay with everyone on the line? You can tell me to stop at any time."
3. **They said yes — start notes** (full-width primary) → server action `checklist_record_consent(…,'awaiting_recorded_confirmation',…)` → `record_start` (required for recorded-consent evidence; otherwise stay by hand) and `transcription_start` on the client leg. This records initial verbal permission, but blocks AI/reminders until recorded evidence changes status to `granted`.
4. The card changes to Joe's next line, which he says on the recording:
   > "Okay, we're recording now — and you're fine with that, right?"
5. **Consent check (code, no AI).** Within 45 s of capture starting, examine final client-track segments. Normalize case and curly apostrophes. Affirmative matches `\b(yes|yeah|yep|sure|fine|okay|ok|of course|go ahead|no problem|not a problem|no worries|don't mind|that's fine)\b` (including “I don't mind”). Before negative matching, remove `no problem`, `not a problem`, `no worries`, `don't mind`, `no,? (that's )?fine`, `no,? go ahead` (comma optional because STT punctuation varies); negative then matches `\b(no|nope|not|never|don't|do not|isn't|ain't|wouldn't|won't|can't|rather not|prefer not|stop)\b` **or** any remaining word ending in `n't` (`\b\w+n't\b`). Evaluate positive on the original text, negative on the stripped text. Because yes-words like "fine"/"okay" also appear inside refusals ("that's not okay", "not fine"), such answers match both lists and fall to **ambiguous** below — never to an automatic yes.
   - Affirmative only → set `consent_evidence_segment_id`; durably queue the ≤20 s yes-clip preservation (§14); chip **Notes on · Consent on recording 00:07**.
   - Negative only → stop capture immediately, set `consent_status='not_on_recording'`, show **Consent not on the recording — ask again or keep it manual. [Ask again] [Keep it manual]**. No response by 45 s follows the same stop path. **Ask again** returns to step 2.
   - Both or neither on a received answer → **ambiguous**, not refusal: set `consent_status='paused_confirmation'`, pause recording/transcription and downstream analysis; retain the already-captured segment, show its text and **That was a yes** / **Stop notes**. Joe's authenticated tap binds to the selected segment id/revision. That was a yes preserves the clip and resumes only after confirmed pause; Stop notes keeps it manual. Do not discard the paused answer or resume on a timer.
   - Unknown speakers (consult mode) → disable automatic attestation. Show **They said yes on the recording** (48 px; 56 px in the consult) and the 45 s countdown. Tapping it **stops the countdown** and lists the recent segments of the call as 48 px tappable rows (time + exact text, newest first); Joe picks the row that is the client's actual answer, then taps **That was a yes** (consent granted) or **Stop notes** (keeps it manual). Joe selects the actual recorded response; his tap plus its segment id/revision is the attestation, never his own spoken question. An ambiguous response still uses **That was a yes** / **Stop notes**. For consult batch audio the visitor must identify the response in the local recorded playback before resuming; do not wait for delayed batch STT to attest consent. For consults no audio clip is stored (Joe 2026-11-02, §14): the visitor's pick is recorded at once, the background worker links it to the yes segment's verified text when that chunk transcribes, and only then may the chunk be deleted; later chunks wait untranscribed until the link exists.
   - `tests/call-consent.test.mjs`: yes, yeah no problem, not a problem, I don't mind, no worries, no that's fine, no go ahead → yes; no/nope/stop/never/"I'd prefer not" → no; "not ok", "that's not okay", "that isn't fine", "I'm not okay with that" → ambiguous (never yes); yes but stop → ambiguous; silence → timeout; unknown speaker requires person; ambiguous pause/resume and clip extraction failures never enable analysis.
6. **They said no — keep it manual** → the card shows Joe's line: *"No problem — I'll just take notes by hand."* Nothing is captured on this call. The checklist works by hand.
7. **Stop** (on the **Notes on** chip) → sheet **Stop recording and AI notes for this call? The call keeps going.** [Stop notes] [Keep notes on]. This sends `transcription_stop` and `record_stop`, sets `withdrawn_at`, expires reminders and stops processing. If Telnyx doesn't confirm within 5 s, the live loop retries once. If it still isn't confirmed: flag banner **Recording stop not confirmed — end the call or tell them you'll call back** plus a `comms` push to Joe. The app never claims capture stopped when it doesn't know.
8. **Someone new joins:** **New person on the line** (in the ⋯ of the Notes on chip) pauses capture (`transcription_stop` + `record_stop`) and shows: *"{Name}, I'm recording this call and using an AI tool to take notes — is that okay with you too? You can tell me to stop at any time."* → [They said yes — resume notes] [They said no — keep it manual].

Only the signed-in person on the call can grant consent (website login, through the owner-owned function; §8.4). Agents cannot change consent. The worker may only pause/stop capture or finish the deterministic evidence check for an already person-authorized start; it cannot grant initial permission or resume capture.

**Attorney items** (one packet with the consult plan): the script wording; recorded confirmation as evidence; interstate callers; naming Telnyx and Anthropic on `/privacy`; a pre-con agreement sentence about recorded calls and visits; staff using it; the retention table in §14.

## 6. Screens

Built from the existing kit: `PageHeader`, `Button`, `Chip`, `Segmented`, `VoiceButton` (`lib/use-dictation.ts`), and tokens from `docs/design-tokens.md`. Paper/card surfaces, ink text, Newsreader headings, Mulish body. Reminders use `--ai-soft` background with `--ai-2` text. Flags use `--flag` / `#EFD9CF` with an icon and a word. No colour-only meaning, no traffic lights. Times shown in America/Chicago (this fixes the current UTC call display in the touched views).

### 6.0 Shared CoverageMark — coverage and ready word sets

`components/ui/CoverageMark.tsx` has exactly two variants/word sets. Every mark always renders its word, including compact views and accessible names; colour is supplementary. A symbol has one meaning inside each set.

| Word set | Stored state or presentation flag | Symbol + exact word |
|---|---|---|
| `coverage` — checklist coverage | `open` | ○ Open |
| `coverage` | `partial` | ◐ Partly |
| `coverage` | `covered` | ✓ Covered |
| `coverage` | `not_applicable` | — N/A |
| `coverage` | pending suggestion (not a fifth state) | ◌ Heard — confirm |
| `coverage` | conflict flag (not a fifth state) | ! Conflict |
| `coverage` | consult return-visit flag (not a fifth state) | ⤳ Return visit |
| `ready` — sub Ready to start | `done` | ✓ Done |
| `ready` | `not_yet` | ○ Not yet |
| `ready` | `problem` | ! Problem |

Use `variant="coverage"` for checklist sections and fields, `variant="ready"` for the sub list. Never use ! for Open, or substitute Answered/Missing as mark words. A required field uses ○ Open plus its separate `*` marker. For multiple flags show separate word marks beside the underlying state. Row labels are 17 px; state words 15 px, right-aligned. Both consumers cite this section rather than inventing a third set.

**Layout in the container-query terms `CallsClient` already uses (`@container/page`):**
- below `@3xl/page` (phone): list **or** detail, with the existing Back button.
- `@3xl/page` to below `@6xl/page` (tablet, small laptop): 280 px list + detail. Inside the detail, one column: reminder card above the rows.
- `@6xl/page` and up (desktop): 280 px list + detail split into checklist (≈58%) and reminder + answers (≈42%).
- The checklist **replaces the body of the existing detail pane**. The pane header (Back, name, `OutcomeChip`) stays. The Calls `PageHeader` meta becomes "Calls, recordings, notes and discovery checklists."

### 6.1 Live-call bar (all pages)

```text
phone 390px
┌──────────────────────────────────────┐
│ ☰  TODAY                      🔔     │  Topbar
├──────────────────────────────────────┤
│ ☎ Alex · Bath — 04:21  [Open checklist] ✕ │  48 px, --ai-soft
├──────────────────────────────────────┤
│ …page…                               │

desktop
┌─────────────────────────────────────────────────────────────────────┐
│ PROJECTS / LAKE BATH                              Search…  ⌘K   🔔   │
├─────────────────────────────────────────────────────────────────────┤
│ ☎ Alex · Bath — on the line 04:21              [Open checklist]  ✕  │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Lead page header with Start a discovery call

```text
desktop                                                     phone
Alex Smith  [Qualifying]                                    Alex Smith [Qualifying]
Upstairs bath remodel, tub to shower                        Upstairs bath…
Logged Oct 30 · Source: Google                              [Move to Pre-con]
[Move to Pre-con] [Start a discovery call] [Call] [Email] […]  [Start a discovery call]
                                                            [Call] [Email] […]
Confirm sheet (both widths):
┌ Start a discovery call ───────────────────────────┐
│ Call Alex at (612) 555-0142?                      │
│ Your cell rings first, then we connect Alex.      │
│ [Call now]                       (48 px, primary) │
│ [Checklist only — I'll call from my cell]         │
│ [Cancel]                                          │
└───────────────────────────────────────────────────┘
```
**Call now** → `placeCallAction` (the existing exact-number grant) plus a session linked to the lead; Calls opens on that call. **Checklist only** → a hand-ticked session linked to the lead, opened in Calls.

### 6.3 Consent card (primary action while consent is pending) and its banners

```text
phone (detail pane, call bridged)
[‹ Calls]  Alex · Bath            ● On the line 00:18
Lead: Alex Smith ▾   Reminders [On]   Saved
┌──────────────────────────────────────────────┐
│ Ask first (say this):                         │  17 px
│ "Before we get into it — I'd like to record   │
│ this call and have an AI tool we use take     │
│ notes, so I don't miss any of your project    │
│ details. Is that okay with everyone on the    │
│ line? You can tell me to stop at any time."   │
│ [ They said yes — start notes ]   full width  │  56 px, primary
│ [ They said no — keep it manual ]             │  48 px, secondary
└──────────────────────────────────────────────┘
Work              ○ Open
Budget            ○ Open
…(rows usable by hand while consent is pending)

after yes:
[Confirming consent · Stop]  45 s remaining
"Okay, we're recording now — and you're fine with that, right?"
Known voices: checking client's recorded answer…
Unknown voices: [They said yes on the recording]  48 px
  tap → countdown stops; recent segments as rows to pick:
  ┌ 00:05  "yeah that's fine"          ┐  48 px row each, newest first,
  ├ 00:03  "okay we're recording now…" ┤  quote text + time, one selected
  └ 00:01  "…"                         ┘
  picked row → [That was a yes] [Stop notes]   (48 px each)
Ambiguous: capture paused · “{actual segment text}”
           [That was a yes] [Stop notes]
then: [Notes on · Consent on recording 00:07 · Stop]

banners (--flag, icon + words, full width under the header):
⚠ Consent not on the recording — ask again or keep it manual.  [Ask again] [Keep it manual]
⚠ Recording stop not confirmed — end the call or tell them you'll call back.  [Try again]
```
Desktop and tablet use the same card at the top of the checklist column. The script is at most 60 ch wide.

### 6.4 Live checklist

```text
desktop (@6xl/page and up)
Calls                                             [Start checklist] [Call]
Calls, recordings, notes and discovery checklists.
┌────────────────┬──────────────────────────────────────────────────────────┐
│ On the line    │ ‹ Alex · Bath  [Answered]   ● On the line 04:21           │
│ › Alex   04:21 │ Lead: Alex Smith ↗ · Notes on · Stop · Reminders [On] · Saved│
│ Recent         ├──────────────────────────────┬───────────────────────────┤
│ Sam  Yesterday │ Discovery checklist   6 of 9 │ ┌ Reminder ─────────────┐ │
│ …              │ Work             ✓ Covered   │ │ Remember to ask if    │ │ 22 px serif
│                │ Budget           ◐ Partly    │ │ they have a budget in │ │ --ai-2 on
│                │ Timeline         ✓ Covered   │ │ mind.                 │ │ --ai-soft
│                │ Address          ✓ Covered   │ │ Try: "Do you have a   │ │
│                │ Contact          ◌ Heard — confirm│ budget in mind, or …?"│ │
│                │ Who decides      ○ Open      │ │ [Asked it] [Later]  ✕ │ │
│                │ How they found us ✓ Covered  │ └───────────────────────┘ │
│                │ Other bids       ○ Open      │ Answers so far            │
│                │ Years in house / staying ○ Open│ Work: upstairs bath, tub→shower│
│                │                              │ Budget: "fifty" — confirm  │
│                │ [Notes] [Transcript ▾]       │ [Evidence ≈02:13]          │
└────────────────┴──────────────────────────────┴───────────────────────────┘

phone (below @3xl/page)
[‹ Calls] Alex · Bath        ● 04:21
Notes on · Stop   Reminders [On]   Saved
┌ Reminder ─────────────────────────────┐
│ Remember to ask if they have a budget │  22 px serif
│ in mind.                              │
│ [ Asked it ]  [ Later ]           ✕   │  48 px buttons
└───────────────────────────────────────┘
Work                         ✓ Covered
Budget                       ◐ Partly
Timeline                     ✓ Covered
Address                      ✓ Covered
Contact              ◌ Heard — confirm
Who decides                  ○ Open
How they found us            ✓ Covered
Other bids                   ○ Open
Years in house / staying     ○ Open
[Answers ▾]  [Transcript ▾]  [Notes]
```
Each row is ≥48 px tall, and the whole row is a target: the label opens the sheet, the state word changes the state. The tablet layout is the phone column inside the 280 px + detail split. The transcript stays collapsed by default and never flashes word by word. The four extra rows appear after row 9 in Settings order; a row Joe switches off disappears from new calls.

### 6.4a Hand-ticked checklist — phone (360 px)

```text
[‹ Calls] Checklist · started 10:42
Lead: Link later ▾ · Call: none ▾ · Saved
[By hand — AI can't hear this call]
Discovery checklist
Work                         ○ Open
Budget                       ○ Open
Timeline                     ○ Open
Address                      ○ Open
Contact                      ○ Open
Who decides                  ○ Open
How they found us             ○ Open
Other bids                   ○ Open
Years in house / staying      ○ Open
[Notes]
─────────────────────────────────────
[          Finish checklist          ]
```

The 48 px primary **Finish checklist** bar is sticky above the safe area; the rows scroll above it. Optional enabled rows follow the nine. Lead/call controls wrap onto separate lines at narrow widths. Tablet and desktop use the same header, chip and finish action within the checklist pane. On a live call with notes on, summary opens at hangup; **Finish checklist** also sits in header ⋯ for a call whose hangup the app can't see (it closes the checklist, never hangs up).

### 6.5 Row sheet (bottom sheet on phone/tablet, side panel on desktop)

```text
┌ Budget ──────────────────────────────── ✕ ┐
│ [ Open ][ Partly ][ Covered ][ N/A ]      │  56 px segmented
│ Answer                                     │
│ ┌──────────────────────────────────┐ 🎤   │  mic = VoiceButton
│ │ around $40–50k                   │      │
│ └──────────────────────────────────┘      │
│ ○ Stated  ○ No budget yet  ○ Rather not say│ (row-specific quick picks)
│ ▸ Why we ask · Questions to try · Evidence │  collapsed
│   Heard ≈02:13 (client): "we were thinking │
│   around fifty"                            │
│ Changed by hand                     │
├────────────────────────────────────────────┤
│ [ Undo ]                      [ Save ]     │  pinned, 48 px
└────────────────────────────────────────────┘
```
N/A shows a required reason field. **Heard — confirm** rows open with the heard value prefilled and one primary **Confirm** (= Covered). A change made by hand shows **Changed by hand**, and the AI never overrides it.

### 6.6 Prefilled row and unknown caller

```text
Address    On lead: 4410 Elm St, Edina    [Still right ✓]    ○ Open
           (value in --ink-2, ghost chip "On lead")

Unknown caller (detail pane, no lead match):
┌ Unknown caller — (612) 555-0142 ─────────────────────┐
│ [Link to a lead]   [New lead]   [Not a lead call]     │  48 px each
└──────────────────────────────────────────────────────┘
```
**Not a lead call** (vendor, sub, family) hides the checklist and creates no session and no reminders. **New lead** opens the existing create-lead form prefilled with the number; the session links when it is saved.

### 6.7 States

| State | Copy / behaviour |
|---|---|
| Nothing selected | "Start a checklist, or pick a call." [Start checklist] works with voice switched off |
| Loading | Skeleton rows, "Loading checklist". No edits until the session id is known; Retry on failure |
| Ringing | Inbound: "Incoming call". Outbound: "Your cell rings first". Checklist usable by hand; no reminders |
| Consent pending | Consent card (§6.3) on top; rows usable by hand |
| They said no | Chip "By hand — no recording"; rows usable |
| Notes on | Call timer, "Last text 3 s ago", **Saved** shown separately |
| Waiting for speech | "Notes on — waiting for speech" (silence is normal) |
| Behind | "AI is behind — tick by hand for now." Stale reminders removed and never replayed |
| Failed | "Live notes unavailable — the call is fine. Keep ticking by hand." [Try once more] |
| Speakers unknown | During consent show **They said yes on the recording** + 45 s countdown (§6.3); after confirmation: "Notes on — can't tell voices apart, so answers show as Heard — confirm" |
| Ambiguous consent | Capture paused; actual response + **That was a yes** / **Stop notes** (§5.1); no AI or reminders |
| By hand | **By hand — AI can't hear this call**, sticky **Finish checklist** (§6.4a) |
| Offline | §4.3 banner |
| Ended | "Call ended — checking the final transcript". Reminders gone; edits still allowed |
| Summary | §6.8 |
| Notes failed | Checklist kept; the existing "Write up the call…" to-do and recording link |

### 6.8 After the call — summary and follow-up

```text
phone                                         desktop: summary left, draft right
Call summary · Alex · Bath · 12 min
6 covered · 1 partly · 2 open · 0 N/A
Open
  Who decides             [☑ Ask in email]
  Other bids              [☐ Ask in email]
Partly
  Budget "fifty" — confirm  [☑ Ask in email]
Answers  ▸ (each with Edit)
Follow-up draft
  To: alex@example.com
  Subject: A few details for your project
  ┌ editable body ──────────────────────┐
  └─────────────────────────────────────┘
  [ Submit for approval ]  (primary, 48 px)
  Joe approves it in Today; approval sends it.

no email on file:
  Confirm their email first  [Add email]
```
At most three questions go in the email; a row left unticked by default stays in the internal summary. If the client said "rather not say" or the row is N/A, it is never put in the email. If every row is covered, there is no draft — the summary says "Everything covered." The draft body is in §11.

### 6.9 Accessibility and field realism

Body text 16 px, row labels 17 px, reminder text 22 px. Visible focus rings, full keyboard use, works at 200% zoom and with reduced motion. `aria-live="polite"` announces count changes at most every 10 s and each reminder once. The page never auto-scrolls away from the Notes field. Sticky controls respect safe areas and the on-screen keyboard. State and Save sit at the bottom of the sheet for one hand. Ink on paper stays readable in a sunny truck cab. Park before using it; there is no driving mode.

## 7. Reminders

### 7.1 When a reminder may appear (the "genuine skip" rules)

- **Nothing in the first 90 s after consent**, except the wrap-up fast path below, which needs at least 60 s since consent.
- **Topic moved on:** a row was asked or discussed but is still Open or Partly. Then two complete turns on another topic and ≥45 s since that row was last mentioned, confirmed by the model. A row nobody has raised is only eligible at wrap-up, never just because it's "next".
- **Wrap-up (fast path, no model wait):** a **wrap-up word** on Joe's track (or any track when speakers are unknown) at least 120 s into the talk. Defaults are SJC's own next-step phrases plus closers: `pre-con`, `pre-construction agreement`, `I'll send you`, `I'll email you`, `set up a time`, `come out and look`, `rough estimate`, `anything else`, `any other questions`, `talk to you soon`, `have a good`, `bye`. Code picks the **one** highest-priority row that is Open, never discussed, has no pending deterministic candidate in the last 20 s of speech, and has its reminders on. Only one fast-path reminder per call. Joe can edit the list in Settings (one phrase per line).
- **Never:** after hangup, past expiry, with Reminders Off, for a row ticked or N/A or covered **On lead** or ✕'d, while the newest segment is the client speaking (needs a completed client turn plus 1.5 s with no newer client segment; this is a best-effort check from text, never audio), with evidence older than 8 s, or with consent not granted.
- **Limits:** at most **3 per call**, ≥**120 s apart**, once per row (a **Later** row may come back once at wrap-up). Screen and Telegram share one reminder id and count as one. All of this is claimed in one DB transaction (`call_nudges` unique `(session_id,item_id,occurrence)`), so two devices or workers can't double up.
- Time alone never triggers a reminder.

### 7.2 Buttons

- **Asked it** — row becomes **Partly** (changed by hand) and the row sheet opens on the answer field with the mic ready. No more reminders for that row.
- **Later** — card hides. The row may come back once, only on a wrap-up cue.
- **✕** — card hides. No more reminders for that row on this call.
- **Reminders On/Off** (header, one switch) — Off: no cards and no phone pushes for this call; rows keep ticking. The screen-only vs screen-and-phone choice lives in Settings, not in the live header.

The card expires 20 s after it appears (it fades to "Reminder expired" for 2 s, then goes). It is removed early if the row gets answered, changed by hand, or a transcript correction makes it stale.

### 7.3 Telegram copy (optional; calls only)

`call_nudge` and `call_live` are **calls-only kinds**. The consult never sends or inherits them. A `call_nudge` push is the exact card sentence, e.g. `[SJC OS] Remember to ask if they have a budget in mind.` + link `/calls?open=<call-id>&view=checklist`. No client name, address or budget appears on the lock screen.

Changes in `lib/notify-owner.ts`: the two new kinds carry `session_id`, `nudge_id` and `expires_at`. They are exempt from the generic four/hour cap and use their own cap: **3 reminders per call and 6 live pushes per hour**. Quiet hours (07–21 Chicago) still apply, and a push blocked by quiet hours or the cap is **dropped, never parked**. A definite send failure retries once within 5 s if the push hasn't expired. An uncertain one never retries, to avoid a double buzz. The 5-min drain discards expired `call_*` rows. `push_outbox` gets a nullable `nudge_id` and `expires_at`, and its `kind` CHECK gains the two kinds.

Business-number SMS is not used for reminders (10DLC status, and owner-directed SMS still goes through the grant rules). No whisper tone or audible prompt: it can be heard on speaker and adds consent risk.

## 8. Shared coverage engine — contract

**This section is the contract the in-home consult plan must match exactly.** Version `COVERAGE_CONTRACT_VERSION = 3`.

### 8.1 Changes from round 2 (complete shared-contract delta)

| Change | Final contract / reason |
|---|---|
| Contract v2 → **v3** | Both consumers use the same validator/fixtures; no v2 fallback |
| Definition items versus runtime items | Stable `ChecklistItem.id` is a definition UUID, not a room UUID. Relational `checklist_version_items` pins templates; `checklist_session_items` admits late room instances without mutating a version |
| New `ItemIdentity` | Session/item UUID plus pinned version, definition item and instance UUID; no checksum-derived identity |
| New evidence/source identity | Device-qualified consult `source_event_id`; exact `SegmentIdentity`, `Evidence` fields and same-session revision FK; timestamp origin and correction chains fixed |
| Runner snapshot | `EngineInput.session.revision` / `capture_epoch`, matched by output `base_revision` / `capture_epoch`; ingest, item and consent changes invalidate stale apply |
| Maintenance versus commits | Unknown-speaker/consult prohibits AI commits and promotions, permits correction-only downgrade/clear; prior/manual rows locked, source invalidation flags recheck |
| Scoped access | Raw shared content grants removed; signed principal/job contexts on every read/write, derived actor, fresh assignment and lease checks |
| Consent | Ambiguous-answer pause, unknown-speaker human attestation, durable evidence clip outside normal transcript purge |
| Holds/retention | `legal_hold_at` replaced by scoped hold ledger; capture-end clocks, deletion epoch and one shared purge job (§14) |
| Control fence | Durable hangup/capture invalidations precede inference/reminder dispatch (§10.1) |

New relational tables supplement the unchanged shared table names below; all are planned for the compatible 0074 base migration (renumber at build). Consult audio integration requires **contract v3**, not merely a migration number. Manual consult forms can ship independently.

### 8.2 TypeScript contract (`lib/checklist-coverage/contract.ts`)

```ts
export const COVERAGE_CONTRACT_VERSION = 3 as const;

export type CoverageState = 'open' | 'partial' | 'covered' | 'not_applicable';
export type SessionKind   = 'discovery_call' | 'in_home_consult';
export type EngineMode    = 'call' | 'consult';            // consult = suggest-only, never auto-tick
export type Speaker       = 'joe' | 'client' | 'staff' | 'unknown';
export type TimingBasis   = 'provider_audio' | 'receiver_relative' | 'receipt_only';
export type SegmentSource = 'telnyx_live' | 'telnyx_recording' | 'media_stream' | 'consult_audio';
export type EvaluateAt    = 'live' | 'section_leave' | 'wrap_up' | 'final';
export type CoverageSource = 'manual' | 'ai' | 'ai_confirmed' | 'prior_record';

export interface ChecklistItem {
  id: string;                 // stable uuid; survives wording changes
  key: string;                // 'budget', or consult 'kitchen.asked_water_history'
  label: string;
  reminder: string;           // exact card sentence
  partial_reminders: Record<string, string>;   // component key → sentence
  questions: string[];        // ≤2
  components: { key: string; label: string; required: boolean }[];
  fact_target: string | null; // lead fact key from the allowlist, or null
  optional: boolean;
  enabled: boolean;
  reminder_enabled: boolean;
  reminder_priority: number;  // lower = first
  section_key: string | null; // consult section; null for calls
  source_ref: string | null;  // consult form field id(s) it compiles from
}

export interface ChecklistVersion {
  id: string; definition_key: string; kind: SessionKind; version: number;
  contract_version: 3; items: ChecklistItem[]; wrap_up_phrases: string[];
}

export interface ItemIdentity {
  session_id: string; item_id: string; definition_version_id: string;
  definition_item_id: string; instance_id: string;
}
export interface SegmentIdentity {
  session_id: string; source: SegmentSource; source_event_id: string; revision: number;
}
export interface Segment extends SegmentIdentity {
  id: string; seq: number; source_ref: string | null;
  supersedes_id: string | null;
  speaker: Speaker; track: 'inbound' | 'outbound' | 'mono' | null;
  timing_basis: TimingBasis; start_ms: number; end_ms: number;   // from capture_origin_at
  text: string; confidence: number | null; section_key: string | null;
  received_at: string; cleared_at: string | null;               // cleared = text removed (retention / request)
}

/** The evidence shape — identical in both plans. `quote` must be an exact substring of the segment text at that revision. */
export interface Evidence {
  session_id: string; segment_id: string; revision: number; quote: string;
  start_ms: number; end_ms: number; speaker: Speaker; timing_basis: TimingBasis;
}

export interface Suggestion {
  state: 'partial' | 'covered';
  component_states: Record<string, CoverageState>;
  value: unknown; evidence: Evidence[]; confidence: number;
  model: string; prompt_version: string; created_at: string;
}

export interface ItemCoverage {
  item_id: string; state: CoverageState;
  component_states: Record<string, CoverageState>;
  value: unknown | null; evidence: Evidence[];
  source: CoverageSource; suggestion: Suggestion | null;
  manual_lock: boolean;
  conflict: { fact_key: string; existing: unknown; proposed: unknown } | null;
  reason: string | null; revision: number; updated_at: string;
}

export interface EngineInput {
  contract_version: 3;
  version: ChecklistVersion;
  session: { id: string; kind: SessionKind; mode: EngineMode;
             consent: 'granted' | 'not_required'; started_at: string;
             capture_origin_at: string | null; revision: number; capture_epoch: number;
             prior: Record<string, { value: unknown; fact_key: string }> };
  items: ItemIdentity[];          // active runtime members, snapshot at session.revision
  coverage: ItemCoverage[];
  segments: Segment[];          // new since cursor + ≤60 s / 3,000 tokens of context
  cursor_seq: number;
  evaluate_at: EvaluateAt;
  section_key?: string | null;  // consult: the section just left
  now: string;
}

export type ItemChange =
  | { kind: 'commit';  item_id: string; state: CoverageState; component_states: Record<string, CoverageState>; value: unknown; evidence: Evidence[]; confidence: number }
  | { kind: 'suggest'; item_id: string; suggestion: Suggestion }
  | { kind: 'downgrade'; item_id: string; to: 'open' | 'partial'; reason: string }   // a correction removed the evidence
  | { kind: 'clear_suggestion'; item_id: string; reason: string };

export interface EngineOutput {
  contract_version: 3; session_id: string; base_revision: number; capture_epoch: number; new_cursor_seq: number;
  changes: ItemChange[];
  fact_candidates: { item_id: string; fact_key: string; value: unknown; evidence: Evidence[] }[];
  reminder_candidate: { item_id: string; trigger: 'topic_moved_on' | 'wrap_up'; evidence: Evidence[]; sentence: string } | null; // discovery_call only
  diagnostics: { lag_ms: number; model: string | null; prompt_version: string; usage: { input_tokens: number; output_tokens: number; cache_read: number; cache_write: number; cost_usd_equiv: number } | null; error: string | null };
}
```

**Engine rules (normative):**
1. **Consult mode, and any evidence segment with `speaker='unknown'`, may only add new answers through `suggest`.** Correction-only `downgrade` / `clear_suggestion` remain legal maintenance; neither can supply a new value, fact or reminder. A person turns a suggestion into a commit by confirming it ("Heard — confirm" → `source='ai_confirmed'`). This holds even at confidence 1.0. A discovery call whose provider returns no `transcription_track` switches to `engine_mode='consult'` for the rest of that session.
2. `commit` (call mode only) needs all required components, validated evidence from a known speaker (client facts need `speaker='client'`; Joe paraphrasing needs the client's "yes" in a later client segment), and model confidence ≥0.90. 0.65–0.89 → `suggest`. Money, contact details and dates that are ambiguous are always `suggest`.
3. Manual, `ai_confirmed` and `prior_record` rows have `manual_lock=true`. AI cannot change their state/value or replace their evidence. Corrections attach a separate recheck flag ("Heard something different") and purge strips quotes even on locked rows; a person must explicitly unlock to allow future auto-ticks.
4. A question with no answer never produces a change. Joe's hypothetical price is never the client's budget.
5. `downgrade` only happens on unlocked AI rows when a newer revision removes or contradicts their actual evidence. `clear_suggestion` only removes a suggestion whose evidence was superseded/cleared. These operations are deterministic maintenance in either mode, never a way to commit unknown-speaker facts.
6. `reminder_candidate` is only produced for `kind='discovery_call'`. The consult reads the open/partial rows for `section_key` at `section_leave` / `wrap_up` and shows its own banner, using the same words (Open / Partly / Heard — confirm).
7. Interim text never reaches the engine. `final` evaluation chunks the full transcript in 8,000-character windows with a 1,000-character overlap and one reducer, so nothing is truncated (unlike `call-notes.ts`'s 24,000-character cut).
8. The engine is pure (`lib/checklist-coverage/engine.ts`). I/O, the model call and the apply step live in `lib/checklist-coverage/runner.ts`. Neither imports Calls UI, telephony or consult UI.

### 8.3 SQL (in 0074 — renumber at build time)

```sql
CREATE TABLE IF NOT EXISTS checklist_definitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE,              -- 'discovery_call' | 'consult:<form_key>'
  kind               text NOT NULL CHECK (kind IN ('discovery_call','in_home_consult')),
  label              text NOT NULL,
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id    uuid NOT NULL REFERENCES checklist_definitions(id),
  version          integer NOT NULL CHECK (version > 0),
  contract_version integer NOT NULL DEFAULT 3 CHECK (contract_version = 3),
  items            jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  wrap_up_phrases  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(wrap_up_phrases) = 'array'),
  compiled_from    jsonb,                                -- consult: {"form_version_id": "..."}
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version)
);
ALTER TABLE checklist_definitions
  ADD CONSTRAINT checklist_definitions_current_fk FOREIGN KEY (current_version_id) REFERENCES checklist_versions(id);

CREATE TABLE IF NOT EXISTS checklist_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL CHECK (kind IN ('discovery_call','in_home_consult')),
  engine_mode            text NOT NULL CHECK (engine_mode IN ('call','consult')),
  definition_version_id  uuid NOT NULL REFERENCES checklist_versions(id),
  call_id                uuid UNIQUE REFERENCES calls(id) ON DELETE SET NULL,
  source_ref             text,                            -- consult id; NULL for calls
  lead_id                uuid REFERENCES leads(id) ON DELETE SET NULL,
  project_id             uuid REFERENCES projects(id) ON DELETE SET NULL,
  capture                text NOT NULL DEFAULT 'manual' CHECK (capture IN ('manual','live')),
  status                 text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','ringing','live','ended','reconciled','cancelled')),
  direction              text CHECK (direction IN ('inbound','outbound')),
  started_at             timestamptz NOT NULL DEFAULT now(),
  bridged_at             timestamptz,
  ended_at               timestamptz,
  consent_status         text NOT NULL DEFAULT 'not_asked'
                           CHECK (consent_status IN ('not_asked','pending','awaiting_recorded_confirmation','paused_confirmation','granted','declined','withdrawn','not_on_recording')),
  consent_notice_version text,
  consent_method         text CHECK (consent_method IN ('verbal_phone','verbal_in_person')),
  consent_by             uuid REFERENCES users(id),
  consent_at             timestamptz,
  withdrawn_at           timestamptz,
  consent_evidence_segment_id uuid,                       -- FK below
  canonical_leg          text,                            -- call_control_id transcription runs on
  track_mapping          jsonb,                           -- {"inbound":"client","outbound":"joe"}
  transcription_status   text NOT NULL DEFAULT 'off'
                           CHECK (transcription_status IN ('off','starting','on','stopping','stopped','failed','stop_unconfirmed')),
  last_event_at          timestamptz,
  last_segment_at        timestamptz,
  reminders_on           boolean NOT NULL DEFAULT true,
  revision               bigint NOT NULL DEFAULT 0,
  cursor_seq             bigint NOT NULL DEFAULT 0,
  finalization_status    text NOT NULL DEFAULT 'none' CHECK (finalization_status IN ('none','pending','done','failed')),
  finalization_error     text,
  capture_origin_at      timestamptz,
  capture_ended_at        timestamptz,
  capture_epoch          bigint NOT NULL DEFAULT 0,
  deletion_epoch         bigint NOT NULL DEFAULT 0,
  policy_version         text NOT NULL DEFAULT 'capture-2026-11-v3',
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_ref),
  UNIQUE (id, definition_version_id),
  CHECK (kind <> 'in_home_consult' OR (source_ref IS NOT NULL AND call_id IS NULL AND engine_mode = 'consult')),
  CHECK (consent_status <> 'granted' OR (consent_by IS NOT NULL AND consent_at IS NOT NULL AND consent_notice_version IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_checklist_sessions_live ON checklist_sessions(status) WHERE status IN ('ringing','live');
CREATE INDEX IF NOT EXISTS idx_checklist_sessions_lead ON checklist_sessions(lead_id);

-- Stable template registry. Reuse id across wording changes, never across different meanings.
CREATE TABLE checklist_definition_items (
  id uuid PRIMARY KEY,
  definition_id uuid NOT NULL REFERENCES checklist_definitions(id),
  key text NOT NULL,
  UNIQUE (definition_id, key)
);
CREATE TABLE checklist_version_items (
  definition_version_id uuid NOT NULL REFERENCES checklist_versions(id),
  definition_item_id uuid NOT NULL REFERENCES checklist_definition_items(id),
  spec jsonb NOT NULL,
  PRIMARY KEY (definition_version_id, definition_item_id)
);
CREATE TABLE checklist_session_items (
  session_id uuid NOT NULL,
  item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  definition_version_id uuid NOT NULL,
  definition_item_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (session_id, item_id),
  UNIQUE (session_id, definition_item_id, instance_id),
  FOREIGN KEY (session_id, definition_version_id)
    REFERENCES checklist_sessions(id, definition_version_id),
  FOREIGN KEY (definition_version_id, definition_item_id)
    REFERENCES checklist_version_items(definition_version_id, definition_item_id)
);

CREATE TABLE IF NOT EXISTS conversation_segments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigserial,                               -- engine cursor
  session_id      uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('telnyx_live','telnyx_recording','media_stream','consult_audio')),
  source_event_id text NOT NULL,                           -- exact names in §8.5; never a device-local sequence alone
  source_ref      text,                                    -- consult chunk UUID as text, or provider recording id
  revision        integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  supersedes_id   uuid,
  speaker         text NOT NULL CHECK (speaker IN ('joe','client','staff','unknown')),
  track           text CHECK (track IN ('inbound','outbound','mono')),
  timing_basis    text NOT NULL CHECK (timing_basis IN ('provider_audio','receiver_relative','receipt_only')),
  start_ms        integer NOT NULL CHECK (start_ms >= 0),
  end_ms          integer NOT NULL,
  text            text NOT NULL CHECK (octet_length(text) <= 8192),
  confidence      real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  section_key     text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  cleared_at      timestamptz,
  CHECK (end_ms >= start_ms),
  UNIQUE (session_id, id),
  UNIQUE (session_id, id, revision),
  FOREIGN KEY (session_id, supersedes_id) REFERENCES conversation_segments(session_id, id),
  UNIQUE (session_id, source, source_event_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_conversation_segments_cursor ON conversation_segments(session_id, seq);
ALTER TABLE checklist_sessions ADD CONSTRAINT checklist_sessions_consent_seg_fk
  FOREIGN KEY (id, consent_evidence_segment_id) REFERENCES conversation_segments(session_id, id);

CREATE TABLE IF NOT EXISTS checklist_item_coverage (
  session_id       uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL,
  state            text NOT NULL DEFAULT 'open' CHECK (state IN ('open','partial','covered','not_applicable')),
  component_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  value            jsonb,
  evidence         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai','ai_confirmed','prior_record')),
  suggestion       jsonb,
  manual_lock      boolean NOT NULL DEFAULT false,
  conflict         jsonb,
  reason           text,
  revision         bigint NOT NULL DEFAULT 0,
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, item_id),
  FOREIGN KEY (session_id, item_id) REFERENCES checklist_session_items(session_id, item_id),
  CHECK (state <> 'not_applicable' OR reason IS NOT NULL)
);

-- Transactionally maintained by apply/confirm; JSON evidence is checked against this projection.
CREATE TABLE checklist_evidence_refs (
  session_id uuid NOT NULL,
  item_id uuid NOT NULL,
  slot text NOT NULL CHECK (slot IN ('committed','suggested')),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  segment_id uuid NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (session_id, item_id, slot, ordinal),
  FOREIGN KEY (session_id, item_id) REFERENCES checklist_session_items(session_id, item_id),
  FOREIGN KEY (session_id, segment_id, revision) REFERENCES conversation_segments(session_id, id, revision)
);

CREATE TABLE IF NOT EXISTS checklist_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE,                       -- idempotency ledger
  actor_kind   text NOT NULL CHECK (actor_kind IN ('person','agent','worker')),
  actor_id     text,
  event_type   text NOT NULL CHECK (event_type IN ('created','linked','item_set','suggestion_confirmed','engine_applied',
                 'consent','capture','reminder','promotion','finalized','retention','legal_hold')),
  before       jsonb, after jsonb, segment_ids uuid[],
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_events_session ON checklist_events(session_id, created_at);

CREATE TABLE IF NOT EXISTS checklist_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  phase        text NOT NULL CHECK (phase IN ('live','control','finalize','promote','followup','retention')),
  input_hash   text NOT NULL,
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','done','failed')),
  attempts     integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token  uuid,
  leased_until timestamptz,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, phase, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_checklist_jobs_due ON checklist_jobs(phase, available_at) WHERE state IN ('pending','failed');

-- Published versions are immutable; segment text may only be cleared.
CREATE OR REPLACE FUNCTION checklist_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME IN ('checklist_versions','checklist_version_items','checklist_definition_items') THEN
    RAISE EXCEPTION 'checklist versions are immutable';
  ELSIF TG_TABLE_NAME = 'checklist_session_items' THEN
    IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN
      RAISE EXCEPTION 'runtime item identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'conversation_segments' THEN
    IF (to_jsonb(NEW) - 'text' - 'cleared_at') IS DISTINCT FROM
       (to_jsonb(OLD) - 'text' - 'cleared_at') THEN
      RAISE EXCEPTION 'segment identity and metadata are immutable';
    END IF;
    IF NEW.text IS DISTINCT FROM OLD.text AND NOT (NEW.text = '' AND NEW.cleared_at IS NOT NULL) THEN
      RAISE EXCEPTION 'segment text is immutable (clear only)';
    END IF;
  ELSIF TG_TABLE_NAME = 'checklist_sessions' THEN
    IF NEW.engine_mode = 'call' AND OLD.engine_mode = 'consult' THEN RAISE EXCEPTION 'cannot leave consult mode'; END IF;
    IF NEW.definition_version_id <> OLD.definition_version_id THEN RAISE EXCEPTION 'version is fixed'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checklist_versions_guard BEFORE UPDATE OR DELETE ON checklist_versions FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_version_items_guard BEFORE UPDATE OR DELETE ON checklist_version_items FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_definition_items_guard BEFORE UPDATE OR DELETE ON checklist_definition_items FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_session_items_guard BEFORE UPDATE ON checklist_session_items FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER conversation_segments_guard BEFORE UPDATE ON conversation_segments FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_sessions_guard BEFORE UPDATE ON checklist_sessions FOR EACH ROW EXECUTE FUNCTION checklist_guard();
```

### 8.4 Scoped read/write authority and revision boundary

All following functions are `SECURITY DEFINER SET search_path = public, pg_temp`; revoke EXECUTE from PUBLIC. Every signature begins with `p_context jsonb`. No function accepts caller-supplied actor identity. Verified context determines actor in events; a person website command cannot be reached with an agent/worker context.

**Principal context (exact claims):** `{subject: UUID, role: 'owner'|'staff'|'agent', delegating_subject: UUID|null, areas: string[], run_id: UUID, session_ids: UUID[], create_scope: {kind: SessionKind, call_id: UUID|null, lead_id: UUID|null, project_id: UUID|null, source_ref: string|null}|null, operations: string[], expires_at: ISO8601, nonce: UUID, signature: string}`. Server minting uses a signing key inaccessible to narrow SQL logins; SQL verification uses the corresponding verification key. No client-settable GUC is authority. Verify signature, expiry, operation, session and nonce/operation receipt; re-read active user, `comms` access for calls and current consult assignment for visits on every command, including reads, INSERT and UPDATE. Agent contexts additionally name the delegating subject and cannot exceed that subject's scope; audit actor remains agent. New-session claims bind allowed kind and lead/project/consult target rather than a nonexistent session id. One operation id is replayable only with identical principal, target and input hash; changed input is rejected.

**Worker context (exact claims):** `{worker_id: string, job_id: UUID, session_id: UUID, phase: string, lease_token: UUID, capture_epoch: integer, expires_at: ISO8601, signature: string}`. Trusted worker supervisor mints; SQL checks current lease, worker generation, phase and session; cannot mint a person context. Live ingestion uses a leased source-event/control job mapped to that session. A job cannot read another session. Owner website commands verify a website principal and fresh assignment even though the owner DB login is privileged.

| Function after `p_context` | Rule | EXECUTE |
|---|---|---|
| `checklist_read(p_session uuid, p_projection text)` | `rows`, `evidence`, `transcript`, `job_input`; strict allowlist, scoped to principal or job; health exposes counts only | owner, agent, worker |
| `checklist_start_session(p_kind text, p_call uuid, p_lead uuid, p_project uuid, p_source_ref text, p_op uuid)` | Target authorization, matching kind/version; initializes no consent; records verified actor | owner, agent, worker (ringing only) |
| `checklist_publish_version(p_definition uuid, p_items jsonb, p_wrap jsonb, p_op uuid)` | Owner principal only; atomically inserts immutable JSON snapshot + relational version members; registry definition/key and JSON/spec must agree | owner only |
| `checklist_add_session_item(p_session uuid, p_definition_item uuid, p_instance uuid, p_expected_rev bigint, p_op uuid)` | Version comes from locked session; template must be in pinned version; consult instance belongs to same consult and compatible form; call instance must equal session id; returns persisted `ItemIdentity` | owner, agent (instance permission only) |
| `checklist_record_consent(p_session uuid, p_status text, p_method text, p_notice text, p_expected_rev bigint, p_op uuid)` | Assigned authenticated person website only; grant/pause/resume/decline and attestation identity cannot come from agents | owner only |
| `checklist_consent_off(p_session uuid, p_status text, p_reason text, p_op uuid)` | Worker may only pause or stop, never grant/resume; increments capture epoch and cancels reminders | owner, worker |
| `checklist_set_consent_evidence(p_session uuid, p_segment uuid, p_revision integer, p_attestation_op uuid, p_op uuid)` | Same-session current recorded answer in 45 s window; unknown/ambiguous requires authenticated attestation receipt; known-speaker affirmative may auto-check; durably queues restricted clip extraction (calls only); known-speaker evidence permits live analysis while recording save is pending. **Consult link (worker):** the worker may only attach the verified yes segment's text to an attestation the authenticated visitor already recorded for this session (matching `p_attestation_op`, same capture epoch); it can never create, change or grant consent, and stores no clip | owner, worker |
| `checklist_manual_set_item(p_session uuid, p_item uuid, p_state text, p_value jsonb, p_reason text, p_expected_rev bigint, p_op uuid)` | Active runtime membership, valid value/components, N/A reason; no evidence input; locks human row; agent actor cannot impersonate person | owner, agent |
| `checklist_confirm_suggestion(p_session uuid, p_item uuid, p_expected_rev bigint, p_op uuid)` | Person only, verifies still-current evidence, `source=ai_confirmed`, manual lock | owner only |
| `checklist_ingest_segment(p_session uuid, p_segment jsonb, p_op uuid)` | Leased authorized capture job only; append immutable identity/revision; same-session correction chain; consent/capture/deletion epochs checked | worker |
| `checklist_apply_engine_result(p_session uuid, p_job uuid, p_lease uuid, p_base_rev bigint, p_output jsonb)` | Snapshot/epoch/lease/membership/evidence checks below; consult suggests plus correction maintenance only | worker |
| `checklist_clear_segments(p_session uuid, p_reason text, p_op uuid)` | Internal stage of approved purge job (§14), not an independent deletion clock; strips all source-linked quote copies and projects tombstones | owner, worker |

`checklist_session_items` insertion is idempotent by `(session_id, definition_item_id, instance_id)`, regardless of a retried client's proposed UUID. Instances created after form publication add **runtime membership**, not definition rows. Calls initialize one runtime item per enabled template with `instance_id=session_id`. Keep retired instances as `active=false` and never reuse an instance UUID.

**Apply transaction:** lock session, recheck scoped assignment/lease/consent and `capture_epoch`, require `EngineOutput.base_revision = EngineInput.session.revision = current session.revision`, and validate runtime membership, active flag, every Evidence field, exact substring, bounds and latest uncleared segment revision. Evidence times/speaker/timing basis must equal its segment; `Evidence.session_id` must equal the target. Model may not supply another cursor/epoch. The runner reads session, members, coverage, segment heads and cursor in one repeatable-read snapshot, releases the DB connection before inference, then applies under the locked check; any revision race discards/requeues from a new snapshot. Ingest, corrections, membership changes, person edits, consent/control and deletion each increment session revision. Advance cursor and write event/evidence projection in the same transaction. Numbers encoded as JSON integers must be safe JS integers; fail rather than round BIGINT revisions/cursors.

Consult/unknown-speaker input rejects `commit`, fact candidates and reminders. `downgrade` / `clear_suggestion` are allowed only when a source revision was actually superseded/cleared; protected human/prior rows preserve state/value and get a recheck flag. Quote redaction is mandatory even on locked rows. No positive assertion can hide inside maintenance.

**Raw grants (all shared tables, including membership, evidence refs, jobs, nudges, consent evidence and retention ledgers):** agent, worker and readonly get **no raw SELECT/INSERT/UPDATE/DELETE**, not even column-level session writes. Definitions/version templates alone allow SELECT to agent/worker; readonly gets only content-free health views. Expose job claim/heartbeat/control/nudge transitions through phase-scoped functions with the same context verifier, never unscoped DML. Worker loops do not hold open SQL transactions while calling models/providers. Owner website uses the scoped DAL; no generic file route or signed URL bypasses assignment/deletion checks. Narrow logins receive no authority over `users`, `policies`, `lane_pauses`, `authority_grants`, `app_settings`, assignments, holds or publishing. Owner-only `set_call_reminders` stays behind the person action.

Update `deploy/db-roles.manifest.json` in the shared migration, paste exact `node scripts/db-roles-sql.mjs <table>` output and explicit function EXECUTE grants/revocations (the generator prints table/sequence grants, not function authority). Tests `checklist-access-db.test.mjs`: direct raw reads/writes denied for every narrow role, cross-assignment read, actor spoof, expired/forged context, revoked helper, cross-session item/segment, INSERT bypass, stale lease/revision/epoch, unknown-speaker commit, lawful maintenance and retained human lock. Use isolated DB guards, never production.

### 8.5 Item identity, evidence identity and consult adapter — normative v3

**Item identity:** `ChecklistItem.id` is the stable **definition item** UUID, registered once per definition/key, reused across wording revisions; meaning changes allocate a new key/id. A form checksum pins content, never identity. `ItemIdentity` maps to `checklist_session_items(session_id, item_id, definition_version_id, definition_item_id, instance_id)` exactly. `item_id` is a persisted runtime UUID, unique within the session; it is the id in `ItemCoverage`, every `ItemChange`, evidence refs, nudges and consumer composite FKs. Definition membership is relational `checklist_version_items(definition_version_id, definition_item_id)`, with `spec` equal to the immutable JSON item. Publication validates template registry definition against version definition. Versions and relational member specs are immutable (INSERT only at publish, no later UPDATE/DELETE). Session membership validates pinned version through the composite FKs in §8.3. Identity columns cannot change after INSERT; instance retirement only toggles active and increments session revision.

Consult publishes templates with its form in one transaction (`compiled_from={form_version_id}`), then adds rooms/windows at runtime through `checklist_add_session_item`. `consult_coverage_items` references `(session_id,item_id)` and records actual form instance UUID/field paths/section; its form version must equal the compiled version. Dimensions/photos stay in deterministic forms, not AI checklist items. One consult session: `kind=in_home_consult`, `engine_mode=consult`, `source_ref=<consult UUID>`. Already-entered answers are `source=prior_record`, `manual_lock=true`; suggestions cannot rejudge them. `evaluate_at=section_leave|wrap_up` is supported unconditionally by v3, with section_key; no conditional schema workaround.

**Segment identity:** `SegmentIdentity = {session_id, source, source_event_id, revision}`. SQL UNIQUE is `conversation_segments(session_id, source, source_event_id, revision)`; `id` is a new UUID per revision, **never** a provider string or chunk bigint. Exact `source_event_id` encodings:

| Source | Canonical source_event_id | source_ref |
|---|---|---|
| `telnyx_live` | Telnyx `data.id` unchanged | null |
| `telnyx_recording` | `<recording_id>:<zero-based-segment-ordinal>` | recording id |
| `media_stream` | `<stream_uuid>:<zero-based-segment-ordinal>` | stream UUID |
| `consult_audio` | `<device_uuid>:<chunk_uuid>:<zero-based-segment-ordinal>` | chunk UUID |

UUIDs are lowercase canonical text, ordinals unsigned base-10 without leading zeroes (except `0`). The consult id is already in `session_id`; device-local chunk sequence is never a global identity. A chunk has a persisted UUID across upload retries and device-qualified provenance; helpers cannot collide. Do not introduce `provider_event_id` as a competing column.

Each segment supplies `speaker`, `track`, `timing_basis`, `start_ms`, `end_ms`, `section_key`, `received_at`, `cleared_at` exactly as §8.2. Capture origin is pinned on the session at first capture (not checklist creation or bridge). Consult records each chunk's monotonic offset from that origin, including pauses; helper device origin alignment is stored at capture registration. `receiver_relative` uses those offsets plus whisper within-chunk times. Telnyx without audio offsets uses receipt estimates (§9.2), `receipt_only`, visibly approximate. Unalignable helper audio is not used as timed evidence until a person aligns it; never invent wall-clock precision.

Corrections append revision n+1 with the **same source identity**, fresh UUID/seq and `supersedes_id` pointing at current revision n of that identity in the same session. Ingest serializes the identity, rejects forks and differing duplicate payloads; replay identical revision returns the existing row. Split/merge retranscription clears/retracts the old affected ordinals and inserts new heads without reusing them for different speech. Current heads exclude superseded/cleared rows. Source corrections invalidate suggestions and unlocked AI coverage; human values stay locked with recheck notice. Old revisions remain purge targets.

**Evidence identity and full shape:** `Evidence = {session_id: UUID, segment_id: UUID, revision: integer, quote: string, start_ms: integer, end_ms: integer, speaker: Speaker, timing_basis: TimingBasis}`. Composite FK `checklist_evidence_refs(session_id, segment_id, revision)` → `conversation_segments(session_id, id, revision)`; refs also FK `(session_id,item_id)` to runtime membership. Quotes are exact substrings of that revision, never paraphrases. Purged display uses `[removed]`, which is a UI sentinel, not newly valid evidence. SQL refs cover committed/suggested JSON arrays and are updated atomically. All other quote-bearing targets register source lineage for §14 purge; evidence alone never grants permission to read the source.

**Shared fixture specification:** `tests/fixtures/checklist-coverage/contract-v3/late-instances.json` publishes form V1 with definition item D, starts session S, then creates room R1 and room R2 **after publication**. It gets persisted distinct I1/I2 with `(S,V1,D,R1)` and `(S,V1,D,R2)` and passes the actual pinned-version SQL validator for both. A V2 wording edit reuses D but cannot change S's version. Two helpers use distinct device/chunk UUIDs even with local chunk sequence 1; source keys cannot collide. Segment revision 2 supersedes revision 1, clears unknown-speaker suggestions, preserves confirmed prior/manual values with recheck, rejects stale Evidence and stale runner revision, and purges quotes from both. Mismatched form/version/instance/session FKs fail. Both `checklist-coverage.test.mjs` and `consult-coverage-contract.test.mjs` use this fixture and the same exported v3 validator; access tests execute the relational checks in an isolated DB. This is a planned fixture, not a claim that a test was created or run in this planning task.

**Canonical inline fixture seed** (materialize under the v3 path above during implementation; symbols in the preceding scenario bind to these exact IDs):

```json
{
  "contract_version": 3,
  "definition_version_id": "10000000-0000-4000-8000-000000000001",
  "definition_item_id": "20000000-0000-4000-8000-000000000001",
  "session_id": "30000000-0000-4000-8000-000000000001",
  "late_items": [
    {"instance_id":"40000000-0000-4000-8000-000000000001","item_id":"50000000-0000-4000-8000-000000000001"},
    {"instance_id":"40000000-0000-4000-8000-000000000002","item_id":"50000000-0000-4000-8000-000000000002"}
  ],
  "segment": {
    "id":"60000000-0000-4000-8000-000000000001", "seq":1,
    "session_id":"30000000-0000-4000-8000-000000000001",
    "source":"consult_audio",
    "source_event_id":"70000000-0000-4000-8000-000000000001:80000000-0000-4000-8000-000000000001:0",
    "source_ref":"80000000-0000-4000-8000-000000000001",
    "revision":1,"supersedes_id":null,"speaker":"unknown","track":"mono",
    "timing_basis":"receiver_relative","start_ms":1000,"end_ms":2000,
    "text":"Keep the tub.","confidence":null,"section_key":"bath",
    "received_at":"2026-11-02T16:00:02Z","cleared_at":null
  },
  "evidence": {
    "session_id":"30000000-0000-4000-8000-000000000001",
    "segment_id":"60000000-0000-4000-8000-000000000001",
    "revision":1,"quote":"Keep the tub.","start_ms":1000,"end_ms":2000,
    "speaker":"unknown","timing_basis":"receiver_relative"
  }
}
```

Fixture order is publish V1/D → start S → create both form instances → add both runtime items → ingest segment → suggest on I1 only → person confirms → append corrected segment revision 2 → source recheck → purge. Both add-item operations must pass pinned membership, but evidence for S cannot attach to an item in another session; room R2 stays Open. Fixture item IDs represent persisted return values injected by the isolated-test UUID factory, never client authority to select another existing item's UUID.

`call_nudge`, `call_live`, wrap-up words and Telegram remain calls-only. Consult uses the same consent buttons/banner (§5/§6.3), CoverageMark `coverage` set (§6.0), and the single §14 retention policy without copying its table. Sub readiness uses only the `ready` set; consult-to-sub `consultScopeFacts` v1 remains owned by consult §10.9, with reviewed author/time/instance labels and approved shareable photo copies defined there, never raw shared evidence access.

## 9. Real-time transcription on Telnyx (exact)

### 9.1 Commands (new wrappers in `lib/telnyx.ts` `callControl`)

```jsonc
// POST /v2/calls/{client_leg_call_control_id}/actions/transcription_start
{
  "transcription_engine": "Telnyx",
  "transcription_engine_config": {
    "transcription_engine": "Telnyx",
    "language": "en",
    "transcription_model": "openai/whisper-large-v3-turbo"
  },
  "transcription_tracks": "both",
  "client_state": "<base64 {c:<call id>, r:<role>, p:'live_stt'}>",
  "command_id": "stt-start:<session_id>:<attempt>"
}
// POST /v2/calls/{same leg}/actions/transcription_stop
{ "client_state": "<same shape, p:'live_stt_stop'>", "command_id": "stt-stop:<session_id>:<attempt>" }
// POST /v2/calls/{recording leg}/actions/record_stop
{ "client_state": "<…>", "command_id": "rec-stop:<session_id>:<attempt>" }
```
- **Leg:** always the **client's leg**. For inbound calls that is the caller leg; for click-to-call it is the dialed-client leg (`counterpartyLeg` in `voice-flow.ts`). Per Telnyx, `inbound` = audio from that leg = **client**, and `outbound` = audio sent to it = **Joe** (after bridge). One rule covers both directions. Stored as `track_mapping = {"inbound":"client","outbound":"joe"}`.
- **Model:** `whisper-large-v3-turbo` rather than the `whisper-tiny` default, because addresses, dollar amounts and emails matter. The pilot compares both on the same consented calls.
- A 422 `90054` ("already in progress") is treated as success. A failed start never short-circuits the rest of an action list (bridge first, analysis on its own best-effort branch).
- Engine `Telnyx` has no interim results, so every segment is final. `confidence` may be null.

### 9.2 Raw event → normalized segment

| Raw field (`call.transcription`) | Normalized | Rule |
|---|---|---|
| `data.id` | `source_event_id` | Dedupe by the unique key; the `source_events` row already exists |
| `data.occurred_at` | `end_ms = max(0, occurred_at − capture_origin_at)`; `start_ms = max(0, min(end_ms, max(prev end on this track, end_ms − min(15000, words×350))))` | `timing_basis='receipt_only'`; times shown as "≈02:13" |
| `payload.call_control_id` | must equal `checklist_sessions.canonical_leg` | otherwise ignored + `unknown_leg` health counter |
| `payload.call_session_id`, `client_state.c` | session lookup via `calls` | mismatch → ignored + logged by id only |
| `transcription_data.transcript` | `text` (trimmed; >8 KiB → cut at 8 KiB and flagged) | empty → dropped |
| `transcription_data.is_final` | must be `true` | `false` → not stored (none expected on this engine) |
| `transcription_data.confidence` | `confidence` | null allowed |
| `transcription_data.transcription_track` | `inbound→client`, `outbound→joe` via `track_mapping` | **missing → `speaker='unknown'`; session switches to `engine_mode='consult'`** (suggest-only); health `speaker_unknown` |
| any event before initial `consent_at`, after withdrawal/end, or during a pause | not stored | epoch/consent first; awaiting confirmation permits only evidence collection, not AI |

Fixtures in `tests/fixtures/telnyx/transcription/`: track present (both values), track missing, `confidence:null`, duplicate `data.id`, out-of-order `occurred_at`, wrong leg, oversized transcript, event after `transcription_stop`. `parseVoiceEvent` gains `transcription: {text, isFinal, confidence, track}`. `isPersistenceOnly` returns true for `call.transcription`, so the immediate path does nothing.

### 9.3 Pilot gates (before live is switched on for real calls)

1. `transcription_track` arrives on ≥95% of segments across 10 consented test calls (5 inbound, 5 outbound). If it is missing with `"Telnyx"`, rerun with the literal legacy value `"B"`, which is the value the spec ties the field to. If it is still missing: live stays in consult mode (suggest-only) and reminders are wrap-up only, or Joe approves the media-fork fallback (§9.5).
2. Known phrases said by Joe and by the client land on the correct speaker 10/10 in both directions.
3. STT final arrives ≤4 s p95 after the phrase ends, measured with a stopwatch script that plays timed phrases.
4. Account tariff checked in the Telnyx portal (public reference $0.025/min, verify whether `both` bills twice). Reserve $0.05 per call-minute.

### 9.4 Recording mode

New `VOICE_RECORDING=consent` value in `lib/comms/env.ts` and the planner. Bridge as today, no `record_start` at answer. `record_start` and `transcription_start` run only from the consent action. `all` and `off` keep today's meaning. `consent` is the recommended setting once the attorney signs off; Joe picks.

### 9.5 Fallback (only if gate 1/3 fails; separate approval)

- **First try managed Deepgram** through the same command: `transcription_engine:"Deepgram"`, config `{transcription_engine:"Deepgram", transcription_model:"deepgram/nova-3", language:"en", interim_results:false, keyterms:["pre-con","HELOC","soffit","LVP", …≤100]}`. The spec documents `transcription_track` only for `B`, so the track gate must be re-run.
- **Media fork** (`streaming_start`, `stream_track:"both_tracks"`, no bidirectional mode) to a separate receiver unit `sjcos-media.service` (MemoryMax 512M, CPUQuota 100%, one call at a time, ≤2 s buffer per track, no disk). The WebSocket upgrade is verified with Ed25519 over `"{telnyx-timestamp}|{stream_url}"` (headers `telnyx-signature-ed25519`, `telnyx-timestamp`) using the same public key as the webhooks. Our replay window is 60 s (Telnyx documents none). `stream_url` carries a single-use 128-bit session token bound to the session id and expiring 30 s after `streaming_start`. Decode from `start.media_format.encoding/sample_rate`; reorder `media.chunk`; one STT stream per `media.track`. Not built unless Joe approves it after a failed pilot.

## 10. Live loop, model adapter and latency (measured)

### 10.1 Durable control priority and independent live loop

Verified current code: `app/api/voice/webhook/route.ts` persists before 200 and relies on worker replay if it dies before `after()`; `claimSourceEvents` currently filters only provider and orders receipt time. Thus webhook `after()` is **not** the hangup guarantee. Planned changes:

- `lib/worker/live-loop.ts` starts beside `supervise()` in `scripts/sjcos-worker.mjs` (same supervised process). Main pool stays max 4; live pool max 2 is reserved for short control/ingest/heartbeat transactions only. **Separate dedicated clients**: one LISTEN connection and one model advisory-lock connection (max total live connections 4, not hidden inside the two-slot pool). Neither uses a pool slot during inference. One global model slot, advisory lock `checklist_live_model`, one child process; all DB transactions end before provider/model I/O. Live heartbeat `sjcos-worker:live` every 5 s with generation fencing. Control claims precede ingest; heartbeat has a bounded ≤1 s pool wait, otherwise health fails closed and dispatch pauses.
- Add `eventTypes`/`excludeEventTypes` plus control-first ordering to claims. Live lane owns **call.hangup and call.transcription**, and `control` jobs for consent withdrawal/pause, stop retries, feature-off and disconnect invalidations. Main loop excludes both event types. Hangup's immediate state transition/bridge cleanup is replayed here, not delegated behind notes; slow post-call effects are separately enqueued idempotently to main-loop jobs. Source-event completion waits for those durable job inserts, not their execution. Any future provider event that invalidates capture joins this lane before rollout.
- **Authoritative fence before 200:** in the same intake transaction as a verified `call.hangup`, map either call leg to its call row and persist a content-free cancellation keyed by call UUID (even if no checklist session exists). Lock the call fence/session, advance capture epoch, mark ended and expire reminders/push rows. Session creation checks this call fence so a late session cannot become live. DB failure returns 503. Duplicate receipt still checks cancellation; do not rely on duplicate `after()`. Stop/pause/off actions persist the equivalent fence and control job before acknowledging. `pg_notify('checklist_live','')` after commit wakes the independent lane; 1 s polling is the fallback.
- Dispatch and engine apply lock/recheck that same call/session fence, epoch, consent, current status, expiry and reminder switch immediately before claiming a send. A durable hangup in `source_events` is also checked so a legacy/replayed receipt missing its fence is repaired before dispatch. Control commands are idempotent. No reminder created/dispatched after the durable cancellation commits; an already in-flight external push cannot be recalled and is logged as such. A stale inference result is discarded, never replayed into a fresh epoch.
- Each tick: control/fence repair → expiry/heartbeat → segment ingest/consent check → deterministic wrap-up → launch async inference if slot free → apply finished results under revision fence → dispatch valid reminders. Two live sessions max; >200 queued segments/session means manual fallback. Transcript backlog cannot starve control. Slow main-loop downloads/model subprocesses are asynchronous; no CPU-bound work allowed in this loop.
- For checklist jobs the main loop runs finalize/promote/followup/retention only; it retains ordinary non-live provider processing. Shutdown stops claims, kills model child, releases leases/clients within 5 s. Crash-after-fence/before-control replay resumes without duplicate commands. Reconnect drops old reminders.
- `tests/call-live-worker.test.mjs`: main processor blocked 60 s, transcript backlog, hangup persisted then app killed **before after()**, restart and delayed/replayed hangup, failed notification plus poll, and inference holding advisory lock. Require control/ingest ≤1 s, heartbeat/stop retries progress, zero new screen/Telegram reminders after durable hangup, stale result rejection, no duplicate apply/send and no pool starvation. Fake provider records dispatch timestamps relative to cancellation; distinguish an already-dispatched push from a later forbidden dispatch.

### 10.2 Model adapter and measured latency

`claudeJson(prompt, {model, effort, deadlineMs, maxOutputTokens})` goes in `lib/ai/claude-json.ts`. It has the same CLI flags as `chatReplyClaude` (`--output-format json --strict-mcp-config --disallowedTools …`) but returns `{text, usage, total_cost_usd, model_usage, duration_ms, duration_api_ms, wall_ms}` and kills the child with SIGKILL at the deadline. The model is pinned to `--model claude-sonnet-5-5` with `--effort low`. The output is strict JSON validated against the §8.2 schema. Any parse failure means "no change", never a guess.

**Measured on this box, 2026-11-02** (same flags, sequential, warm CLI cache after the first run):

| Prompt | Runs | Wall time incl. CLI start | `duration_api_ms` | RSS per process | Cost (CLI `total_cost_usd`) |
|---|---|---|---|---|---|
| Small (~300 tokens, 66 out) | 5 | 2.12 – 3.19 s (median 2.42) | 1.9 – 2.8 s | ~250 MB | $0.003 warm; $0.052 first run (writes the CLI's ~13k-token system prompt to cache) |
| Realistic (8 KB ≈ 2.5k tokens of segments, 307 out) | 3 | 3.17 – 4.24 s | 2.5 – 3.6 s | ~250 MB | $0.006 warm; $0.06 first run |

CLI startup adds about 0.5–0.7 s (wall time minus `duration_ms`). The round-1 3 s deadline would have timed out most real calls, so: **deadline 6 s, budget p95 ≤5 s**, to be re-measured with 30 runs during the pilot. Claude runs through Joe's logged-in CLI (`dev-agents.ts:40`), so `total_cost_usd` is an API-equivalent figure that counts against his plan's usage, not a separate bill. It is still metered.

**Cost cap (equivalent dollars):** at most 36 model runs per call, ≤3,000 input tokens and ≤350 output tokens each. A typical call: ≈12 runs × $0.006 + $0.06 ≈ **$0.13**. Cap **$1 per call, $30 per month**. At the cap: deterministic matching and manual ticking only, with semantic reconciliation done after the call. The cap is checked and reserved in the same transaction that starts the run, so two runs can't race past it. A persistent `claude --input-format stream-json` process could save ~0.6 s per run, but it would keep 250 MB resident. Not worth it unless the pilot p95 misses the budget.

### 10.3 End-to-end budget (from the end of the client's phrase)

| Step | p95 budget | Basis |
|---|---|---|
| Telnyx STT final | ≤4 s | pilot gate 3 (not yet measured) |
| Webhook → `source_events` commit + NOTIFY | ≤0.3 s | existing route |
| Live-loop wake | ≤0.25 s (1 s fallback) | LISTEN/NOTIFY |
| Segment insert + matcher | ≤0.05 s | pure code |
| Model confirm (when needed) | ≤5 s (6 s kill) | **measured** 3.2–4.2 s |
| Apply + commit | ≤0.2 s | |
| Browser poll | ≤1 s | 1 s poll while live |

- **Wrap-up reminder on screen (fast path, no model):** ≤ **6 s** p95. Telegram adds 1–3 s, so ≤ **9 s** to the phone.
- **Topic-moved-on reminder (one immediate model run):** ≤ **11 s** p95.
- **Ordinary tick** (model batched at most every 10 s, only with new final speech): ≤ **21 s** p95, target median ≤10 s. The app never claims every tick is under 8 s.
- **Acceptance (domain):** on held-out calls that have a wrap-up, the **median reminder appears ≥10 s before the client's last turn**.

The browser polls `GET /api/calls/coverage?session=<id>&rev=<n>` every 1 s while a call is live (`Cache-Control: private, no-store`, 304 when the revision hasn't changed), every 2 s while ringing, and stops after reconciliation. Polling pauses in hidden tabs and backs off 2/5/15 s on errors. No new server for UI updates.

## 11. After the call

One post-call pipeline. `saveTranscript → generateCallNotes` stays (Hermes draft, Claude review). Coverage finalization runs beside it as separate `checklist_jobs` phases, each idempotent and resumable even after `notes_status='done'`:

1. **finalize** — hangup freezes reminders. The final recording transcript (if recorded) is written as `source='telnyx_recording'` segments with `speaker='unknown'` (a single mixed transcript), and the engine runs `evaluate_at='final'`. Those segments can only add suggestions; live, speaker-labelled evidence stays the stronger evidence. Divergences are flagged and manual rows are kept as they are.
2. **promote** — only committed, grounded values (Covered, with value; never Partly, N/A, a suggestion or question-only text) go through `recordFact(run,{leadId,key,value,sourceRef})`. A person's typed answer also counts, with the actor recorded. `sourceRef = checklist:<session-id>:item:<item-id>:rev:<n>`. Same-lead/key writes are serialized with `pg_advisory_xact_lock(hashtext(lead_id||key))`. On conflict, both values are kept in `checklist_events` and the row shows **! Conflict**; Joe picks one. Contact changes to the lead itself only happen on **Use these contact details**. The worker needs INSERT/UPDATE on `lead_facts` (today it has SELECT, manifest l. 1312); this is added in the Phase 4 migration with the manifest.
3. **notes** — the `call_summary` knowledge item gets a "Discovery checklist" section and metadata `{session_id, definition_version, coverage_revision}`. It is upserted by a stable key `call-summary:<call-id>` (new nullable `knowledge_items.source_key text` with a partial unique index, Phase 4 migration), not by content hash, so a reconcile updates the same note. A hand-ticked session gets one session-keyed summary marked as Joe's notes.
4. **followup** — one to-do keyed `call-coverage:<session-id>` (not one per row). If **Next step** has a date, `due_at` is that day (snoozed until 00:00 Central). Existing `ensureCallFollowUps` still handles commitments.
5. **draft** — only when there is a confirmed email and something worth asking. Up to three items, related fields combined, refusals and N/A never included:

   > **Subject:** A few details for your project
   >
   > Hi Alex,
   >
   > Thanks for talking with me about the bathroom. Before I work out the next steps, could you send me the project address and city, let me know whether you have a budget range in mind, and tell me when you're hoping to start? It's fine if you're still figuring out the budget or timing.
   >
   > Thanks,
   > Joe
   > SJ Carpentry LLC
   > 612-361-6585

   Staged through `stageDraftForApproval(run, {work_item_id, channel:'email', kind:'draft', draft})`, extracted from the inline MCP handler into `lib/approvals/stage-draft.ts` and called by both the MCP tool and the worker. The draft starts `To: <confirmed lead email>` / `Subject: …` / blank line / body (otherwise Approve silently skips sending). It is staged once per content revision. A newer reply or text that answers a question invalidates the unsent draft. **Joe's Approve click sends it; nothing calls `send_email` afterwards.** No email on file → an internal note "Confirm their email first", not a sendable draft.
6. **notify** — one owner push when the summary is ready: `/calls?open=<call-id>&view=checklist` (or `?checklist=<session-id>`). No push per tick or per fact.

Crash tests: kill between each step and restart. Each step must run exactly once (unique `(session_id, phase, input_hash)`, stable keys on the to-do, note and draft). Staging failure leaves the job `failed` with a retry and one `call-coverage` repair item.

**Texts in this scope:** business-number texts already land in `/messages`. A fact-candidate adapter reads verified inbound business SMS (`sms:<message-id>` provenance) and can answer an open row's **fact** (and invalidate an unsent draft question). It never rewrites the call's coverage as if it had been said on the call. Personal-phone texts and iMessage are only visible if Joe pastes or uploads them to the lead (source `manual_import`, confirmed before promotion). There is no general personal-phone feed, and the plan doesn't claim one.

## 12. Call-specific tables, facts and migrations

```sql
-- 0074 (Phase 1 ships all §8.3 tables + seed; renumber at build time)
-- Later discovery phases add these in their own migration, numbered at build time (after 0075+):
CREATE TABLE IF NOT EXISTS call_nudges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL,
  occurrence    smallint NOT NULL DEFAULT 1 CHECK (occurrence IN (1,2)),   -- 2 = the one "Later" return
  trigger       text NOT NULL CHECK (trigger IN ('topic_moved_on','wrap_up')),
  sentence      text NOT NULL,
  evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  cursor_seq    bigint NOT NULL,
  state         text NOT NULL DEFAULT 'visible'
                  CHECK (state IN ('visible','asked','later','closed','expired','superseded','suppressed')),
  phone_state   text NOT NULL DEFAULT 'none' CHECK (phone_state IN ('none','queued','sent','dropped','uncertain','failed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  UNIQUE (session_id, item_id, occurrence),
  FOREIGN KEY (session_id, item_id) REFERENCES checklist_session_items(session_id, item_id)
);
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS nudge_id uuid REFERENCES call_nudges(id) ON DELETE SET NULL;
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS expires_at timestamptz;
-- extend push_outbox.kind CHECK with 'call_live','call_nudge' (drop + re-add the named constraint)
```

The per-call cap (3), the 120 s gap and the 6/hour phone cap are enforced in one transaction: `SELECT … FOR UPDATE` on the session row, then count `call_nudges`. Lead facts: seven new keys (§3.3); no schema change. Worker grants for `lead_facts`, `push_outbox` (new columns), `knowledge_items`, `work_items` and approval staging come from the manifest scan (`node scripts/db-roles-scan.mjs --diff`), with exact columns, never a blanket owner login. Every new table or new worker write → manifest + pasted `db-roles-sql` output in the same migration.

**Migration split (all renumbered at build time):**

| Phase | Migration | Contents |
|---|---|---|
| 1 | **0074** | §8.3 shared engine tables, immutable-membership/identity guards, scoped §8.4 functions + grants, consent-evidence and retention ledgers (§14), seed `discovery_call` v1 (13 rows, all on; the 4 extra rows can be switched off) |
| 2 | next free | `VOICE_RECORDING=consent`; durable call cancellation fence and capture-control functions; source-event claim filters; no raw worker column grants |
| 3 | next free | `call_nudges`; `push_outbox` columns + kind CHECK; cost-ledger columns on `checklist_jobs` (`cost_usd_equiv numeric(8,4)`) |
| 4 | next free | worker writes on `lead_facts`, `knowledge_items` stable key, `work_items`; shared retention adapters extended to new derived copies |

No production data migration. Database tests run only against an isolated test database using the pattern in `tests/esign-lifecycle.test.mjs`, never the live database.

## 13. MCP tools and health

| Tool | Input | Output / authority |
|---|---|---|
| `get_call_coverage` | `{call_id?: uuid, session_id?: uuid}` (exactly one) | Version, rows (state, value, evidence quotes), consent status, freshness, draft status. Read-only |
| `list_checklist_definitions` | `{kind?: 'discovery_call'\|'in_home_consult'}` | Current published versions. Read-only |
| `start_call_checklist` | `{call_id?: uuid, lead_id?: uuid, operation_id: uuid}` | Creates a hand-ticked session; no dialing, no consent |
| `update_call_checklist_item` | `{session_id, item_id, state, value?, reason?, expected_revision, operation_id}` | Via `checklist_manual_set_item`; actor recorded as agent; no evidence quotes accepted |
| `finalize_call_checklist` | `{session_id, expected_revision, operation_id}` | Queues the finalize job; refuses while the call is live; never hangs up |
| `prepare_call_followup` | `{session_id, expected_revision, operation_id}` | Stages the draft via `stageDraftForApproval`; returns ids; never sends |

`list_calls` / `get_call` gain a coverage summary and session link (no transcript by default). `place_call {to, owner_grant_id, …}` stays the only agent dial path. Agents cannot grant consent, confirm a "Heard — confirm" suggestion, switch reminders on or off, publish definitions or ingest segments. Round 1's `set_call_nudges` is **removed**: the reminders switch is Joe's, from the live header.

**Health** (`GET /api/comms/health`, bearer): live STT configured/engine/model; last live webhook; live-loop heartbeat age; oldest unclaimed `call.transcription`; live lag p95 (last hour); failed starts; `speaker_unknown` and `unknown_leg` counts; consent checks failed; reminders shown/expired/dropped; finalization age; cost-cap state. A disabled feature is not a failure. Enabled and broken → named degraded component; call routing still works. No transcript text in health output or logs. Failures go through `reportCommsFailure('live-transcription' | 'call-coverage' | 'call-nudge', …)`: one open repair item per area, with the existing once-a-day push.

Feature flags (`lib/comms/env.ts`): `VOICE_LIVE_TRANSCRIPTION=off|telnyx`, `VOICE_LIVE_STT_MODEL`, `CHECKLIST_AI=off|shadow|on`, `CHECKLIST_REMINDERS=off|screen|screen_phone`, `CHECKLIST_FACT_PROMOTION=off|on`. Off = inert. Configured but broken = loud.

## 14. Shared retention and privacy — single source for calls and consults

This is the **only retention table** for discovery calls and in-home consult audio/transcripts. Consult §8.3 points here and carries no copy. Proposed policy `capture-2026-11-v3` requires Joe/attorney approval before audio launch; pin the approved policy version on each session. Do not imply that two years from capture guarantees protection against a later-discovered claim: [Minn. Stat. §626A.13 subd. 5](https://www.revisor.mn.gov/statutes/cite/626A.13) runs from first discovery or reasonable opportunity to discover; counsel confirms duration and uses legal hold for a dispute.

| Data | Kept until | Client asks to delete |
|---|---|---|
| Consent evidence: recorded yes (calls: ≤20 s audio clip + its segment text; **consults: the yes segment's verified transcript text only, no audio** — Joe 2026-11-02), notice version, who/when and attestation | **2 years after capture**, or longer under legal hold; dedicated restricted record, not whole recording | Kept as evidence of lawful recording, restricted to owner/legal review; counsel confirms |
| Consult audio (every chunk, incl. the consent answer) | **Not kept — Joe 2026-11-02.** Each chunk is deleted from the server as soon as its transcript segments are verified and committed (and, for the consent chunk, the visitor's pick is recorded); a chunk that never transcribes is deleted at **7 days** after a visible "Couldn't transcribe — notes for this part are missing" flag. The device deletes its local copy on server acknowledgement. | Same — nothing to keep |
| Call audio under this feature | **90 days after capture end** | Permanent active-store purge now; no recoverable trash |
| Transcript text, segments/revisions, evidence quotes, raw transcript payloads, rejected AI text | **180 days after capture end**; raw `source_events` payloads emptied **30 days after reconcile** (or at 180-day expiry, whichever earlier) | Purge now; quote displays show **[removed]** |
| Confirmed checklist answers, measurements, manual notes, photos, lead facts, reviewed summaries | With lead/project record under its record policy | Kept as human-confirmed business records; remove transcript quotes and unconfirmed generated content, subject to owner/legal deletion review |
| Telnyx stored recording | Deleted via API after our verified copy and consent clip are saved | Delete with active copies; retry/receipt tracked |
| Backups (B2, including historical object versions) | Deleted objects age out **within 90 days maximum** of active deletion; rollout fails if bucket settings are unknown or exceed this | Same; restricted backup access until aging completes |
| Device cache (consult only) | **30 days after server acknowledgement**, or earlier owner deletion | Delete on reconnect before display; unsynced work never silently ages away |

**Clock:** capture end is the final recording stop, falling back to last chunk end for an abandoned visit or authoritative call end for an interrupted call. A daily abandoned-capture closer pins this value; a stuck open session cannot retain content indefinitely. Pausing/resuming the same visit preserves capture origin and epochs; a new visit creates a new session. Never wait for a construction contract or lost status; never-contracted, cancelled, unlinked and lost sessions use these same 90/180-day clocks. A consent clip uses its own capture timestamp. Consent paused/declined material without lawful assent is quarantined from analysis and purged promptly on the stop request; only counsel-approved minimal audit metadata remains.

**Consent record:** planned `checklist_consent_evidence(id uuid PK, session_id uuid FK, segment_id uuid, segment_revision integer, clip_file_id text FK files, segment_text text, notice_version text, consent_by uuid, consent_at timestamptz, attestation_operation_id uuid, captured_at timestamptz, expires_at timestamptz)` holds the ≤20 s yes independently of the full recording. Same-session segment/revision FK uses §8.3; the normal segment row may become a content-free tombstone at 180 days while the dedicated minimal text/clip stays. Keep a record per consenting participant/resumption, not just the latest session pointer. Clip creation is a durable idempotent checkpoint with byte hash and restricted file classification **before** generic file access. Live call recording bytes may arrive only after hangup: recorded-answer text plus the durable extraction job permits live analysis, with clip state **Pending recording save** until verified. Extraction failure is a visible consent-evidence repair, stops any ongoing capture/analysis and blocks finalized evidence status; retry or use hand mode for future capture. Provider deletion and normal audio expiry cannot pass an unfinished consent-clip checkpoint without owner/legal review; overdue checkpoints raise repair immediately, never silently extend general audio retention. Before 90-day expiry counsel/owner resolves any unrecoverable exception explicitly. Unknown-speaker attestation selects the response/clip; batch consult links the segment later without fabricating one. **Consult sessions keep no clip** (Joe 2026-11-02): `clip_file_id` is NULL (CHECK `clip_file_id IS NOT NULL OR session kind = 'in_home_consult'`), and the evidence is the attested yes segment's verified `segment_text` plus attestation; the consult audio chunk holding it is deleted with the rest once transcribed. Telnyx receipt-relative offsets are not accurate clip cut points: after saved audio arrives, locally align the attested response to the audio and verify the ≤20 s extract (or ask Joe to select it in playback). Never keep an arbitrary 20-second window as proof. Persist text/clip hash, exact audio offsets and verification receipt; all temporary full-audio alignment copies remain 90-day purge targets. The two-year exception never preserves adjacent project discussion or general transcript copies.

**One hold model:** replace session `legal_hold_at` and any separate consult hold authority with `checklist_legal_holds(id uuid PK, scope_kind text CHECK session/lead/project, scope_id uuid, reason text, by_user uuid, at timestamptz, expires_or_review_on timestamptz, released_at timestamptz)`. Only owner website may create/release. `checklist_effective_hold(session_id, target_kind)` checks active session **or ancestor lead/project** holds, locked in the same order as purge (session, holds, target ledger). Review dates never auto-release a hold. A hold blocks physical deletion and backup aging for held targets; a restricted encrypted preservation copy is made before ordinary backups age out. It does **not** reinstate ordinary access after a deletion request. UI: **Held for legal records**. Owner sees due reviews and backlog.

**One purge authority/job:** `checklist_request_purge(owner_context, session_id, target: 'audio'|'text'|'both', reason, operation_id)` creates a durable request, immediately increments `deletion_epoch`, denies affected reads/downloads, cancels transcription/inference/draft jobs, and enqueues `checklist_jobs.phase=retention`. Explicit client request defaults to both; scheduled 90-day audio expiry leaves text to 180. `checklist_retention_step(job_context, request_id)` uses policy deadlines and the effective hold, writes per-target attempts/completion/tombstones to `checklist_purge_targets(request_id,target_kind,target_id,state,attempts,last_error,completed_at)` with UNIQUE `(request_id,target_kind,target_id)`. One daily `lib/checklist-coverage/retention.ts` main-worker scheduler sweeps due sessions and retries unfinished targets; consult retention code is only an adapter registering targets, **never a second sweeper with its own clock**. Three failures create one durable repair work item in the same transaction as its dedupe receipt. Job completion requires every active target receipt; backup aging deadline remains visible separately. No purge log contains deleted text.

**Mandatory purge graph (including every revision and derivative):**

- File bytes/rows and audio chunks, original recording, derived clips other than protected yes, transcodes, temporary WAVs, upload staging, thumbnails/waveforms, provider recordings and cached provider URLs. Verify owner/legal-only access to protected clips. Telnyx failure retains a retry target, never a false “deleted” receipt.
- `calls.transcript`, transcript-bearing `calls.notes`, `call_events` payloads, `source_events.payload`, transcript revisions and text in `conversation_segments`, shared coverage/suggestion Evidence, `checklist_events.before/after` and nested JSON, nudge evidence, job input/output/error payloads, rejected AI output and consult answer/event quote copies. IDs, hashes and content-free audit tombstones can remain. `checklist_clear_segments` is one stage of this graph, not the whole purge.
- Generated follow-up drafts and approval snapshots, call summaries, work-item bodies, Open Brain `knowledge_items` and source-linked quotations, search/vector indexes, embeddings, caches and stale snapshots. Every producer registers `{session_id, source segment ids/revisions, target_kind, target_id, contains_quote, human_confirmed}` lineage in the same transaction as its content write. Unconfirmed AI paraphrases expire with transcript; retained reviewed summaries must contain only independently confirmed facts, with all source quotes removed. A stable source key alone is insufficient. Preserve human values separately from evidence text so the exception cannot silently preserve a copied transcript.
- Processor copies/caches: configure no persistent CLI prompt/output files and no transcript body logs; use provider deletion/retention controls and record limitations on `/privacy`. Provider-side retention must be verified with counsel before launch; if a claimed purge guarantee cannot be met, block that processor/capture rollout rather than claim immediate remote deletion.
- Browser/server caches, IDB snapshots and active download links: auth-scoped `no-store` reads, deletion epoch on every file fetch, no long-lived bearer signed URLs for audio/transcript. Revoke proxy tokens at request commit; if direct signed URLs are ever introduced, revocation support is a rollout prerequisite. Devices process tombstones before cached display/upload; old-epoch uploads are quarantined/refused, cannot resurrect purged content. Offline devices cannot be remotely erased; bound offline unlock/expiry under the consult contract and disclose that limit. Pending human edits remain recoverable separately from deleted audio/quotes.
- Backup replicas/B2 versions: encrypted, restricted, lifecycle verified ≤90 days. Maintain content-free purge/hold ledger beyond backup lifetime. Restore into quarantine, replay all purge tombstones and holds **before any read/index/job/network access**; test resurrection prevention. Legal-preservation copies are separately inventoried/restricted, not exempt general-purpose backups.

Privacy disclosure is truthful: Telnyx processes call audio; consult whisper runs on SJC's server; Anthropic processes transcript text; encrypted offsite B2 backups include the covered material. Existing pre-feature recordings stay outside this rollout until Joe/counsel explicitly extend the policy. New website capture requires approved notice and retention settings. None of this plan executes a deletion.

`tests/call-checklist-retention.test.mjs` and `consult-retention-db.test.mjs` assert identical 2-year/90/180/30/≤90 values (consult audio: deleted per chunk on verified transcription, 7-day cap for a failed chunk, no consent clip), capture-end clocks for never-contracted/cancelled/abandoned sessions, multiple assent clips, every graph target, human-fact/quote separation, legal hold racing purge, request-time read/URL denial, source-history redaction, retry after partial purge, stale upload/cache refusal and quarantined restore. Both use isolated DB guards; one shared fixture drives clock/purge assertions.

## 15. Phased build and acceptance tests

Run single test files only (never the whole suite on this box). Coordinator-only visual checks; no `next dev`.

**Phase 1 — hand-ticked checklist (ships first, zero dependencies).** Migration 0074, seed, Calls checklist pane, **Start checklist**, the live-call bar (ringing/bridged from today's call rows), **Start a discovery call** + confirm sheet, row sheet with mic, prefilled **On lead** rows, unknown-caller choices, summary + hand-typed draft through approval, Settings (§3.4), offline queue (§4.3), `CoverageMark`.
Accept: works with voice off; 13 rows render with the §3 labels and word marks at every width; one tap starts a checklist and one tap ticks a row; two-device conflict shown; offline queue survives a reload once back online; storage denied shows its banner; user switch can't see another user's queue; staff can't edit Settings.
Tests: `node --test tests/call-checklist.test.mjs`, `tests/checklist-offline.test.mjs`, `tests/checklist-access-db.test.mjs`.
Coordinator checks: 360 px phone, tablet portrait/landscape, desktop, keyboard, screen reader, 200% zoom, daylight contrast.

**Phase 2 — consent + live transcript, no AI.** Fully enforced §14 purge/hold/clip policy and tests are a launch prerequisite. `VOICE_RECORDING=consent`, consent card and recorded-confirmation check, Stop / New person, `transcription_*` and `record_stop` wrappers, parser + fixtures, live loop, claim filter, freshness states, the Telegram `call_live` link.
Accept: nothing captured before **They said yes**; an unambiguous no or silence at 45 s stops capture; an ambiguous answer pauses for Joe; unknown speakers require **They said yes on the recording**; a stop not confirmed shows the flag; a slow main-loop job doesn't delay live work; restart doesn't double-process; bridge never depends on STT.
Tests: existing `tests/voice-flow.test.mjs`, `tests/comms-env.test.mjs`; new `tests/call-live-transcription.test.mjs`, `tests/call-live-worker.test.mjs`, `tests/call-consent.test.mjs`. Then pilot gates §9.3.

**Phase 3 — engine in shadow, then on-screen reminders.** Engine, runner, `claudeJson`, evidence validation, wrap-up fast path, reminders card, `call_nudges`.
Accept on 40 redacted/acted calls labelled by Joe + a second reviewer (20 dev / 20 held-out) + 10 consult conversations: ≥98% precision on auto-ticks; ≥90% recall on complete explicit answers; zero unsupported money or contact promotions; zero reminders after hangup, expiry, Off or ✕; ≤1 false reminder per 20 held-out calls; median wrap-up reminder ≥10 s before the client's last turn; fast path ≤6 s p95; model ≤5 s p95 over 30 timed runs. Then 10 consented shadow calls before Joe turns reminders on.
Tests: `tests/checklist-coverage.test.mjs` (incl. the shared contract-v3 fixtures), `tests/checklist-nudges.test.mjs`, `tests/claude-json.test.mjs` (deadline kill, cost-cap race).

**Phase 4 — phone reminders and post-call completion.** `call_nudge` push, fact promotion, note upsert, follow-up to-do, `stageDraftForApproval`, business-SMS fact adapter (last). Retention enforcement ships with Phase 2 capture, not delayed until this phase.
Accept: no push after hangup or expiry or in quiet hours (dropped, not delayed); no lock-screen client details; crash between any two steps resumes without twins; corrected transcript invalidates a stale draft; future `due_at` stays snoozed; retention clears every copy.
Tests: `tests/call-checklist-completion.test.mjs`, `tests/call-nudge-push.test.mjs`, `tests/call-coverage-facts.test.mjs`, `tests/call-checklist-retention.test.mjs`, plus `tests/db-roles-manifest-db.test.mjs` and `tests/db-roles-paths-db.test.mjs` in the isolated DB.

**Phase 5 — only if needed.** Managed Deepgram or the media fork (§9.5); a Telnyx mobile-voice pilot.

**Rollout / rollback.** Each flag turns its layer off on its own. Turning off live STT sends `transcription_stop` / `record_stop` on active sessions and expires reminders. It never hangs up a call, deletes a transcript or hides history. Schema is additive, so rollback drops no evidence. No deploy, service restart or Telnyx change is authorized by this document.

## 16. Risks, questions for Joe, out of scope

**Risks:** misheard emails and numbers (read-back, always suggest-only); the track label missing (consult-mode fallback, then managed Deepgram); a reminder arriving after goodbye (SJC wrap-up words, fast path without a model); the CLI being slow or rate-limited (6 s kill, deterministic fallback, metered); the phone page sleeping on iOS (second screen, Telegram link); consent disputes (recorded yes stored as evidence); host memory (one 250 MB model process at a time, bounded queues, no local streaming STT).

**Questions for Joe** (defaults let Phase 1 start now):
1. Will you use **Start a discovery call** for outbound lead calls and give new clients the business number, keeping the by-hand checklist for your cell?
2. Will you usually have a laptop or tablet beside you on calls, and do you want the Telegram link and phone reminders after the screen-only trial?
3. Will your attorney approve the consent script, the recorded "you're fine with that, right?" and the retention table in §14?
4. Are three reminders per call, at most, the right limit?
5. ~~Turn any of the four optional rows on?~~ **Decided 2026-11-02:** all four start on; Joe switches them off in Settings as he goes.

**Out of scope:** scoring Joe or coaching; autonomous client outreach; AI answering or speaking on calls; whisper tones; prices or schedule promises; lead stage changes; recording personal calls; iMessage capture; measurement checks (consult plan); sub agreements; estimates, contracts or change orders; a native app; custom checklist rows (later, if asked).

## 17. Corrections to the brief and limits of this plan

- The webhook persists before replying 200, and deferred work runs in the worker. `docs/comms.md`'s "200 immediately, work in after" is out of date.
- The recording-announcement switch is a notice played while recording already runs. It is not consent and has no outbound branch.
- The C to-do's "discovery call scoring" conflicts with Joe's decision in B; coverage only.
- TestFlight and 10DLC status are dated claims from the brief; this plan depends on neither.
- Telnyx latency and track behaviour on Joe's account are unproven until the §9.3 pilot. The model latency figures are inherited round-2 measurements on this box, not re-run this round or proven at peak account load.

## Revision log (round 1 → 2)

| Judge | Item | What changed | Section |
|---|---|---|---|
| Design | 1a | App-wide live-call bar in `Shell` under `Topbar`, fed by layout refresh via `LiveUpdates`, 48 px, ✕ per call | §4.1, §6.1 |
| Design | 1b | **Start a discovery call** on lead header + `…` + lead row menu, with wireframe and confirm sheet | §4.1, §6.2 |
| Design | 1c | Telegram `call_live` link → `/calls?open=<id>&view=checklist` | §4.1, §7.3 |
| Design | 2 | One-tap **Start checklist**; lead/call linked later from the session header | §4.2 |
| Design | 3a–d | Word next to every mark (`CoverageMark`); one label set of 13; card = exact reminder sentence; 22 px serif `--ai-2` on `--ai-soft`, 17 px rows | §1.1, §3, §6 |
| Design | 4 | Reminder buttons cut to **Asked it** / **Later** / ✕ + one **Reminders On/Off**; screen vs phone moved to Settings | §7.2, §3.4 |
| Design | 5 | Consent card wireframed as the primary action; Notes on · Stop chip; stop-not-confirmed banner | §5.1, §6.3 |
| Design | 6 | Row sheet: 56 px segmented states, mic, collapsed why/questions/evidence, pinned Undo/Save; tapping the state word cycles Open→Covered | §4.2, §6.5 |
| Design | 7 | **On lead** + **Still right ✓** row; unknown-caller choices wireframed | §3.3, §6.6 |
| Design | 8 | After-call summary + draft wireframe, counts line, Ask in email toggles, no-email state | §6.8 |
| Design | 9 | Phase 1 Settings cut to labels, sentences, questions, on/off, order; custom rows/components/fact targets cut | §3.4 |
| Design | 10 | Breakpoints restated as `@3xl/page` / `@6xl/page`; checklist replaces detail body, header kept; new PageHeader meta | §6 |
| Design | X-1 | `evaluate_at` input in the engine | §8.2 |
| Design | X-2 | Consult mode: unknown speaker → suggest-only, "Heard — confirm" | §8.2 rule 1 |
| Design | X-3 | Consult writes the shared session/segment tables; exact adapter | §8.5 |
| Design | X-4 | Tap-target rule 48 px office/portal, 56 px field | §1.1 |
| Design | X-5 | Shared `components/ui/CoverageMark.tsx` | §6 |
| Design | X-6 | Shared consent pattern: "AI tool we use", "You can tell me to stop at any time", They said yes/no, same fields | §5 |
| Design | X-7 | `call_nudge` / `call_live` are calls-only | §7.3, §8.5 |
| Design | X-9 | Words table; one button/noun set (Start checklist / Start a discovery call / Finish checklist; "End checklist" removed) | §1.1 |
| Engineering | Wrong: worker priority | Separate live loop in the worker process with its own pool, heartbeat, LISTEN/NOTIFY, claim filter | §10.1 |
| Engineering | Wrong: gateway is a subprocess | Stated plainly; `claudeJson` adapter; latency **measured** (3.2–4.2 s at real size); deadline 6 s | §2, §10.2 |
| Engineering | Wrong: normalization unpinned | Exact OpenAPI fields incl. `transcription_track` (engine B/Telnyx only) and no timing fields; full mapping table + fixtures | §2, §9.2 |
| Engineering | Wrong: offline reload | Chose online reload + pending-edit recovery; no offline shell, stated plainly | §4.3 |
| Engineering | 1 | Live scheduler, files named (`scripts/sjcos-worker.mjs`, `lib/worker/live-loop.ts`, `claimSourceEvents`), fencing, backpressure, shutdown, `tests/call-live-worker.test.mjs` | §10.1 |
| Engineering | 2 | Exact start/stop/record_stop bodies, raw→normalized fixtures, manual/suggest-only when tracks missing; media-fork Ed25519 over `timestamp\|stream_url`, replay window, session token; pinned `claude-sonnet-5-5`; usage-returning adapter; cost-cap race test | §9, §10.2 |
| Engineering | 3 | Versioned TS + SQL contract; consult id mapping; protected writes via SECURITY DEFINER functions with REVOKE FROM PUBLIC; grant matrix; `tests/checklist-access-db.test.mjs` with direct-SQL attacks | §8 |
| Engineering | 4 | Cache partition by user, logout/expiry, unsent warning, storage denial, idempotency ledger (`checklist_events.operation_id`), 409 conflict | §4.3 |
| Engineering | 5 | Migrations and tests per phase; retention across source_events/segments/knowledge/Telnyx/backups; `stageDraftForApproval` extracted to lib; crash/staging tests; rollback stops capture | §11, §12, §14, §15 |
| Engineering | X | Migration order 0073 / **0074** / 0075+, renumber at build time; shared processor disclosure | §0, §12, §14 |
| Domain | Wrong 1 / Req 1 | Recorded confirmation line; `consent_evidence_segment_id`; "Consent not on the recording" stop; decline line | §5.1 |
| Domain | Wrong 2 / Req 2 | SJC wrap-up words fire a no-model fast path; acceptance: median ≥10 s before last client turn | §7.1, §10.3, §15 |
| Domain | Req 3 | Four optional rows written in full, off by default; Joe question 5 | §3.2, §16 |
| Domain | Req 3 (Photos) | **Rejected in part**: the Photos row does **not** write the existing `photos` fact. Evidence: `lib/leads/qualification.ts:81` derives `photos` from the count of uploaded photo files, and `syncFactsFromIntake` would overwrite a request status with it. The request status is stored as the session value `photos_request` instead. | §3.3 |
| Domain | Req 4 / X-1 | One retention table for both plans; truthful Telnyx/Anthropic disclosure; recorded yes stored in both | §14, §5 |
| Domain | X-5 | Discovery facts (who decides, property/HOA, years staying, photos) shown in the consult's "What we know so far" | §3.3 |
| Domain | X-6 | Client words: pre-con agreement, rough estimate, formal estimate, Pre-con change, change order, upsell; never proposal/bid | §1.1 |
| Design | 5 vs X-6 | Consent button wording merged: **They said yes — start notes** / **They said no — keep it manual** satisfies both items | §5, §6.3 |
| — | Cut | `set_call_nudges` MCP tool removed (the reminders switch is Joe's); custom checklist rows deferred | §13, §3.4 |

## Revision log (round 2 → 3)

| Judge | Item # | What changed | Section |
|---|---|---|---|
| Design | 1 | Phone hand-ticked nine-row screen, exact by-hand chip, sticky Finish checklist, hangup/header fallback | §6.4a |
| Design | 2 | Recorded-yes button in words table, countdown/ambiguous card and speakers-unknown states | §1.1, §5.1, §6.3, §6.7 |
| Design | 3 / Cross 1 | Two exact CoverageMark variants; fields use Covered as well as sections; no Answered/Missing/! Open mark aliases | §6.0 |
| Design | Cross 2 | Shared yes/no/recorded-yes/ambiguity buttons and stop banners fixed verbatim for consult adoption | §5, §6.3 |
| Design | Minor | Removed duplicate inline Undo; pinned row-sheet Undo remains | §6.5 |
| Engineering | 1 / D1 / Cross operations | Durable pre-200 hangup fence, replay/control lane and explicit dedicated connection ownership; delayed hangup test | §10.1 |
| Engineering | 2 / D2 / C1 / Cross engine | Stable templates + relational runtime membership, late repeated instances, device-qualified source keys, full Evidence/timing/corrections, common v3 fixture | §8.1–§8.5 |
| Engineering | 3 / D3 / C1 | Scoped signed principal/job reads and commands, no raw content grants, derived actor, snapshot revision/epoch, maintenance versus commit, prior/manual lock and access tests | §8.2–§8.5 |
| Engineering | 4 / D4 / C2 / Cross retention | One bounded capture-end policy, scoped effective hold, one purge authority, all copies/caches/events/URLs/uploads/backups and restore | §14 |
| Engineering | Cross migration / implementation | Compatible v3 migration prerequisite, manifest plus explicit EXECUTE grants, isolated DB acceptance; no implementation/test execution claimed | §8.1, §8.4, §12, §15 |
| Engineering | Cross scope/photos / C3 | Consumer ownership stays consult §10.9; names reviewed author/time/instance labels and approved photo export, no raw evidence bypass | §8.5 |
| Domain | 1 / New 1 | Strip affirmative no/don’t phrases before negatives, ambiguous pauses and person confirms, exact phrase tests | §5.1 |
| Domain | 2 / New 2 | Paying-for-it insurance warning and deduped initial-estimate §325E.66 notice to-do | §3.2 |
| Domain | 3 / New 3 / Cross 1 | Adopt proposed shared table including separate two-year minimal yes clip, 90-day audio, 180-day transcript, ≤90-day backups; discovery owns only copy | §14 |
| Domain | Cross 2–6 | Preserve consult-owned scope export/origin/RRP flow, discovery fact prefill, shared words and target sizes; define consumer mark contract exactly | §1.1, §3.3, §6.0, §8.5 |
| All | Evidence limits | Rechecked webhook durable replay, source-event filtering, qualification photos, Telnyx wrapper gap and actual call transcript columns; inherited model/provider results explicitly unverified this round | §2, §8, §10.1, §14, introduction |

## Revision log (round 3 judge fix)

| Judge | Item | What changed | Section |
|---|---|---|---|
| Contractor & legal R3 | 1 | Negative consent pattern now includes bare `not`, `never`, `isn't`/`won't`/`can't`… and any `n't` word left after stripping the yes-phrases; refusals that contain "okay"/"fine" fall to ambiguous (Joe picks), never an automatic yes; tests added for "not ok", "that's not okay", "that isn't fine", "I'm not okay with that", "I'd prefer not", "never" | §5.1 step 5 |

## Revision log (round 3 design judge fix)

| Judge | Item | What changed | Section |
|---|---|---|---|
| Design R3 | 1 | Unknown-voices consent: tapping **They said yes on the recording** stops the countdown, lists recent segments as 48 px rows, picked row → **That was a yes** / **Stop notes**; wireframe drawn | §5.1 step 5, §6.3 |

## Revision log (Joe's answers, 2026-11-02)

| Decision | What changed | Section |
|---|---|---|
| Consult consent link | §5.1 no longer stores a consult clip; §8.4 lets the worker attach the verified yes text to an attestation the visitor already recorded, never create or change one | §5.1, §8.4 |
| Optional rows on by default | The four extra rows (Next step, Photos, The property, Paying for it) start **on**; Joe switches them off in Settings; seed updated; question 5 closed | §3.2, §6, §15, §16 |
| No need to keep consult audio, just transcribe it | Consult audio deleted per chunk once transcribed (7-day cap for a chunk that fails); consult consent proof is the yes text + attestation, no audio clip. Call audio unchanged (90 days) — Joe answered for consults | §14 |
