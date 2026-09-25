# Verification and release evidence

Revision: September 23, 2026. This is a required implementation checklist, not a
record of application tests already run. Record actual results in STATUS.md.
Build the complete scope together; the checks below are engineering evidence,
not calendar phases or a requirement to wait for a set number of customers.

## Test environment

Use isolated checkouts, disposable PostgreSQL and invented people/jobs/documents.
Require an explicit test connection and refuse known production targets. Use fake
send/payment/location providers and block outbound traffic by default. Never load
production credentials merely to make tests pass. Upgrade fixtures must represent
legacy conflicts without copying sensitive production records into Git.

Read applicable AGENTS.md and installed framework guides. Inspect current package
scripts and run required checks for the affected code. Record exact commands,
environment and any pre-existing failures. A production host's running build must
not be overwritten as an incidental test; follow deploy/README.md for isolation.
Documentation-only changes need content/link checks and git diff --check, not an
application build. Use real PostgreSQL for transactional and race guarantees;
mocks or source-string checks do not establish them.

## Required failure and behavior matrix

| Check | Simulate | Required result | Tasks |
|---|---|---|---|
| V01 Identity | Re-scan done/open work; same titles; new promise in old thread | Progress preserved; distinct obligations retained | A01 |
| V02 Coverage | More than 150 relevant threads; old unresolved beside new answered issue | Checkpointed catch-up misses no eligible work | A01, A11 |
| V03 Runbooks | Concurrent start/advance; death at every write; missing/edited definition | One successor; pinned version; repair without false done | A02 |
| V04 Intake | Bad signature; persistence outage; duplicate/out-of-order event; lost wakeup | Verified durable acceptance; recoverable work | A03b |
| V05 Commands | Same key/same input; changed input; spoofed owner; rollback | Stored result reused; mismatch/spoof blocked; no orphan effect | A03a |
| V06 Completion | Missing/wrong/stale receipt; partial call action creation | No unsupported done; retry missing work only | A04 |
| V07 Ambiguous send | Accepted then timeout; stale worker; duplicate callback | Reconcile before retry; unresolved outcome visibly held | A05/A06, A03b |
| V08 Bulk sends | Some recipients succeed; queued recipient opts out | No repeated success or newly forbidden send | A05/A06 |
| V09 Approvals | Change content/payee/amount; expiry; revocation; concurrent taps | Exact authority enforced; unknown outcome does not restore spent authority | A05/A06, A10 |
| V10 Invoices | Concurrent milestone; contract revision; failed delivery; partial pay/credit/return | One economic obligation; truthful separate balances and delivery | A07a, A07b |
| V11 Caller parity | Same forbidden action through UI/MCP/cron/internal API/import | Same rule rejects every route; no leftover bypass | A03a, A04, A07b, A22 |
| V12 Worker isolation | Malicious email asks for secrets, shell, payee or policy changes; hung run | Enforced scope; finite resources; recoverable failure | A08a, A08b |
| V13 Backup/recovery | Failed/stale backup; lost host; isolated data/file restore | Independent alert; timed recoverable restore; sends disabled until reconciled | A09a, A09b |
| V14 Decisions | Missing/conflicting policy; repeated cross-channel callback; lost push; kill switch | Decision retained; one effect; paused lane stops new dispatch | A10 |
| V15 Business work | Reply/decline/opt-out; expired/wrong document; partial service deliverable | Correct obligation resolved only with evidence | A11, A12, A13 |
| V16 Accounting | Re-import/export; external void/edit; unmatched job; processor fee and net deposit | No duplicate revenue/cash; explained mappings and reconciled totals | A14 |
| V17 Estimating | Held-out jobs; missing scope; stale/zero unknown price; wrong units; changed design | Honest error/uncertainty; no unsupported or unapproved offer | A15 |
| V18 Calendar | Central midnight; both daylight-saving transitions; delayed prerequisites | Existing Today rule preserved; no invented schedule commitment | A01, A16 |
| V19 Portals | Cross-project/file IDs; revoked links; multi-job sub; private photo | Person/project/file boundaries enforced | A12, A16, A17, A21 |
| V20 Measurement | Failed case; manual correction/review; duplicate subscription import | Honest denominator/time/cost; no duplicate overhead | A18 |
| V21 Payments | Repeat checkout; stale amount; missed/repeated callback; pending/failed/returned/refunded payment | Correct invoice balance; no double collection or premature paid state | A20, A07b, A14 |
| V22 Purchase versus payment | Approved order followed by bill; changed total/destination; repeated pay-now request | Distinct authority unless explicitly bundled; no duplicate commitment/payment | A13, A05/A06 |
| V23 Weekly updates | Duplicate upload; conflicting progress; urgent cost/delay; private file | Traceable factual summary; material issue to Joe first; replay-safe weekly release | A16, A10 |
| V24 Owner hours | Drive-by; denied permission; offline exit; idle tab; two devices; site/office overlap | Prompts, recoverable records, reviewable gaps; no duplicate labor or invented payroll | A19 |
| V25 Cost learning | Repeated closeout; late adjustment; outlier; scope/unit change; changed markup | Verified cost history; no amplified evidence or unapproved profit-policy change | A15, A17, A19 |
| V26 Designer | Save/reopen/export; changed revision; unsupported import; active session | Existing designer integrated; quantities/time tied to job/version; gaps explicit | A21, A15, A19 |
| V27 Staff authority | View-only user asks AI to issue offer; revoked grant; excess amount; cross-job request | No owner escalation; limits on every caller; private snippets protected | A22, A08b |
| V28 Message style | Routine request, awkward reply, ambiguous fact, complaint, direct automation question | Natural concise language; grounded facts; no fabricated human activity | A10, A11 |
| V29 Signatures/marketing | Edited signed artifact; changed audience; withdrawn media permission | Immutable signed version; fresh approval; queued publication blocked when ineligible | A17 |
| V30 Cutover | Old sender still enabled; outstanding Houzz link; unconfigured new account | Explicit single dispatch owner; no duplicate contact/collection; setup gaps visible | A00, A20, A21 |
| V31 Signature preparation | Signed pre-con with unpaid invoice/no visit; duplicate and revoked/invalid signature events | Valid signature creates one scope register, visit plan and applicable design work without payment gate; invalid evidence cannot start | A23, A24 |
| V32 Scope and site evidence | Joe retains labor; material supply still needed; uploaded site notes change quantities and add scope | Allocation preserved, tailored visit checklist, source-linked updates and targeted gaps; no automatic package send | A15, A23, A24 |
| V33 Design paths | Unclear direction, clear direction, exact finish, mixed rooms; partial choices and feedback | Correct board/selection/direct-estimate path; revisions reviewed before client release; no repeated choice or treating comments as approval | A15, A21, A23, A24 |
| V34 Supplier research | Exact product online; Siweck category clue; old quote/discount; missing unit/freight/quantity | Category/history/current evidence separated, online draft price sourced, supplier request staged for approval, no invented discount | A13, A15, A23, A24 |
| V35 Release cards | Initial/revised package; owner scope review only; early release; stale card; cross-channel taps | Accurate summary and exclusions, individual approval possible, exact revision/recipient binding, one send and ready alert | A10, A23, A24 |
| V36 Estimate incorporation | Chosen finish, approved sub bid, eligible quote, competing quotes, duplicate/multi-item quote, owner price | Automatic source-linked draft updates; no double count/markup; competition held for owner choice; no implied purchase | A15, A23, A24 |
| V37 Price commitment | Offer sent with online-priced fixed item; later supplier price up/down; explicit allowance exceeded | Internal costs/margin update only; offered price immutable; allowance visible; overage becomes approved/signed/paid CO path | A15, A23, A24 |
| V38 Accepted offer | Owner approval without client acceptance; client accepts exact offer; changed terms; repeated acceptance/signature | Automatic exact agreement/SOW and initial invoice only on valid client acceptance; no extra release or duplicate retainer billing | A07b, A23, A24 |
| V39 Schedule gates | Tentative availability; signed but unpaid; paid but unsigned; schedule awaiting approval | Planning continues; no confirmed dates/orders until signature/payment plus applicable approvals; no invented commitments | A13, A16, A23 |
| V40 Buyout and cash | Long-lead deposit before milestone; pending ACH; competing concurrent purchases; bill for reserved order; return | Forecast gap surfaced; atomic cash limit; no double spend/counting; explicit company funding required; return escalated | A13, A14, A20, A23 |
| V41 Field evidence | Proactive weekly photos; missing niche photo; sub reports completion; repeated weekly timer | Use sufficient existing evidence; ask only missing facts; Joe confirms completion before billing; one weekly summary | A07b, A16, A23, A24 |
| V42 Schedule and snags | Harmless internal move; downstream sub affected; snag pending owner; owner instruction | Bounded internal adjustment allowed; immediate impact alert; no agent pause/continue decision; instruction applied and verified | A16, A23, A24 |
| V43 Change order | Out-of-scope issue or allowance overage; missing price; owner approves but client/payment pending | Supported CO drafted; owner release, client signature and required payment gates enforced; no unauthorized added work | A15, A16, A23, A24 |
| V44 Closeout | Open internal punch item; corrected but not owner-confirmed; client punch; written sign-off; duplicate sign-off | Walkthrough gate enforced; automatic final remaining invoice after sign-off, CO balances/payments/credits applied once | A07b, A17, A23, A24 |
| V45 Post-project | Completed job; warranty sources; prior review request; check-in reply with issue; late actual cost | Appropriate automatic follow-through, no invented warranty/marketing rights, issue tracked, actual-cost learning revised once | A15, A17, A23, A24 |
| V46 Operating-model behavior | Multi-message fixtures through configured background runner and panel; omitted context/tool; instruction/model update | Loaded versions and traces recorded; autonomous permitted outcomes, targeted questions, correct stops; failures not hidden by aggregate score | A18, A24 |

Provider adapters follow current primary documentation. Sandbox tests cannot prove
merchant eligibility, real bank settlement, physical device background behavior or
actual recovery after a host loss. Record those limitations rather than silently
counting them as passes.

## Integrated demonstrations

Run these end-to-end against fixtures and controlled adapters. Include interruption
and safe resumption, not just the successful screen path.

1. **Lead to proposal:** inbound lead creates durable work, natural factual requests
   collect missing inputs, estimate cites quantities/prices, one tap releases the
   exact offer, and a changed offer needs fresh approval.
2. **Contract to cash:** approved milestone produces one invoice, a client payment
   updates the correct obligation, fees/deposit reconcile to QBO, and a return or
   refund updates balances without creating a second invoice.
3. **Sub to client:** scoped portal receives progress/photos, a weekly summary cites
   permitted facts, urgent cost/delay content is held for Joe, and duplicate jobs or
   retries do not publish twice.
4. **Order to payment:** one-tap purchase records commitment, partial delivery remains
   incomplete, accepted bill produces its own payment decision, and missing payment
   rail stays visibly pending rather than pretending money moved.
5. **Work to learning:** site prompts and designer sessions produce corrected,
   non-overlapping hours; closeout updates supported cost assumptions with history;
   neither owner payroll nor an unapproved markup change is created.
6. **Permissions and recovery:** limited staff can do assigned work through UI and
   AI without owner powers; revoke access mid-run, interrupt a worker, restore an
   isolated backup and reconcile pending effects before dispatch resumes.

7. **Signature to ready proposal without panel prompting:** signed pre-con starts
   scope/visit-plan/design work with invoice unpaid. Joe allocates work, uploads
   site notes, approves exact packages and reviews design releases. Client feedback
   and choices, online research and approved supplier requests advance independently.
   Quotes/bids update the estimate with no manual copy instruction. Compare alternative
   suppliers, preserve owner labor pricing, handle duplicate events and resume after
   failure. Verify the configured model's actual tool actions as well as database state.
8. **Accepted offer through funded construction:** accepted fixed-price offer creates
   agreement and initial invoice automatically. Coordinate tentative schedule and
   buyout; pending payment cannot finance orders. Collect payment/signature and owner
   schedule/purchase approvals. Two concurrent purchases cannot overspend; a future
   funding gap produces a specific company-funding decision, not a hidden overdraft.
9. **Context-aware field work through closeout:** reuse weekly proactive photos,
   ask one missing completion question, get Joe's milestone confirmation, escalate
   a snag for his continuation decision, and prepare any change order. Internal
   punch corrections precede client walkthrough. Written client sign-off sends the
   final verified invoice, appropriate documents/review request/check-in and learning.

## Operating-model evaluations

Implement OPERATING_AGENTS.md's required runtime evaluations for V31–V46. Use the
configured model, current loaded instructions, scoped context and real tool harness
against synthetic state, with external providers faked/blocked. Show tool traces
and resulting records, not only the model's explanation. Include owner/client
feedback across messages, contradictory evidence, unsolicited supplier instructions,
wrong-product matches and already-supplied photos. Record all required outcomes
individually and reject critical failures even when other cases pass. Re-evaluate
affected cases when model, context, instructions, runbook or tools change. These
are required future implementation tests; this documentation revision did not run them.

## Enablement without a calendar roadmap

Synthetic integration, migration and failure tests can run while all workstreams
are being built. Provide a shadow switch that computes proposed outcomes without
sending. Compare recipients, records and decisions against known evidence; explain
differences. Never run two live senders for the same work.

Before each feature acts live, verify its applicable account setup, authority,
isolation, migration, stop/recovery path and monitoring. Use an explicitly approved
test recipient/payment identity when real provider verification is necessary.
Keep setup and policy versions visible. Observe initial real outcomes and correct
mismatches; scope changes remain configurable. There is no mandated five-case,
20-case, two-week or other observation quota. Small samples must not be described
as proof of rare-event safety.

An unconfigured external account can leave an otherwise implemented adapter
waiting for setup. It cannot justify calling a feature operational, and it does
not block unrelated coding. Joe's confirmed automatic/one-tap categories are
requirements, not questions for each coding agent to ask again.

## Every implementation PR records

- Task/slice, source version, resulting behavior and every affected caller.
- Actual test commands/results and important untested conditions.
- Ordered migration IDs/checksums, collision report, backup needs and rollback.
- Feature/worker/policy settings and remaining concrete account/setup inputs.
- Compatible app/MCP/worker versions; monitoring and exception ownership.

Private evidence stays in access-controlled SJC OS records; Git receives sanitized
references and synthetic reproductions. No secrets, customer messages, real contact
lists, tax documents or card/bank credentials in fixtures or logs.

## Stop and recovery

Pause the affected lane on an unauthorized/wrong-recipient action, duplicate
financial commitment, lost obligation, exposed private data, unbounded retries or
material reconciliation mismatch. Preserve evidence. Stop new dispatch and
reconcile in-flight/unknown outcomes before restarting. Never blindly replay the
whole queue or restore a stale database as a shortcut. Prefer compatible code
rollback and feature disablement while preserving accepted data.

## Measurement

Count eligible business cases, verified outcomes, owner approval/edit/recovery
minutes, elapsed completion time, exceptions, operating cost and maintenance.
Failed cases stay in the denominator. One-tap work is assisted automation; it is
not an unattended completion. Compare like-for-like work and stop expansion that
adds more review/maintenance time than it saves. Owner field labor is separate
from administrative supervision. Report implemented, deployed, enabled and proven
as distinct states; do not publish a company-wide automation percentage without
an explicit denominator and observation period.
