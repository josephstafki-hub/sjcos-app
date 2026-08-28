# SJC OS — Stage Gates & Status Crosswalk

> Source of truth: mirrored from the temp CRM tracker's `stage_gates.md` and
> encoded as machine-readable rows in the **`stage_rules`** table (see
> `db/schema.sql`, Open Brain/Engine/Skills section). This doc is the human-
> readable narrative; the table is what the code reads.
>
> *Accuracy note (2026-08-25): `stage_rules` is still live and correct, but
> nothing queries it directly over MCP. It is consumed in-app by
> `computeStageGate()` (`lib/record-ops.ts`) — which powers the Ops-tab "what's
> needed to advance" guidance — and by the gate-stalled detector
> (`lib/detectors.ts`). The guidance is advisory: **the UI never blocks a stage
> change on a gate.***

## Why a crosswalk instead of new enum values

The temp CRM tracker models the real business lifecycle at a finer grain (32
stages across lead → precon → construction → closeout) than the official
`leads.stage` (5) and `projects.status` (9) enums the UI is built around.
Rather than widen those enums — which would ripple through the pipeline strips,
chips, and `lib/{leads,projects}.ts` and risk breaking pages — the real business
stages are preserved in `stage_rules` with a crosswalk to the official status an
agent should set:

| column | meaning |
| --- | --- |
| `stage` | business stage (PK), e.g. `rough_estimate_sent` |
| `phase` | `lead` / `precon` / `construction` / `closeout` |
| `sort_order` | lifecycle ordering |
| `gate_requirements` | what must be true to enter this stage |
| `maps_to_lead_stage` | official `leads.stage` when this is a lead-phase stage |
| `maps_to_project_status` | official `projects.status` when project-phase |
| `is_terminal` | lost / pass / archived |

**Rule for agents:** before advancing a record, check the target stage's
`gate_requirements`. If required fields/evidence are missing, do NOT advance —
list exactly what is missing. When a stage change is allowed, set the official
`leads.stage` / `projects.status` via the crosswalk. The UI enums are untouched.

---

# SJC Stage Gates

This file defines when a record is allowed to move between lifecycle stages. Hermes should check these gates before advancing a record. If required fields/evidence are missing, Hermes should not advance the stage; instead it should list exactly what is missing.

## Core rule

A stage change is allowed only when the gate for the target stage is satisfied.

## Lead / Sales Pipeline

### `new`
No gate. Used when a lead is captured but not reviewed.

### `needs_response`
Required:
- Name or contact method is present
- Source or notes explain where the lead came from

### `discovery_scheduled`
Required:
- Client contact method present: phone or email
- Discovery call date/time captured in `next_action` or `status_notes`

### `discovery_completed`
Required:
- Discovery call notes captured in `qualification_notes` or `status_notes`
- Project type known
- Budget range known or explicitly marked unknown
- Timeline known or explicitly marked unknown

### `rough_estimate_needed`
Required:
- Discovery completed
- Scope summary has enough information to prepare Phase 1 rough estimate
- Any missing photos/measurements/open questions are listed in `status_notes`

### `rough_estimate_sent`
Required:
- Rough estimate has been prepared and sent to client
- Sent date captured in `last_contact_at`
- Scope summary updated with estimate assumptions
- Follow-up next action set, normally 2 days out

### `follow_up_needed`
Required:
- Prior client-facing contact exists in `last_contact_at`
- Next follow-up reason is stated in `next_action`

### `precon_deposit_requested`
Required:
- Client accepted rough estimate direction or requested to move forward
- Pre-con agreement/deposit request sent or ready to send
- Requested amount captured in `precon_deposit_amount` if known

### `precon_deposit_paid`
Required:
- Pre-con agreement accepted/signed or otherwise approved
- Pre-con deposit paid/cleared
- `precon_deposit_status` is `paid`

### `lost`
Required:
- Lost reason captured in `status_notes`

### `pass`
Required:
- Pass/disqualification reason captured in `status_notes`

## Pre-Construction

### `site_visit_scheduled`
Required:
- Current or prior stage confirms `precon_deposit_paid`
- Site visit date/time captured in `next_action` or `status_notes`

### `site_visit_completed`
Required:
- Site visit notes captured in `qualification_notes`, `scope_summary`, or `status_notes`
- Photos/measurements status noted

### `precon_active`
Required:
- Site visit completed
- Detailed takeoff/scope/selections/sub-vendor pricing work started
- Next action assigned

### `formal_estimate_needed`
Required:
- Site visit complete
- Scope summary updated from site visit
- Known selections/allowances/open questions captured

### `formal_estimate_sent`
Required:
- Formal estimate/SOW package sent to client
- Sent date captured in `last_contact_at`
- Follow-up next action set

### `contract_requested`
Required:
- Client approved formal estimate/SOW direction
- Contract request or contract draft is ready/sent
- `contract_status` is `requested` or `sent`

### `contract_signed`
Required:
- Contract signed
- `contract_status` is `signed`

### `retainer_paid`
Required:
- Contract signed
- Retainer paid/cleared
- `retainer_status` is `paid`

## Construction

### `construction_scheduled`
Required:
- Retainer paid
- Start date/schedule captured in `next_action` or `status_notes`
- Current milestone identified

### `active_construction`
Required:
- Construction started
- Current milestone identified
- Owner/PM assigned

### `change_order_pending`
Required:
- Change order description captured in `status_notes`
- Client approval/payment/signature need stated in `next_action`

### `waiting_on_client`
Required:
- Client-blocking decision/payment/access item stated in `next_action`

### `waiting_on_sub`
Required:
- Sub/vendor-blocking item stated in `next_action`

### `milestone_ready_to_invoice`
Required:
- Milestone name captured in `current_milestone`
- Completion/approval evidence captured in `status_notes`

### `substantial_completion`
Required:
- Substantial completion reached
- Punch list or walkthrough status captured in `status_notes`

## Closeout / Warranty

### `punch_list_active`
Required:
- Punch list exists or walkthrough completed
- Open items summarized in `status_notes`

### `final_invoice_sent`
Required:
- Final invoice sent
- Sent date captured in `last_contact_at`

### `closed_out`
Required:
- Final payment received
- Punch list resolved or accepted
- Documents archived or archive action noted

### `warranty_active`
Required:
- Project closed out
- Warranty period/date or policy reference captured in `status_notes`

### `warranty_claim_open`
Required:
- Claim description captured in `status_notes`
- Response/resolution next action set

### `archived`
Required:
- No active project, payment, warranty, or client action remains
- Archive note captured in `status_notes`
