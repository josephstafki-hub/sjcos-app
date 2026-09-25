# Shared engineering contracts

Revision: September 23, 2026. These are implementation requirements and proposed
record shapes, not a claim that every API/table exists. Map onto existing concepts
before adding new ones. Keep Next.js/TypeScript, PostgreSQL and supervised workers;
no microservices rewrite or new generic orchestration product is required.

## Authority and integration boundary

DECISIONS.md contains Joe's settled desired behavior. Existing AGENTS.md rules
remain enforced by current software until the matching migration is deployed.
A10 explicitly changes the operating instructions with versioned policy and
shared server enforcement. Do not turn on automatic sends by deleting a guard.
Do not ask Joe to repeat authority decisions already recorded in this package.
Deployment/account connection and outstanding setup are separate from coding.

Every entry point—UI, MCP, internal API, webhook, import and scheduler—calls the
same typed server commands for the same business action. Authentication derives
from the trusted session/service identity; the caller cannot submit `is_owner`.
Bind delegated agents to the initiating person, allowed projects and actions.
Staff area visibility and approval privileges are distinct. A model can propose
work but cannot mint its own approval or turn a staff request into an owner call.

`lib/run-action.ts` is an existing client error wrapper, not this command layer.
Keep it useful for presentation. Do not import secrets/database authority into it.
Use separate typed commands with shared validation/transaction machinery, rather
than a universal command that accepts arbitrary SQL or model-supplied operations.

## Required records and invariants

| Concept | Required fields/behavior |
|---|---|
| Command | Principal, request key, canonical input hash/revision, action/target, auth reference, stored result and event links |
| Source event | Provider + account + event ID uniqueness; authenticated payload reference/hash, source/receipt times, state, attempts/lease and retention |
| Obligation | Business obligation identity separate from source message/thread; source links, lifecycle, owner, next action, schedule/deadline and resolution evidence |
| Workflow instance | Target, immutable definition/policy versions, current step and explicit blocked/repair states |
| Step | Unique instance + definition version + step key; output contract and evidence |
| External action | Stable economic/business operation key, immutable payload/artifact revision, actor/scope, decision/policy, state and provider IDs |
| Attempt | Append-only request/response classification, lease token, timestamps, provider request reference; secrets redacted |
| Decision | Exact action(s), audience/payee, amount/currency, content/version, expiry, approval/rejection actor and authority scope |
| Document/design | Stable ID and immutable revisions, content hash, source/rights, project scope, approval/signature binding |
| Financial mapping | Internal/external identity, company/location, authoritative source, version, posted/settled/reconciled state and mapping exception |
| Cost observation | Job/scope/unit, quantity, actual cost/hours, source/date, completeness, exception/outlier status and pricing-version lineage |
| Time interval | User/job/category, start/end, capture source, inferred/confirmed state, device/event IDs and correction history |

A command's same key and same input returns the stored outcome. Same key with
changed input fails. Permanent uniqueness and transaction locks handle concurrent
callers; an in-memory cache alone cannot. Select retention appropriate to audit
and business needs without keeping raw sensitive payloads indefinitely.

## Safe transactions and permanent intents

A03a first introduces minimum permanent action intent/attempt records. Write
business change, audit and intent in one PostgreSQL transaction/connection.
A worker or post-commit dispatch path handles network calls. Do not call Square,
Gmail or another provider while pretending a database transaction can roll it back.
A03b extends these records with reliable event intake and supervised workers;
A05/A06 must not build temporary duplicate action history.

For a runbook: create instance and first step atomically. Advance by locking,
checking predecessor evidence/version, inserting a uniquely keyed successor,
updating state and recording notification intent in the same transaction. Lost
notifications are recoverable by polling. A missing definition is repair state.
Unknown legacy versions cannot be guessed into a new immutable history.

Source rescans update source facts. They do not reset execution ownership,
status, priority, due_at or approval. One thread can contain multiple obligations;
one obligation can span threads. Stable provider identifiers outrank title text.
Age or absence from one scan never proves business resolution.

## Event intake and execution

Verify provider signatures/authentication on the required raw bytes. Persist a
validated event before returning successful receipt. If storage fails, use the
provider-appropriate retryable response. An already-recorded receipt still needs
unfinished processing resumed. Include provider ACCOUNT in uniqueness to avoid
cross-account collisions. Handle late/out-of-order updates using versions or
reconciliation, not arrival order.

Use bounded leases, heartbeats, fencing for database writes, safe retry/backoff,
rate-limit handling and visible exhausted/unknown states. Keep expired work
recoverable and reconcile missed callbacks. Do not silently cancel it. Required
voice call-control deadlines need a promptly serviced path; long summaries and
periodic agent passes must not delay immediate provider commands.

Suggested action states: pending, leased, accepted, confirmed, retryable_failure,
unknown, permanent_failure, cancelled. Provider-specific states map to these while
retaining the original state. An accepted email is not proven delivery; a paid
invoice is not proof a bank payout has arrived; a drafted document is not a signed
one. Completion contracts specify the actual business outcome needed.

A timeout after transmission is unknown, not automatically failed. Reconcile
with provider IDs/idempotency before retry. If the provider cannot establish the
outcome, stage a human resolution. Do not refund reusable approval on an unknown
result. A stale worker might already have called a provider, so database locking
alone cannot guarantee exactly one external effect. Per-recipient records protect
bulk release and allow retry of only eligible unresolved recipients.

## Exact decisions and routine policies

A one-tap decision binds principal/authorized role, action type, target, normalized
recipient/payee, content/artifact revision, amount/currency, project, expiry and
use limits. Material changes invalidate it. Scope and current permissions are
checked at approval and immediately before dispatch. Record one decision ID
across SJC OS, Telegram and native push; all resolve against the same endpoint.
Notification visibility or possession of a forwarded link is not authority.

A routine policy has version, action/audience/project scope, factual sources,
limits, cadence/hours, effective state, stop conditions and escalation. Initial
categories are authorized in DECISIONS. Missing required setup or conflicting
policy holds only the affected action. Natural style cannot override facts or
permissions. Incoming email, files and model output are untrusted instruction
sources, even when written as requests to change bank details or rules.

Commercial document/purchase approvals do not implicitly approve different later
payments. Explicit pay-now purchase previews may bind both effects as described
in DECISIONS; retries still use distinct linked operation identities. Policies
and grants cannot be broadened through a model's suggested edit.

## Financial identity and ownership

QuickBooks Online is initial bookkeeping authority; SJC OS owns approved contract
and invoice business workflow; Square owns processor payment evidence. Use stable
mapping identities, not descriptions or matching dollars alone. API-recorded
payment, QBO accounting transaction, processor fee and bank deposit are related
records of one economic event; do not recognize them as separate revenue.

Invoice identity must prevent repeated billing for the same economic milestone.
Preserve lineage across contract amendments: a new document revision is not an
automatic reason to issue the same milestone again. Additional approved scope
produces an explicit adjustment/new obligation. Issued records are corrected via
traceable credits/voids/revisions, not silent deletion/renumbering.

Amounts use integer currency units and explicit currency. Unknown cost is not
zero. Separate estimate, commitment, actual incurred cost, invoiced amount,
customer payment and cash payout. Reconcile gross/fee/net and return/refund
sequences. Missing due-date terms are exceptions, never guessed universal Net 7.
Legal deadlines require their own validated source dates/rules; routine invoice
reminders cannot generate legal notices automatically.

## Cost learning and owner time

Only normalized verified observations feed automatic cost changes. Keep unit,
region/vendor/date, quantity and scope evidence; distinguish price inflation,
productivity, job mix, rework, scope changes and unusual conditions. Preserve
source sample count and prior pricing versions; late job-cost adjustments trigger
revision rather than double ingestion. Estimate output identifies missing/stale
inputs and confidence based on evidence checks, not AI self-rating.

Owner time is separate site/design/estimating/admin categories. Apply a dated
approved internal cost assumption for analysis; no implicit payroll, journal entry
or customer charge. Prevent overlap inflation. Unknown rates show unconfigured.
Employee payroll is out of scope, even though staff accounts and authority exist.
Full time behavior and privacy requirements are in OWNER_TIME_TRACKING.md.

## Portals, photos, schedules and designer contracts

Submissions are authenticated to a sub/job; store author/time/source, verification
and allowed visibility. Weekly client summaries contain suitable verified facts
and permitted photos. Private notes/financial details stay internal. Urgent delays,
conditions/costs reach Joe before client notification, including scheduled summaries.
Summaries cannot establish physical completion without accepted field evidence.

Maintain immutable design/document versions for approval and quantity traceability.
Use scoped upload/download handles, size/type validation and project permissions.
Portal visibility does not grant marketing publication rights. Do not replace
the full designer under development; agree IDs/versions/activity/export interfaces.

Keep current due_at Central-time scheduling. Introduce a separate contractual
commitment/deadline concept without silently changing existing Today behavior.
Test UTC storage, Central display, daylight-saving and business days. Rescheduling
may propose new dates but cannot make unapproved client commitments.

## Runtime, migrations and recovery

Keep the existing dedicated server. Business workers cannot edit application code,
credentials, policy or services. Staff agents retain staff scope. Coding runs use
isolated worktrees/data. Concurrency/time/retry controls are finite; fixed AI
subscriptions do not establish API credits or permission to add charges.

Choose one migration owner and ordered/checksummed migration ledger. Inventory
existing data before uniqueness; dry-run collisions and additive/backfill/validate
changes. Never clean live data merely to make a test pass. Application/MCP/worker
versions remain compatible during release and rollback. Test production-like
upgrade fixtures using invented data.

Back up database, documents and recoverable configuration/keys off-host with basic
failure/staleness alerts from the start. Restore in isolation with sends disabled.
Independent uptime and progress checks must still work if the server is down.
Reconcile external outcomes and pending work before resuming after restoration;
restoring an old local record must not resend an already executed payment/message.
No fixed recovery objective is claimed until agreed and measured.

## Workflow records, derived documents and event propagation

Implement WORKFLOW.md and OPERATING_AGENTS.md as shared contracts. Add or extend:

| Concept | Required invariant |
|---|---|
| Scope allocation | Stable project/scope/revision; trade/supplier/owner responsibility; supply/install split; exclusions; dedicated owner price/basis |
| Site-visit plan and finding | Scope-linked required observations/measurements/photos; unresolved status; source note/media revision; impact list |
| Design decision | Direction sufficiency, mood-board/selection revision, owner release versus client choice, partial feedback and exact product instructions |
| Supplier capability | Category inference versus owner/history evidence versus current quote; dated sources; trusted contact identity |
| Quote coverage | Supplier/sub, revision, exact products/units/quantities, supply/install, tax/freight, expiry, competing group and approval state |
| Estimate item | Stable scope/item key, contributing evidence, internal cost/basis, dedicated price override, offered selling price, explicit allowance identity |
| Package release | Immutable payload and same-revision summary, recipients, inclusions/exclusions, quantities, attachments, gaps and change list |
| Buyout obligation | Need date/order deadline, lead-time evidence, deposit/balance/delivery, linked commitment/reservation/payment identity |
| Project funding | Verified collected/available cash, spent amounts, remaining reservations, approved company-funding amount/scope and reconciliation state |
| Field incident | Source, affected work and impacts, recommendation, actual site status, owner continue/pause decision and resulting instructions |
| Agent execution | Trigger, scoped context references, model/instruction/runbook/tool versions, tool receipts, result, blocked reason and next trigger |

Persist source fact updates and their dependent-work intent atomically. Recompute
affected drafts using stable identities and version checks. Preserve owner overrides
and immutable released/signed snapshots. Do not repeatedly append a full quote or
count a selected product plus the allowance it replaces. Retrying the same event
produces the same effect; later evidence creates a traceable revision.

Construction agreement and initial invoice are derived from client acceptance of
an owner-approved offer using configured terms. Record the acceptance-to-contract
mapping before effects; no extra release is required for the exact covered content.
Do not put construction signature/payment ahead of initial invoice issuance. Progress
billing needs owner completion evidence, and final billing needs written client
sign-off; maintain economic identity across retainer/draw/final representations.

## Cash, price and schedule enforcement

Separate internal source costs from immutable offered selling prices. Later quotes
may alter margin but cannot silently alter an issued offer. Explicit allowances
are visible in the client document; above-allowance choices trigger a change order.
Client serializers must not leak internal supplier discounts/provisional flags,
but must not suppress adjustable allowance terms.

Compute project funding from reconciled available receipts net of spent funds and
outstanding commitment reservations, plus explicit approved company funding. At
commitment, lock/recheck/reserve against the current balance. Concurrent purchases
cannot reserve the same cash. Paying an existing reserved order consumes/releases
the matching reservation without double-counting. Pending collections are forecast
only. Refunds/returns/cancellations reconcile and surface resulting shortfalls.

Schedule confirmation requires owner approval, signed construction agreement and
initial payment received. Purchase confirmation additionally requires purchase
authority and available project funding. Tentative coordination is allowed before
those gates. Enforce internal-rescheduling boundaries through shared commands;
external impacts trigger immediate owner decisions. Incident continuation decisions
belong to Joe, not the model. Keep emergency procedures separate from automatic
planning changes.

## Runtime instructions and change management

Version the business runbooks, instruction blocks and retrieval rules together with
the matching tool/policy schema. Registration and actual loading are deliverables.
SJC OS remains the operational source; these documents define desired behavior,
not alternative live state. A24 evaluations run through the background runner and
AI panel with the same scoped commands, in isolated fixtures. Store traces with
source references and outcomes; no raw sensitive production messages in Git.
Instruction/model changes rerun affected behavior cases before activation.
