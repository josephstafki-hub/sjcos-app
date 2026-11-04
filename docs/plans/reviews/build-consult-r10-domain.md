# Build R10: Contractor / Minnesota domain judge (in-home consult)

SCORES: design=9 completeness=8

**What I read:**
- My round-9 review (`build-consult-r9-domain.md`). I checked items 1–4 and E1–E5.
- `git show b842ae6e 8732cf8e 41b49456`.
- `db/migrations/0081_consult_rrp_start_date.sql`, `db/migrations/0082_consult_rrp_redelivery.sql`.
- `lib/consult/{rrp,flags,protocol}.ts`: `close()`, `completion()` and `todo()`.
- `lib/consult/ui/{model,words}.ts`, `components/consult/field/WrapClose.tsx`, `lib/consult/client-summary.ts`.
- `lib/consult/forms/seed/{scripts,shared}.ts` and `lib/consult/forms/approved-content.ts` (the counsel block).
- `tests/consult-r9-logic.test.mjs`, `tests/consult-r9-domain.test.mjs`, `tests/consult-r8-logic.test.mjs`.
- `scripts/qa-seed-consult.mjs`, to see how the seeded Complete visit was built.
- Plan `docs/plans/in-home-consult-plan.md`: line 1118 (the 60-day promise), line 2133, and the counsel block (1561–1568).
- Screenshots in `/tmp/sjcqa/shots/consult-r10/`:
  - phone-17, 17bb, 17bc, 17c, 17e;
  - phone-18b, w320-22b, w320-24b, w320-29b;
  - phone-29c, 29e;
  - phone-41, owner-desktop-47;
  - phone-48, 49, 43;
  - `log.json`, and `/tmp/sjcqa/shoot-consult10.mjs` for the order of the reopen steps.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices" (w320-29b).
- The counts on the empty visit (246 / 247 / 255 open).
- "and ten more" in the selections line.
- phone-43's generic error. The engineering judge owns the cause. Its domain consequence is in "Kitchen and bath" below.

---

## Round-9 items

| # | Item | Status |
|---|---|---|
| 1 | Renovate Right re-delivery after 60 days (§745.84(a)(1)) | **Done when the start date changes. Missing when the start date is already set at close.** 0082 replaces the 0081 function, so the existing `AFTER UPDATE OF start_date` trigger now does three things. It re-dates `:rrp:delivery`. When `start − visit day > 60` it files or re-dates `:rrp:redelivery`: due `start − 7` at 00:00 Central, with the full title, and it reopens a cancelled one. When the start comes back inside 60 days it cancels the open one, and it leaves a done one alone. The SQL "applies" test matches `rrpApplies` in `rrp.ts`: before-1978 true, or no answer and the year isn't after 1977, and paint disturbed or a window/door replaced. The test covers 2027-03-10 → due 03-03, then 2026-12-20 → cancelled, and "Client absent" → none. **The gap:** `close()` (protocol.ts:356) files the re-delivery only when the visitor ticks the box. The trigger fires only when `projects.start_date` **changes**. So if the start is already set when the visit closes, no re-delivery to-do is filed. The walk project is that case: start 2027-02-01, visit Nov 3, which is 90 days. See Fix 1. |
| 2 | Counsel record | **Done.** Plan line 2918, the stale copy, is gone. The changed-lines block is a `###` heading, each line has its label, and the doubled blank lines are gone. A test checks that each of the five literals appears in `approvedFormContent` exactly once. The staff no-date line now reads "He'll be in touch to tell you when you'll have the formal estimate", which was my E1 option 2. Good. |
| 3 | A reopened Complete visit closed again stays Complete | **Fixed on the server, not yet proven on screen.** `saveEvidence` now requires the baseline the editor saw ("Absence is not deletion"). `snapshot()` hydrates decisions from `consult_close_evidence` after a reopen. The new test reopens twice, hands off to a fresh device, and asserts `complete=true` with the same checks and an unchanged evidence row. phone-48 shows 244/244 hydrated. phone-49 carries the promised date and the client initials. **But** phone-49 also shows "Trade walks: Plumber, Electrician, HVAC — needs a decision". The cause is the seed, not hydration: `qa-seed-consult.mjs:73` closes with `touched_trades:[]`, `trade_walks:[]` and `no_trades_confirmed:true`. The server accepted that as Complete for a kitchen and a bath. That is a real domain hole. See Fix 2. The fixture is still all "Other — QA fixture" skips (owner-desktop-47), so the "real values" half of R9-3 is still open. |
| 4 | QA proof | **Partly.** (c) Done: phone-41 and owner-desktop-47 show "Complete · Nov 3, 5:14 pm · 7 estimate quantities not measured". (b) Half done: phone-17bc shows the "Because the house was built before 1978…" line with the pamphlet field, and its new hint ("Give it no more than 60 days before work starts… If work starts later, we give it again"). The unknown-year line isn't captured, because phone-17 stops above the pamphlet field. (a) Not done: phone-18b is the date-open state, and w320-22b is scrolled past the script again. No screen shows the no-date line 2, and no skipped-date visit closes ✓ Complete. (d) Blocked by phone-43. See Fix 3. |

R9 extras:
- **E1. Done.** See item 2.
- **E2. Mostly done.**
  - Done:
    - Move reads "at its new spot".
    - Replace reads "the replacement toilet".
    - New reads "a new toilet".
    - Remove gets no front-clearance flag.
    - The test pins all five plans.
  - Not done: the line that says the two answers disagree ("Toilet plan says Keep but the fixture says {plan} — fix one"). It is carried as E2 below.
- **E3. Done.** `sameBathroom()` matches the fixture to the bath, or to the bath's room. It is used in both `completion()` and `buildModel()`, and has a unit test.
- **E4. Done in code, wording needs work.** `certificationWarnings()` checks each expiry against `target_end_date`. It is never a close block. It shows on the Renovate Right sheet and in Before you wrap: phone-17c reads "⚐ Renovator certification expires 2027-03-01, before the planned finish". It does **not** show on the Era screen; phone-17bb and 17bc have no ⚐ line. That is fine for an advisory. The wording and who sees it are in Fix 4.
- **E5 (carried from R6).** Still open, not blocking:
  - bath fixtures with the bath;
  - a sink-base "soft, stained or wet?" choice;
  - a large-format tile flatness hint;
  - the printed name and date with the Renovate Right initials (for counsel).

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Yes, if the visitor fills it in honestly.** Nothing that prices the job was removed this round. These are all still there:
- 1/16″ on the cabinet runs, island, sink base and appliance cutouts;
- vanity wall;
- toilet rough-in and clearances, now per bath;
- shower drain and size;
- threshold build-up;
- the wet-wall framing trigger;
- fan duct;
- hood, range and fridge space;
- soffit contents;
- the basement ceiling under a moved sink;
- selections.

Per-bath toilet plans fix a real two-bath error: bath 2's moved toilet no longer puts a code flag on bath 1's kept toilet.

**Two things still put "priced without a return trip" at risk:**

1. **The server lets a device say no trades were touched (Fix 2).** `completion()` takes `touched_trades` straight from the evidence the device sends (protocol.ts:325). The field model works out the trades from the sections, e.g. plumbing fixture → Plumber, electrical panel → Electrician, HVAC → HVAC. The server does not. The seed proves it: a kitchen and bath with three fixtures, a panel and a vented appliance closed ✓ Complete with no trade walks. In real use, an old cached build, a stale device or an agent calling the API could do the same. Joe would then price plumbing moves and a panel with no bid walk-throughs. He'd find out only when he called the plumber, which means a second trip with the sub. RRP already follows "derive the gate from captured facts, never from wrap-sheet checkboxes" (`rrp.ts:8`). Trade walks need the same rule.
2. **A reclose that fails on site (phone-43).** After Joe reopens a visit ("Client asked to add a closet measurement"), the visitor's close comes back "Something went wrong… Try again". The answers are safe on the device. But until a close goes through:
   - the visit stays reopened;
   - the promised-estimate to-do isn't re-checked;
   - auto-apply / estimate inputs don't run for the new generation.

   For the client, nothing changes. For Joe, the estimate he promised for Dec 10 sits waiting on a visit he can't see is stuck. Whatever the engineering judge finds, the domain need is this: a failed reclose must either retry until it goes through, or tell Joe, with a bell card or a to-do saying "Visit reopened by you is not closed again — {visitor} got an error". It must not wait silently on the visitor's device. I'm not listing this as a separate fix because it depends on the engineering root cause. It is in Fix 3(d).

## Minnesota checks

- **Frost (Minn. R. 1303.1600).** Unchanged and right: Zone I 60 in, Zone II 42 in (metro included), with the city's requirement editable.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)).** One-party consent. The consent script is unchanged and settled.
- **RRP (40 CFR 745).**
  - **Applies (§745.82, §745.83 minor repair).** The rule is: before 1978, or no year on record, and paint disturbed above 6 sq ft in a room or 20 sq ft outside, or any window/door replacement. Right; window replacement is correctly never a minor repair. The SQL copy in 0082 matches `rrpApplies`. Two copies can drift, so Extra E3 asks for a test that ties them together.
  - **§745.84(a)(1) 60-day window.** Right when the start date changes after the visit (0082). Missing when the start is already set at close (Fix 1). The new field hint, "Give it no more than 60 days before work starts… If work starts later, we give it again", is accurate and plain.
  - **§745.84(a)(1) delivery / mailing.** The to-do title is unchanged and right. It is due start − 7 and follows the start date.
  - **§745.89 / §745.90 certifications.** "Current" is checked on the later of the visit day and the start day. Right. The new mid-job advisory is right on the law: certification must stay current while renovation work happens, so expiry before the planned finish is a real problem. In the walk, Dana Kowalski expires 2027-03-01; the start is 2027-02-01 and the finish 2027-06-30. She is current at the start and lapses about four weeks into the job. The app flags it and doesn't block. Right. The wording is in Fix 4.
- **Plumbing clearances (Minn. R. 4714.0402.5, UPC 402.5).** Right:
  - 24″ in front of the toilet;
  - 15″ from centre to each side;
  - 30″ centre to centre.
  - Keep and stay gets the calm advisory, Move, Replace and New get the code line, and Remove gets no flag.
  - On Replace: many inspectors don't enforce clearance when a toilet is swapped in the same spot. Calling it "code" is the conservative choice, and the visitor still picks the disposition. Fine as it is. See E2 for wording.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

- **Staff no-date line 2 (new wording):** "Next, Joe prices this with our trade partners and suppliers. He'll be in touch to tell you when you'll have the formal estimate. It shows…" Read aloud it is clear, and it no longer says "call" twice before 2b ("he may call you with a question or two"). Accurate: Joe's to-do is "Set the formal estimate date and tell {client}".
- **Other changed lines:** staff line 2, staff 2b, the Joe no-date line and the unknown-year pamphlet line are unchanged since R9. They are still accurate.
- **Client screen with the date skipped (w320-24b):** the **Next** line reads "Joe sends your formal estimate." The text recap for the same case (`clientRecapText`) says "Joe will confirm the estimate date." The client initials the screen, so the two should match the spoken line. See Extra E1.

---

## Required fixes (numbered)

1. **Re-delivery when the start date is already set at close (40 CFR 745.84(a)(1)).**
   - **Files:** `db/migrations/0083_…sql` (new) and `lib/consult/protocol.ts` (`close()`, around line 356).
   - **Problem:** the 0082 logic runs only on `UPDATE OF start_date`. A visit closed with the pamphlet given while `start_date` is already more than 60 days out gets no `:rrp:redelivery` to-do. The walk project is that case (start 2027-02-01, visit 2026-11-03). Two smaller gaps:
     - a visitor-picked "Re-deliver on" day isn't capped at the start;
     - clearing the start date (setting it to NULL) cancels an open re-delivery.
   - **Change:**
     - Move the 0082 body into `consult_reconcile_rrp(project_id uuid)`, with `SECURITY DEFINER SET search_path = public, pg_temp`.
     - Call it from the trigger, and from `close()` after the RRP to-dos are written.
     - When `start_date` is NULL, leave open re-delivery to-dos alone; don't cancel them.
     - When the start is known, set the due date of a visitor-picked `:rrp:redelivery` to whichever is earlier: the picked day or `start − 7`.
   - **Tests:**
     - start 2027-02-01 set **before** a close with the pamphlet given on 2026-11-03 → one re-delivery to-do, due 2027-01-25, 00:00 Central;
     - start 2026-12-20 set before close → none;
     - start set to NULL after close → the open to-do is still open.
2. **Server works out the touched trades itself (trade-walk check 11).**
   - **File:** `lib/consult/protocol.ts`, `completion()` line 325. Move the `TRADES` map from `lib/consult/ui/model.ts:404-408` into a shared `lib/consult/trades.ts`.
   - **Problem:** `touched_trades` comes from the evidence the device sends. A device that sends `[]` with `no_trades_confirmed:true` closes a kitchen and bath ✓ Complete with no plumber, electrician or HVAC walk. The QA seed did exactly that (`qa-seed-consult.mjs:73`).
   - **Change:** in `completion()`, set `touched_trades = union(trades derived from live instances, evidence.touched_trades)`. Use the same rules as `buildModel`:
     - module → trade;
     - structure flag → Engineer/framer;
     - footing → Excavation/foundation;
     - asbestos other than None → Abatement.

     Ignore `no_trades_confirmed` when the derived list isn't empty.
   - **Tests:**
     - a visit with a `plumb_fixture` and an `electrical_panel` instance, with evidence `touched_trades:[]` and `no_trades_confirmed:true`, makes check 11 list Plumber and Electrician;
     - the same visit with both walks decided is complete.
   - **Also:** fix the seed so the Complete visit decides its trade walks, e.g. Plumber needed, "moves the shower drain". That way phone-48/49 show a reopened visit with nothing open.
3. **QA proof still owed.**
   - (a) On the skipped-date visit, w320 and phone: the Closing script card scrolled into view, showing the new staff no-date line 2 and then 2b. Then a close that comes back **✓ Complete**, and Joe's undated "Set the formal estimate date and tell {client}" to-do.
   - (b) phone-17 scrolled to the pamphlet field with Year built empty, showing the "We're not sure…" line.
   - (c) After Fix 2: the seeded Complete visit rebuilt with real values (numbers and choices, not "Other — QA fixture") and its trade walks decided.
   - (d) After the engineering fix for phone-43: reopen → the visitor's close → ✓ Complete, with no "Finish consultation" to-do. If a reclose can still fail, show what Joe sees about it.
4. **Certification warning: plain date, name, the next step, and Joe sees it.**
   - **Files:** `lib/consult/rrp.ts` (`certificationWarnings`), `components/consult/field/WrapClose.tsx`, `components/consult/office/LookOverActions.tsx` or the look-over page.
   - **Problem:**
     - phone-17c reads "Renovator certification expires 2027-03-01, before the planned finish". The date is ISO, the person isn't named, and it doesn't say what to do.
     - It shows only to the visitor, on the wrap and Renovate Right sheets. Joe staffs the job, and after close he never sees it.
     - It renders even when RRP doesn't apply. `CertWarnings` isn't gated on `model.rrpApplies`.
   - **Change:**
     - Wording:
       - "Dana Kowalski's renovator certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Renew it or put another certified renovator on the job."
       - "SJC's firm certification runs out {date} — before the planned finish, {date}. Renew it before then."
     - Show it only when `rrpApplies`.
     - Show the same lines, calm, on the office look-over after close.
   - **Test:** RRP off (1965 + No with a reason) → no warning lines.

---

## Optional extras

- **E1. Client screen Next line with the date skipped** (`ClientView.tsx`, `client-summary.ts`). Use one sentence on the screen and in the recap, matching the spoken line: "Joe will be in touch to tell you when you'll have your formal estimate." Counsel confirms, since the client initials the screen.
- **E2. Toilet flag wording** (`flags.ts`).
  - Add the disagreement line when `toilet_plan = Keep` and a fixture says Move, Replace or New: "Toilet plan says Keep, but the fixture says {plan} — fix one."
  - The code line repeats itself: "Measured 20″ — less than 24″ in front of the toilet — a new toilet needs at least 24″". Shorter: "Measured 20″ in front of the toilet. A new toilet needs at least 24″ (Minnesota plumbing code)."
  - For Replace, add: "Same spot? Ask the inspector whether it has to meet 24″."
- **E3. One "RRP applies" definition.** Add a DB test that feeds the same fact sets to the 0082/0083 SQL and to `rrpFacts().applies`, and asserts they agree:
  - 1985 + Yes;
  - 1965 + No;
  - no year;
  - paint No + window Yes.
- **E4. Certifications at visit time.** Show the cert warning under the Era expiry field too, as a calm one-line hint. Then the visitor can ask the client about timing while they're still in the home.
- **E5. Carried from R6.** These are still open:
  - bath fixtures with the bath;
  - a sink-base "soft, stained or wet?" choice next to the Sink base open photo;
  - large-format tile flatness (about ⅛″ in 10 ft for tile with an edge over 15″) as a hint on `flooring.worst_dip`;
  - the printed name and date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
