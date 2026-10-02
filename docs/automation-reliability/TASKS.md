# Complete implementation backlog

Revision: September 23, 2026. This replaces the previous dependency list.
All 28 rows are in the requested build. There are no calendar phases. A00–A18
remain traceable to the audit; suffixes split early repairs from broader work.
A05/A06 is one work item. A19–A22 retain the earlier confirmed additions.
A23 implements WORKFLOW.md; A24 implements OPERATING_AGENTS.md in live agent runners.

**Depends** lists engineering contracts/integration prerequisites. Independent
work can proceed against agreed fixtures while those contracts are implemented.
Live activation additionally requires the applicable authorization, isolation,
monitoring and recovery checks in VALIDATION.md. A completed test does not grant
an agent permission to deploy or make a real purchase.

Read DECISIONS.md for authority and INTEGRATIONS.md for system ownership. Paths
are inspection starting points, not an exhaustive edit list. Re-check current
source before changing behavior; STATUS tracks evidence separately from claims.

## A00 — Current evidence, test environment and migration discipline

**Depends:** none. **Inspect:** AGENTS.md, deploy/README.md, db/schema.sql,
db/apply-*.mjs, package.json, tests/, current MCP capabilities.

Inventory code/deployed/schema versions, workers/timers, integrations, existing
approvals, failure evidence and backups. Use SJC OS read-only when available;
unknown is a valid recorded result. Label original audit scenarios separately
from observed incidents. Establish baseline owner touches/time now with A18.
Create a disposable PostgreSQL harness with synthetic jobs and fake providers,
explicit test connection validation, outbound disabled and safe reset. Inventory
historical apply scripts; establish ordered new migrations and checksums without
blindly replaying old seed/apply files. Reuse existing infrastructure.

**Accept:** fresh and representative upgrade fixtures reproduce; test DB cannot
silently resolve to production; exact existing test commands/results are recorded;
evidence gaps and active-team file ownership are documented. No sensitive records
in Git. A missing production login blocks live claims, not local implementation.

## A01 — Stable obligations and protected task state

**Depends:** A00. **Inspect:** scripts/upsert-inbox-work-items.mjs,
lib/comms-shared.ts, lib/reminders.ts, lib/detectors.ts, lib/gmail.ts,
lib/lead-thread-sync.ts, db/apply-scheduled-snooze.mjs.

First remove stale-age/scan-absence cancellation and prevent source refresh from
resetting owner, status, priority, approval or scheduled work. Then add stable
message/event and distinct obligation identity across open/closed records. Stop
merging known identities by title. Preserve multiple promises per conversation.
Use checkpointed mailbox catch-up and obligation-level reply handling, including
older, unmatched and post-closeout work. Unknown identity becomes a review item.

**Accept:** replay cannot resurrect done work or overwrite active work; unrelated
same-title sources remain separate; a new promise in an old thread becomes new
work. More than 150 relevant threads and an older unanswered issue beside a new
answered one are handled. Existing Central-time Today scheduling remains intact.
Migration uses a collision report and explicit legacy resolution, not mass merge.

## A02 — Transactional runbook start, advance and repair

**Depends:** A00, A03a. **Inspect:** lib/runbook-engine.ts,
db/apply-runbook-instances.mjs, app/api/internal/runbooks/route.ts, work-item tools.

Create the instance/first task atomically. Advance under one database transaction:
lock instance, validate pinned definition/predecessor, create uniquely keyed next
step, update progress and record wakeup intent. Keep network calls outside it.
Version definitions immutably. Missing definitions or unprovable legacy versions
enter repair/review, never false completion. Add bounded missing-step repair and
recoverable worker notification; leases come from the shared worker contract.

**Accept:** process death at every write boundary and concurrent start/advance
create no stranded or duplicate step. Changed definitions do not alter active
instances. Repair is replay-safe, logged and dry-runnable. Rollback retains
accepted tasks and evidence. Do not falsely assign old work to a guessed version.

## A03a — Shared server commands and minimum action records

**Depends:** A00. **Inspect:** lib/db.ts, lib/actions/*, mcp/sjcos-mcp.mjs,
lib/agent-sends.ts, lib/newsletter-outbox.ts and lib/run-action.ts.

Implement shared server-side command infrastructure with trusted principal,
request key, input hash/version, authorization reference and stored result.
Use separate typed business commands, not one enormous generic dispatcher.
Minimum permanent external-action intent and append-only attempt records belong
HERE, before send safety. Persist business state plus intent/audit atomically;
perform external calls after commit. Concurrent same-key retries reuse the result;
changed inputs fail. Reuse existing outboxes with explicit ownership of dispatch.
The existing client error/toast helper stays; it does not supply this contract.

**Accept:** database races produce one intent; rollback produces no dispatchable
intent; caller cannot spoof Joe; result/error is truthful. UI/MCP/cron/internal
callers migrate per feature with no unsafe legacy bypass. A03b extends these same
records instead of introducing a second ledger or sender.

## A03b — Durable intake and supervised worker

**Depends:** A03a, A05/A06. **Inspect:** app/api/voice/webhook/route.ts,
lib/voice.ts, lib/call-notes.ts, existing cron/outbox code and deploy/.

Verify and persist provider/account/event identity before acknowledging receipt.
Worker claims bounded leases with heartbeat/fencing, retries safe operations with
backoff, reconciles unknown outcomes and exposes exhausted work. Duplicate receipt
is not proof of completed effects. Lost wakeups recover through polling. Migrate
voice intake and other required adapters with prompt call-control latency; separate
immediate call actions from later summaries. Reuse newsletter dispatch ownership.

**Accept:** invalid signatures cannot act; unavailable persistence cannot produce
a successful acceptance acknowledgment. Duplicate/late/out-of-order events, worker
death and lost wakeups recover correctly. Fake provider tests include latency,
acceptance-then-timeout and stale workers. No blanket replay of historical events
into real recipients. Basic worker failure signals ship with the worker.

## A04 — Evidence-backed completion

**Depends:** A02, A03a. **Inspect:** completion tools in mcp/sjcos-mcp.mjs,
lib/runbook-engine.ts, lib/call-notes.ts, lib/comms-shared.ts and direct done writes.

Each automated step has a typed output/postcondition. A shared completion command
validates authoritative artifact/record revisions and appropriate evidence before
committing done/advance. Draft, provider acceptance, delivery and business response
are different outcomes. Manual resolutions record actor/reason without invented
receipts. Call summaries and follow-up task creation progress independently and
recover only missing actions. Ambiguous person/date/project becomes a question.

**Accept:** stale/wrong/missing evidence rejects completion on all callers; valid
retry creates one successor; partial call action failure resumes correctly.
Legacy unsupported completion is reported for review, not manufactured proof.

## A05/A06 — Approval binding and duplicate-safe external actions

**Depends:** A03a. **Inspect:** lib/owner-grants.ts, lib/owner-grant-types.ts,
lib/agent-sends.ts, newsletter/PO adapters, owner-click and stage-change callers.

Bind decisions to principal/scope, action, target, recipient, content/artifact
revision, amount/currency, expiry and uses. Atomically reserve/consume against the
permanent intent. Record attempts and provider IDs. Use provider idempotency when
available. Unknown acceptance holds authority pending reconciliation: no blind
retry or refund. Bulk actions track individual recipients. Check revocation,
opt-out and input revision at dispatch. Preview compound owner-click effects.
Migrate one adapter at a time, prioritizing verified incidents; do not assume
an unreported duplicate has occurred.

**Accept:** concurrent or repeated taps produce one intended effect; changed
content/payee/price invalidates authority; accepted-then-timeout reconciles without
resending. If the provider cannot establish the outcome, hold for resolution.
No database lock is advertised as an exactly-once guarantee for an external API.
Unresolved recipients alone are eligible for safe retry. Preserve existing grant
restrictions until A10/A22 policy migration is deployed with enforcement.

## A07a — Small independent invoice integrity repair

**Depends:** A00. **Inspect:** lib/actions/money.ts, lib/actions/projects.ts,
lib/draw-schedule.ts, lib/reminders.ts, db/schema.sql.

Create stable milestone/contract invoice identity and atomic invoice linkage;
replace count-based display numbering with concurrency-safe allocation. Stop
claiming failed sends succeeded. Correct reminder dates where contract terms
are verified; unknown terms become exceptions. Produce a read-only existing
invoice collision report. Implement minimal shared billing service boundaries
that A07b can extend; do not wait for a broad accounting redesign.

**Accept:** concurrent/replayed milestones create one invoice; failed send never
reports sent/paid; identical economic milestones survive unrelated contract
revision without accidental rebilling. Issued invoices are neither deleted nor
renumbered by migration. No blanket historical send or balance correction.

## A07b — Invoice lifecycle, balances and automatic contract billing

**Depends:** A07a, A03a, A05/A06. **Inspect:** money/project actions,
lib/record-ops.ts, invoice/payment schema and A14/A20 integration contracts.

Separate issued amount, delivery, cash/payment status and external-sync status.
Represent partial payments, credits, voids, refunds/returns and revisions without
losing the original audit. Enforce contract/stage evidence through shared commands,
not just display guidance. Apply WORKFLOW W08/W10/W12: client acceptance of the
owner-approved formal estimate automatically issues the initial invoice under the
predetermined structure, even before the construction agreement is signed. Progress
billing requires Joe's milestone confirmation; final billing follows written client
sign-off after punch resolution. Preserve retainer/split-payment identities and
link the acceptance-based initial invoice to the resulting contract without rebilling. Use verified balance/due dates for
routine reminders; hold on disputes, pending payment or uncertain reconciliation.

**Accept:** partial payment/credit/return sequences preserve the right balance;
zero balance stops reminders; unapproved changes cannot alter issued obligations;
all callers enforce the same gate. Missing contract/rate/milestone evidence stages
a decision. Legal notices remain separate controlled work, not ordinary reminders.

## A08a — Immediate business-agent access restrictions

**Depends:** A00. **Inspect:** scripts/run-claude-agent.mjs, lib/dev-agents.ts,
lib/orchestrator/, lib/permissions.ts, docs/users-and-access.md and runtime config.

Separate the business profile from coding/shell/repository/service/secret access
as far as current runtime permits. Finite time/retry limits apply immediately.
Inventory production credentials and remove unnecessary reach. Do not justify
broad privileges on the basis that Joe approves sends. Until scoped AI tools are
available, restrict owner-powered AI sessions to the owner; staff access must not
be expanded as a shortcut. Coordinate A22 to replace this temporary restriction.

**Accept:** business fixture prompts cannot edit controls, read unrelated secrets
or change payees; intended existing business tools still work. Record residual
limitations. No claim that a prompt instruction alone enforces isolation.

## A08b — Enforced worker identities, budgets and recovery

**Depends:** A08a, A03b, A22. **Inspect:** business/coding service profiles,
MCP auth, model runners and supervised worker configuration.

Use scoped database/provider/tool credentials and delegated-user/project identity
for every worker. Coding agents use isolated checkouts and synthetic data. Enforce
finite runtime/retry/concurrency controls and meter usage; respect provider account
terms and verified supported authentication. Do not assume a consumer subscription
includes API allowance. No new paid service/API spending without purchase approval.
Multiple-model review is optional where evidence shows value, not a required loop.

**Accept:** malicious email/file cannot gain shell, permissions or financial
authority; revocation applies mid-session before effects; hung work ends visibly
and can recover without duplicate actions. Staff requests never run as Joe merely
because they came through an AI panel.

## A09a — Off-host backups, basic alerts and restore proof

**Depends:** A00. **Inspect:** deploy/, DB/attachment/config storage.

Build encrypted off-host database, uploaded-file and recovery-config backups,
retention, recoverable key management and immediate backup failure/staleness
alerts. Test restore into isolation with external dispatch disabled and verify
DB/file consistency. Include UPS requirements for server plus modem/router;
actual equipment purchase/installation is a setup item. No hosting move required.

**Accept:** timed restore recovers representative files/relationships/pending work;
failed/stale backups alert; recovery instructions work without the lost host.
Report measured recovery time/data loss. A nightly option is not permission to
lose 24 hours of records. Reconcile external actions after restoring before sends
resume. Do not mark hardware or off-host accounts configured if they are not.

## A09b — Independent uptime and business-progress monitoring

**Depends:** A09a, A03b. **Inspect:** deploy/sjcos-mcp-watchdog.*, MCP health,
app/api/cron/_lib/guard.ts, services and reconciliation jobs.

Keep existing cron error handling; extend it with independent host-down detection,
DB readiness, worker heartbeat, oldest pending obligations/actions, expired leases,
unknown sends/payments and last successful workflow. Use approved owner channels,
with deduplication and escalation when alerts cannot be delivered. Show code,
schema, policy and configuration versions. Document safe staged build/rollback.

**Accept:** simulated host/DB/worker failures generate actionable alerts and
correct recovery; monitoring works when the application is down. Graceful handling
of provider rate limits does not hide indefinitely unprocessed work.

## A10 — Automatic routine policy and one-tap decision surfaces

**Depends:** A05/A06, A22. **Inspect:** owner grants/decision UI,
lib/agent-interactions.ts, notifications and current live SOPs through MCP.

Implement DECISIONS authority matrix and WORKFLOW's action-specific exceptions.
Routine factual communication is automatic; scope/bid/supplier-pricing requests
and mood-board/selection packages require exact release approval. Construction
agreement/SOW and initial invoice derived from client acceptance are automatic;
progress/final invoice triggers follow W10/W12. Other commitments/payments/marketing
retain their one-tap rules. Ready-package summaries show recipient, scope, exclusions,
quantities, attachments, gaps and changes, with full preview and individual release. One immutable decision is shared by SJC OS, temporary
Telegram and future mobile push. Authentication, current delegated authority,
expiry/revision and replay checks apply on the server. Approval durably resumes
work; reject/edit/snooze are explicit. Build finite policy scope/cadence/hours,
stop conditions, escalation and kill switch. Migrate root operating instructions
and versioned policy together; Joe's settled categories need no repeated approval.

**Accept:** cross-channel repeated taps act once; stale/unauthorized approvals fail;
revoked staff cannot approve through old notifications; paused dispatch retains
unknown effects. Natural-language tests remain factual and avoid invented personal
claims. Existing newsletter drip arming stays owner-controlled.

## A11 — Complete lead intake and follow-up

**Depends:** A01, A04, A10, A03b. **Inspect:** lead intake/reply/nurture,
lib/detectors.ts, call notes and approved lead SOP/runbooks.

Match intake; collect qualification facts/photos/measurements; follow up naturally;
update records and stop redundant contact on reply/decline/opt-out. Separate missing
information follow-up from approved longer nurture. Preserve immediate human-call
preference where current SOP confirms it; agent never invents a completed call.
Prepare a traceable estimate-input package and hand it to A15. Route unusual scope,
disputes and genuine business choices to a decision, not every email.

**Accept:** unknown identity, multiple open issues, direct owner replies and
incomplete information work correctly. No unsolicited quote/price/acceptance beyond
approved authority. Measure actual completion and owner time. Shadow/review tools
are included without requiring a calendar pause or number of real leads.

## A12 — Subcontractor paperwork collection

**Depends:** A01, A04, A10, A22. **Inspect:** sub records, compliance reminders,
portal/file/bid tools and current document requirements.

Detect missing/expiring documents, request correct contact, follow up, associate
exact versions with the right sub/job, validate required metadata and resolve
only when accepted. Receipt is not proof of insurance coverage or tax validity.
Sensitive documents use restricted storage and synthetic test copies. Sub roles
are distinct from internal staff permissions.

**Accept:** wrong-job/unreadable/expired/duplicate files produce appropriate
exceptions; accepted documents stop contact; another sub cannot access documents
by changing IDs. Missing professional interpretation escalates with evidence.

## A13 — Procurement, commitments and approved bill payment

**Depends:** A01, A04, A10, A07b. **Inspect:** purchase-order/vendor/file/MCP tools
and current service procurement procedures.

Prepare orders/bid awards under one-tap commitment approval. Apply WORKFLOW W05–W09:
stage every supplier pricing request and bid package for approval; choosing a bid
for an estimate is not an award. Build material buyout dates from need dates, lead
times, delivery and payment terms. Compare expected milestone collections to all
project outflows, but enforce actual collected cash net of spent/reserved funds for
commitments. Reserve cash atomically; order-to-bill conversion must not double-count.
Company cash requires explicit scoped funding approval. Purchase approval never
bypasses construction signature/initial-payment or funding gates. Track acknowledgement,
promised date, received, reviewed, accepted and payable separately; multiple orders
and deliverable revisions per vendor must remain distinct. Enforce vendor
restrictions and current approved manual marketplace steps. Use scoped file handles,
not large base64 payloads. Represent engineering/owner blockers explicitly.
Prepare a separate payment decision unless pay-now charge was clearly included in
the order approval. Unsupported payment rail remains manual-completion pending.

**Accept:** partial/late/wrong/revised deliveries reconcile; price/payee changes
invalidate approval; nothing becomes payable merely because a file arrived.
Approved payment retries cannot duplicate disbursement. No invented vendor-bank
integration or silent auto-payment. See INTEGRATIONS for setup boundary.

## A14 — QuickBooks Online connection and reconciliation

**Depends:** A07b, A03b. **Inspect:** cost/invoice schemas and current QBO developer
documentation; company/account mappings are setup inputs, not guessed IDs.

QuickBooks Online remains authoritative bookkeeping; use existing bank/card feeds.
Build read/import for supported posted entities and a reviewed export fallback.
Also build controlled mappings/adapter for SJC-issued invoices, confirmed payments,
refunds and fees to QBO as needed, with a clear enable switch per direction.
No generic bidirectional overwrite. Match existing transactions before creating
records; record external IDs, versions, cursors, voids and unresolved mappings.
Separate job actuals, commitments, invoices and cash; support owner review of
unmapped records and authoritative edit conflicts.

**Accept:** repeated import/export creates no duplicate revenue/cash; gross payment,
processor fee and net deposit reconcile; externally edited/voided records surface;
partial payments/refunds preserve both systems' balances. Existing bank-feed
matching is retained. Unavailable/unposted bank-feed details are not fabricated.
No new Plaid/custom bank feed or custom ledger replacement in this task.

## A15 — Evidence-based estimates and closeout cost learning

**Depends:** A14 core cost contract; consume A19/A21 contracts when available.
**Inspect:** lib/estimates.ts, lib/cost-book.ts, lib/cost-book-units.ts,
estimate actions and current rough/final proposal templates.

Build rough ranges and detailed fixed-price proposals, initially supported by
configured assemblies/scopes and honest unsupported-scope exceptions. Coordinate
quantity inputs with designer revisions. Prepare initial pricing setup because
rates, markup/profit targets and allowances are not settled. Evidence checks use
scope completeness, quantities/units, source/date of prices, sub quotes, exclusions,
uncertainty and margin arithmetic—not model self-confidence. Implement W04–W07's
three design paths, active feedback handling, online price discovery and supplier
learning. Maintain a live draft from client products, choices, approved sub bids,
eligible supplier quotes and owner pricing without an AI-panel prompt. Competing
supplier offers require approval. Preserve source coverage, units, owner overrides
and allowance replacement without duplicates. Missing inputs trigger research,
staged pricing requests or a targeted question. Joe may approve online-priced fixed
items or explicit allowances. Internal cost uncertainty stays internal; client
allowances are clearly labeled. Freeze offered prices at send; later cost changes
adjust internal margin, never automatically the client price. All revised offers
and change orders require fresh release approval.

At closeout compare estimated versus verified actual costs/hours by scope. Keep
dated source history and sample support; separate inflation from scope changes,
rework, geography, unusual conditions and bad coding. Normalize units and prevent
outlier/small-sample data from silently replacing established assumptions. Verified
costs may update automatically with audit/rollback; markup/profit changes require
approval. Owner-hour rates remain explicit assumptions, not new payroll entries.

**Accept:** held-out job evaluation reports errors and review effort honestly;
stale/unknown prices never become zero; estimate changes invalidate prior approval;
repeated closeout ingestion does not amplify the same evidence. Reviewable learning
explains what changed and why. Broad scope support is limited by evidence, not a
single job type hard-coded into the architecture.

## A16 — Sub portal field evidence, scheduling and weekly client summaries

**Depends:** A04, A10, A22. **Inspect:** sub logs/uploads, project daily logs,
lib/schedule.ts, schedule actions and weekly-status/client portal code.

Subs submit photos/progress against authorized jobs. Record author/time/activity,
source and visibility. Build weekly client-facing portal summaries and configurable
notification/delivery, derived from verified suitable facts/photos. Keep internal
notes, prices/private files and unconfirmed claims out. Urgent delays, unexpected
conditions and added costs go to Joe first; hold affected client content pending
his decision without suppressing unrelated factual progress. Do not declare a
milestone complete solely because generated prose says so.

Implement WORKFLOW W09–W11: prepare tentative availability and a full schedule for
owner approval; signed construction agreement and received initial payment also
precede confirmed commitments. Automatically adjust internal tasks only within the
approved no-external-impact/no-cost-increase/no-funding-gap boundaries. Immediately
alert Joe on any client/sub schedule impact or snag, with recommendation; Joe decides
whether affected work continues. Use already-supplied progress/photos in weekly
sub reports; request only missing details. Completion reports trigger photo requests
only when needed, then Joe's confirmation before applicable billing. Prepare priced
out-of-scope change orders automatically for approval. Use material/crew/inspection
dependencies; real people confirm physical work. Preserve due_at Today semantics, adding separate contractual
deadlines explicitly. Any client commitment or scope/price change follows its gate.

**Accept:** source links trace each summary claim/photo; duplicate uploads and
missing/conflicting updates do not invent progress; urgent content is not leaked
in the scheduled summary. Cross-job isolation, Central dates, daylight-saving,
crew conflicts and delayed prerequisites work. Weekly publishing is replay-safe.

## A17 — Closeout, warranty, signed documents and approved marketing

**Depends:** A04, A07b, A10, A16. **Inspect:** closeout/project actions,
lib/client-portal.ts, lib/sub-portal.ts, portal routes, document/signature,
warranty and marketing code.

Enforce applicable punch/inspection/document/acceptance/payment conditions and
explicit exceptions. Implement WORKFLOW W12: organize Joe's internal inspection and
sub corrections, obtain Joe's confirmation before scheduling the client walkthrough,
resolve client punch items and record written client sign-off. That sign-off triggers
the final reconciled invoice automatically with remaining approved CO balances,
payments and credits applied. Automatically deliver applicable warranty/care documents,
request a review and arrange the configured check-in; do not invent timing/coverage.
Pin signed documents and releases to immutable revisions.
Generate warranty obligations from verified terms; distinguish residential and
commercial requirements without invented legal rules. Complete cost/time closeout
feeds A15; late financial adjustments create a traceable learning revision.
Draft appropriate marketing from authorized photos with separate publication
rights and one-tap release. Retain owner-only newsletter drip arming.

**Accept:** cross-project IDs/revoked links fail, multi-job sub visibility is
correct, private portal media stays private, missing closeout evidence blocks the
applicable transition. Content/audience changes void approval. Withdrawal of rights
stops queued publication; automation never assumes portal visibility permits ads.

## A18 — Baseline, overhead, learning governance and truthful procedures

**Depends:** A00. **Inspect:** skill/runbook tools, lib/agent-memory.ts,
usage records and procedures; consume other feature events as they land.

Start owner-time/touch measurement now; dashboard expansion can follow. Track
eligible cases, verified outcomes, corrections, missed commitments, unknown effects,
latency and support effort. Keep fixed subscriptions and actual metered charges
separate; seed reported Anthropic $200 and OpenAI $10 as owner-reported recurring
overhead, reconcile to bills/QBO to avoid double-counting. Do not assume subscription
fees include API credits. Provide optional thresholds and finite run limits without
making a new budget survey block the build.

Version policies/procedures/tool references; detect missing tools/retired fields/
contradictions. Distinguish one-job preference, factual correction and proposed
company rule. Do not auto-promote unapproved authority/pricing changes.

**Accept:** failures stay in denominator; manual review counts as owner time;
costs reconcile and unknown estimates are labeled. Capability status separates
implemented/deployed/enabled/proven. Proposed rules do not silently become authority.

## A19 — Owner site and office time capture

**Depends:** A03a, A22; coordinate A21 designer interface.

Implement OWNER_TIME_TRACKING.md: phone location suggests job clock-in, departure
suggests clock-out; active designer work records job/category time with idle,
overlap and offline handling. Manual timers/corrections cover outside-app work.
Test native app behavior on devices; use explicit location permissions and no
continuous route/screenshot/keylogging collection. No employee payroll.

**Accept:** location does not prove labor; passing a job cannot create a confirmed
session; multiple devices/site-plus-office sessions cannot double-count time.
Uncertain intervals remain reviewable. Verified hours feed A15 with dated approved
owner-cost assumptions; no automatic customer charge or QBO expense is generated.

## A20 — Square card and ACH customer payments

**Depends:** A07b, A05/A06, A03b, A22. **Inspect:** invoice preview/payment surfaces,
client portal routes; follow INTEGRATIONS.md and current Square documentation.

Build invoice-bound checkout, sandbox adapter, setup/connection status and secure
Square client tokenization/server payment flow. Support cards and US bank transfer.
No Square account exists yet; use fixtures/sandbox during build, clearly distinguish
unconfigured from ready. Server calculates allowed outstanding amount and maps every
attempt to an invoice revision; never trust a browser's paid flag or amount.
Handle pending, completed, failed, returned, refunded and disputed states; verify
callbacks and reconcile missed events. Route refunds through one-tap decisions.

**Accept:** repeat taps/webhooks/timeouts do not duplicate charges; pending ACH is
not paid; late failure/return restores the correct balance without fabricating new
invoices. Stale amounts/links fail; card data/secrets never enter model context or
logs. Deposits/installments respect Square's actual constraints and invoice mapping.
Gross/fees/net payouts reconcile through A14. Merchant account approval is required
before live use; do not claim collecting funds also supplies vendor disbursement.

## A21 — Integrate existing full 3-D designer and retire Houzz dependency

**Depends:** A00, A22. **Inspect:** components/projects/FloorPlan.tsx,
lib/actions/floorplans.ts, designer/mobile workstream contracts and current exports.

Coordinate with agents already building the full designer. Reuse project/design
IDs, versions, permissions, assets, quantities and exports; feed active-use events
to A19 and traceable reviewed quantities to A15. This task integrates a full design
experience; a static image/2-D placeholder is not a Houzz replacement. Obtain the
actual designer scope/repo/branch before changing it. Record feature/import gaps
and assign them to its existing owner rather than building a second planner.

Prepare Houzz exit covering payments, design files, prior invoices/payment history,
open client links and any still-active automations. Test card/ACH replacements,
necessary designer workflows and record access before Joe cancels the service.

**Accept:** design revisions survive save/export/reopen; portals enforce visibility;
quantity/time events identify the correct revision/job; no double designer work.
Unsupported editable imports are explicit with archive/export fallback. Cancellation
or deletion is never an automatic consequence of merging integration code.

## A22 — Delegated approvals and employee accounts

**Depends:** A03a, A08a. **Inspect:** lib/permissions.ts, lib/dal.ts,
lib/api-auth.ts, lib/actions/users.ts, components/settings/TeamAccess.tsx,
docs/users-and-access.md, owner-grant and AI runtime identity paths.

Extend existing staff accounts rather than recreate them. Separate view/edit areas
from approve/execute authority, grantable by action type, project and optional
amount limits. New accounts have no approval authority. Joe can configure his
wife's account without payroll. Use principal-aware shared commands and scoped
agent delegation; the current ai permission must not implicitly grant Joe's tools.
Adapt owner-only decision screens for scoped eligible approvers while retaining
owner-only authority administration. Protect sensitive finance fragments in shared
surfaces as well as dedicated routes. Recheck authorization at approval and dispatch.

**Accept:** a staff member with estimates access but no approval authority cannot
issue a proposal or ask the agent to bypass the gate. Revocation works without
re-login and through stale Telegram/push buttons. Dollar/project bounds apply
on all callers; unauthorized data is not exposed via AI or shared-page snippets.
Policy/permission edits cannot be self-approved through an agent.

## A23 — Confirmed lead-to-closeout workflow and proactive estimate assembly

**Depends:** A02, A03b, A04, A10, A11, A13, A15, A16, A17, A21.
**Inspect:** existing stage/runbook definitions, signature handlers, project scope,
estimate/design/quote/package commands, scheduling/buyout records and owner decisions.

Implement WORKFLOW W01–W12 using shared feature commands rather than parallel
business logic. Register signature/reply/note/quote/choice/approval/payment/report/
sign-off triggers, structured prerequisites, completion evidence and durable next
actions. Keep one project history with independent scope/design/quote branches.
Add explicit source-to-estimate mapping, item/quote coverage, committed client-price
snapshots, allowance identity, scope allocations, site-visit plans and package review
cards. Expose blockers and existing owner decisions without duplicate to-dos.

Integrate construction agreement/initial invoice issuance on accepted estimate,
cash-aware buyout and scheduling, owner-controlled snags, field-evidence confirmation,
and automatic final invoice/post-project follow-through. Signature-triggered scope
preparation cannot depend on paid status. Scope approval cannot imply package send.

**Accept:** V31–V45 pass through actual feature entry points and real PostgreSQL for
state/race checks; integrated story advances without AI-panel prompts except explicit
owner/client decisions and supplied site evidence. Every W step maps to a runbook,
policy, command, evidence and recovery path. Existing issued/signed records stay
immutable; legacy project migration is reviewed, never a mass replay of sends.

## A24 — Operating-agent instructions, context and behavior evaluations

**Depends:** A03b, A08b, A10, A18, A23.
**Inspect:** current agent runners, MCP skill/runbook registration, instruction
loading, retrieval/context assembly, AI-panel and background-worker tool bindings.

Implement OPERATING_AGENTS.md as versioned instructions/skills/runbooks actually
loaded by relevant agents. Provide current scoped project context and tools for
the next authorized action, including feedback processing, supplier reasoning,
estimate updates, evidence-aware follow-up and concise approval summaries. Use
event wakeups and repair sweeps; do not rely on Joe opening the panel or repeatedly
explaining the process. Enforce finite runs and retain blocked obligations.

Run the configured model on multi-message synthetic scenarios using the actual
runner and scoped tool harness. Record model/instruction/tool versions, tool trace,
resulting records, owner prompts, latency and cost. Diagnose missing context/tools
before changing models. Route difficult reasoning to an approved capable model when
needed, with re-evaluation and existing spending controls; no arbitrary model upgrade
or mandatory multi-model loop substitutes for measured behavior.

**Accept:** V31–V46 pass as applicable with real operating-model behavior as well as
deterministic enforcement. V46 proves instructions are loaded in both background
and panel paths. No unapproved action/false completion can be averaged into a pass.
Provide actual evaluation results, deployment/rollback instructions and loaded-version
evidence; supplying unregistered prose alone fails the task.

## Audit coverage and scope traceability

| Audit finding | Tasks |
|---|---|
| F01 Human-default intake / overwrite | A01, A10–A13 |
| F02 Identity and stale cancellation | A01 |
| F03 Detection coverage | A01, A11 |
| F04 Stranded workflow transitions | A02, A03a, A03b |
| F05 Completion without evidence | A02, A04 |
| F06 Non-durable intake | A03b |
| F07 Broad approvals | A05/A06, A10, A22 |
| F08 Unknown-send retry/refund | A03a, A05/A06 |
| F09 Different authority by caller | A03a, A05/A06, A07b, A22 |
| F10 Combined business/code authority | A08a, A08b, A22 |
| F11 Review after actions | A05/A06, A08a, A08b |
| F12 Billing races | A07a, A07b |
| F13 Collection clock | A07a, A07b, A14 |
| F14 Advisory gates | A04, A07b, A16, A17 |
| F15 Recovery and monitoring | A00, A09a, A09b |
| F16 Instruction drift / weak learning proof | A10, A15, A18 |

New decisions are covered by A10 (authority/style/channels), A14/A20 (QBO/Square),
A15/A19 (pricing and hours), A16 (weekly/urgent client updates), A18 (overhead),
A21 (designer/Houzz exit) and A22 (delegated accounts).

September 23 additions: A23 owns the W01–W12 business workflow integration;
A24 owns the deployed operating-agent behavior and evaluation. They extend rather
than replace A10/A13/A15/A16/A17. Feature tasks must expose the contracts A23 uses;
A24 adds runtime reasoning/behavior without moving server authority into prompts.
