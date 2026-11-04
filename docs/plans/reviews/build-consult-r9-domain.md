# Build R9: Contractor / Minnesota domain judge (in-home consult)

SCORES: design=9 completeness=8

**What I read:**
- My round-8 review (`build-consult-r8-domain.md`). I checked items 1–6 and E1–E6.
- `git show 489490f3 f99b338c`.
- `lib/consult/forms/seed/{scripts,shared,template-modules,flag-hints}.ts`, `lib/consult/forms/approved-content.ts`.
- `lib/consult/{rrp,flags,protocol}.ts`, `lib/consult/ui/{model,words}.ts`, `components/consult/field/{VisitScreen,FieldRow,WrapClose}.tsx`.
- `db/migrations/0081_consult_rrp_start_date.sql`, `tests/consult-r8-logic.test.mjs`, `tests/consult-r7-logic.test.mjs`.
- Plan `docs/plans/in-home-consult-plan.md`: §7.3 era (line 1118), the counsel block (1561–1568) and the closing addendum (2916–2918).
- Screenshots in `/tmp/sjcqa/shots/consult-r9/`:
  - phone-06 cards 2–7;
  - phone-17/17b/17c/17d/17e;
  - phone-18b and w320-18b;
  - phone-19b/19c, 29c and 29e;
  - w320-22b and w320-24b;
  - w320-29b and phone-43b;
  - `log.json` (`rrp_lines`).

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices" (w320-29b).
- The empty-visit counts (246 open).
- "and ten more" in the selections line.
- "Not measured today: the bathroom, the kitchen, two more rooms" (w320-24b). The rooms were left empty on purpose.

---

## Round-8 items

| # | Item | Status |
|---|---|---|
| 1 | Certification check used start − 7 (§745.89/.90) | **Done.** `completion()` passes `start_date::text` to `rrpFacts` (`protocol.ts:303`). The 7-day shift is only on the to-do's due date (`protocol.ts:335`). The test has a certification expiring 2027-03-07 with a 2027-03-10 start. It gives `firm_current=false` and `renovator_current=false`, and check 8 is open. |
| 2 | Line 2 after "Joe sets the date" | **Done in code, not on screen.** `closingScriptLine()` swaps in `CLOSING_NO_DATE_JOE` / `CLOSING_NO_DATE_STAFF` for "Joe sets the date", and for "Other" with a note. "Other" with no note keeps the direction. A test covers all three cases. The swapped line has no `{estimate_date}`, so `needsDate()` lets it through. **No screenshot shows it.** phone-18b and w320-18b are the date-open and date-picked states, and w320-22b is scrolled past the script. See Fix 4. |
| 3 | Skipped date: mark and hint | **Done.** w320-22b shows "– Skipped", the hint "Joe gets a to-do to set the date.", and "Skipped · Joe sets the date · Joe sets the date after the lumber quote comes back." w320-29b no longer lists the date as open. Extra on the same screen: "Change reason…" and "Undo skip". Good. |
| 4 | Kept toilet that moves | **Done.** `keptToilet` needs `toilet_plan = Keep` and every toilet fixture on Keep. A Move gets the code line "at its new spot it needs at least 24″". The advisory card (19c, 29e) reads: "It's staying where it is, so the code doesn't force a change. Pick 'Not an issue' if it stays, or 'Price it' if the client wants it moved." The code card (19b, 29c) is styled as code. Each plan has a test. Two wording gaps are in Extra E2. |
| 5 | Re-date the Renovate Right to-do from the start date | **Done.** Migration 0081 adds an `AFTER UPDATE OF start_date` trigger. It sets `due_at = start − 7` at 00:00 Central on open `:rrp:delivery` to-dos. The test checks two start dates, Central midnight and the snooze. **But** the same trigger is where the 60-day re-delivery belongs, and that is still manual. See Fix 1. |
| 6 | QA proof | **Partly.** (c) Opening card 6 is captured ("6 of 6", the client's own list), and so is card 7, the section list. (d) The certification test is in. **Still missing:** (a) the no-date line 2 on screen, and a visit closed **Complete** after "Joe sets the date" with Joe's undated to-do; (b) the pamphlet line itself. phone-17c and 17e are Before-you-wrap sheets. They show the Renovate Right status line, not the Era hazards pamphlet field with its spoken line. See Fix 4. |

R8 extras:
- **E1. Done.** The unknown-year wording is the one I suggested: "We're not sure… so we're giving you…".
- **E2. Mostly done.** The changed lines are now inside `approvedFormContent`, so the counsel copy includes them. But the record has a stale copy and unlabeled lines. See Fix 2.
- **E3. Done.** The card wording is fixed. On the inch marks: the source uses ″ everywhere (`flag-hints.ts:47`, `flags.ts`). 29c/29e show 24" next to 20″, so the sans face draws ″ like a straight quote. Look at it only if Joe notices.
- **E4. Done in code.** `quantitiesLine()` adds "N estimate quantities not measured" under ✓ Complete. It isn't on screen, because no visit closed Complete this round.
- **E5. Done.** `consult-r7-logic.test.mjs:15` now asserts the exact list of 1/16″ fields.
- **E6. Still open; carried, not blocking.** These were carried from R6:
  - bath fixtures with the bath;
  - the sink-base moisture question (`kitchen_scope` has the photo, but no "soft/stained/wet?" field);
  - large-format tile flatness, which `flooring.worst_dip` covers only partly;
  - the printed name and date with the Renovate Right initials (for counsel).

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Yes, on the first trip.** Nothing that prices the job was removed or loosened. These are all still there:
- 1/16″ on the cabinet runs, island, sink base and appliance cutouts (now pinned by an exact-list test);
- vanity wall vs. width;
- toilet rough-in, side and front clearance;
- shower drain centre and new shower size;
- threshold build-up;
- the wet-wall framing trigger;
- fan duct and exit;
- hood, range width and fridge space;
- soffit contents;
- the basement ceiling under a moved sink;
- selections.

A skipped estimate date no longer blocks the close, and the visitor now has a real line to say about the estimate.

**One consequence of phone-43 that matters for this question.** A seeded Complete visit was reopened by the owner and closed again on a new device. It came back as "Needs finishing · 241 open": Answers 212, Photos 29, and the trade walks open again. That is almost the same count as the empty visit in w320-29b (217 / 29). So the reclose counted nearly none of the visit's answers, photos or trade-walk decisions.

If that happens with real answers, the core promise breaks. Joe reopens a complete kitchen-and-bath visit to fix one value, closes it from his tablet, and three things follow:
- the visit drops to Needs finishing;
- the visitor gets a "Finish consultation" to-do, which reads as a return trip;
- the auto-apply and estimate-inputs step, which is keyed on a Complete generation, doesn't run.

The engineering judge owns the cause. I only state the domain requirement, in Fix 3.

## Minnesota checks

- **Frost (Minn. R. 1303.1600).** Unchanged and right: Zone I (northern counties) 60 in, Zone II (southern Minnesota,
  metro included) 42 in, with the city's requirement editable.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)).** One-party consent. The consent script is unchanged and settled.
- **RRP (40 CFR 745).**
  - **Target housing and the year.** The 1978 boundary is right. "1985 + Yes" keeps RRP on (17c: receipt, firm and
    renovator certification all open), which is the conservative answer. "1965 + No" needs the written "How do we know…"
    reason (17d) and then turns RRP off (17e, `rrp_lines: []`). This is the settled override design. Its hint, "If Year
    built is wrong, change Year built instead", points the visitor the right way.
  - **§745.89 / §745.90 certifications.** These are now checked on the later of the visit date and the actual start
    date. Right.
  - **§745.84(a)(1) acknowledgment/mailing.** The to-do title is right ("get the owner's initials, or mail it with a
    certificate of mailing at least 7 days before work starts"). It is due start − 7 and follows the start date
    (0081). Right.
  - **§745.84(a)(1) 60-day window: gap.** The rule requires the pamphlet "no more than 60 days before beginning
    renovation activities". The plan (line 1118) and the field note both promise: "if the start is later, the app files a
    to-do to re-deliver it before start". The build doesn't do that.
    - What it has instead is a manual checkbox in the Renovate Right sheet: "Work starts more than 60 days from today —
      re-deliver before start", plus a date the visitor picks (`WrapClose.tsx:191`).
    - At a consult the start date is almost never known. The formal estimate, contract and scheduling all come after.
      For SJC's normal flow the pamphlet given at the consult will usually be stale by the start, and nothing notices.
      0081 already fires on the start date, so the fix belongs there. See Fix 1.
- **Plumbing clearances (Minn. R. 4714.0402.5, UPC 402.5).** Right:
  - 24″ in front of the toilet; 15″ from centre to each side; 30″ centre to centre.
  - The front-clearance hint names the obstructions that count: "nearest wall, vanity, tub or door swing".
  - A kept toilet that stays gets the calm advisory, since existing work isn't forced to change. A moved toilet gets
    the code line, and so does a new toilet.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

- **Staff line 2:** "Next, Joe prices this with our trade partners and suppliers. You'll have the formal estimate by
  {estimate_date}. It shows each part of the work…" Clear, plain and true. (w320-18b reads "by Thursday, November 12".)
- **Staff line 2b:** "Joe works from everything I measured today, and he may call you with a question or two." Good.
- **No-date line 2, Joe:** "Next, I price this with our trade partners and suppliers. I'll call you with the date you'll
  have the formal estimate. It shows…" Accurate: Joe's to-do is "Set the formal estimate date and tell {client}". It
  promises nothing the app doesn't do.
- **No-date line 2, staff:** "Next, Joe prices this… He'll call you with the date you'll have the formal estimate…"
  Accurate. Read aloud, the staff version has two calls in a row: "He'll call you with the date…" and then 2b, "he may
  call you with a question or two." It's fine, but see Extra E1.
- **Unknown-year pamphlet:** "We're not sure the house was built in 1978 or later, so we're giving you this pamphlet about
  lead-safe work — it's called Renovate Right. Could you initial here that you got it?" Accurate. It makes no claim
  about the house and reads easily aloud.

---

## Required fixes (numbered)

1. **Renovate Right re-delivery when the start is more than 60 days after the visit (40 CFR 745.84(a)(1)).** Change
   `db/migrations/0081_consult_rrp_start_date.sql`, or a new 0082 with the same trigger.
   - **Problem:** re-delivery happens only if the visitor ticks "Work starts more than 60 days from today" and picks a
     day at close. When the start date is set later, which is the normal case, nothing compares it with the day the
     pamphlet was given. The plan's promise ("the app files a to-do to re-deliver it before start") isn't kept.
   - **Change:** when `projects.start_date` is set or changes, do this for each consult on the project where RRP applied
     and the pamphlet was given:
     - If `start_date − visit date > 60 days`, file (or re-date) a consult to-do with source
       `{consult}:rrp:redelivery`:
       - title: "Renovate Right: give it again — work starts more than 60 days after the visit. Get the owner's
         initials, or mail it with a certificate of mailing at least 7 days before work starts";
       - due `start_date − 7`, at 00:00 Central.
     - If the start moves back inside 60 days, cancel that to-do. Leave a done one alone.
     - Re-date an open visitor-picked `:rrp:redelivery` to-do the same way, so a start moved earlier can't leave it due
       after the start.
     - Keep the close checkbox for the case where the start is already known.
     - Tests:
       - visit 2026-11-03, start 2027-03-10 → one redelivery to-do, due 2027-03-03;
       - start moved to 2026-12-20 → that to-do is cancelled;
       - pamphlet skipped ("Client absent") → only the `:rrp:delivery` to-do, no redelivery to-do.
2. **Counsel record: one current copy of each changed line, each with its label.** Files:
   `docs/plans/in-home-consult-plan.md` and `lib/consult/forms/approved-content.ts`.
   - **Problem 1:** plan line 2918 still carries the **old** unknown-year text ("We don't know for sure… so we give
     you…"). Line 1568 carries the new one. Counsel could approve the wrong one.
   - **Problem 2:** in both files, the two no-date lines and the pamphlet line have no label saying which line each one
     is.
   - **Problem 3:** in both files, "Changed since approval — confirm with counsel" is a bare line, not a heading.
   - **Change:**
     - Replace plan 2918 with the current text.
     - Prefix the lines with "closing line 2, no date — Joe:", "closing line 2, no date — staff:" and "unknown-year
       pamphlet:".
     - Make "Changed since approval — confirm with counsel" a `###` heading, and drop the doubled blank lines.
     - Add a test asserting that every literal in `CLOSING_NO_DATE_JOE`, `CLOSING_NO_DATE_STAFF`,
       `STAFF_CLOSING_LINE_2`, `STAFF_CLOSING_LINE` and `PAMPHLET_UNKNOWN_YEAR_LINE` appears exactly once in
       `approvedFormContent`.
3. **A reopened Complete visit closed again from another device must stay Complete when nothing new is missing**
   (phone-43b). This is needed unless the engineering judge shows the 212/29 count comes only from the fixture.
   - **Requirement:** after Reopen with no answer changed, a close from any device of Joe's or the assigned visitor's
     must come back ✓ Complete. That close must keep:
     - every answer and committed photo;
     - the skip reasons;
     - the flag decisions;
     - the trade-walk decisions;
     - the Renovate Right evidence from the last close.
   - It must file no "Finish consultation" to-do.
   - Test it with a fixture of real values (numbers and choices, not "Other — QA fixture"), so the answers count as
     answers.
4. **QA proof still owed:**
   - (a) On the skipped-date visit, w320 and phone: the script card scrolled into view, showing the no-date line 2
     (staff version, then 2b). Then a close that comes back **✓ Complete**, and Joe's undated "Set the formal estimate
     date and tell {client}" to-do.
   - (b) Era hazards with the **pamphlet field in view**:
     - Year built empty → the "We're not sure…" line;
     - Year built 1965 + Yes → the "Because the house was built before 1978…" line.
   - (c) One Complete close showing E4's "N estimate quantities not measured".
   - (d) After Fix 3: the phone-43 path again, showing ✓ Complete.

---

## Optional extras

- **E1. Staff no-date script, for counsel to consider.** When the date is skipped, the staff script says "call" twice
  (line 2, then 2b). Two options:
  - shorten 2b in that case to "Joe works from everything I measured today.";
  - or word line 2 as "He'll call you to tell you when you'll have the formal estimate." That reads more easily aloud
    than "with the date you'll have".

  Either way it's for counsel to confirm.
- **E2. Toilet flag wording for the other fixture plans** (`flags.ts`, test `consult-r8-logic`).
  - "at its new spot" is right only for **Move**. The test pins it for Replace, Remove and New as well.
  - With `toilet_plan = Keep`, use the code line for those three plans, and add one line saying the two answers
    disagree: "Toilet plan says Keep but the fixture says {plan} — fix one."
  - With a **Remove** fixture, don't raise the front-clearance flag at all.
- **E3. Toilet plans across baths.** `toilet_fixture_plans` collects toilet fixtures from the whole visit, not from
  that bath. In a two-bath job, bath 2's moved toilet turns bath 1's kept toilet into a code flag. It errs on the safe
  side, but it's wrong. Filter by the fixture's bath (its room/parent).
- **E4. Certifications that lapse mid-job (§745.89/.90).** "Current" is checked on the start day only. If the project
  has a planned end date, also say "firm certification expires {date}, before the planned finish". Make it advisory, not
  a close blocker.
- **E5. Carried from R6.** These are still open:
  - bath fixtures with the bath;
  - a sink-base "soft, stained or wet?" choice next to the Sink base open photo;
  - large-format tile flatness (about ⅛″ in 10 ft for tile with an edge over 15″) as a hint on `flooring.worst_dip`;
  - the printed name and date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
