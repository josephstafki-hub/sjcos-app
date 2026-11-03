# Round 1 — Contractor & legal judge
SCORES: sub-agreements design=8 completeness=7 | discovery-call design=9 completeness=8 | in-home-consult design=9 completeness=7

Lens: would a seasoned remodeling owner/estimator and a Minnesota construction attorney call this
content complete and right? Statutes checked 2026-11-02 against revisor.mn.gov (337.01, 337.05,
337.10, 514.02, 514.011, 327A.02, 181.165) and the DLI construction independent-contractor
handout (181.723, 14-factor test from 2025-03-01). Code references: Minn. R. 1309.0010 (MN Residential
Code = 2018 IRC as amended; IRC energy ch. 11 → Minn. R. 1322/1323, mechanical → **1346**, plumbing ch. 25–33 →
**4714 MN Plumbing Code, UPC-based**, electrical ch. 34–43 → 1315). Everything below still needs
attorney review where flagged. I am not counsel.

---

## 1. Sub agreements (`sub-agreements-plan.md`)

### What's strong
- Two layers (master + per-job Work Order) is how good small remodelers actually run subs. The
  Work Order's inclusions, exclusions and named "by others" interfaces are the cure for 90% of sub fights.
- Joe's three asks are met head-on: cl. 3 (only signed scope), cl. 6 ("discuss with Joe first", what
  counts as written OK, "looks good"/client yes/AI ≠ authorization), cl. 7 (exact upsell words the sub
  must say, required work ≠ upsell, client acceptance ≠ Joe's release).
- Indemnity/additional-insured are drafted the right way for MN. They are limited to the sub's own fault,
  with no coverage required for SJC's own negligence. That matches **337.02** and **337.05 subd. 1(b)**:
  a building-contract clause requiring a party to insure others for *their* negligence is void.
- Lien basics are right. Under 514.011 subd. 1, SJC gives the contractor's notice in its client contract.
  A sub gives its own notice within 45 days of first furnishing (subd. 2). Clause 15 bars waivers before
  payment, consistent with 337.10 subd. 2. The non-solicit is narrow and kept separate from a noncompete,
  so it doesn't run into the 181.988 ban.
- Phase 0 is honest. Attorney first, wet or PDF signatures this week, no fake client-portal signing,
  and to-do A isn't closed until real subs have signed.

### Wrong
1. **Payment timing hides the statutory 10-day clock (Minn. Stat. 337.10 subd. 3).** Every building
   and construction contract (337.01 subd. 2 is not limited to owner contracts or commercial work) is
   *deemed* to require payment to a sub within **10 days of the contractor receiving payment** for
   undisputed work. Late payment carries **1½%/month interest**, with a $10 monthly minimum on balances of
   $100 or more, and the sub may suspend work. Cl. 4 says "net 15 … or earlier when applicable law
   requires". A sub, Joe, and the app's "statutory due date" (§6 table) can't compute that, and when the
   client pays a draw on day 1, net 15 is late.
2. **Trust-fund statute missing (Minn. Stat. 514.02 subd. 1).** Money SJC receives from the owner is
   held in trust for the people who furnished labor and materials. Using it elsewhere while they go unpaid
   can be **theft**, and for residential work it can be charged against the responsible officer personally.
   Subd. 3 also has a 15-day notice-of-nonpayment trigger. This is the biggest personal-liability item in
   Joe's sub relationship and the plan never names it, either in the contract or in the payment warning screen.
3. **Warranty is shorter than what SJC owes the client (Minn. Stat. 327A.02 subd. 3).** For home
   improvements, the statutory warranty is **1 yr** for workmanship and materials, **2 yrs** for faulty
   installation of plumbing, electrical, heating or cooling systems, and **10 yrs** for major construction
   defects on additions and major structural changes. Cl. 10 gives SJC 1 year from the sub, so SJC carries
   the second year on every MEP job and years 2–10 on framing/foundation work, with nobody behind it.
   Leaving it to "counsel should supply" (§4) defers the problem; it doesn't fix it.
4. **181.723 is not "when applicable".** Since 2025-03-01, the 14-factor test applies to *all*
   residential building construction or improvement services. Several factors are things the contract and
   payment rail must do, and the plan doesn't build them:
   - factor 9: a written contract signed and dated by both, executed **no later than 30 days after work
     starts**, naming the specific services, and paid **per job or bid, not hourly**;
   - factor 10: invoices and payments in the business entity's name, with **no cash**;
   - factors 6 and 7: an MN unemployment-insurance account and workers' comp where required;
   - factor 5: Secretary of State good standing.

   Cl. 6's not-to-exceed caps and "emergency protective work … resolved" can turn into hourly or T&M pay,
   which fails factor 9(iv).
5. **Workers' comp exposure understated (Minn. Stat. 176.215).** If the sub's employees aren't covered,
   the contractor that hired the sub is liable for their comp. "Exemption documented" isn't enough. The
   common MN case is an uninsured one-person LLC that brings a helper. Cl. 13 needs the no-employees
   statement plus a hard removal rule.
6. **Licensing clause is generic.** Cl. 18 doesn't name the licenses the Work Order must capture:
   - DLI **electrical contractor** license, with the permit pulled by that contractor;
   - DLI **plumbing contractor** license, which needs a bond and insurance (326B.46), with the permit pulled
     by that contractor;
   - **local gas/mechanical** licenses in Minneapolis, St. Paul and other cities that require them;
   - **residential roofer** license (326B.802);
   - **residential building contractor** license for a sub that offers two or more special skills (counsel
     to confirm the 326B.805 subd. 6 exemptions);
   - **lead-safe certified firm and certified renovator** for paint-disturbing work in pre-1978 homes. EPA
     runs this until MDH's own program under 144.9505 subd. 1h takes effect; verify the status at build time;
   - **MDH-licensed asbestos** abatement.
7. Not wrong, a confirmation: **181.165** (contractor joint liability for subs' wage theft) excludes
   owner-occupied home-improvement contracts and 1–2-family home construction (subd. 1(d)). The plan is
   right not to build it in. Add one sentence to §4 so counsel and Joe know it was considered.

### Required to reach 10
1. **§3 cl. 4 — replace the payment sentence** with:
   > "SJC will pay each undisputed amount by the earlier of (a) 15 calendar days after SJC receives
   > Sub's invoice and the supporting documents listed in the Work Order, or (b) 10 days after SJC
   > receives the owner's payment that includes Sub's work (Minn. Stat. § 337.10, subd. 3). Undisputed
   > amounts paid late bear interest at 1½% per month (at least $10 per month on an unpaid balance of $100
   > or more). Sub shall pay its own lower-tier subs and suppliers within 10 days of receiving payment for
   > their work. All payments are by check or electronic transfer to Sub's business name — never cash."

   **§6 enforcement table, "Payment" row:** define the due date as `min(invoice_received + 15d,
   client_payment_received_covering_this_line + 10d)`, so the 10-day clock starts the day the client
   payment posts. **§9:** commitments/sub invoices need a link from the client invoice payment to the sub
   lines it covers. **cl. 5:** add "SJC releases Sub's retainage within 10 days after SJC receives the
   corresponding retainage from the owner, and in any event under § 337.10, subd. 4."
2. **§3 new cl. 15A "Job money is trust money":**
   > "Money SJC pays Sub for a job is held in trust for the workers, lower-tier subs and suppliers who
   > furnished labor or materials to Sub for that job (Minn. Stat. § 514.02) and must be used to pay them
   > first. Sub shall give Joe written notice the same day it learns a lower tier is unpaid."

   **§13 risks:** add "SJC's own receipts are trust funds for subs; the app's payment warning must say so."
3. **§3 cl. 10 — replace the 1-year promise** with:
   > "Sub warrants its work and materials to SJC, to the extent a defect arises from Sub's work or
   > materials, for the same periods SJC warrants the job to the owner under Minn. Stat. § 327A.02,
   > subd. 3: one year for workmanship and materials; two years for installation of plumbing, electrical,
   > heating or cooling systems; ten years for major construction defects in additions or major structural
   > changes. Periods start on the warranty date SJC gives the owner, stated in the Work Order."

   Add a `warranty_date` and `warranty_class` (`general` / `mep` / `structural`) to the Work Order. Cl. 13:
   completed-operations coverage for at least 3 years for MEP subs and as long as obtainable (broker) for
   structural/framing subs.
4. **§3 cl. 2 — rewrite** to:
   > "Sub is a business entity meeting every requirement of Minn. Stat. § 181.723, subd. 4, and shall keep
   > them met. Sub is paid only per job or per bid under a signed Work Order, never hourly. Sub invoices and
   > is paid in its business name."

   **§6 Paperwork screen:** add an **Independent-contractor check** card with the 14 factors as tick
   fields plus evidence. They are:
   1. separate business;
   2. own tools/vehicles/space;
   3. serves multiple customers;
   4. federal EIN, MN tax ID, 1099s received, returns filed, W-9 given;
   5. SOS good standing;
   6. MN UI account if required;
   7. workers' comp if required;
   8. 326B licenses/registrations;
   9. written contract signed by both ≤ 30 days after start, specific services, per-job pay;
   10. invoices and payments in the business name, no cash;
   11. controls the means;
   12. bears the main expenses;
   13. responsible for completion;
   14. profit or loss possible.

   Joe re-confirms the check at each master renewal. Make it a readiness reason code. Counsel to confirm
   whether a sole proprietor counts as a "business entity" under 181.723 subd. 1. Cl. 6: changes and
   emergency work are priced as a lump sum per change, not hourly.
5. **§3 cl. 13 — add:**
   > "Before any person works for Sub on an SJC job, Sub provides a workers' compensation certificate or,
   > if Sub has no employees, a signed statement saying so and promising to buy coverage before any
   > employee or helper works on an SJC job. An uncovered worker on site is removed immediately (SJC is
   > liable for Sub's uninsured employees under Minn. Stat. § 176.215)."

   Also add:
   - additional-insured by **CG 20 10 + CG 20 37 (04 13 editions or equivalent)**, for SJC **and the
     property owner**;
   - **primary and non-contributory** for claims arising from Sub's work;
   - **waiver of subrogation** in favor of SJC and the owner to the extent of Sub's fault;
   - 30 days' notice of cancellation where the insurer offers it.

   Counsel and broker confirm these against 337.05(b).
6. **§3 cl. 18 and §5 "Permits/closeout" — make the Work Order's permits table** one row per regulated
   trade, with these fields: `trade | license type | license # | holder | expires | individual licensee
   on site | who pulls permit | inspection authority (DLI or city)`. Required rows:
   - electrical (DLI electrical contractor license);
   - plumbing (DLI plumbing contractor + bond);
   - gas/HVAC (city license where required);
   - roofing (residential roofer);
   - lead (firm cert # + certified renovator name, when the consult flags pre-1978 and paint disturbance);
   - asbestos (MDH license);
   - general (residential building contractor license if 2+ skills, or exemption basis).

   An empty required row blocks release.
7. **§5 Work Order — add a plain-words page that the sub initials, above the legal text:**
   > **The rules on every SJ Carpentry job**
   > 1. Do only what's on this Work Order. If it isn't written here, it isn't in your price.
   > 2. Something new or different? Stop that part, call or text Joe, and wait for Joe's written OK with a price.
   > 3. A client asking you is not an OK. Only Joe's written OK counts.
   > 4. Optional upgrades are **upsells**. Tell Joe first. If the client brings it up, say: "This is an upsell — it's optional and not in your price. Joe will price it. Nothing happens unless you and Joe approve it."
   > 5. Never quote, discount or take money from the client.
   > 6. Required fixes (code, safety, rot) are not upsells. Call Joe; don't sell them.
   > 7. Insurance, license and comp must be current before you start, every day you're on site.
   > 8. Protect the house, clean up daily, no smoking inside, keep the client's codes private.
   > 9. Invoice in your business name; you get paid within the timeline in this agreement.
   > 10. Built before 1978 or odd materials (old tile, pipe wrap, vermiculite)? Don't disturb. Call Joe.

   The portal's "short summary" in §5 last paragraph is this page plus the scope table.
8. **§3 new cl. 10A "Materials others supply":**
   > "Sub inspects SJC- or client-supplied materials on delivery and before installing, and reports
   > damage, wrong items or shortages to Joe before installing. Reinstalling a visibly damaged item Sub
   > chose to install is Sub's cost."

   Cl. 11 add: "Sub supplies materials free of liens and passes manufacturer warranties to SJC and the owner."
9. **§5 "Site rules" — add for any trade that digs** (deck footings, post holes, trenching, sump discharge):
   > "Sub is the excavator. Sub requests Gopher State One Call locates at least 48 hours before digging,
   > excluding weekends and holidays (Minn. Stat. ch. 216D), and keeps the ticket number on the Work Order.
   > 811 does not mark private lines (irrigation, invisible fence, gas to a grill, power to a garage); ask
   > Joe and the owner."

   Add a field `gsoc_ticket`.
10. **§1/§6 renewal design:** replace the yearly re-sign of the master with an **evergreen master**
    (either party ends it on 30 days' notice for future Work Orders). Add an annual re-check of COI, the
    licenses and the IC card, plus re-signing only when counsel publishes a new template version. The
    yearly ceremony adds no legal protection and becomes a gate that blocks real jobs every January.
11. **§4 legal packet:** add counsel questions for 514.02, the 327A pass-through, 176.215, the 14-factor
    card and the 30-day execution rule. Add one line that 181.165 was reviewed and excluded for
    owner-occupied home improvement (subd. 1(d)).

---

## 2. Discovery call (`discovery-call-plan.md`)

### What's strong
- All nine of Joe's items are written out in full: why, two natural questions, and covered/partial
  examples. "Covered" is defined the way a remodeler would: "no budget yet" is covered, Joe's own
  hypothetical price is not the client's budget, an email needs spell-back, and city alone is partial.
- It respects Joe's rule: coverage only, no scoring. The engine is told "do not rate Joe", and the copy
  never says "you failed".
- Consent law is right: **626A.02 subd. 2(d)** (private party), not 2(c). It doesn't assume area code
  means jurisdiction, so it uses affirmative consent from everyone on every call, which also covers
  callers from all-party states. It correctly says today's announcement switch records before consent
  and has no outbound branch.
- Nudge limits fit real calls: nothing in the first 90 s, never-raised items wait for wrap-up, 3 per
  call, 120 s apart, once per item, 20 s expiry, nothing after hangup.
- The manual-first phase works on Joe's personal cell tomorrow with zero telephony changes.

### Wrong
1. **Consent evidence is weaker than it needs to be (§12).** Recording starts only after Joe's tap, so
   the recording never holds anyone saying "yes". The only proof is Joe's own tap. If an out-of-state
   caller later disputes consent, a recorded confirmation is the best evidence and costs nothing.
2. **The nudge for never-raised items comes too late (§5, wrap-up only).** Real discovery calls close in
   10–30 s once Joe says "I'll send you the pre-con agreement". With an 8 s p95 to the screen and 12 s
   to the phone, the prompt often lands after goodbye. The plan's wrap-up cues are generic ("goodbye,
   next steps"); Joe's own next-step phrases are the earliest reliable signal.
3. No statutory errors found.

### Required to reach 10
1. **§12 consent sequence — add the recorded confirmation.** After **Everyone agreed — start notes**,
   Joe's first recorded line is: *"Okay, we're recording now — and you're fine with that, right?"* The
   segment holding the client's yes is stored as `consent_evidence_segment_id` on `checklist_sessions`.
   If that segment is missing or says no, stop capture and show **Consent not on the recording —
   confirm again or stop**. The decline line (on screen for Joe): *"No problem — I'll just take notes
   by hand."*
2. **§5 wrap-up cues — add SJC's actual next-step phrases** as a wrap-up candidate list that fires the
   fast path *before* goodbyes: "pre-con", "pre-construction agreement", "I'll send you", "I'll email
   you", "set up a time", "come out and look", "rough estimate", "anything else", "any other questions".
   Acceptance: in the held-out set, the median nudge appears ≥ 10 s before the last client turn on
   calls that have a wrap-up.
3. **§3 — add four optional rows**, off by default. Joe turns them on in Settings, and §14 gets Joe
   question 5: "Turn any of these on?" They are what experienced remodelers ask on a first call. Each one
   is written in full:
   - **Next step agreed.** Ask: "What's the best next step for you — should I send the pre-con
     agreement and set up a time to come out?" Covered: a dated meeting or visit, the client accepts that
     Joe sends the pre-con agreement, or the client says they'll call back. Partial: "sounds good" with
     nothing agreed. Copy: "Remember to agree on the next step." Value: `next_step {kind, date|null}`.
   - **Photos.** Ask: "Could you text or email me a few photos of the space?" Covered: yes, no, or
     already sent. Copy: "Remember to ask for photos." Fact: existing `photos` key (request status only).
   - **The property.** Ask: "Do you own the home? Is it a house, townhome or condo — any HOA?" Covered:
     owner yes/no (buying, renting → whose approval) **and** property type **and** HOA yes/no. Copy:
     "Remember to ask if there's an HOA." Value: `property {owner, type, hoa}`. Renting or condo changes
     who signs and whether there's an association approval, both of which come before price.
   - **Paying for it.** Ask: "Will you pay for this out of pocket, or through a loan or insurance claim?"
     Covered: cash / loan or HELOC / insurance claim / declined. Copy: "Remember to ask how they plan to
     pay." This feeds the bank-approval skill and the deposit rule. A declined answer is covered.
4. **§12 and consult §8.4 — make retention one policy** across both plans (see Cross-plan 1).

---

## 3. In-home consult (`in-home-consult-plan.md`)

### What's strong
- The approach is how a good estimator works: house and access questions at the table, then room by
  room with derived quantities, photos tied to the fields they prove, flags (⚑) that turn into issues for
  Joe, and skip-with-reason. "Get on return visit" keeps the visit open, which is right.
- The field content is far better than average. A seasoned estimator would be glad to find, among
  others, these checks:
  - **toilet:** rough-in and side clearance;
  - **panel:** FPE/Zinsco/fuses and open spaces;
  - **piping:** galvanized/polybutylene, lead service line, Orangeburg;
  - **hazards:** vermiculite, plaster, knob & tube;
  - **access:** narrowest turn for tub/cabinet delivery; dumpster on the street needs a street-use permit;
  - **deck:** brick veneer at the ledger means freestanding;
  - **basement:** egress well and ladder, beams and ducts under 6′4″, stair headroom under 80″.
- **MN specifics are right:**
  - 42″/60″ frost by zone (Minn. R. 1303.1600);
  - Gopher State One Call (216D);
  - RRP 6 sq ft interior / 20 sq ft exterior and the 60-day pamphlet window, with a re-give to-do;
  - guards over 30″;
  - attached-garage separation.
- The scripts sound like Joe. The opening frames the visit (no prices today), "I'll ask before I open
  anything" builds trust, the closing read-back is turned to the client, and the staff variant is right.
- The "Completed properly" test (§10.3) checks the record, not the person, and needs Joe's review when
  staff ran the visit. "Sub/supplier will measure" becomes a scope assumption, which is right.

### Wrong
1. **The consent wording is inaccurate (§8.1).** "It's never posted or shared outside SJ Carpentry"
   is said while §8.3 sends the transcript text to Anthropic. Telling a client that is a misstatement,
   and the attorney will reject it. The discovery-call script ("use AI to take notes") gets it right.
2. **Wrong code bodies for MN.**
   - Kitchen hood "make-up air required (IRC M1503.6)": MN does not adopt the IRC mechanical chapters.
     Minn. R. 1309.0010 replaces them with **Minn. R. ch. 1346** (MN Mechanical & Fuel Gas Code), and the
     MN energy code (1322) adds makeup-air rules. Cite 1346/1322 and verify the MN threshold.
   - Toilet: MN plumbing is **Minn. R. ch. 4714 (UPC-based)**, which requires **24″ clear in front** of
     the toilet (not the IRC's 21″) in addition to 15″ to each side and 30″ center-to-center. The form
     has no front-clearance field.
3. **Egress area mis-stated (§7.7 `egress`).** "≥ 5.7 sf (5.0 at grade)": under IRC R310.2.1, the
   **5.0 sf** minimum applies to **grade-floor *and below-grade*** openings. That covers basement
   windows, so the form as written would flag compliant basement windows as failing.
4. **The RRP check can miss window jobs (§7.3 `era`).** It asks only "> 6 sf interior / 20 sf exterior".
   Window replacement is never a minor repair under 40 CFR 745.83. A pre-1978 window or door replacement
   is RRP work at any size. The form also never confirms that SJC's certified firm and a named certified
   renovator are assigned.
5. **The deck permit test is incomplete (§7.8).** "attached, > 30″, > 200 sf" leaves out that a deck
   serving a required exit door needs a permit (IRC R105.2 exemption conditions). The footing module
   doesn't allow the MN freestanding option. City handouts (Maplewood, Grand Rapids) allow footings above
   frost for low freestanding decks; confirm the exact Minn. R. 1303.1600 criteria per city.
6. **Some skips make the visit "complete" with no consequence for the estimate (§10.2/10.3).** "No
   access" and "Not safe to measure" count toward complete with only a "soft gap". A fixed price with an
   unmeasured area needs a written assumption or exclusion, or Joe eats the risk.

### Required to reach 10
1. **§8.1 consent words — replace** with:
   > "Before we start — I'd like to record our conversation on this tablet so I don't miss anything you
   > tell me. The recording stays with us at SJ Carpentry. An AI tool we use turns the words into my notes
   > and measurements. It's never posted or shared with anyone else. Is that okay? You can tell me to stop
   > at any time."

   After yes, the first recorded line is "Okay, it's recording now — and you're fine with that?" (same
   evidence rule as discovery-call fix 1). **Add a photo line to the opening** (§7.2, new line 4b):
   > "I'll take photos of the rooms, closets, the basement and the mechanicals so I can price it
   > right — I'll keep people and personal things out of them. Is that okay?"

   Add field `house.photos_ok` yesno R.
2. **§7.3 `house` — add these fields:**
   - **Permit authority:** city or township, and who inspects (city / DLI for electrical). R.
   - **Smoke and CO alarms now:** where, hardwired or battery. R. ⚑ "Permitted work triggers smoke/CO
     alarms (IRC R314/R315; Minn. Stat. 299F.51 CO within 10 ft of sleeping rooms)".
   - **Water pressure:** psi at a hose bib, O; R? when body sprays, a rain head or a new bath is planned.
     The `psi` unit already exists but no field uses it.
3. **§7.3 `era` — add these fields:**
   - **Window or door replacement in a pre-1978 home?** yesno R? pre-1978. ⚑ "RRP applies at any size —
     window replacement is never minor repair (40 CFR 745.83)".
   - **Certified renovator assigned:** name, cert #, expiry. R? RRP applies.
   - **SJC firm certification # on file:** check. R? RRP applies.
   - **Kids under 6 or a pregnant person in the home:** yesno. R? RRP applies (containment and cleaning plan).
   - Asbestos-suspect ⚑ text: "test before demo; abatement by an MDH-licensed contractor — confirm the
     residential rules with MDH/counsel."
   - §8.2 attorney item 5: add "status of MDH's state RRP program (Minn. Stat. 144.9505 subd. 1h) vs EPA".
4. **§7.4 `bath_scope` — add these fields:**
   - **Existing tub material:** Cast iron / Steel / Acrylic-fiberglass / Tile base. R. ⚑ cast iron "2-person
     demo / break-up".
   - **Tub drain end** (L/R) R? tub kept or replaced.
   - **Shower drain center from back wall × from side wall:** length_pair. R? shower.
   - **Wet wall is an exterior wall?** yesno R. ⚑ "MN freeze risk — reroute or insulate supplies".
   - **Wet wall framing:** 2×4 / 2×6 / Unknown. R? new valve, niche or wall-hung toilet.
   - **Existing valve:** brand, cartridge, kept or replaced. R.
   - **Where the vent stack runs** (text + photo). R? any fixture moves.
   - **Fan:** existing cfm (label), duct route and length to the outside, exit (roof / wall / soffit),
     switch or timer. R. ⚑ duct > 25 ft or more than 3 elbows. Minimum airflow per Minn. R. 1346/1322 —
     verify the value.
   - **Electrical in the room:** GFCI present, receptacle count, dedicated 20 A bath circuit
     (Yes / No / Can't tell), light locations. R.
   - **Toilet front clearance:** length R? toilet. ⚑ < 24″ "MN Plumbing Code (4714/UPC) needs 24″ in front".
   - **Total floor thickness at the threshold:** length R. Used for tile build-up and the transition.
   - **Water heater size** becomes R when the tub is > 60 gal or body sprays are planned.
   - **Heated floor area:** derived sf.
5. **§7.5 kitchen — add these fields:**
   - **Per new appliance in `kitchen_scope`:** model # if picked, cutout W×H×D, power (120 V / 240 V,
     amps), gas yes/no, panel-ready yes/no. R for New. Without them, cabinets get ordered wrong.
   - **Hood duct route:** exit (wall / roof / none — recirculating now), path (upper cabinet / soffit /
     joist bay — joist direction), estimated length, number of elbows, duct size. R. ⚑ path crosses joists
     "framing work".
   - **Makeup-air ⚑:** re-cite to Minn. R. 1346/1322 (Wrong 2).
   - **Gas line at the range:** location, shutoff, line size if visible. R? gas range.
   - **Soffit depth × height** per wall. R? soffit ≠ None.
   - `window` and `door` in a kitchen: "Left corner to edge" and **casing width** become **R** (cabinet
     layout depends on them). Floor to sill is already R.
   - `room.out_of_level` becomes **R** for kitchen and any tile floor.
   - **Floor layers and their height under the new countertop** (dishwasher clearance under 34½″): R.
   - **Existing circuits:** count of 20 A countertop circuits; dedicated DW, disposal, micro and fridge
     circuits (Yes / No / Can't tell). R. NEC 210.52 work belongs to the electrician, but it is priced now.
   - **Island services:** what's below the island (unfinished basement / finished / slab) and joist
     direction. R? island with sink or outlets. ⚑ slab "trench for drain/vent".
   - **Recessed lights:** what's above the ceiling (attic / floor / roof), joist direction. R? recessed
     wanted.
6. **§7.7 basement — add these fields:**
   - **Foundation wall insulation now:** None / Blanket / Foam board / Framed and batts, plus thickness. R.
   - **Rim joist insulated?** yesno R. ⚑ "MN energy code (1322): insulate walls and rim when finishing —
     verify the R-values".
   - **Slab:** cracks, heave, low spots, floor drain locations. R.
   - **Sump:** sealed lid, battery backup, where it discharges. R? sump.
   - **Gravity drain possible for the bath:** main drain depth and direction seen at the cleanout. R? bath.
   - **Fuel-burning appliances in a room being enclosed?** yesno R. ⚑ "combustion air / clearances
     (Minn. R. 1346)". Also service clearance in front of the furnace and water heater, R.
   - **Furnace capacity:** BTU input from the label, and supply/return available for the new rooms. R.
   - **Pipes, wires or gas lines below the joists to reroute** (text + photo). R? drywall ceiling.
   - **Storage under the stairs?** yesno. ⚑ "½″ drywall on the enclosed side (IRC R302.7)".
   - **`egress`:**
     - Fix the area rule: "≥ 5.0 sf for grade-floor or below-grade openings (basement); 5.7 sf otherwise".
     - Add: will a deck or porch sit over this well? yesno. ⚑ "needs a clear path out (IRC R310)".
     - Add: well drainage (Drain / Gravel / None).
7. **§7.8 deck — add these fields:**
   - **House rim/band material at the ledger:** 2× lumber / LVL / I-joist / Unknown. R? attached. ⚑
     I-joist "ledger needs engineered detail or freestanding".
   - **Existing flashing at the ledger line:** yesno R? attached.
   - **Distance from the house foundation to the first footing line.** ⚑ "footings must bear on
     undisturbed soil, not foundation backfill".
   - **Private underground lines not marked by 811:** irrigation, invisible fence, grill gas, power to a
     garage/shed, None. R? will dig.
   - **Egress window or well under the deck?** yesno R. ⚑ as in basement.
   - **Stairs:** width, handrail needed (≥ 4 risers), landing. R? stairs.
   - **Existing deck:** joist size and spacing, beam, posts, ledger rot. R? replace. Feeds "Existing
     footings reusable".
   - **Hot tub:** dry weight + water, GFCI disconnect location. R? hot tub.
   - **`footing`:** add the choice "Floating (freestanding, low deck — city must allow)", and a note
     "confirm the Minn. R. 1303.1600 freestanding criteria on the city handout".
   - **Permit triggers** derived: add "serves a required exit door".
8. **§7.6 addition — add these fields:**
   - **Soils:** known fill, wet or high water table, heavy clay, unknown. R. ⚑ any but unknown "soil
     check / engineer".
   - **Existing foundation at the tie-in:** type, top-of-foundation height, footing depth if visible. R.
   - **Windows or doors lost or covered by the addition:** count. ⚑ "bedroom egress lost".
   - **Lot:** existing hardcover estimate (sf), lake/river/wetland nearby (shoreland), floodplain,
     watershed district, height limit, **city requires a certificate of survey** (most metro cities for
     additions). R. ⚑ shoreland, floodplain or watershed.
   - **Septic and well location** if not on city sewer and water. R? not city. ⚑ setbacks.
   - **Sewer and water laterals, gas service and meter location** relative to the footprint. R. ⚑ meter
     in the footprint "utility relocation".
   - **HVAC capacity:** furnace BTU and age, AC tonnage, duct path to the addition, "Manual J by HVAC sub"
     yes/no. R.
   - **Roof at the tie-in:** overhang depth, fascia height, gutters, vents/skylights/chimney within 6 ft,
     attic ventilation path. R.
   - **Energy note:** "addition built to the current MN energy code (Minn. R. 1322)".
   - **Protected trees** (city tree ordinance). O.
9. **§7.9 whole-home — add:** temporary kitchen/bath plan while living there (R? living here). Plus a
   pre-1981 asbestos survey before demo across the house (R? pre-1981 and demo), with ⚑ "survey before
   pricing demo".
10. **§10.3 "Completed properly" — add three conditions:**
    - (9) Every fired ⚑ flag has a disposition: *Price it / Allowance / Sub must look before pricing / Not
      an issue — reason*.
    - (10) Every "No access" or "Not safe to measure" skip on a field with `maps_to` creates a written
      estimate assumption ("Quantity assumed at X; field-verify — adjusts by change order/pre-con change"),
      shown in review. Without it, the skip doesn't count.
    - (11) Each trade the template touches records **Trade walk needed before pricing** (Electrician /
      Plumber / HVAC / None), which files the bid-walk to-do.

    The rest of the test stays as written. It is the right test once those three are added.
11. **§6/§7.1 design — tier the required fields.** Mark each R as **Price-critical** (quantity, existing
    condition that changes price, code trigger) or **Record** (nice to have). Phase 1 completeness uses
    Price-critical, plus Record items for staff visits. Re-time `{duration}`, because with the fields above
    a kitchen is 2 h, not 90 min. A first visit where the form won't close in the time Joe quoted the
    client is how forms get abandoned.

---

## Cross-plan

1. **One consent and retention policy.** The discovery call says recording 90 days and transcript 180 days.
   The consult says audio is deleted 180 days after the construction agreement and the transcript is kept
   with the project. Pick one table for both, with a value for each of audio, transcript, segments and
   confirmed notes, and send it to the attorney once. Both scripts must name the AI service ("an AI tool
   we use"), and both store the recorded "you're fine with that?" segment as consent evidence.
2. **Consult → sub scope, by name.** The sub plan's §5 step 3 "versioned adapter" was written before the
   consult plan existed. It must call the consult's `consultScopeFacts(projectId, scopeKey)` (consult §10.9)
   and consume its flags, photos and "Sub/supplier will measure" assumptions as Work Order exclusions and
   interfaces.
3. **Upsell vs required, labelled at the source.** Consult "new work heard / + Something new" (§10.5)
   should carry `origin: client_requested_optional | found_condition_required`. Client-requested optional
   items get the sub plan's **Upsell — optional addition** label on the pre-con change, and found conditions
   get **Scope change — required work**. That way the label exists before a sub ever sees the job, and
   Joe's rule holds even when SJC, not the sub, finds the upsell. Before the contract, these go to a
   Pre-con change estimate. They are never a change order (AGENTS rule).
4. **RRP and licensing flow down.** A consult `era` result of "RRP applies" must set a Work Order
   readiness requirement: the sub firm's lead-safe cert # and certified renovator name for every
   paint-disturbing trade (sub fix 6). The consult's `house.permit authority` must pre-fill the Work Order
   permits table (who inspects, city vs DLI).
5. **Discovery facts pre-fill the consult.** Decision makers, HOA/property (if Joe enables discovery
   fix 3), "how long / plan to stay" and photos already received should show in the consult's "What we
   know so far" so the client isn't asked twice. The consult then confirms them rather than re-asking.
6. **Same words everywhere.** Use "pre-con agreement", "rough estimate", "formal estimate", "Pre-con
   change", "change order", "upsell" in scripts, checklist copy and Work Orders. Don't introduce
   "proposal" or "bid" toward the client. All three plans are close; keep it that way in revisions.

Sources checked: [337.10](https://www.revisor.mn.gov/statutes/cite/337.10),
[337.01](https://www.revisor.mn.gov/statutes/cite/337.01),
[337.05](https://www.revisor.mn.gov/statutes/cite/337.05),
[514.02](https://www.revisor.mn.gov/statutes/cite/514.02),
[514.011](https://www.revisor.mn.gov/statutes/cite/514.011),
[327A.02](https://www.revisor.mn.gov/statutes/cite/327A.02),
[181.165](https://www.revisor.mn.gov/statutes/cite/181.165),
[DLI construction IC tests (9 and 14 factors)](https://www.dli.mn.gov/sites/default/files/pdf/ic_tests_construction_nine_and_14factors.pdf),
[Minn. R. 1309.0010](https://www.revisor.mn.gov/rules/1309.0010/version/2020-03-31T11:43:06-05:00),
[MDH RRP rulemaking](https://www.health.state.mn.us/communities/environment/lead/rules/rrp/index.html),
[Maplewood deck handout](https://www.maplewoodmn.gov/DocumentView.asp?DID=39),
[MN Rule 1303.1600](https://law.cornell.edu/regulations/minnesota/Minn-R-1303-1600).
Not re-verified here, flagged for counsel: 176.215, 326B.46/.802/.805 license details, 299F.51,
Minn. R. 1346 makeup-air and bath-exhaust values, 1322 basement R-values, 40 CFR 745.83/.84.
