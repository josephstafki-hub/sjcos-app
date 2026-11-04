# Build R12: Contractor / Minnesota domain judge (in-home consult)

SCORES: design=9 completeness=9

**What I read:**
- My round-11 review (`build-consult-r11-domain.md`). I checked items 1–3 and E1–E8.
- `git show cff2ee60 03ddd36a`, in particular:
  - `db/migrations/0085_consult_redelivery_window.sql`;
  - `lib/consult/{protocol,rrp,close-errors,flags,completeness}.ts`;
  - `lib/consult/ui/{controller,model,words,flag-lead}.ts`;
  - `lib/consult/forms/seed/flag-hints.ts`;
  - `components/consult/field/WrapClose.tsx`;
  - `scripts/qa-seed-consult.mjs`;
  - `tests/consult-r10-domain.test.mjs`, `tests/consult-r11-fixes.test.mjs`.
- Seed forms: `lib/consult/forms/seed/{shared,template-modules}.ts`, for the `main_stack` and `wet_wall_exterior` flags. The only seed change this round is the toilet hint.
- `lib/consult/forms/approved-content.ts`, the counsel block (lines 700–712), and the same block in `docs/plans/in-home-consult-plan.md` (around line 1561).
- Screenshots in `/tmp/sjcqa/shots/consult-r12/`:
  - phone-17f, 17g, 17gg;
  - owner-desktop-51, plus the matching `close-failure todos` row in `log.json`;
  - phone-29;
  - phone-43g, 43h, 43i, 43j;
  - phone-43, 43d;
  - owner-desktop-50b, with its Flags block cropped and read.
  - `FAIL-phone-rrp.png` is a harness capture of Before you wrap, not the RRP sheet; I ignored it.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices".
- The large open counts on the walk visit.
- Settings › Company having no firm expiry in the QA DB (the "SJC firm certification is current" problem on 17f).

---

## Round-11 items

| # | Item | Status |
|---|---|---|
| 1 | Keep a picked re-delivery day inside the 60-day window | **Done.**<ul><li>0085 sets `due = greatest(start − 60, least(picked, start − 7))` at 00:00 Central. With no pick it falls back to `start − 7`.</li><li>`close()` now files the full title: "Renovate Right: give it again — work starts more than 60 days after the visit. Get the owner's initials, or mail it with a certificate of mailing at least 7 days before work starts". It then calls the reconcile, which clamps the day.</li><li>The date input has `min`/`max` set to start − 60 … start − 7. `clampDay` covers typed dates that skip the browser limits.</li><li>phone-17gg shows the hint: "Between 60 and 7 days before the start, so the pamphlet still counts. Pick a day from Dec 3, 2026 to Jan 25, 2027." The dates are plain words, not ISO. The walk project starts 2027-02-01, so both dates are right.</li><li>The test has the three cases I asked for: 11-20 → 12-03, 01-28 → 01-25, 01-10 → 01-10.</li></ul>One gap remains: a re-delivery already **done** is never checked again when the start slips later. See Fix 1. |
| 2 | Joe's stuck-close to-do in plain words | **Mostly done.**<ul><li>`officeCloseFailure()` maps the conflict, device, manifest, invalid-command and transient codes to plain office lines.</li><li>The raw code moved to the body ("Close refusal code: …") and the audit. The title has no underscores, and that is tested.</li><li>Conflict and stale_snapshot now wait 30 minutes before Joe is told (controller 570 and 638). That was E7.</li></ul>But the codes this round's screens actually raised fall through to the catch-all. 43h (owner_required) says "Joe has been told", and the row on Today reads "Abigail Stafki's visit for Tom Tierney hasn't closed — **the office turned the close down; open the visit**". That gives Joe nothing to act on, and owner_required is the one code that *is* Joe's to act on. owner-desktop-51 also doesn't show the row, which sits below the fold under The rest. See Fix 2. |
| 3 | Counsel record: the client-screen no-date Next line | **Done in substance, filed in the wrong place.** The line is in both `approved-content.ts` and the plan, the stray blank entry is gone, and the test counts six. But the new line sits **above** the `### Changed since approval — confirm with counsel` heading, right after the `---`. Counsel reading that section sees five lines. See Fix 4. |

R11 extras:
- **E1. Toilet line: done.** The seed hint reads "Less than 24″ in front of the toilet. A new toilet needs at least 24″ (Minnesota plumbing code)." `flag-lead` turns it into "Measured 20″ in front of the toilet. A new toilet needs …". Move and Replace keep their own second sentence, and Replace keeps the line about asking the inspector. Accurate to Minn. R. 4714.0402.5.
- **E2. Bath electrician: not taken.** Still optional.
- **E3. Realistic Complete fixture: partly done.**
  - Done:
    - Woodbury / City of Woodbury;
    - "Hall and each bedroom";
    - Kitchen and Hall bath;
    - bath fixtures Toilet / Bath sink / Shower (owner-desktop-50b: "Fixture 1 — Toilet, Fixture 2 — Bath sink, Fixture 3 — Shower").
  - Not done: about 40 selection rows, plus Door 1, Electrical panel 1, Exhaust fan 1 and Moisture check 1, are still labelled "Existing locations retained; durable neutral finishes requested.". "Who lives here", "Where will you be" and "HOA rules" carry the same sentence. QA fixture only; see E3 below.
- **E4. Skipped-date screen proof: still owed.** Not retaken. Not blocking; the backend test covers it.
- **E5. More room on the mailing deadline: not taken.** The due date is still `start − 7`, the last legal mailing day. The hint now says the window plainly, so this stays optional.
- **E6. Firm 90-day line: done.** "Joe renews it before then. Apply at least 90 days before it runs out so it doesn't lapse." That is right under §745.89(b)(1). See E1 below for the renovator half.
- **E7. Stuck-close noise: done** for conflict and stale_snapshot. evidence_conflict was missed; it goes in Fix 2.
- **E8 (carried from R6): still open, not blocking.**

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Yes.** Nothing that prices the job changed this round. The only seed edit is the toilet hint.

- The kitchen still captures:
  - 1/16″ cabinet runs per wall, island and sink base;
  - appliance cutouts, model status, voltage and amps, and fridge space;
  - the hood exit and route: joist direction, length, elbows and size;
  - gas location, shutoff and size when a range is gas;
  - countertop circuits;
  - soffit contents;
  - the basement ceiling under a moved sink.
- The bath still captures:
  - toilet rough-in and clearances;
  - shower drain;
  - vanity width;
  - wet-wall-exterior;
  - floor heat and the dedicated circuit.
- The trade walks (Plumber, Electrician, HVAC) are still derived on the server, so they can't be skipped from the device.
- phone-29 shows the walk visit closes ◐ Needs finishing with Answers, Photos, Initials, Renovate Right and Trade walks each listed with its button, and "A Finish consultation to-do was made." That is the right result for a half-done walk.
- phone-43 and 43d show the Complete close:
  - ✓ Complete · Nov 3, 7:01 pm, Price-critical 322/322 · Record 2/2 · 34 skipped;
  - "Joe applies the findings in the office.";
  - ‹ Back to visits.

  The fresh phone and the same phone match. One Price-critical count now runs from device to office (`countedModule`), which ends the 325-vs-322 mismatch.
- owner-desktop-50b (Complete look-over) reads like a real Woodbury kitchen and bath: 7:00–3:30 work hours, Hardwired alarms, Radon tested 36 pCi/L, and the feeds (224 sf shower floor, 248 sf kitchen demo, 6 lf cabinets, 12.8 sf tops, 2 sf backsplash).
  - Radon: 36 pCi/L is far above MDH's 4 pCi/L action level, and no flag shows. `house.radon_level` (`shared.ts:61`) has no flag. See E5.

## Minnesota checks

- **Frost (Minn. R. 1303.1600).** Unchanged and right: Zone I 60 in, Zone II 42 in, and the city's figure can be edited.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)).** One-party consent. Settled and unchanged.
- **Plumbing clearances (Minn. R. 4714.0402.5).** Right. E1 is done.
- **RRP (40 CFR 745):**
  - **§745.84(a)(1), 60-day window.** The window is right in every direction the code knows about: the start set before close, set after close, a picked day, cleared to NULL, moved inside 60 days, and moved back out (a cancelled one reopens). The gap is a start that slips **after** the pamphlet was handed over a second time. Remodel starts slip all the time (cabinet lead times, permits), so this will come up. See Fix 1.
  - **§745.84(a)(1), mailing.** "Mail it with a certificate of mailing at least 7 days before work starts" is right, and the window ends at `start − 7`.
  - **§745.89(b)(1), firm.** The 90-day line is right.
  - **§745.90(a)(3), renovator.** "Joe renews it" doesn't fit an individual renovator. Dana renews by taking a refresher course before the certificate runs out; if it lapses, Dana has to take the initial course again. Wording only; see E1.

## Office flag sentences (owner-desktop-50b)

Most now read as sentences, for example:
- "HOA approval may be needed before permit."
- "A cast-iron tub takes two people to remove or break up."
- "The new loads may need a bigger electrical service — the electrician runs the load numbers."

Two still read like raw seed text, because `officeFlagText` keeps any issue that starts with a capital letter and never falls back to the plain hint:
- "**Orangeburg; Cast iron with cracks.**" (`water.main_stack`) is a list of choice values, not a sentence. The plain hint already exists: "Old or cracked drain stack — the plumber looks before we price."
- "**MN freeze risk — reroute or insulate supplies.**" (`bath_scope.wet_wall_exterior`) uses the "MN" shorthand. The plain hint is "Pipes in an outside wall can freeze — they may need moving or insulating."

See Fix 3.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

All six are accurate and plain:
- staff closing line 2;
- 2b;
- the Joe no-date line;
- the staff no-date line;
- the unknown-year pamphlet line;
- the client-screen no-date Next line.

The only problem is where the sixth line is filed (Fix 4).

---

## Required fixes (numbered)

1. **Re-delivery when the start slips after the pamphlet was given (40 CFR 745.84(a)(1)).**
   - **Files:** `db/migrations/0086_consult_rrp_slip.sql` (new; replaces `consult_reconcile_rrp`) and `tests/consult-r10-domain.test.mjs`.
   - **Problem:**
     - 0085 skips any `:rrp:redelivery` or `:rrp:delivery` to-do with `status = 'done'`.
     - Example: start 2027-02-01, Joe re-delivers and ticks the to-do done on 2027-01-20, then the cabinets slip the start to 2027-04-15. The Jan 20 handover is now 85 days before work starts. It no longer counts, and nothing asks again.
   - **Change:**
     - In the loop, before the insert, reopen a done to-do when the handover is now too early:
       `UPDATE work_items SET status='open', completed_at=NULL, due_at=due WHERE source_kind='consult' AND source_id=source AND status='done' AND (completed_at AT TIME ZONE 'America/Chicago')::date < start_day-60;`
     - Do the same for `:rrp:delivery`, due `start − 7` and never before `start − 60`.
     - Prefix the reopened title with "Start moved — " so Joe knows why it came back.
     - `completed_at` is the day Joe ticked it, which can be later than the handover. That errs on the safe side.
   - **Test:**
     - start 2027-02-01, re-delivery done 2027-01-20, start moved to 2027-04-15 → open, due 2027-04-08;
     - the same done to-do with the start moved to 2027-03-01 (40 days) → stays done.

2. **Joe's stuck-close to-do: plain words for every code he can be told about.**
   - **Files:**
     - `lib/consult/close-errors.ts` `officeCloseFailure`;
     - `lib/consult/ui/controller.ts` lines 570 and 638;
     - `tests/consult-r11-fixes.test.mjs`.
   - **Problem:**
     - owner_required, rebase_required, evidence_too_large, batch_too_large, access_denied and person_required all fall through to "the office turned the close down; open the visit".
     - log.json shows that exact title after 43h. owner_required means the visitor set a trade-walk day, which only Joe can do, so Joe is the one who should act, and the title doesn't tell him.
     - evidence_conflict is reported right away, while conflict and stale_snapshot wait 30 minutes.
   - **Change:** add these lines:
     - owner_required → "they set a trade-walk day, which only you can set; set the day yourself or tell them to take it off";
     - rebase_required → "you reopened it after they typed some answers; they need to pick which values to keep";
     - evidence_too_large or batch_too_large → "the wrap-up was too big to send; they need to shorten the notes";
     - access_denied or person_required → "they no longer have access to this visit; open it to recover their answers";
     - json_required or csrf → "their page was out of date; they need to reload and close again".

     Also add `'evidence_conflict'` to the 30-minute list in both controller checks.
   - **Test:** for every key of `CLOSE_ERROR_ACTIONS` except `consult_key_unavailable` and `complete_locked`, `officeCloseFailure(code)` is not the catch-all line.
   - **Screen:** retake owner-desktop-51 with the row in view: scroll to Tierney under The rest, or use Quick ones / By due date.

3. **Office flag line falls back to the plain hint, not a capitalized fragment.**
   - **File:** `lib/consult/ui/model.ts` `officeFlagText`, around line 392.
   - **Problem:** `if (detail || /^[A-Z]/.test(t)) return sentence;` keeps "Orangeburg; Cast iron with cracks." and "MN freeze risk — reroute or insulate supplies." on the office look-over, even though a plain hint exists for both.
   - **Change:**
     - Return the issue only when it carries office detail: `detail` true, a code citation (`Minn. R.`, `CFR`, `IRC`, `MDH`, counsel), or a full sentence with a verb.
     - Otherwise return `hint` when there is one.
     - Simplest rule: keep the issue when it ends in `.`, `?` or `!`, or matches the detail regex. Otherwise prefer the hint.
     - Also clean the two seed issues so the office text reads well without a hint:
       - `shared.ts:289` `issue: 'Drain stack is Orangeburg or cracked cast iron — plan on replacing it'`;
       - `template-modules.ts:23` `issue: 'Pipes in an outside wall can freeze in Minnesota — reroute or insulate them'`;
       - the same two lines in `approved-content.ts` (205 and 334).
   - **Test:** `officeFlagText('Orangeburg; Cast iron with cracks', 'Old or cracked drain stack — the plumber looks before we price.')` returns the hint. Assert that no office flag text in the seed contains `;` or `MN `.

4. **Counsel record: file the sixth line under its heading.**
   - **Files:** `lib/consult/forms/approved-content.ts` (around line 704) and `docs/plans/in-home-consult-plan.md` (around line 1561).
   - **Problem:** "Changed after counsel's approval — confirm with counsel: client screen and recap, Next with no date: …" sits between the `---` and the `### Changed since approval — confirm with counsel` heading, outside the section counsel reads.
   - **Change:** move it below the heading, after the "unknown-year pamphlet" line.
   - **Test:** in the existing six-lines test, also assert that all six lines come after the `### Changed since approval` index.

---

## Optional extras

- **E1. Renovator wording (§745.90(a)(3)).** In `rrp.ts` `certWarningParts`, change the non-firm tail to: "Dana takes the refresher course before then, or Joe puts another certified renovator on the job." Use `{who}`, or "The certified renovator" when there's no name. Joe can't renew someone else's individual certificate, and a lapsed one means retaking the full initial course. Keep the firm tail as it is; it's right.
- **E2. owner_required is the visitor's to fix.** Like conflict, the visitor clears it by taking the day off in Trade walks. Consider the same 30-minute wait before telling Joe, so a quick fix doesn't leave a to-do on Today. The next close marks it done anyway.
- **E3. Finish the realistic fixture** (`qa-seed-consult.mjs`). Key the remaining text fields:
  - selection item names (from the selection module's own title, e.g. "Vanity", "Faucets");
  - `who_lives_here` "Two adults, one dog";
  - `where_during_work` "Living at home";
  - `hoa_rules` "No HOA";
  - Door, Electrical panel, Exhaust fan and Moisture check labels as "Bath door", "Basement panel", "Bath fan", "Under tub".

  Then the left rail of the look-over reads like a real job.
- **E4. Skipped-date close on screen.** Still owed from R10 3(a): the Closing script card with the staff no-date line in view, and Joe's undated "Set the formal estimate date and tell {client}" to-do on Today.
- **E5. Radon.** The Complete fixture records 36 pCi/L with no flag; `house.radon_level` (`shared.ts:61`) has none. Add an advisory at ≥ 4 pCi/L (MDH action level): "Radon is above 4 pCi/L. Mention mitigation, and don't seal the sump or slab in a way that blocks a future system." It doesn't change remodel pricing much, but a basement bath or finish will run into it.
- **E6. Mailing margin.** Carried from R11 E5: consider `start − 10` as the last day the to-do suggests for mailing.
- **E7. Carried from R6:**
  - bath fixtures listed with their bath;
  - a sink-base "soft, stained or wet?" choice;
  - a hint on `flooring.worst_dip` for large-format tile flatness;
  - the printed name and date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
