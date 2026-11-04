# Build R8 — Contractor / Minnesota domain judge (in-home consult)

SCORES: design=8 completeness=8

**What I read:**
- My round-7 review (`build-consult-r7-domain.md`). I checked items 1–7 and the extras.
- `git show a4dcce49 a75e8e71 44c52288`.
- `lib/consult/forms/seed/{shared,template-modules,scripts}.ts`, `lib/consult/forms/approved-content.ts`,
  `lib/consult/ui/words.ts`.
- `lib/consult/{rrp,flags,completeness,protocol}.ts`, `lib/consult/ui/model.ts` and
  `components/consult/field/VisitScreen.tsx`, for the close, the Renovate Right and the closing-script paths.
- The plan's closing addendum (lines 2906–2908).
- Screenshots in `/tmp/sjcqa/shots/consult-r8/`:
  - w320-21, 22, 22b, 22c, 24b and 29b;
  - phone-17/17b/17c/17d, phone-18b, phone-19b/19c, 29c and 29e;
  - phone-40/41, phone-42 and owner-desktop-44;
  - `log.json` `rrp_lines`.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices" (w320-29b).
- Conflict buttons that show two device ids and no "this device" (phone-42). The script registers one device per width,
  so the phone that took the shot is neither side.
- The seeded Complete visit where every field is "Other — QA fixture".

---

## Round-7 items

| # | Item | Status |
|---|---|---|
| 1 | Skipped estimate date can't close | **Mostly done.** `promised_date` is nullable. Check 6 accepts "Joe sets the date" or "Other" with a note. `close()` files "Set the formal estimate date and tell {client}", undated. The row reads "Skipped · Joe sets the date · {note}" (w320-22b), and w320-29b no longer lists the date as open. **Still wrong:** the mark is "– N/A", and the field hint still says "Joe gets a to-do for this date." **New gap:** closing line 2 never becomes readable. See Fixes 2 and 3. |
| 2 | Renovate Right to-do deadline (§745.84(a)(1)) | **Done, but it brought a regression.** The title is right, and the to-do is due `start_date − 7`. **But** the same `start_date − 7` is now passed into `rrpFacts()`, which checks certification dates, so a certification that runs out in the last week before the start now counts as current. Re-dating an undated to-do once a start date is set was not built. See Fixes 1 and 5. |
| 3 | Toilet front clearance | **Done.** It has the measuring hint (phone-19b), the code line for a new toilet, a calm advisory card for Keep (phone-19c, 29e), and inches under 48″ ("20″"). One gap: a kept toilet that is moving still gets the advisory card. See Fix 4. |
| 4 | Skip-sheet help by field type | **Done.** On initials (w320-22c): "The client wasn't here to initial." / "The client chose not to initial. Write what they said." / "Needs a note." On the date (w320-22): "Joe gets a to-do to set the date and tell the client." |
| 5 | Staff closing line and the counsel record | **Done.** Line 2b now reads "Joe works from everything I measured today…", with no second "Joe prices". Line 2 is its own literal, `STAFF_CLOSING_LINE_2`, and a test pins both lines. All three changed lines are marked in the plan (2906–2908) and in `approved-content.ts`. See Extra E2. |
| 6 | Conflict picker shows both values | **Done.** "Pick 18″ · …" / "Pick 19″ · …" (phone-42). A side that can't be loaded is disabled. |
| 7 | QA proof | **Partly.** Captured: the 20″ Keep card (29e), and close after a skipped date with the date no longer open (w320-29b). **Still missing:** (a) a visit closed **Complete** after "Joe sets the date", with Joe's undated to-do; (b) the unknown-year Renovate Right line on screen (phone-17 has Year built empty, but the pamphlet field is off-screen); (c) opening card 6 (only cards 2–5 are in the set). See Fix 6. |

R7 extras: these are done.
- E1: "If Year built is wrong, change Year built instead." (phone-17d)
- E2: "not on file" (`rrp_lines`).
- E4: the calm Complete screen (phone-40).
- E5: the override issue text.
- E6: a seed test for the 1/16″ fields. It checks with a regex, not an exact list.

E3 (the Complete pill with the count of unmeasured quantities) is still open. See Extra E4 below.

---

## The kitchen-and-bath walk: can it be priced without a return trip?

**Yes.** Nothing that prices the job was removed or loosened this round. All of these are still there:
- room, wall and cabinet-run measurements, to 1/16″ on the cabinet layout;
- appliance cutouts;
- vanity wall vs. vanity width;
- toilet rough-in, side and front clearances;
- shower drain and threshold build-up;
- the wet-wall framing trigger for valve, niche and wall-hung;
- panel, water heater, hood and make-up air;
- vented appliances;
- structure and moisture;
- selections, with who buys each.

The new front-clearance hint ("From the front of the bowl to the nearest wall, vanity, tub or door swing") gives the
number a plumber would check. A skipped estimate date no longer blocks the close, so a staff visit can still close
Complete on its first trip.

## Minnesota checks

- **Frost (Minn. R. 1303.1600).** Unchanged and right: Zone I 60 in, Zone II 42 in, with the city requirement still
  editable.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)).** The consent script is unchanged and settled.
- **RRP (40 CFR 745).**
  - The 1978 boundary, the 60-day pamphlet window and the 6/20 sq ft minor-repair limits are unchanged and right.
  - §745.84(a)(1): the follow-up now says what the rule allows for an owner-occupied home. That is either the owner's
    written acknowledgment, or mailing with a certificate of mailing at least 7 days before the start. It is due 7 days
    before the start. Right.
  - **Regression.** `completion()` now calls `rrpFacts(..., start_date − 7)`. `rrpFacts` uses that date to require
    firm and renovator certifications to be current on the later of the visit date and the start date. With the
    7-day shift, a firm certification (§745.89) or renovator certification (§745.90) that expires up to 6 days before
    work starts passes check 8. The visit closes Complete, and the crew starts work with a lapsed certification. The
    7-day shift belongs only on the to-do's due date. See Fix 1.
- **Toilet clearances (Minn. R. 4714.0402.5, UPC 402.5).** 24″ in front, 15″ from center to each side and 30″
  center-to-center are right. The code line now applies to a new toilet and the advisory to a kept one, which is right
  for existing work that isn't being changed. But a toilet that moves is a new installation at the new spot, even if
  it's the same bowl. See Fix 4.

## Client-facing lines changed after counsel's approval (wording only; counsel confirms)

- **Staff line 2:** "Next, Joe prices this with our trade partners and suppliers. You'll have the formal estimate by
  {estimate_date}. It shows each part of the work, the allowances for the things you're still choosing, and what isn't
  included." Clear and plain. The only change is "I price" → "Joe prices". Good.
- **Staff line 2b:** "Joe works from everything I measured today, and he may call you with a question or two." Good.
  It no longer repeats "prices", and it sets the expectation of a call.
- **Unknown-year pamphlet:** "We don't know for sure the house was built in 1978 or later, so we give you this pamphlet
  about lead-safe work — it's called Renovate Right. Could you initial here that you got it?" Accurate, and it makes
  no claim about the house. "so we give you" is a little stiff when read aloud. See Extra E1.
- These three are on record in the plan. In `approved-content.ts` they sit in a `/* */` comment after the exported
  string, not inside `approvedFormContent`. See Extra E2.

---

## Required fixes (numbered)

1. **`lib/consult/protocol.ts:301` (`completion()`): certification check uses start − 7 days (40 CFR 745.89/745.90).**
   - **Problem:** the `rrpFacts` call selects `(start_date - 7)::text AS start_date`, so `firm_current` and
     `renovator_current` are checked against a day a week before work starts.
   - **Change:**
     - Go back to `SELECT start_date::text FROM projects WHERE id=$1` for `rrpFacts`.
     - Keep `start_date - 7` only on the Renovate Right to-do's due date at line 333.
     - Add a test: start 2027-03-10, firm certification expiring 2027-03-06 → `firm_current=false`, and check 8 open.
2. **Closing script › line 2 after "Joe sets the date": the visitor never gets a line to read.**
   - **Problem:** `VisitScreen.tsx:40` `needsDate()` is true whenever `model.promised` is null. So once the date is
     skipped, line 2 stays "→ Pick the estimate date below, then read this line." (phone-18b), and the visitor makes up
     their own words about the estimate.
   - **Change:**
     - When `closing.estimate_promised` is skipped with "Joe sets the date" or "Other" plus a note, show a no-date
       line 2 instead of the direction:
       - Staff: "Next, Joe prices this with our trade partners and suppliers. He'll call you with the date you'll
         have the formal estimate. It shows each part of the work, the allowances for the things you're still
         choosing, and what isn't included."
       - Joe's own version: "Next, I price this…" with "I'll call you with the date…".
     - Add both lines to `scripts.ts` as literals. Mark them in the plan and in `approved-content.ts` as "changed after
       counsel's approval — confirm with counsel".
     - The client view already reads "Joe sends your formal estimate." (w320-24b). Keep it.
3. **Closing › Formal estimate promised by, when skipped (w320-22b): the mark and the hint are wrong.**
   - **Change:**
     - When the skip reason needs no assumption ("Joe sets the date", "Client absent", "Client declined"), show
       "– Skipped" on the right, not "– N/A". The comment at `FieldRow.tsx:281` ("the mark on the right already says
       N/A") is the thing to change.
     - While skipped, replace the hint "Joe gets a to-do for this date." with "Joe gets a to-do to set the date."
4. **Bathroom work › Toilet front clearance: a kept toilet that moves.**
   - **Problem:** `flags.ts` makes the flag advisory whenever `toilet_plan === 'Keep'`, even when the toilet's
     `plumb_fixture.plan` is Move.
   - **Change:**
     - Use the advisory only when `toilet_plan = Keep` **and** the toilet fixture's plan isn't Move.
     - A kept toilet that is moving gets the code line: "Less than 24″ in front of the toilet — at its new spot it needs
       at least 24″ (Minnesota plumbing code)."
     - Add a test for each case.
5. **Renovate Right follow-up to-do: re-date it when the start date is set (carried from R7 Fix 2).**
   - **Problem:** with no start date at close, the to-do is filed undated and stays undated. Nothing then warns Joe
     7 days before the start.
   - **Change:** when `projects.start_date` is set or changes, set `due_at` to `start_date − 7` on any open consult
     `rrp/delivery` to-do for that project.
     - Use a trigger or the existing start-date write path.
     - Per the scheduling rule, a later `due_at` snoozes the to-do until that day.
6. **QA proof still owed:**
   - (a) A visit closed **Complete** after "Joe sets the date", following Fix 2, showing:
     - the no-date line 2;
     - the close result;
     - Joe's undated "Set the formal estimate date and tell {client}" to-do.
   - (b) Era hazards with Year built empty and the pamphlet field in view, showing the unknown-year line. Then with
     Yes, showing the "Because the house was built before 1978…" line.
   - (c) Opening card 6.
   - (d) A test for Fix 1's certification boundary.

---

## Optional extras

- **E1. Unknown-year pamphlet wording, for counsel to consider.** "We're not sure the house was built in 1978 or later,
  so we're giving you this pamphlet about lead-safe work. It's called Renovate Right. Could you initial here that you
  got it?" It means the same and reads more easily aloud. It's for counsel to confirm either way.
- **E2. `approved-content.ts`.** Move the "changed after counsel's approval" lines from the trailing comment into
  `approvedFormContent`, in a short "Changed since approval — confirm with counsel" section. That way the counsel copy
  generated from this file includes them.
- **E3. Kept-toilet card wording (29e).** "Joe decides whether it needs to change" sits above four choices the visitor
  must pick. Use instead: "…It's staying where it is. Pick 'Not an issue' if it stays, or 'Price it' if the client
  wants it moved." Also use ″, not ", in the flag hint (phone-19b shows 20″ next to 24").
- **E4. The Complete pill with no quantities (R7 E3).** Still worth doing: "Complete · N estimate quantities not
  measured" on the office pill and on phone-40.
- **E5. The 1/16″ seed test.** Assert the exact list of fields, not `/kitchen|flooring/`, so a new kitchen field can't
  silently get 1/16″.
- **E6. Carried from R6.** These are still open:
  - bath fixtures with the bath;
  - the sink-base moisture question;
  - tile subfloor and large-format flatness;
  - the client's printed name and the date with the Renovate Right initials, kept 3 years under §745.86 (for counsel).
