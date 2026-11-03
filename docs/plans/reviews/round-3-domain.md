# Round 3 — Contractor & legal judge
SCORES: sub-agreements design=10 completeness=10 | discovery-call design=10 completeness=9 | in-home-consult design=10 completeness=10

Lens unchanged from rounds 1–2: would a seasoned remodeling owner/estimator and a Minnesota
construction attorney call this content complete and right? Re-checked 2026-11-02 on
revisor.mn.gov:
- **326B.805.** Subd. 1: a remodeler needs a residential remodeler or building contractor license. A roofer needs a roofer, building contractor or remodeler license. Subd. 6(5) is the $15,000 exemption, and it needs a certificate of exemption obtained by affidavit. Subd. 6(8) is the one-special-skill exemption.
- **Minn. R. 1346.0501.** § 501.4.3 items 4–5: exhaust over 300 cfm uses Table 501.4.3(1) for homes built 1994 or later and Table 501.4.3(2) for homes built before 1994. Columns A–D are set by power/direct vent, fan-assisted, one atmospheric or solid-fuel appliance, or several.

The 337.10, 325E.66 and 626A.13 checks carry over from round 2. I am not counsel. Items properly
deferred to the attorney are not held against any score.

Every round-2 required item is fixed in the plan text. One new error is left, in the discovery
consent matcher, and my own round-2 regex caused it.

---

## 1. Sub agreements (`sub-agreements-plan.md`)

### Round-2 items

| # | Status | Note |
|---|---|---|
| 1 — 337.10 unlinked pay-by fallback | FIXED | §13 starts the 10-day clock at the earliest settled client payment on or after the day the work was done, using the earlier of the invoice date and the recorded completion date. It never waits for the invoice. A known partial-work payment caps the date, linking a draw can't push a known deadline later, and a guard sentence says the date can never be later than subd. 3 allows. The "estimated" bill label is there. Scope form §5 milestone text matches ("first client payment on/after work done — estimated until draw linked"). `tests/sub-pay-by.test.mjs` names "client draw received before the sub invoices", plus partial-work and missing-metadata cases. |
| 2 — 326B license table + exemptions | FIXED | Roofing row: roofer, remodeler or building contractor, subd. 1. General row: remodeler or building contractor if two or more special skills; otherwise one special skill (6(8)) or ≤ $15,000 with the DLI certificate of exemption number (6(5)). Cl. 18 and counsel q.6 now cite subd. 1 and 6, and both exemption routes are in q.6. Wording matches the Revisor text I re-read today. |

Joe's three asks are still met exactly:
- **Scope defined:** cl. 3, plus Included / Not included with a named "by others".
- **Changes go to Joe first:** cl. 6, rules 2–3, §8.5.
- **Every upsell named to the client as an upsell:** cl. 7, rule 4, and the client document title "Upsell — optional addition". The sub can't be approved before the client accepts.

The new round-3 "SJC absorbs this — no client price change" path (§8.5 step 5, §9.H) applies only
to *required* work and still needs Joe's lump sum and days. That is a correct Joe's-written-OK, and
it doesn't let an upsell skip the client. The "Client declined" closed state is right.

### New issues
None that block. Optional, not required: §16 keeps signed records "at least 10 years after job
completion". Counsel may want this keyed to the 541.051 repose period, which is 10 years from
substantial completion plus up to 2 years for a defect found in years 9–10. It is already marked
"counsel confirms".

### Required to reach 10
(none)

---

## 2. Discovery call (`discovery-call-plan.md`)

### Round-2 items

| # | Status | Note |
|---|---|---|
| 1 — Consent matcher: "no problem" = yes | FIXED as asked; see New 1 | §5.1 step 5 strips "no problem", "not a problem", "no worries", "don't mind", "no, (that's) fine" and "no, go ahead" (comma optional) before the negative match. Ambiguous pauses without discarding, and Joe's tap is bound to the segment id/revision. The test list includes "yeah no problem", "not a problem", "I don't mind", "no worries", "no that's fine" and "no go ahead". |
| 2 — 325E.66 insurance warning | FIXED | §3.2: the on-screen line for Joe, the deductible-rebate and public-adjuster bans, and one idempotent to-do for the subd. 1(b) written notice. It carries into estimate preparation, not just the summary, and counsel supplies the wording. |
| 3 — Single retention table with the 2-year consent clip | FIXED | §14 is titled single source and says consult §8.3 carries no copy. Values are 2 years for the consent clip (its own restricted record, one per participant/resumption), 90 days for audio and 180 days for text, all from capture end. Raw payloads go 30 days after reconcile. Backups age out in ≤90 days, and the device-cache row is there. The unlinked-call special case is gone because one clock now applies to everything. The plan correctly adds that 626A.13 subd. 5 runs from discovery, so two years is not a guarantee, and legal hold covers disputes. That is better than my wording. Both retention tests assert the same values from one fixture. |

Joe's ask still holds. The nine rows are exactly his, in any order, and the checklist measures
coverage only. Joe is never scored. Reminders fire only on a genuine skip, and the summary shows
covered vs missed.

### New issues
1. **The consent matcher records some refusals as a "yes" (§5.1 step 5).** This is false
   *consent*, the unsafe direction. The positive list includes `fine`, `okay` and `ok`. The negative
   list has `no`, `nope`, `don't`, `not okay`, `rather not` and `stop`, but not a bare `not` or a
   `-n't` contraction (`\bno\b` does not match "not"). So:
   - "That's **not ok**" → positive `ok`, no negative → **affirmative**. Evidence is set and AI analysis starts.
   - "That **isn't okay**", "that's **not fine**", "I'm **not** really okay with it" → **affirmative**.

   A recorded refusal saved as consent evidence is exactly what an attorney would strike. (Minnesota
   one-party consent still covers Joe, but the plan's own reason for recording the yes is out-of-state
   callers and proof.) This came from the regex I wrote in round 2.

### Required to reach 10
1. **§5.1 step 5 — replace the negative pattern and extend the test list:**
   > "…negative then matches `\b(no|nope|not|never|don't|do not|isn't|ain't|wouldn't|won't|can't|rather not|prefer not|stop)\b` or any remaining `n't` contraction (stripping runs first, so 'not a problem' and 'don't mind' are already gone)."

   Add to `tests/call-consent.test.mjs`: "not ok", "that's not okay", "that isn't fine",
   "I'm not okay with that", "I'd prefer not", "never" → **not** affirmative. Positive + negative →
   ambiguous (pause, Joe picks). "Not at all" → ambiguous is acceptable, because it fails safe to
   Joe's tap.

---

## 3. In-home consult (`in-home-consult-plan.md`)

### Round-2 items

| # | Status | Note |
|---|---|---|
| 1 — Makeup-air venting inputs | FIXED | `hvac` now has a row per appliance with fuel and venting: atmospheric (draft hood/open flue) / fan-assisted / power-vent / direct-vent sealed / solid fuel / none, plus a flue photo for each. Also the dryer (vented / ventless / none), other exhaust fans with label cfm, and a derived "built 1994 or later" that picks Table 501.4.3(1) vs (2), with unknown year → the conservative table. The hood ⚑ is the exact text I asked for. `water` points gas heaters to the venting row. §8.2 lists the same inputs. I checked the table numbers and the A–D columns against 1346.0501 today, and they match what the form captures. |
| 2 — Tempered-glass cases | FIXED, beyond the ask | `window` adds Large pane (R308.4.3, all four conditions) and Near stairs (R308.4.6 within 36″ / R308.4.7 bottom landing with the 60″ arc, both requiring the bottom edge under 36″). `door` adds glass in or beside the door (R308.4.1/.2) plus the same two fields for sidelights and transoms. `openings` carries all of them, required on every replaced unit. §8.2 cites each one and says the supplier/AHJ confirms exceptions. The "within 24″ of a door edge" check leaves out R308.4.2's "bottom under 60″" condition. That flags too many, not too few, so it is safe for pricing. |
| 3 — §8.3 retention points to discovery §14 | FIXED | The consult table and the wrong "discovery already says 90/180" sentence are gone. §8.3 now maps every consult storage target to one §14 row and one purge-graph bullet: clips, chunks, quarantined audio, segments, quotes, rejected AI, payloads, Open Brain, answers, photos, device IndexedDB, the SW cache (assets only), signed links and backups. There is no consult sweeper, clock or hold table, and the test asserts the §14 values from the shared fixture. |
| New 4 (r2) — consent clip within 626A window | FIXED | Clip stored at once under §14's two-year consent-evidence row, one per participant/resumption, separate from the 90-day audio. |
| New 5 (r2, non-blocking) — long door script | Addressed | Kept truthful, with a note that counsel may shorten it to "details are on our privacy page" for one notice across both plans. Acceptable. |

**The two partial declines — I agree with both.**
- *No "✓ Answered" word.* Discovery §6.0 is the owner of the coverage words and forbids Answered as a mark. One vocabulary across Calls and the consult is more important than a second synonym. From the field and legal side nothing is lost: ✓ Covered on a field means the same thing.
- *No consult device-cache sentence in §8.3.* The §14 table I asked discovery to adopt includes a "Device cache (consult only)" row: 30 days after server acknowledgement, deleted on reconnect, unsynced work never ages away silently. §8.3 maps the device's IndexedDB to that row. Repeating the number in §8.3 would bring back the two-copies problem round 2 was fixing. The decline is correct.

Joe's ask still holds. The visit comes after the pre-con agreement and the signed rough estimate.
There are questions and measurement forms for bath, kitchen, addition, basement, deck, whole-home,
general and add-ons, and completion tracking that checks the record, not the person. Scripts work
for Joe or staff on a tablet or phone. The consult uses discovery's unknown-speaker path: the
visitor picks the recorded answer in playback and taps it. So the discovery matcher bug above does
**not** reach the consult.

### New issues
None that block. Optional: on an insurance-funded job, a staff visitor is the person most likely to
offer to "talk to the adjuster". A one-line ⚑ in `house` or the closing script repeating
discovery's § 325E.66 warning (pulled from `paying_with = insurance`) would help. It isn't
required: the notice to-do already rides with the estimate, and insurance work is a small share of
SJC's remodel mix.

### Required to reach 10
(none)

---

## Cross-plan

1. **Retention: closed.** There is one table, in discovery §14. The consult maps every target to it without a copy, and the sub plan keeps its separate legal-record policy for signed paperwork without duplicating recording retention.
2. **Consent pattern: closed.** The consult uses discovery §5's words and buttons verbatim. The unknown-speaker manual attestation keeps the consult safe from the matcher defect (discovery New 1). When that regex is fixed, no consult change is needed.
3. **Consult → sub scope: closed.** `consultScopeFacts` v1 has a shared fixture. RRP era and permit authority pre-fill the license/permit rows. The upsell vs required-work labels carry through from the consult to the Pre-con change / change order to the sub scope, and before the contract it is never a change order.
4. **Glazing and makeup air flow to subs: closed.** The new `hvac` venting rows and tempered-glass flags are consult facts the HVAC sub and window supplier price from, and they arrive in the sub scope through the same export.
5. **Same words and targets: closed.** CoverageMark is discovery-owned. Hand-back is "hold 2 seconds" or Use PIN in both the sub and consult plans. The 48/56 px rule is everywhere.

Sources checked this round: [326B.805](https://www.revisor.mn.gov/statutes/cite/326B.805),
[Minn. R. 1346.0501](https://www.revisor.mn.gov/rules/1346.0501/). Carried from round 2:
[337.10](https://www.revisor.mn.gov/statutes/cite/337.10),
[325E.66](https://www.revisor.mn.gov/statutes/cite/325E.66),
[626A.13](https://www.revisor.mn.gov/statutes/cite/626A.13). Still flagged for counsel:
181.723, 514.02/.011, 327A.02, 176.215, 337.05, 326B.46, 299F.51, 1322 R-values and bath-exhaust
minimums, 40 CFR 745 and MDH RRP status, MDH asbestos rules, recording notice and retention values.
