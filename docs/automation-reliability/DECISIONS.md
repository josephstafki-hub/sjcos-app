# Confirmed decisions and remaining configuration

Revision: September 23, 2026. Authority: Joe's answers in this conversation.
These decisions supersede older planning assumptions about the desired behavior.
They do not assert that matching code or live configuration already exists.

## Confirmed business decisions

| Topic | Confirmed requirement |
|---|---|
| Build scope | One coordinated complete build; remove calendar phases and waiting periods |
| Accounting | QuickBooks Online currently used; bank and card feeds already connected; retain initially |
| Current invoices | Sent through SJC OS; Houzz currently used when clients request online payment |
| Houzz | Replace completely, including payments and full 3-D design capabilities |
| Square | Planned processor for cards and bank transfers; no account exists yet; validate account capabilities before live use |
| Designer | Full 3-D designer, already being built by other coding agents; integrate that work |
| Routine communication | Automatic as much as possible within factual scope; natural human language based on Joe's writing |
| Purchases | One-tap approval of vendor, scope/items, total including tax/shipping and project; changes require fresh approval |
| Estimates/proposals/change orders | One-tap approval before sending |
| Invoices | Automatic initial invoice on client acceptance of owner-approved formal estimate; progress billing after Joe confirms the required milestone; final invoice on written client sign-off; preserve predetermined payment structure |
| Refunds/vendor/sub payments | One-tap approval before executing the money movement |
| Social posts/newsletters | One-tap approval before publication/release |
| Approval surfaces | SJC OS always; Telegram temporary; actionable app push notifications when mobile app supports them |
| Approval authority | Configurable per employee account and action type; owner assigns/revokes permissions and optional limits |
| Current people | No employees; wife may receive an account with assigned access; no separate pay arrangement to implement |
| Hosting | Existing always-on dedicated server; no migration to paid hosting required |
| Power protection | Server/network battery backup not installed; include it as a setup requirement |
| Field updates | Subs submit photos and progress through their portals |
| Client updates | Automatic weekly summaries from suitable verified portal evidence |
| Urgent issues | Delays, unexpected conditions, added costs and comparable material problems go to Joe before client notification |
| Estimates | Rough ranges and detailed fixed-price proposals when evidence is sufficient; no fabricated certainty |
| Pricing | Initial rates/markup/allowances need definition; learn from actual closed-job results over time |
| Cost learning | May automatically update internal cost estimates from verified results; keep history and explanations |
| Profit policy | Changes to markup and profit targets need approval |
| Owner time | Arrival-based clock-in prompts plus active job-specific office/designer time; manual corrections |
| Overhead | Track AI/services as overhead; reported subscriptions: Anthropic $200/month and OpenAI $10/month |
| AI budget | No fixed new budget ceiling selected; budget decisions should not stall the build; new paid services require purchase approval |
| Future accounting | Possible eventual QuickBooks replacement, not a requirement to complete this build |
| Pre-construction trigger | Verified signed agreement starts scope breakdown, site-visit planning and applicable design preparation; do not wait for payment or the visit |
| Scope allocation | Joe reviews scopes and can retain work with dedicated pricing before bids are sent |
| Site preparation and notes | Tailored inspection/measurement/photo/question plan; uploaded notes update affected scope, design, takeoff and estimate records |
| Scope/bid/pricing-request sends | Every initial or revised package requires approval; concise summary, individual release at any time, Telegram now/push later |
| Mood boards | Only for poorly defined finished results; prepare from signature, revise using site notes and feedback |
| Selections | For unresolved client choices consistent with direction; owner reviews before client presentation; client choice feeds estimate |
| Exact client finishes | Direct to working formal estimate; no redundant selection board |
| Design feedback | Watch owner/client feedback, revise, and obtain owner approval for revised client-facing packages |
| Price discovery | Research exact products online and through likely suppliers; stage supplier requests for approval; online prices may provisionally support internal estimate |
| Supplier learning | Category-based candidates plus dated history; Siweck Lumber is Joe's lumberyard example; no assumed brand availability or discount |
| Cost incorporation | Approved sub bids and eligible supplier quotes update estimate automatically; competing supplier quotes require choice approval |
| Client price commitment | Sent prices are committed; internal research/pending discounts stay private; adjustable allowances must be clearly labeled |
| Allowance overage | Prepare change order for owner approval then client signature and required payment before additional work |
| Construction agreement | Automatically send established agreement/SOW after client accepts the owner-approved formal estimate; no additional release for exact derived content |
| Construction gate | Signed construction agreement AND received initial payment before confirmed dates/material orders; schedule/purchase approvals still apply |
| Scheduling | Prepare and coordinate tentative availability automatically; owner approves full schedule before dates confirmed |
| Material buyout | Plan order/deposit/delivery timing against need dates, lead times and milestone collections |
| Cash limits | Spend/commit within project funds actually collected, net of spent/reserved amounts; explicit approval for company cash |
| Internal schedule changes | Automatic only without changing client/sub promises, raising costs or creating a funding gap |
| External schedule impact | Immediately notify Joe with consequences and recommendation; approval before new commitments |
| Completion and weekly sub reports | Request missing completion photos; use existing weekly progress/photos/snags; avoid redundant requests; Joe confirms milestones |
| Snag response | Immediately notify Joe with recommendation; Joe decides whether affected work continues |
| Closeout sequence | Joe's internal inspection and corrected punch list before client walkthrough; client items resolved and written sign-off triggers final invoice |
| Post-project | Automatically send applicable warranty/care, request review, arrange check-in, and learn from verified actuals |

## Action authority matrix

Every action also needs authenticated identity, project scope, unchanged approved
payload and a provider/tool capability that actually exists. Staff UI access is
not automatically authority to approve money or to delegate owner power to an AI.

| Action | Initial desired rule | Trigger or evidence |
|---|---|---|
| Request missing factual information / routine follow-up | Automatic under bounded policy, except controlled package/pricing-request sends below | Correct recipient, current obligation, existing replies/photos considered, approved cadence/stop rules |
| Weekly factual client summary | Automatic | Verified permitted inputs; material issues screened to Joe |
| Rough estimate / proposal / change order issuance | One tap | Exact immutable document and price/scope revision |
| Purchase / accept a binding supplier or sub offer | One tap | Payee, scope, project, total/currency and terms |
| Pay an approved purchase or vendor bill | Separate one tap for payment | Matched obligation, receipt/acceptance where required, payable amount and destination |
| Pay-now purchase checkout | One tap may cover both commitment and charge only when clearly bundled | Preview explicitly states both order and immediate payment with one total; never an implicit later-payment approval |
| Scope/bid package or supplier pricing request | One tap for every initial or revised release | Exact recipient, package revision, inclusions/exclusions, quantities, assumptions and attachments |
| Mood board or selection package | One tap before client presentation, including revisions | Accurate preview; source direction and relevant feedback; client approval is separate |
| Internal scope/design/estimate update | Automatic within evidence and owner overrides | Signature, notes, feedback, selected items, approved bids or eligible quotes; sent client prices remain immutable |
| Competing supplier quote choice / sub bid for estimate | Owner approval | Comparable scope, costs, exclusions and lead times; not an implicit purchase/award |
| Construction agreement/SOW and initial invoice | Automatic after client accepts owner-approved formal estimate | Exact accepted revision, established template and predetermined milestone structure; no additional owner release |
| Contract progress invoice | Automatic after Joe confirms completion | Current payment structure, correct milestone and owner confirmation with evidence; no duplicate billing |
| Final invoice | Automatic on written client sign-off after punch resolution | Verified remaining balance, approved CO balances, recorded payments/credits |
| Confirm construction schedule | Owner approval plus signed construction agreement and initial payment received | Verified dependencies, sub availability, material and funding readiness |
| Internal schedule adjustment | Automatic within approved boundaries | No changed client/sub promises, increased costs or funding gap |
| Company cash for project | Explicit owner funding approval | Exact project, amount and purpose; ordinary purchase approval alone is insufficient |
| Warranty/care delivery, review request and check-in | Automatic under configured post-project rules | Correct project/terms, no invented coverage or unauthorized marketing enrollment |
| Routine undisputed payment reminder | Automatic within factual follow-up policy | Verified due date/balance; hold on pending payment, dispute, settlement exception |
| Refund | One tap | Original payment, verified refundable amount, exact recipient/method |
| Newsletter / social publication | One tap | Exact content, audience/platform, attachments and publication timing |
| Cost assumption update from completed jobs | Automatic within learning rules | Verified normalized costs/hours; history, sample support and outlier handling |
| Markup/profit target change | One tap from owner or explicitly authorized delegate | Old/new value, affected scope and effective date |
| Urgent client problem | Joe first | Private incident record plus prepared recommendation/message |
| Payee/bank destination or authority-rule change | Owner-controlled configuration | Independent validation; never adopted from untrusted email or agent suggestion alone |

The WORKFLOW.md action-specific rule wins over the broad routine-message category.
An accepted agreement's unchanged SOW follows its automatic construction-agreement
rule; separately released or revised scope packages still need approval.

A changed material field invalidates the prior decision. Clicking on one channel
resolves the same decision on all channels. Repeat taps produce one effect.
Receiving permission to place an order does not silently authorize a later bill.
New employees receive no approval privileges by default. They may approve only
assigned action types within project and amount scope; no shared owner logins.

## Natural communication requirement

Use permissioned examples of Joe's actual writing to build editable tone guidance.
Messages should be concise, conversational, specific and appropriate to the
relationship. Avoid canned greetings, repetitive templates and invented personal
claims. Preserve facts, recipients, opt-outs and confidentiality regardless of
style. Do not claim a human call, inspection or approval that did not occur.
Do not conceal automation if directly asked. Tone checks must not become mandatory
owner review for every routine message. Version templates and test realistic cases.

## Defaults agents may implement as editable proposals

These are implementation defaults, not facts Joe supplied. Show them clearly in
settings; do not repeatedly ask about low-impact choices during coding.

- Time zone: America/Chicago. Proposed ordinary outbound hours: weekdays 09:00–17:00;
  queue outside this window. Use a valid existing approved cadence if one exists;
  otherwise a suggested new cadence stays disabled until selected in setup.
- Weekly summary: configurable per job; suggested Friday 15:00 Central. Weekly
  frequency is confirmed; day/time and delivery channel are configuration choices.
- Five-minute office-idle threshold with a reviewable gap; not a measurement of
  mental effort. Manual correction and thinking-time timer remain available.
- Backup frequency: implement configurable nightly snapshots plus an optional
  more frequent database recovery path; 24-hour acceptable data loss is NOT an
  approved business target. Report achieved recovery/data-loss measurements.
- Finite per-run time/retry limits based on observed workloads; hard money caps
  remain unset until chosen. New billable API usage is a new purchase decision.

## Setup items that do not block building

| Item | Agent prepares | Needed to enable |
|---|---|---|
| Square account | Sandbox integration, setup screen, credential/connection checks | Joe opens/activates account; verified merchant/location/payment capabilities |
| QuickBooks Online access | Mock/sandbox adapter, mapping screen, import/reconciliation tests | OAuth connection to correct company and confirmed posting mappings |
| Vendor payment execution | Adapter interface, approval flow and manual-payment recording | Supported authorized payment rail; do not assume Square collects-and-pays-subs through the same API |
| Initial pricing | Evidence-backed proposed labor rates, cost rules, markup/margin distinction, allowances and uncertainty | Joe approves price assumptions; unsupported values are not silently zero; owner may issue supported online-priced fixed items or clearly labeled allowances per WORKFLOW.md |
| Designer/mobile interface | Contract/fixtures and integration requirements | Coordinate with current coding team and supported released app |
| Notifications | One shared decision API and Telegram/app adapters | Channel identities/credentials and native push setup |
| Backup destination/keys and UPS | Configuration, restore script and equipment requirements | Chosen off-host destination, recoverable keys, installation of equipment |
| Existing old automations | Inventory and disable/cutover plan | Confirm actual active sends and retire only after equivalent behavior is verified |
| Historical job mappings | Review UI and collision reports | Resolve ambiguous job/vendor/invoice matches; never invent linkages |

No employee payroll, automatic owner-draw accounting, custom bank feed, or new
3-D designer rewrite is authorized by this scope. Keep owner-time costing as an
internal estimate/profitability model separate from bookkeeping entries.
