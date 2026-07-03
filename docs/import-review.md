# Imported data review — temp CRM → SJC OS

_Generated 2026-07-03 by `scripts/import-review.mjs` (read-only). Re-run to refresh._

Source: `/home/joe/SJC OS Temp/data/leads.csv` (legacy/import reference only — SJC OS Postgres is now the source of truth).

## Counts

| Table | Actual | Expected (Hermes review) | OK |
|---|---:|---:|:--:|
| leads | 2 | 2 | ✅ |
| projects | 10 | 10 | ✅ |
| work_items | 12 | 12 | ✅ |
| knowledge_items | 47 | 47 | ✅ |
| skills (approved) | 8 | 8 | ✅ |
| runbooks | 5 | 5 | ✅ |
| sjc_temp_lead_imports | 56 | 56 | ✅ |
| stage_rules | 32 | 32 | ✅ |

## Records needing a look: 4 of 12

Each imported **active** lead/project is below. Nothing here is auto-changed — this is review only. To roll the whole import back: `node scripts/import-undo.mjs undo --confirm`.

### Sam Stading-Ogan — lead  ✅

- **Source record_id:** `sjc-6d4f74f7`
- **Classification:** proposed `lead` → imported as **lead**
- **Temp stage:** `follow_up_needed`  →  **official stage:** `rough_estimate`
- **Contact:** sam.ogan@stevensgreat.com · 612.710.4601
- **Next action:** Follow up later with Sam/Great Clips Plymouth if no reply after their internal cost/timing discussion.  _(due Wed Jul 08)_
- **Linked knowledge items:** 4
- **Work items (1):** Follow up later with Sam/Great Clips Plymouth if [queued, needs approval]

### Travis and Erin Christensen — lead  ✅

- **Source record_id:** `sjc-c334cf04`
- **Classification:** proposed `lead` → imported as **lead**
- **Temp stage:** `rough_estimate_sent`  →  **official stage:** `rough_estimate`
- **Contact:** erinmorley87@gmail.com · 7637328403
- **Next action:** No immediate reply needed; follow up after the July 4 weekend if Travis/Erin have not chosen a contractor or asked quest  _(due Fri Jul 10)_
- **Linked knowledge items:** 4
- **Work items (1):** No immediate reply needed; follow up after the J [queued, needs approval]

### Dan Willems — project  ✅

- **Source record_id:** `sjc-545a9bcb`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `precon_active`  →  **official status:** `selections`
- **Milestone:** Asked Dan/Kelli whether doors under sinks can work or if they want custom drawer-heavy vanity cabinetry.
- **Contact:** dan.m.willems@gmail.com
- **Next action:** Review/send Dan/Kelli draft answering custom vanity cost difference/running-total question; before final commitment, pul  _(due Mon Jul 06)_
- **Linked knowledge items:** 4
- **Work items (1):** Review/send Dan/Kelli draft answering custom van [queued, needs approval]

### Derek Battey — project  ⚠️

- **Source record_id:** `sjc-b95e1e15`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `active_construction`  →  **official status:** `construction`
- **Milestone:** Still waiting on Menards delivery timing for siding materials.
- **Contact:** batteyderek@yahoo.com
- **Next action:** Keep waiting on Menards delivery timing for Derek/Battey siding materials; check back early next week if no confirmation  _(due Mon Jul 06)_
- **Linked knowledge items:** 4
- **Work items (1):** Keep waiting on Menards delivery timing for Dere [queued, needs approval]
- **⚠️ Review flags:**
  - Contract executed in Joe's external system but not yet mirrored in SJC OS — capture a contract reference/knowledge note when convenient.

### Elaine Louiselle — project  ✅

- **Source record_id:** `sjc-112745c0`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `precon_active`  →  **official status:** `selections`
- **Milestone:** Meeting confirmed for 2026-07-02 11:30 to discuss revised kitchen layouts/new direction.
- **Contact:** elainelouiselle@gmail.com; elouiselle@gmail.com
- **Next action:** Review/send Elaine draft about Beaumont saving close to $500, and correct/update Houzz estimate ES-10177 to show Cambria  _(due Mon Jul 06)_
- **Linked knowledge items:** 4
- **Work items (1):** Review/send Elaine draft about Beaumont saving c [queued, needs approval]

### Isaiah Maertens — project  ✅

- **Source record_id:** `sjc-e6ce503a`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `precon_active`  →  **official status:** `selections`
- **Milestone:** Follow-up question sent to Jesse about whether beam below is needed because lower unit is inaccessible.
- **Contact:** isaiahmaertens@outlook.com
- **Next action:** Review/send Isaiah structural update draft if accurate; decide practical construction/engineering path for flush beam wh  _(due Mon Jul 06)_
- **Linked knowledge items:** 4
- **Work items (1):** Review/send Isaiah structural update draft if ac [queued, needs approval]

### Jeffrey Plumbon / New Kingdom Healthcare — project  ✅

- **Source record_id:** `sjc-14c3909b`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `final_invoice_sent`  →  **official status:** `closeout`
- **Milestone:** CO issued; final invoice open
- **Contact:** cpfeifer@newkingdomhealthcare.com
- **Next action:** Track New Kingdom final invoice IN-10051 payment; CO has been issued/uploaded to Cottage Grove permit file.  _(due Wed Jul 08)_
- **Linked knowledge items:** 4
- **Work items (1):** Track New Kingdom final invoice IN-10051 payment [queued, needs approval]

### John Flanagans — project  ⚠️

- **Source record_id:** `sjc-5efeb6a3`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `waiting_on_sub`  →  **official status:** `construction`
- **Milestone:** Still waiting for Rob to start demo/concrete at 311 Butler.
- **Contact:** jflanaganpt@gmail.com
- **Next action:** Keep waiting on Rob confirmation that demo/concrete work has begun at 311 Butler; follow up next week and do not order m  _(due Mon Jul 06)_
- **Linked knowledge items:** 4
- **Work items (1):** Keep waiting on Rob confirmation that demo/concr [queued, needs approval]
- **⚠️ Review flags:**
  - Contract executed in Joe's external system but not yet mirrored in SJC OS — capture a contract reference/knowledge note when convenient.

### Laurel Gollinger — project  ⚠️

- **Source record_id:** `sjc-5d04d387`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `construction_scheduled`  →  **official status:** `construction`
- **Milestone:** Pricing received/shared; waiting on Laurel decision.
- **Contact:** laurel.gollinger@gmail.com · 612-270-0087
- **Next action:** Wait for Laurel to get back with what she wants to do after receiving the pricing; follow up if quiet after the holiday/  _(due Wed Jul 08)_
- **Linked knowledge items:** 4
- **Work items (1):** Wait for Laurel to get back with what she wants  [queued, needs approval]
- **⚠️ Review flags:**
  - Contract executed in Joe's external system but not yet mirrored in SJC OS — capture a contract reference/knowledge note when convenient.

### Libby Mahowald — project  ✅

- **Source record_id:** `sjc-8016666c`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `precon_active`  →  **official status:** `selections`
- **Milestone:** Meeting scheduled for 2026-06-26 at 2:00 PM; no action needed today.
- **Contact:** libbyrose527@gmail.com
- **Next action:** Wait for Libby/Tim feedback after showroom links and ranch home style guide email; continue selection/design/precon coor  _(due Wed Jul 08)_
- **Linked knowledge items:** 4
- **Work items (1):** Wait for Libby/Tim feedback after showroom links [queued, needs approval]

### Mike McCullough — project  ✅

- **Source record_id:** `sjc-1e168dfb`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `active_construction`  →  **official status:** `construction`
- **Milestone:** Waiting on floor to be finished; check-in set for Monday.
- **Contact:** mjmassociates@gmail.com
- **Next action:** Check in with Mike on Monday about floor completion and next garage construction steps.  _(due Mon Jul 06)_
- **Linked knowledge items:** 3
- **Work items (1):** Check in with Mike on Monday about floor complet [queued, needs approval]

### Molly Egan — project  ⚠️

- **Source record_id:** `sjc-3ad6c7dc`
- **Classification:** proposed `project` → imported as **project**
- **Temp stage:** `active_construction`  →  **official status:** `construction`
- **Milestone:** Waiting on Molly radiator-refurbishing decision.
- **Contact:** 1mollydesign@gmail.com; heartandsoil@me.com
- **Next action:** Wait for Molly to confirm whether she wants help finding someone to refurbish the radiators; continue payment/admin coor  _(due Tue Jul 07)_
- **Linked knowledge items:** 4
- **Work items (1):** Wait for Molly to confirm whether she wants help [queued, needs approval]
- **⚠️ Review flags:**
  - Contract executed in Joe's external system but not yet mirrored in SJC OS — capture a contract reference/knowledge note when convenient.

## Duplicate / false-record checks

- ✅ No duplicate names across leads + projects.

## The 44 closed rows

The other 44 temp rows classified as `archive` (closed_out / lost / pass / archived / warranty_*) were **left in staging only** (`sjc_temp_lead_imports`, `import_status='staged'`) and were **not** written to official leads/projects. Review them in the staging buffer if any should be revived.
