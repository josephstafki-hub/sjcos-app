# Whole-build assignment for coding agents

Revision: September 23, 2026. Joe wants the complete scope built as one coordinated
project. Independent workstreams may proceed together. Technical dependencies and
release checks remain; calendar phases and fixed observation quotas do not.

## Copy this assignment

> Implement the complete SJC OS automation build in
> `docs/automation-reliability/`. Read root and applicable nested `AGENTS.md`, then
> README.md, DECISIONS.md, WORKFLOW.md, OPERATING_AGENTS.md, TASKS.md, DESIGN.md, INTEGRATIONS.md,
> OWNER_TIME_TRACKING.md, VALIDATION.md and STATUS.md. Deliver all 28 task rows,
> including owner hours, Square checkout, existing full-designer integration and
> scoped staff approvals, the confirmed W01–W12 workflow and actual operating-agent
> instruction loading/context/evaluation. Do not stop after A00 or return only
> another plan. A24 is not satisfied by writing instructions that no runner loads.
>
> First reconcile the current checkout and in-progress teams with this package.
> Use SJC OS MCP read-only for operational evidence when available; otherwise label
> live state unknown and continue local work. Define shared contracts and claim
> work/file ownership. Build ready independent tasks together in isolated branches
> or worktrees; integrate dependencies through small compatible changes. Reuse the
> existing designer/mobile work and current account/permission infrastructure.
>
> Follow Joe's confirmed decisions in DECISIONS.md without repeating the previous
> questionnaire. Implement missing external-account setup and adapter fixtures now;
> record only the concrete inputs needed to enable each integration. Preserve
> existing enforcement until its tested replacement is ready. Check every caller,
> use ordered additive migrations and synthetic fixtures, and test the actual
> business outcomes and failure paths in VALIDATION.md.
>
> Update STATUS.md in every implementation PR with exact results, remaining gaps,
> migration IDs, activation and rollback. Deliver working integrated code, tests,
> setup surfaces, accurate operating instructions and a release packet. Clearly
> separate implemented code from deployed/enabled/proven features. This assignment
> does not itself authorize production migration, deployment, account purchases,
> customer sends, charges, vendor payments or destructive historical cleanup;
> use the authority in the active implementation session for those actions.

## Coordinate before overlapping edits

Assign one integration owner for schema/migration ordering, shared server command
contracts, principal/permission types, and event/action/provider interfaces. Record
branch, claimed task/slice and affected files in the existing coordination process
and STATUS.md. A task has one accountable owner even when several agents contribute.

Suggested independent assignments are the seven workstreams in README.md. A00 defines
the disposable environment and current evidence. A01/A07a/A08a/A09a/A18 can then
progress without waiting for the full worker. A03a provides the minimal durable
command/action contract; A05/A06 uses it; A03b extends the same records. Agree
interfaces with A14/A19/A21 early so estimate, money, designer and time work can be
implemented against shared fixtures instead of blocking each other.

Do not let several agents independently invent invoice IDs, approval tables,
payment states, worker outboxes, migration numbers or account permissions. Shared
file owners review changes crossing their contract. Record dependency readiness,
not just branch completion. Rebase/merge with current work; never reset or overwrite
another agent's branch to make integration easier. The designer already has its
own active team: obtain its actual repository/branch and interfaces, then assign
remaining feature gaps to that team instead of creating a competing planner.

## Start each implementation session

1. Inspect current source, repository status and claimed work. Original audit
   baseline was `77522d1ba0656d0367aad5556430493900064621`; the September 17 targeted
   refresh used `43e0eada71d5e34f3122ebebe71e52f26217ceef`. New changes may already
   resolve old findings. Reproduce before fixing.
2. Read applicable operating rules and relevant installed framework guides. Use
   live SJC OS evidence when available; do not mistake old exports for current
   business state. Never copy private snapshots or credentials into Git.
3. Claim a ready task/slice and identify its callers, shared contracts and tests.
   When an interface is pending, coordinate a fixture contract and continue useful
   implementation; do not silently change the other team's assumptions.
4. Carry the slice through behavior, callers, migration, tests and documentation.
   Finish one reviewable result before calling it implemented, then take the next
   ready task. An account-setup gap should not stop unrelated deliverables.

## Non-negotiable behavior

- Server-derived identity and current scope on every action. Staff AI access must
  never turn a limited user into Joe. Instructions alone are not access controls.
- Approval is bound to the exact action; one tap across channels resolves one
  decision. Purchase approval does not silently authorize a later payment.
- Routine facts and contract-matched milestone billing become automatic only
  through the matching implemented policy. Existing newsletter drip arming remains
  owner-controlled. Never loosen AGENTS.md alone to make tests or sends work.
- Persist action identity before the external call. Unknown outcomes reconcile
  before retry. Provider acceptance is distinct from delivery/payment completion.
- Preserve the existing Central-time due_at Today rule. Keep financial deadlines
  separate from planned work dates through explicit migration.
- Preserve issued invoice identity and historical evidence. Use collision reports;
  no mass merging, renumbering, replay, deletion or guessed reconciliation.
- Use QuickBooks Online initially, existing dedicated hosting and the existing
  designer/mobile effort. No incidental custom accounting replacement, new bank
  feed, payroll build or paid hosting move.
- Owner time supports costing and learning; location is not proof of labor and
  internal labor assumptions are not automatic payroll/bookkeeping entries.

## Workflow and runtime completion obligations

- Do not gate W02 preparation on payment or the site visit; verify the signature.
- Scope allocation does not release packages. Every bid/pricing request and revised
  design package has a concise accurate approval summary and a ready notification.
- Client-specified finishes bypass selection boards. Client feedback, selections,
  approved bids and eligible quotes update the draft estimate without prompting.
- Preserve committed client prices and explicit allowances. Later supplier savings
  cannot silently reprice an issued offer. Unresolved costs never silently become zero.
- Exact construction agreement/SOW and initial invoice after client acceptance are
  automatic; do not insert another owner release or require signature before invoicing.
- Connect schedule/buyout to collected project funds and atomic reservations, with
  explicit company-funding authority. Keep purchase and schedule approvals distinct.
- Reuse field reports/photos, escalate snags immediately for Joe's continuation
  decision, require owner milestone confirmation, and automate final/post-project work.
- Deliver loaded, versioned operating instructions plus real model evaluations and
  tool traces. Demonstrate initiative and correct approval stops, not only handlers.

## Handoff for every slice

Record task/owner/branch/source, changed behavior, affected files/callers,
commands actually run and results, migration IDs, setup/activation, rollback,
evidence and remaining acceptance criteria. Give the next precise ready slice.
Keep task implementation and operational proof separate. The build is complete
only when all 28 rows meet their applicable code/test criteria and all remaining
external setup or live-verification gaps are explicit.

The Markdown backlog is the source for this assignment. If a later session also
imports tasks into SJC OS, use stable task IDs and the MCP to avoid duplicates;
this planning package does not claim those operational work items were created.
