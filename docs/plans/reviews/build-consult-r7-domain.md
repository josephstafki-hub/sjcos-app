# Build R7 — Contractor / Minnesota domain judge (in-home consult)

SCORES: design=8 completeness=8

**What I read:**
- My round-6 review (`build-consult-r6-domain.md`). I checked items 1–9.
- `git show 94e670cc 80a679eb 23d720f8`.
- `lib/consult/forms/seed/{shared,template-modules,templates,scripts,helpers,flag-hints}.ts` and
  `lib/consult/forms/approved-content.ts`.
- `lib/consult/ui/{words,model,flag-lead}.ts`, `lib/consult/{completeness,protocol,client-summary}.ts` (the close and
  evidence paths), `components/consult/field/{SkipSheet,FieldRow}.tsx`.
- The plan's script and RRP sections.
- Screenshots in `/tmp/sjcqa/shots/consult-r7/`:
  - phone-05b and 06-2…5, phone-17/17a–e, phone-19/19b, 29c and 42-conflict-picker;
  - phone-41/43-complete and owner-desktop-44b-complete;
  - tabletP-18b;
  - w320-20b, 22, 22b, 22c, 24b and 29b;
  - the `rrp_lines` entries in `log.json`.

**What I ran:** nothing. No servers, builds, browsers, DB access or tests.

**Harness artifacts I ignored:**
- "N other devices".
- The seeded Complete visit, where every field is "N/A · Other — assumption written".
- Section names in the seeded look-over that read "one per wall with cabinets, clockwise from the entry: A, B, C, D 1".
  `scripts/qa-seed-consult.mjs:42` uses the requirement's `label` (which is really a note) as the instance label. The
  app itself names these "Kitchen wall 1", as on tabletL-07b.

---

## Round-6 items

| # | Item | Status |
|---|---|---|
| 1 | Built before 1978? shown Open while the logic used the year | **Done.** phone-17a shows "● No · From Year built (1985)", marked Covered with "Change it if that's wrong." The server's `completion()` counts the prefill the same way the screen does. |
| 2 | Override reason worded for the unknown-year case | **Done on screen.** The label is now "How do we know it was built in 1978 or later?" (phone-17d) and the flag hint matches. The seed `issue` string still says "Year and pre-1978 answer disagree". See Extra E5. |
| 3 | Renovate Right unknown-year line | **Done in code.** The condition is now `year not a number AND before_1978 ≠ Yes`. The text says "1978 or later". `LEAD_SAFE_PAMPHLET.unknown_year_text` matches. Not captured on screen; see Fix 7. |
| 4 | Walk-through summary read-only | **Done.** It shows as "What the client initialed / Filled when the client initials." The server refuses `capture_answer` on `closing.summary` (`summary_read_only`). The text the client was shown is also saved when initials are skipped (`summary_text` on the skip), which covers my R6 Extra E7. |
| 5 | Skip reasons by field type | **Partly done.** The lists are right (w320-22, 22c), and the server checks them (`invalid_skip_reason`). **But a skipped date can never close the visit, and the help and status wording are wrong. See Fixes 1 and 4.** |
| 6 | Staff closing line 2 | **Partly done.** Line 2 now reads "Next, Joe prices this…" (tabletP-18b). The next line still opens "Joe prices the estimate…", so the client hears "Joe prices" twice in a row. The approved-content file was not updated either. **See Fix 5.** |
| 7 | `len`/`pair` default back to ⅛ | **Done.** The helpers default to 0.125. Only the kitchen layout fields (walls, runs, sink base, island, cutouts) and worst dip are 1/16. No seed test lists them; see Extra E6. |
| 8 | Opening card 4b said the photo line twice | **Done.** phone-06-opening-card-4 shows the line once, then "Photos okay?". |
| 9 | QA proof | **Mostly captured.** `log.json` `rrp_lines`: 1985 + Yes gives "Renovate Right: receipt not recorded · firm certification not current · renovator certification not current". 1965 + No with a reason gives no RRP row. The skipped date and the client view are captured (w320-22b, 24b). **Still missing:** opening card 6 (only cards 1–5 were captured), the unknown-year pamphlet line, and a close after a skipped date. See Fix 7. |

---

## The kitchen-and-bath walk: can it be priced without a return trip?

Yes, nothing was lost this round. These are all still there:
- room, wall and cabinet-run measurements (1/16 on the cabinet layout);
- appliance cutouts;
- vanity wall vs. vanity width;
- toilet rough-in and clearances;
- shower drain and threshold build-up;
- panel, water heater, hood and make-up air;
- vented appliances, created on the spot;
- structure and moisture;
- the selections, with who buys each.

New and useful:
- The flag card now leads with the number that tripped it: "Measured 20″ — less than 24″ in front of the toilet"
  (phone-29c). A typo can now be caught before it gets priced.
- The two-device conflict on "Narrowest door or turn on that path" carries the delivery-path flag ("Check that a new
  tub or cabinets fit through here"). That is the right check for a 60″ tub or a tall pantry.

## Minnesota checks

- **Frost (Minn. R. 1303.1600).** Unchanged and right: Zone I 60 in, Zone II 42 in. There's no silent default.
- **Recording (Minn. Stat. 626A.02 subd. 2(d)).** The consent script is unchanged and settled.
- **RRP (40 CFR 745).**
  - The 1978 boundary is now right everywhere ("1978 or later").
  - The prefill and the gate agree.
  - The 60-day pamphlet window and the 6/20 sq ft minor-repair limits are unchanged and right.
  - **One gap is new this round.** A Renovate Right initials skip with "Client absent" or "Client declined" now
    counts as a receipt exception and files "Deliver Renovate Right before work starts", due on the job start date.
    For an owner-occupied home, §745.84(a)(1) allows only two proofs: the owner's written acknowledgment, or a
    certificate of mailing at least 7 days before the work starts. The "renovator certifies delivery" route is only
    for tenant units (§745.84(a)(2)). A to-do due on the start day is too late to mail it. See Fix 2.
- **Toilet clearances (Minn. R. 4714, 402.5).** 24″ in front, 15″ from center to each side and 30″ center-to-center
  are right. The flag fires on any toilet plan, including "Keep". Whether it applies depends on whether the toilet is
  new or moved. The field also doesn't say what to measure to. See Fix 3.

---

## Required fixes (numbered)

1. **Closing › estimate date: a visit with "Joe sets the date" can never close Complete, and the skipped row has the
   wrong words.**
   - **Problem:**
     - `evidenceSchema.promised_date` is `day` (not nullable) in `protocol.ts:24`.
     - `consultCompleteness` check 6 requires `validDate(promised_date)`.
     - `buildEvidence` sends `promised_date: model.promised`, which is null after the skip.
     - So the evidence write is refused, or check 6 stays "Estimate date — not yet", on every visit where the
       visitor honestly didn't know Joe's date. The QA run never closed that visit: w320-29 is from the other
       visit, which had a date.
     - w320-22b shows "N/A · Joe sets the date — assumption written · …". The date isn't N/A, and no assumption was
       asked for.
   - **Change:**
     - Make `promised_date` nullable in `evidenceSchema`.
     - In check 6, count the date as done when `closing.estimate_promised` is skipped with "Joe sets the date", or
       with "Other" plus a note. Pass that skip into `CompletionInput`.
     - On close with no date, file Joe's to-do with no due date: "Set the formal estimate date and tell {client}".
       Keep "Prepare promised formal estimate" for when a date exists.
     - `FieldRow.tsx:275`: when the skip reason needs no assumption ("Joe sets the date", "Client absent", "Client
       declined" on a signature), show "Skipped · {reason} · {note}". Use the neutral mark, not N/A, and never say
       "assumption written".
     - Add a test: skip the date → hand back → close → Complete, with Joe's undated to-do.
2. **Era hazards › Renovate Right initials skipped: the follow-up to-do has the wrong deadline and doesn't say how
   to deliver it (§745.84(a)(1)).**
   - **Change:**
     - In `close()`, when `receiptException` is set, make the to-do due **7 days before** `projects.start_date`, or
       undated when there's no start date.
     - Title it: "Renovate Right: get the owner's initials, or mail it with a certificate of mailing at least 7
       days before work starts".
     - If no start date is set yet, file it undated and re-date it when `start_date` is set.
3. **Bathroom work › Toilet front clearance: say what to measure, and word the flag for the toilet plan.**
   - **Change:**
     - Add a hint: "From the front of the bowl to the nearest wall, vanity, tub or door swing in front of it."
     - When `toilet_plan` is New standard, Comfort height or Wall-hung, or the toilet moves, keep the flag hint:
       "Less than 24″ in front of the toilet — a new toilet needs at least 24″ (Minnesota plumbing code)."
     - When `toilet_plan = Keep`, show instead: "Less than 24″ in front of the toilet. It's staying where it is,
       so Joe decides whether it needs to change."
     - Show the field value in inches under 48″, as the flag card does: 20″, not "1′ 8″" (phone-19b). Clearances
       and door widths are spoken in inches.
4. **Skip sheet › Client declined: the help text is wrong on signature fields.**
   - **Problem:** w320-22c shows "Client declined — Needs a written assumption or exclusion if it prices the
     job." No assumption is asked for there.
   - **Change:** on signature fields use:
     - Client declined: "The client chose not to initial. Write what they said."
     - Client absent: "The client wasn't here to initial."
     - Other: "Needs a note."

     On estimate_promised, make "Joe sets the date" read: "Joe gets a to-do to set the date and tell the client."
5. **Closing script (staff) and the approved-content record.**
   - **Change:**
     - Change `STAFF_CLOSING_LINE` to "Joe works from everything I measured today, and he may call you with a
       question or two." That stops "Joe prices" appearing twice.
     - Write the staff line 2 as its own literal in `scripts.ts`, not `.replace()`, which does nothing without
       warning if line 2's wording ever changes. Add a test that checks the exact staff line 2.
     - Add the staff line 2 and the unknown-year Renovate Right line to `approved-content.ts` and the plan, marked
       "changed after counsel's approval: one word / new variant — confirm with counsel". The settled decision is
       that counsel approved the scripts, so wording that differs from what they approved has to be on record for
       them.
6. **Conflict picker: "Pick · this device" shows no value (phone-42-conflict-picker).**
   - **Problem:** the visitor has to choose between two door widths without seeing one of them.
   - **Change:** show both values in inches: "Keep 18″ · office" and "Keep 16½″ · this device". If this device's
     value is empty or cleared, say "Keep blank · this device".
7. **QA proof still owed:**
   - A visit closed after "Joe sets the date", following Fix 1: the close result and Joe's undated to-do.
   - Opening card 6 ("anything you want to make sure we look at today?").
   - Era hazards with Year built left empty and "Built before 1978?" = No (or unanswered), showing the
     unknown-year Renovate Right line. Then with Yes, showing the "Because the house was built before 1978…" line.
   - The 20″ flag card with Toilet plan = Keep, following Fix 3.

---

## Optional extras

- **E1. Year built vs. the override (phone-17d).**
  - A 1965 house set to No because of "the 1981 building permit card" may be a permit for an addition or a remodel,
    not for building the house.
  - Under the reason box, add: "If Year built is wrong, change Year built instead."
  - In the office look-over, show both values side by side: "Year built 1965 · Built before 1978? No — {reason}".
- **E2. RRP short words.** "firm certification not current" shows on a visit where nobody has entered it yet. Use
  "firm certification not entered or expired", and the same for the renovator.
- **E3. Complete with no quantities.**
  - The seeded Complete visit shows every estimate feed as Open (floor tile area, cabinet run, countertop area).
  - Under the settled no-owner-review rule that's allowed. But the office pill should say so: "Complete · 7
    estimate quantities not measured". Joe then knows before he opens the estimate.
- **E4. A Complete visit opened on a device (phone-41/43).** It shows a red "Not ready / Problem". Show "Complete —
  answers locked · Reopen in SJC OS to change" in a calm style instead.
- **E5. The year-override flag `issue` (`shared.ts`).** It still says "Year and pre-1978 answer disagree". Make it
  "Pre-1978 answer is No — write how we know it was built in 1978 or later", so the office text matches the screen.
- **E6. A seed test listing the 1/16 fields.** It was asked for in R6 Fix 7 and is still missing.
- **E7. Carried from R6.** E1 (bath fixtures with the bath), E3 (kitchen sink-base moisture question), E4 (tile
  subfloor), E5 (large-format tile flatness) and E6 (the client's printed name and the date with the Renovate Right
  initials, kept 3 years under §745.86; for counsel).
