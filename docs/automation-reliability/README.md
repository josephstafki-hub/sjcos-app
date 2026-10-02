# SJC OS — complete automation build plan

Revision: September 23, 2026. Prepared for Joseph Stafki.

**Build one coordinated scope. There are no calendar phases, required waiting
periods, or staged feature roadmaps.** Coding agents may develop independent
workstreams together. Dependencies below control integration order; behavior,
security and recovery checks control when a feature may act on live data.

## What this revision replaces

This package consolidates the September 7 audit implementation plan, Fable's
September 16 proposed reorder, the subsequent critique, and Joe's decisions in
this conversation. It supersedes conflicting sequencing, approval assumptions,
fixed pilot sample counts, and deferred-scope language in the earlier package.
A00–A18 identifiers are preserved; A19 covers owner hours, A20 Square payments,
A21 designer integration, and A22 staff approvals. A23 adds the confirmed
lead-to-closeout workflow; A24 delivers operating-agent instructions, context and
behavior evaluations. Split tasks use suffixes.
There is no separate mandatory A05 then A06 build: A05/A06 is one coordinated
approval-and-send work item. The full task ledger contains 28 implementable rows.

This is a build specification, not evidence of implementation or permission for
this planning session to send messages, charge cards, pay vendors, or deploy.
Joe has approved the business policy categories in DECISIONS.md; future agents
should implement those decisions rather than ask the same questions again.
The older root AGENTS.md send rules must be explicitly migrated alongside working
policy enforcement. Do not enable new behavior merely by editing instructions.

## September 23 workflow revision

Joe clarified the process step by step before authorizing this revision. The
business sequence and operating-agent requirements now have explicit contracts
in WORKFLOW.md and OPERATING_AGENTS.md. They supersede conflicting older sequencing
and blanket document-release assumptions. Existing reliability requirements remain.

| Point in the project | Automatic work | Owner touchpoint |
|---|---|---|
| Pre-construction agreement signed | Scope breakdown, site-visit plan, applicable design preparation | Scope allocation, including Joe's own work/pricing |
| Site notes, client feedback or exact finishes arrive | Update affected records and draft estimate; research missing facts | Release revised boards/selections/packages; resolve genuine ambiguity |
| Supplier or sub pricing arrives | Incorporate eligible costs; compare competing quotes | Sub bid selection and competing supplier choice; all quote-request/package sends |
| Client accepts approved formal estimate | Send exact construction agreement/SOW and milestone-based invoice | No additional release for matching derived documents |
| Before construction | Tentative trade coordination, schedule and material buyout/cash plan | Schedule and purchases; signature plus initial payment before commitments; explicit company funding |
| During construction | Compile existing progress/photos, targeted follow-up, bounded internal adjustments | Confirm completion; decide snags; approve externally affecting changes and change orders |
| Closeout and afterward | Track corrections, final invoice on written client sign-off, warranty/care, review request, check-in and learning | Internal QC/corrections confirmed before client walkthrough |

## Read in this order

| File | Purpose |
|---|---|
| [DECISIONS.md](DECISIONS.md) | Confirmed business rules, proposed defaults, setup gaps |
| [WORKFLOW.md](WORKFLOW.md) | Authoritative lead-to-closeout sequence and business gates |
| [OPERATING_AGENTS.md](OPERATING_AGENTS.md) | Runtime behavior, loaded context, proactive actions and model evaluations |
| [TASKS.md](TASKS.md) | All implementation tasks, dependencies and acceptance checks |
| [DESIGN.md](DESIGN.md) | Shared data, command, authorization and recovery contracts |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Square, QuickBooks Online, approvals, designer and Houzz exit |
| [OWNER_TIME_TRACKING.md](OWNER_TIME_TRACKING.md) | Site prompts and active office/designer time |
| [VALIDATION.md](VALIDATION.md) | Failure cases, integrated demonstrations and release evidence |
| [AGENT_HANDOFF.md](AGENT_HANDOFF.md) | Copyable whole-build assignment and coordination rules |
| [STATUS.md](STATUS.md) | Actual implementation state and next work |

## What Joe should experience

SJC OS notices incoming work and keeps responsibility for the next step. Agents
read conversations, collect missing information, prepare documents, compare
results and flag exceptions. Ordinary calculations, schedules and checks use
application code. The application validates authority, carries out actions,
records outcomes and resumes unfinished work after a failure.

Routine factual communication is automatic and written in Joe's natural style.
Purchases, proposals, change orders, refunds, vendor payments and public marketing
wait for one tap from an authorized person. Invoices matching approved contracts
and confirmed milestones send automatically. Subcontractor portal updates feed
weekly client summaries; urgent problems go to Joe first. Scope/bid/pricing-request
and design-package releases need approval; the accepted-estimate agreement and
initial invoice, plus final invoice on client sign-off, follow explicit automatic
rules in WORKFLOW.md. Internal estimate updates require no AI-panel prompt.

QuickBooks Online remains the accounting record initially. SJC OS owns invoice
preparation and the customer experience; Square is the planned card/ACH processor.
Houzz is retired only when online payments and the separately developed full 3-D
designer have working replacements and necessary records are preserved. Job
closeout improves cost estimates using actual materials, subcontractor costs and
verified owner hours. Markup and profit-target changes still require approval.

## What still needs people

Joe or an authorized delegate approves purchases, offers, changes, refunds,
vendor payments and public marketing with one tap. People still perform physical
work, confirm what actually happened on site, resolve unusual or contradictory
information, and make business judgments outside the standing rules. Account
signup, initial pricing choices and ambiguous historical bookkeeping need human
input. The system prepares the evidence and next action so these are decisions,
not repetitive data entry. Location and generated summaries cannot prove work
was performed.

Employees and subs get only their assigned access. Owner time is tracked for job
costing and estimate learning; payroll and replacing QuickBooks are outside this
build. A supplier payment remains visibly pending if no supported payment service
is connected. These limits must be visible instead of being counted as automated
successes.

## Coordinated workstreams

These are concurrent development areas, not dates or release phases. Assign
shared-file/migration ownership before splitting work; define contracts first.

| Workstream | Tasks | Integration responsibility |
|---|---|---|
| Foundation and recovery | A00, A03a, A03b, A09a, A09b | One schema/migration owner; durable events and actions |
| Work and communications | A01, A02, A04, A05/A06, A10–A13 | One obligation and approval model across callers |
| Money and estimating | A07a, A07b, A14, A15, A20 | Invoice/payment identity and financial reconciliation |
| Access and decisions | A08a, A08b, A22 | No staff-to-owner escalation; one decision across channels |
| Field, designer and closeout | A16, A17, A19, A21 | Existing designer/mobile team interfaces and evidence |
| Measurement and procedures | A18 from the start | Truthful baseline, costs, policy/tool version consistency |
| Workflow and operating agents | A23, A24 | Join feature contracts into Joe's workflow; deploy and evaluate runtime behavior |

A01 protection and A07a invoice corrections can integrate after A00 without
waiting for the full worker. A03a includes a minimum permanent action record;
A05/A06 depends on that record, not an undefined future ledger. A03b extends it
into durable intake and supervised processing. Access restrictions and basic
backup failure detection are early protections. Full role/policy/recovery checks
must pass before their respective live features are enabled.

## Source freshness and existing work

Original audit: `77522d1ba0656d0367aad5556430493900064621`.
Repository baseline last inspected September 17 (not refreshed by this September 23 documentation revision):
`43e0eada71d5e34f3122ebebe71e52f26217ceef`.

Targeted inspection found existing staff access areas (`lib/permissions.ts`,
`docs/users-and-access.md`), a client-side action error helper (`lib/run-action.ts`),
cron error notifications, thread-folder work and panel improvements. Extend these;
do not duplicate them. The action helper is not a transactional business command
layer. Current documentation says staff AI-panel access effectively grants owner
capability; A08/A22 must repair that before claiming delegated authority works.

This was a targeted refresh, not another complete code or production audit.
A00 revalidates every finding against the assigned checkout and actual deployed
version. No SJC OS operational MCP tools were exposed during this revision.
The designer is reported in active development on another workstream; its final
repository/branch/contracts must be obtained from that work, not invented here.

## Completion standard

The complete build delivers all tasks, documented integration checks, migrations,
configuration/setup screens, automated tests, and a release/rollback packet.
Unconfigured external accounts are labeled explicitly; they do not justify
stopping unrelated implementation. A feature is not called operational until
its live configuration and outcomes are verified. No fixed two-week or 20-case
observation requirement blocks coding the rest of the scope.

Future QuickBooks replacement and employee payroll are outside this build.
The architecture keeps financial records exportable so a later accounting decision
is possible. Owner time capture and cost learning are included now.
