# Build R11: Contractor / Minnesota domain judge (in-home consult)

SCORES: design=9 completeness=9

**What I read:**
- My round-10 review (`build-consult-r10-domain.md`). I checked items 1–4 and E1–E5.
- `git show 44d76fff 6d62e067 19bafac8`, in particular:
  - `db/migrations/0083_consult_rrp_reconcile.sql`;
  - `lib/consult/{trades,protocol,rrp,flags,client-summary}.ts`;
  - `lib/consult/ui/{controller,model,words}.ts`;
  - `components/consult/CertWarning.tsx`, `components/consult/field/WrapClose.tsx`;
  - the look-over page `app/(os)/projects/[slug]/consult/[id]/page.tsx`;
  - `scripts/qa-seed-consult.mjs`;
  - `tests/consult-r10-domain.test.mjs`.
- Seed forms: `lib/consult/forms/seed/{shared,templates,template-modules}.ts`. I read the bath and kitchen templates, `kitchen_scope`, `kitchen_appliance` and `kitchen_wall`.
- `lib/consult/forms/approved-content.ts`, the counsel block (lines 704–710).
- Screenshots in `/tmp/sjcqa/shots/consult-r11/`:
  - phone-17bb, 17c, 17e;
  - phone-29c;
  - w320-22b, w320-24b;
  - phone-49, 43, 43c, 43cc, 43d;
  - owner-desktop-31b, 47-1, 50;
  - `log.json`, `log-refused.json`.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices".
- The large open counts on the walk visit.
- `FAIL-w320-refused-persistent`, a harness selector miss.
- The 404s for selection images.

---

## Round-10 items

| # | Item | Status |
|---|---|---|
| 1 | Re-delivery when the start date is already set at close (§745.84(a)(1)) | **Done, with one new gap.** `consult_reconcile_rrp(project)` is `SECURITY DEFINER SET search_path = public, pg_temp`. The start-date trigger calls it, and `close()` calls it after the RRP to-dos are written. It handles all three cases:<ul><li>a NULL start returns early, so open to-dos are left alone;</li><li>more than 60 days from the visit files or re-dates `:rrp:redelivery`, due `start − 7`, and reopens a cancelled one;</li><li>inside 60 days cancels the open one and leaves a done one alone.</li></ul>The test covers all of these:<ul><li>start 2027-02-01 set before a Nov 3 close → due 2027-01-25, snoozed to the due day;</li><li>start set to NULL → still open;</li><li>start 2026-12-20 → cancelled.</li></ul>This is the walk project's exact case. The walk itself ended on 1965 + No (RRP off), so no screen shows the to-do; the DB test is the proof, and it is enough. **New gap:** a re-delivery day the visitor picks is combined as `least(start − 7, picked day)`. It is capped late but not early. If the visitor picks a day more than 60 days before the start, the to-do surfaces on that day, and a pamphlet given then is again too early to count. See Fix 1. |
| 2 | Server works out the touched trades itself | **Done.** `lib/consult/trades.ts` is shared by `buildModel` and `completion()`. `touched_trades` is now the union of what the facts show and what the device sent. `no_trades_confirmed` is ignored whenever the facts show a trade. The test: a `plumb_fixture` + `panel` visit, sending `[]` and `no_trades_confirmed: true`, leaves check 11 open for Plumber and Electrician, and closes once both walks are decided. The seed now decides real walks with reasons ("Confirm shower drain and sink connections", "Confirm kitchen circuits and bath GFCI", "Confirm bath exhaust route"). phone-49 shows "Trade walks: all decided ✓". (`electrical_panel` in the map isn't a module key. It is harmless.) |
| 3 | QA proof | **Mostly done.**<ul><li>(b) is covered: phone-17 shows the unknown-year path.</li><li>(c) Done in substance. The Complete visit's numbers and choices are real, its flags are decided (13) and its trade walks are decided. Its text answers are one placeholder sentence, which shows up as room names and as "Permit authority — city/township" (owner-desktop-47-1). That is a QA-fixture look, not a defect; see E3.</li><li>(d) Done. phone-43 shows a fresh phone after reopen → ✓ Complete 325/325, and phone-43d shows the same phone → ✓ Complete. phone-43c shows a refusal → "Not closed yet", the plain conflict line, and Reload.</li><li>(a) Still not on screen: w320-22b is again scrolled past the Closing script. The skipped-date close → Joe's undated "Set the formal estimate date and tell {client}" to-do is covered by `consult-r6-backend.test.mjs`, so I'm moving the screen to an extra (E4).</li></ul> |
| 4 | Certification warning | **Done.**<ul><li>phone-17bb, under the expiry field: "⚐ Dana Kowalski's renovator certification runs out Mar 1, 2027 — before the planned finish, Jun 30, 2027. Renew it or put another certified renovator on the job." It is plain, names the person, gives both dates and says the next step.</li><li>phone-17c (Before you wrap) shows the same line on the calm card. It is not shown after 1965 + No (17e, `rrp_lines: []`), because `certificationWarnings` is gated on the RRP rule.</li><li>The firm line reads "SJC's firm certification runs out … Renew it before then."</li><li>Joe sees the line calmly on the look-over, on the close card and under the Era expiry field, and it never blocks the close.</li></ul>On the law: certification has to stay current while the renovation work is going on (§745.89(a), §745.90(a)–(b)). An advisory at visit time, and not a close block, is the right weight. |

R10 extras:
- **E1. Done in code; the counsel record is missing a line.** The client screen (w320-24b) and the text recap now both read "Joe will be in touch to tell you when you'll have your formal estimate." That matches the spoken staff line. But the client initials this screen, and the line is not in the counsel block (`approved-content.ts` 704–710). Only a code comment flags it. See Fix 3.
- **E2. Done.**
  - Replace adds "Same spot? Ask the inspector whether it has to meet 24″."
  - The disagreement line ("Toilet plan says Keep, but the fixture says {plan} — fix one.") is in place.
  - The doubled "24″" is gone. phone-29c reads "Measured 20″ — in front of the toilet, a new toilet needs at least 24″ (Minnesota plumbing code)." It is accurate, but the dash after the number reads oddly. See E1 below.
- **E3. Done.** `SQL RRP applicability agrees with captured-fact rule` pulls the predicate out of 0083 and checks it against `rrpFacts().applies` on all four fact sets.
- **E4. Done.** The warning shows under the Era expiry field (phone-17bb).
- **E5 (carried from R6). Still open, not blocking.**

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Yes.** This round closes the last gap that let a job be called Complete when it would have needed a second trip.

- **Trades come from the captured facts, not the device.**
  - Every kitchen has a sink (`plumb_fixture`), a `panel` and `hvac`. Every bath has `plumb_fixture` ×2 and `hvac`.
  - So a kitchen or bath can't close Complete until a Plumber, Electrician and HVAC walk-through has each been decided as needed or not needed, with a reason.
  - That's right for SJC: HVAC is often "not needed — fan only, existing duct to the roof cap". But someone has to say so in the home, not Joe at the desk.
- **Everything that prices the job is still captured.** Nothing was removed this round:
  - the measurements:
    - 1/16″ cabinet runs per wall, island, sink base;
    - appliance cutouts, model status, voltage and amps;
    - fridge space;
    - toilet rough-in and per-bath clearances;
    - shower drain;
    - dishwasher opening height;
  - hood exit, route, joist direction, length, elbows and size;
  - the gas line location, shutoff and size when a range is gas;
  - countertop circuits;
  - soffit contents;
  - the basement ceiling under a moved sink;
  - selections.
- **A stuck reclose no longer waits unseen on the visitor's phone.**
  - A refused close sends a `close_failure` to-do to Joe:
    - right away for a non-transient refusal;
    - after 30 minutes of transient failures.
  - The next successful close marks it done.
  - The device keeps retrying with backoff.
  - That is what R10 asked for. The wording of that to-do is Fix 2.
- **Bath electrical (optional, E2).** A bath gets an Electrician walk-through decision only when it has floor heat or a missing dedicated 20 A circuit. That's defensible: most electricians price a bath fan, vanity light and GFCI from photos. It is listed below in case Joe wants it always asked.

## Minnesota checks

- **Frost (Minn. R. 1303.1600).** Unchanged and right: Zone I 60 in, Zone II 42 in (the metro included), and the city's requirement can be edited.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)).** One-party consent. The consent script is unchanged and settled.
- **Electrical permits.** The hint is accurate: "Most cities use the state (DLI…). A few, like Minneapolis and St. Paul, inspect their own."
- **RRP (40 CFR 745):**
  - **Applies (§745.82, §745.83 minor repair).** Unchanged and right. The SQL and TS copies are now tied by a test.
  - **§745.84(a)(1), 60-day window.**
    - Right in both directions: the start already set at close, and the start changed afterward.
    - `start − visit day > 60` is the right comparison ("no more than 60 days before beginning renovation activities").
    - The to-do title is plain and complete.
    - The one gap is the early bound on a picked day (Fix 1).
  - **§745.84(a)(1) mailing.** "Mail it with a certificate of mailing at least 7 days before work starts" is right. The due date of `start − 7` is the last day to mail, so it's tight; see E5.
  - **§745.89 / §745.90.**
    - A certification that isn't current on the later of the visit day and the start day is still a close block.
    - Expiry before the planned finish is now the plain advisory.
    - Right.
- **Plumbing clearances (Minn. R. 4714.0402.5).** All right:
  - 24″ in front of the toilet;
  - 15″ from the centre to each side;
  - 30″ centre to centre.
  - Keep and stay gets the calm advisory; Move, Replace and New get the code line.
  - The Replace line now tells the visitor to ask the inspector about a same-spot swap. That is the honest answer, since enforcement varies.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

- **Staff no-date line 2, Joe no-date line, staff line 2 and 2b, unknown-year pamphlet line:** unchanged since R10, and accurate.
- **Client screen and recap Next line with the date skipped (new):** "Joe will be in touch to tell you when you'll have your formal estimate." It is clear, matches the spoken line and promises no date. It needs to go into the counsel list (Fix 3).

---

## Required fixes (numbered)

1. **Keep a picked re-delivery day inside the 60-day window (40 CFR 745.84(a)(1)).**
   - **Files:**
     - `db/migrations/0085_…sql` (new; replaces `consult_reconcile_rrp`);
     - `lib/consult/protocol.ts` `close()` line 361;
     - `components/consult/field/WrapClose.tsx` line 226.
   - **Problem:**
     - 0083 sets the due date to `least(start − 7, picked day)`. The date input has no bounds.
     - Example: start 2027-02-01 and a visitor picks 2026-11-20. The re-delivery to-do comes up on Nov 20, 73 days before the start. A pamphlet given that day is again too early, and the to-do is marked done, so nothing asks again.
     - `close()` also files the visitor-picked to-do as "Re-deliver Renovate Right", which loses the initials or mailing instruction.
   - **Change:**
     - In the reconcile, use `due = greatest(start − 60, least(picked day, start − 7))` at 00:00 Central.
     - In `close()`, file the to-do with the full 0083 title: "Renovate Right: give it again — work starts more than 60 days after the visit. Get the owner's initials, or mail it with a certificate of mailing at least 7 days before work starts".
     - When the start is known, set `min = start − 60` and `max = start − 7` on the "Re-deliver on" input. Add the hint: "Pick a day from {start − 60} to {start − 7}. Earlier than that is too early to count."
     - When the start is unknown, keep the input open. The reconcile clamps the day once the start is set.
   - **Test:**
     - start 2027-02-01 with picked day 2026-11-20 → due 2026-12-03;
     - picked day 2027-01-28 → due 2027-01-25;
     - picked day 2027-01-10 → due 2027-01-10.

2. **Joe's stuck-close to-do in plain words, with the next step.**
   - **Files:** `lib/consult/protocol.ts` (`report_close_failure`, around line 482) and `lib/consult/ui/words.ts`.
   - **Problem:**
     - The title is built from the raw code: "Abigail Stafki's visit for Michael Larson hasn't closed — conflict", or "— close_timeout" or "— manifest_sequence_gap".
     - Joe can't act on a code. The visitor's screen already has a plain line for every code (`closeRefusal`), but Joe's to-do doesn't use it.
   - **Change:**
     - Map the code to an office-side line and put it in the title: "{visitor}'s visit for {client} hasn't closed — {line}". The lines:
       - conflict, stale_snapshot or evidence_conflict → "the office changed it since their device last checked; they need to reload and close again";
       - close_timeout → "their device couldn't reach the office for 30 minutes";
       - manifest_sequence_gap, manifest_blob_missing or manifest_initials_missing → "some answers or photos haven't reached the office";
       - device_access_denied or missing_device_manifest_required → "another device has this visit — move it or set that device aside";
       - an unknown code → "the office turned the close down; open the visit".
     - Keep the raw code in the audit payload, not in the title.
   - **Test:** `report_close_failure {reason:'conflict'}` → the title contains no underscore and doesn't end in the bare code.

3. **Counsel record: add the client-screen no-date Next line.**
   - **File:** `lib/consult/forms/approved-content.ts` (the counsel block, 704–710), and the same block in the plan.
   - **Problem:** the client initials the screen that now reads "Joe will be in touch to tell you when you'll have your formal estimate." (`W.nextFormalNoDate`, `clientRecapText`). The line changed after counsel's approval, but it is only flagged in a code comment in `client-summary.ts`.
   - **Change:** add "Changed after counsel's approval — confirm with counsel: client screen and recap, Next with no date: Joe will be in touch to tell you when you'll have your formal estimate." Drop the stray blank entry at line 707.
   - **Test:** extend the five-literals-once test to six.

---

## Optional extras

- **E1. Toilet line punctuation** (`flags.ts`). It reads "Measured 20″ — in front of the toilet, a new toilet needs at least 24″…". Use two sentences: "Measured 20″ in front of the toilet. A new toilet needs at least 24″ (Minnesota plumbing code)." Use "at its new spot" or "the replacement toilet" for Move and Replace, as now.
- **E2. Bath electrician decision.** Optionally derive Electrician for every bath where `bath_scope` changes the fan, lighting or vanity light. That way the walk-through question is always asked; the visitor can still answer "not needed — priced from photos".
- **E3. Realistic Complete fixture text** (`qa-seed-consult.mjs`). Give text fields answers by key:
  - room names "Kitchen" and "Hall bath";
  - permit city "Woodbury";
  - building inspector "City of Woodbury";
  - smoke/CO "Hall and each bedroom".

  Make the bath's fixtures toilet, vanity sink and shower, not three toilets. Then the owner look-over reads like a real job.
- **E4. Screen proof still owed from R10 3(a).** On the skipped-date visit, scroll the Closing script card into view (w320 and phone) so it shows staff no-date line 2 and 2b. Then show a ✓ Complete close and Joe's undated "Set the formal estimate date and tell {client}" to-do. phone-43c could also capture "Joe has been told this visit hasn't closed." when the report goes through.
- **E5. More room on the mailing deadline.** A re-delivery to-do due on `start − 7` is the last legal day to mail. Consider `start − 10`, still at least `start − 60`, so a one-day slip doesn't break the 7-day mailing rule. In-person initials still work up to the start day.
- **E6. Firm recertification lead time.** For the firm line, add: "Apply at least 90 days before it runs out so it doesn't lapse" (§745.89(b)(1)).
- **E7. Stuck-close noise.** Conflict and stale_snapshot are usually fixed by the visitor with Reload. Consider reporting them to Joe after the same 30 minutes as transient codes, not right away.
- **E8. Carried from R6:**
  - bath fixtures listed with their bath;
  - a sink-base "soft, stained or wet?" choice next to the Sink base open photo;
  - a hint on `flooring.worst_dip` for large-format tile flatness (about ⅛″ in 10 ft for tile with an edge over 15″);
  - the printed name and date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
