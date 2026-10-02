# Integration and transition specification

Revision: September 23, 2026. Proposed engineering design grounded in Joe's
confirmed requirements. Provider limits/authentication must be rechecked against
current official documentation during implementation. Do not invent credentials,
merchant capabilities, accounting mappings or unknown designer interfaces.

## System responsibilities

| System | Responsibilities in this build | Does not automatically imply |
|---|---|---|
| SJC OS | Jobs, contracts, invoice workflow, decisions, portal experience, estimate/cost learning, coordination | Custom accounting ledger or independent proof of settled funds |
| Square | Planned customer card/ACH collection, processor evidence and supported refunds | General vendor/subcontractor bill-payment facility |
| QuickBooks Online | Initial bookkeeping, existing bank/card feeds, posted financial record | Every unreviewed bank-feed item being available through its API |
| Existing 3-D designer work | Full editing/design experience, project revisions/exports | All quantities being measured/verified or every format being importable |
| Native mobile app | Actionable push, permissioned arrival/departure suggestions, mobile access | Reliable background job-location behavior from a browser alone |
| Telegram | Temporary owner notification/decision interface | A separate decision database or authority from knowing a chat ID |
| Existing server | Application/workers/data hosting | Backup protection from the server merely being always on |

## Square customer checkout — A20

Isaac Huss's August 10 email, "Square API," supplied orientation links. This is
reference material, not merchant onboarding or authorization. Joe has no Square
account yet. Use mocked/sandbox integration and a clear setup checklist until the
account, location, processing entitlement, connection and HTTPS setup are verified.

Recommended experience: SJC OS invoice/portal has a Pay button with card and bank
transfer choices. Use Square's supported browser payment components to tokenize
payment details, then a server-side Payments API request. Keep secrets and raw
card/bank credentials out of SJC OS logs and model context. Verify invoice/link
access, current revision, currency, collectible balance and partial-payment policy
server-side. Checkout has an immutable payment intent/attempt key; refreshing or
repeated taps do not create a new charge for the same intended payment.

Square documents ACH as asynchronous, US/USD, with pending-to-completed/failed
states. When linking an ACH payment to a Square Order, its full-balance/one-ACH
constraint matters. Do not model all construction draws as repeated partial ACH
payments against one incompatible Square Order. Validate separate installment
orders or another supported mapping without duplicating SJC invoices. A pending
transfer is not an invoice-paid event. [Square ACH documentation](https://developer.squareup.com/docs/payments-api/take-payments/ach-payments)

Use signed callbacks plus scheduled provider reconciliation and store event IDs,
payment IDs, fees, payout links, failure/return/refund/dispute transitions. Test
out-of-order events and accepted-then-timeout. Pause collection reminders while
a payment is genuinely pending; escalate stale pending instead of waiting forever.
Returns/refunds restore the correct balance under contract/accounting rules with
traceability. Refund requests require exact one-tap authority and current provider
eligibility. Customer consent to pay is separate from internal approval authority.
Do not auto-charge stored methods without separately established consent/policy.

Reference: [Square Web Payments SDK](https://developer.squareup.com/docs/web-payments/overview)
and [Payments overview](https://developer.squareup.com/docs/payments-overview).
Do not add fees/surcharges or assume pricing/transaction limits without checking
current merchant terms and applicable requirements. Merchant signup and identity
verification remain Joe's setup actions, not a coding blocker.

## QuickBooks Online — A14

QuickBooks Online and its bank/card feeds are confirmed. Implement connection and
company identity checks, secure refresh/revocation handling, versioned mapping
configuration and health/status reporting. Work against a test company/fake adapter
until authorized real connection. Verify current documented entity support and
limits; do not treat UI bank-feed visibility as API support.

Record ownership and sync rules per entity:

| Record | Initial proposed ownership | Synchronization rule |
|---|---|---|
| Job, approved contract and milestone | SJC OS | Map to QBO customer/project structure supported by the account |
| SJC-issued invoice | SJC OS business record; QBO accounting mirror | Create/map once after issue; detect QBO edits, never overwrite silently |
| Existing QBO/Houzz invoice | Existing source/history | Import/map for reconciliation; do not issue/send a replacement automatically |
| Customer payment | Square or verified manual/bank evidence | Apply once to mapped invoice(s); mirror supported accounting entry once |
| Processor fee and payout | Square evidence plus QBO bank reconciliation | Gross receipt minus fee reconciles to net payout; avoid duplicate income |
| Posted expenses, bills, credits and corrections | QBO initially | Import mapped actuals with versions and review unresolved job/cost codes |
| Owner time valuation | SJC internal analytical model | No automatic QBO expense/payroll posting |
| Subscriptions/AI overhead | Verified bill/QBO posting | Match owner-reported recurring baseline; do not book it twice |

Build read/import and controlled supported outbound invoice/payment accounting
synchronization as distinct modes. Default connections are dry-run/read-only until
mappings and posting direction are confirmed; the outbound code remains in scope.
No general two-way overwrite. External revisions and conflicting authoritative
facts become reconciliation decisions. Use source IDs/versions, replay-safe sync,
checkpoint/recovery, explicit deleted/voided semantics and restricted access.

Do not create a second bank feed or new Plaid integration to duplicate QBO.
Unmatched transactions remain unmapped, not attached to the nearest amount/date.
If a required entity is unavailable through current APIs, build reviewed export/
import and label the limitation; do not falsely claim full sync. Initial account,
customer/project, fee/clearing and tax mappings need competent owner/bookkeeper
review before writes. No custom general ledger or tax/payroll engine in this build.

Reference: [QuickBooks Online API documentation](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api).
Detailed current API behavior must be verified during implementation; no provider
specific undocumented endpoint is assumed here.

## Purchase, vendor payment and refunds — A13/A05/A06

A purchase authorization and its later payment are distinct decisions. Store
purchase/bill/receipt match and the exact approved total/destination. For immediate
checkout, one preview can explicitly bundle purchase plus immediate charge; do not
reuse that authorization for future invoices. Changed payee or bank instructions
require independent validation and new authority; untrusted email cannot set them.

No outgoing-payment provider has been selected. Build a provider-neutral adapter
and a manual-payment path. If the selected supported rail can safely execute an
approved disbursement, connect it after account setup; otherwise approval marks
"approved, payment pending" and creates the owner's execution step. It must not
say paid until external proof or verified manual confirmation exists. This is an
explicit activation gap, not an instruction to fake a bank integration. Refunds
use the original processor where supported and always need one tap.

## One decision across web, Telegram and push — A10/A22

SJC OS stores the decision and complete preview. Telegram temporarily delivers
approved-channel notifications and actions. Future native push exposes the same
Approve/Review decision where supported. Reuse the existing mobile project and
registered device identity; confirm its repository/stack before implementation.

Each action binds decision ID, version, expiry and authenticated authorized user.
Sensitive operations may require the platform's device unlock or authenticated
app context; one tap means no repeated business approval, not bypassing identity.
Validate Telegram secret and allowed user/chat plus the bound action; forwarded
messages, edited callbacks and repeated taps fail safely. Push payloads avoid
private financial/customer detail visible on a lock screen. Revoke device tokens
and staff privileges centrally. Losing a notification must not lose the decision.

Web/Telegram/push decisions synchronize immediately, show accepted/changed/expired
state, and wake paused work durably. Duplicate delivery is harmless. Mobile push
availability does not block web/Telegram functionality or coding the push adapter.
Do not add automatic newsletter drip arming; publication remains one-tap.

## Existing full 3-D designer — A21/A19/A15

Ask the current development workstream for its actual repository/branch, owner,
release artifact and interfaces. The user wants a full designer; do not downgrade
the requirement to a static preview or create a competing implementation.

Agree these interfaces before merging overlapping code:

- Authentication and authorized project/design access; consistent customer/sub
  visibility and internal working versions.
- Stable design ID and immutable revision, project link, units, saved geometry,
  asset dependencies, export/download references and restoration behavior.
- Quantity export with units, provenance and revision. Treat unverified dimensions
  as assumptions; changes invalidate affected estimate quantities/approvals.
- Active-session events for A19: user/job/category/session, foreground/idle,
  timestamps and stable event/sequence IDs. No raw keystroke/content telemetry.
- Client sharing rights/versions and signed/approved design artifacts.

Use a representative remodel as the shared product acceptance fixture. The
proposed minimum acceptance scope is editable measured rooms/walls/openings,
placement of cabinetry/fixtures/furnishings, finishes/materials, useful 2-D and
navigable 3-D views, saved alternatives/revisions, and exportable plans/images.
Record the supported dimensions, levels, assets and target devices explicitly.
Validate these with the existing designer team; this is an engineering acceptance
proposal, not a claim Joe specified every modeling feature. Assign missing work
to that team's backlog and include it in integrated completion. An interface stub
or statement that another team owns the designer is not a completed A21.

Document supported design/edit/visualization/export workflows with the existing
team and compare to what Joe actually uses in Houzz. Preserve access to current
projects and old designs. Unsupported imports are shown with export/archive
fallback, not falsely presented as editable models.

## Houzz exit checklist

Code the transition and migration tools now. Do not cancel Houzz during planning
or automatically on deployment. Joe can retire it when all relevant criteria hold:

1. SJC/Square card and bank payment paths are live and verified with accounting
   reconciliation, refunds/returns and existing invoice handling.
2. The full designer meets agreed real project workflows with saved/exported data.
3. Necessary Houzz designs, invoices, payment history and client artifacts have
   been exported/preserved and linked to the right jobs; unsupported records listed.
4. Existing customer payment links and outstanding Houzz invoices have a documented
   finish/migrate path; no duplicate collection or surprise changed amount.
5. Any old reminders, integrations and payment senders are inventoried and retired
   deliberately. One system owns each active outbound action during transition.

The retirement of any Make/Sheets/other automation depends on actual current use;
this plan does not assume those older tools are still running.

## Workflow and operating-agent integration — A23/A24

Use WORKFLOW.md for event/action order and OPERATING_AGENTS.md for runtime behavior.
Map the actual signature provider's verified completion event to pre-construction
preparation; payment is not that trigger. Map owner/client messages, portal comments,
uploads, supplier quotes, payment changes and client sign-off to affected project
obligations. Reconcile provider and manual verified records rather than inventing
an unavailable API. Every source must preserve identity and revision evidence.

Price-research tools need product/source/date/unit evidence. Supplier requests use
the same approval and external-action system as bid packages. Search results and
supplier category alone cannot establish negotiated price or brand availability.
Map current trusted supplier/contact records before sends; Siweck Lumber's category
is a planning example, not permission to contact an inferred recipient.

Ready package cards and urgent incident decisions use SJC OS plus configured
Telegram, then native push when available. Cards include exact revision summaries
and authenticated action links; repeated taps cannot duplicate sends. Track failed
notification delivery and retain the owner decision in-app.

Connect buyout/cash controls to A07/A14/A20 reconciled records. Processor acceptance,
payment completion and funds available for project spending are distinct; pending
bank transfers cannot fund an order. Preserve the approved retainer/draw structure
and link final invoice balances without duplicate revenue or collection.

Post-project artifacts use actual applicable warranty/care sources and configured
check-in timing. Review requests do not authorize marketing publication. Missing
providers or account setup remain precise visible blockers while fixtures and
unrelated workflow work continue.
