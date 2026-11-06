SCORES: design=9 completeness=8

Security judge — Canvas Phase 1 build, round 1. Reviewed HEAD b98a8aa7 and the Phase 1 changes after c2d8a699. Verdict: changes required; not approved for release.

## Required vulnerabilities

### R1 — High: get_project loses contact/subcontractor sensitivity

`lib/canvas-classification.mjs:171` labels `get_project` only estimates, invoices, change_orders and money. The handler at `mcp/sjcos-mcp.mjs:653` selects the entire projects row and returns it unchanged at `:684`. That includes `client_email` (`db/schema.sql:152`). It also returns project subcontractor slugs and roles (`mcp/sjcos-mcp.mjs:658`). Neither leads (client contact information) nor subs is recorded. This contradicts the classification handoff's contact-area rule and its conservative union across every result mode.

An otherwise complete business conversation can read this result, put the client email or subcontractor assignments in a diagram, and save with only the four recorded financial areas. A job-file reader holding those areas but lacking Leads/Subs can then read that information. This does not require an owner downgrade: staff Save uses the incomplete baseline automatically, and an owner's preselected checklist never asks about the missing areas. The source-thread isolation and exact-set acknowledgement do not repair an incorrectly classified source result.

REQUIRED: classify all returned contact/subcontractor fields (at least leads and subs in addition to the current set), or remove those fields from this result under a deliberately narrower contract. Add a regression through the actual handler, provenance and saved-file resolver showing a reader without each omitted area is refused. Correct already-recorded affected provenance/snapshots conservatively if any exist; changing only future classification cannot repair old copies. Recheck other broad row-returning tools for the same omission.

### R2 — High: the Node-test database guard does not cover direct script/worker connections

The guard is called only by `lib/db.ts:7`, `mcp/sjcos-mcp.mjs:130` and `mcp/interact-mcp.mjs:49`. Direct constructors elsewhere bypass it. Examples:

- `scripts/invoice-collision-report.mjs:24–25`: selects DATABASE_URL or reads .env.local, constructs Client and immediately connects.
- `scripts/refresh-capabilities.mjs:87`: constructs a Pool using env/file DATABASE_URL and queries immediately below.
- `scripts/run-claude-agent.mjs:96` and `:289`: direct Client/Pool.
- `scripts/sjcos-worker.mjs:58`: direct Pool from the resolved worker login; `lib/db-login.mjs:78` permits env/file runtime URLs without a test check.
- `scripts/backup.mjs:68–69`, restore/import/enqueue scripts also construct clients directly. A later guarded app import cannot undo an earlier connection/query.

A test importing or spawning these entrypoints with inherited runtime configuration can still reach the live cluster. Reproduced safely with NODE_TEST_CONTEXT=child-v8, a dummy runtime-shaped DATABASE_URL, and a module hook replacing pg with a non-network stub: importing the actual invoice-collision script printed `UNGUARDED_PG_CONSTRUCTION`, then `SOCKET_BLOCKED_BY_REVIEW_STUB` from connect(). No TEST_DATABASE_REQUIRED occurred. No real live connection was attempted by this review.

REQUIRED: enforce the guard before every pg construction/connection in lib, MCP, scripts and worker paths, including spawned processes and direct URL overrides; prevent test-time fallback to runtime env files. Prefer a common guarded factory plus a complete constructor inventory test. Require a verified disposable socket/cluster target if the guarantee is “never reach the live cluster”: an application_name marker plus a non-sjcos database name alone does not establish cluster isolation. Add no-socket negative tests for direct entrypoints and positive controls using the tagged harness.

## Boundary verdicts

- **Sandbox/CSP: no demonstrated exploit found.** Both HTTP CSP and iframe use sandbox allow-scripts without allow-same-origin. Default/resource/connect policies deny network, forms and nested frames. Exact inline script hashes are computed from the same bootstrap strings inserted into the document; Mermaid bytes must match the pinned digest. The route uses that document/header pair. No generated script is interpolated into it.
- **b98a8aa7 SVG changes: no demonstrated new XSS/exfiltration vector.** Decorative filter/gradient/symbol subtrees and filter attributes are removed. Shared validation rejects dangling fragment references (`lib/canvas-content.mjs:485`), so a reference to a stripped gradient fails rather than resolving externally. Style attributes are removed and suspicious CSS is refused; neither style nor arbitrary CSS reaches reconstruction. Stroke widths/miter limits/dash offsets use the finite bounded numeric gate (absolute maximum 8192; negatives allowed only where intended). pt/px conversion is followed by that gate, so overflow/huge values fail. Dropping width/height from other elements adds no active capability. XML, byte, element, depth and path limits remain. A browser iframe is not a hard CPU isolation boundary; no concrete new denial-of-service bypass was established here.
- **Bridge: pass within inspected scope.** Parent checks current WindowProxy, null origin, exact ready shape, 128-bit instance/nonce, one channel, response type/sequence/source-version and byte/dimension bounds. Child accepts only its parent, non-null origin, matching nonce/instance and one transferred port, then removes the global handshake listener. Commands expose no app action or credential authority.
- **Identity: pass within tested scope.** createCanvasCall/createCanvasFileCall capture construction-time stdio tags, reject HTTP and HTTP-ALS contexts before forwarding, and ask the secret-authenticated website to reload admission. Claimed tool arguments cannot substitute identity. Website checks the live run/person/thread/profile/start/launch tuple; unrelated owner threads are not an owner bypass. Background runs cannot admit Canvas. Operator context stays unknown.
- **Provenance: mechanism passes, classification fails R1.** Native Read/Glob/Grep/NotebookRead are disallowed by the shared profile and both runners; tracked business uses ToolSearch-only native tools and isolated settings. Canonical docs and attachment readers are bounded and generation/hash checked. Both question registrations use pending/completion gates, reconstruct fixed choices and mark free text unknown before delivery. Unknown, pending, legacy/resumed and failed tracking cannot become complete staff provenance. Actual runner/website tests exercised serialization and persistence failures.
- **Save/audience: pass subject to R1.** Server derives the baseline; unknown owner context uses all 21 areas. Owner UI defaults to Share with staff; API omission remains owner_only. Staff cannot supply audience/ack overrides. One HMAC acknowledgement binds the exact removed set, person/auth epoch, canvas/version/project/current policy and expiry. Reservation and ready commit recheck policy. Saved-file access has its own authenticated policy and does not grant source-thread access. Publication, portal, signature and delivery operations refuse Canvas profiles; ordinary attachment queries exclude them. Immutable generations and trash/restore preserve policy.
- **Test-DB guard: fail R2.** The three protected factories pass their tests, but that is not an exhaustive connection boundary.

## Classification sample: 25 actual returned contracts

Reviewed registrations, SQL projections and delegated helpers, rather than inferring labels from tool names or write authority. Counts in the handoff are 22 full-C / 153 narrow / 110 none; enumerating all registrations is useful but cannot prove field coverage. “Covered” below means no additional missing area identified in this sample; record-scoped prose retains its record's area as specified by the handoff.

| Tool | Registry areas | Returned-field audit |
|---|---|---|
| get_project | estimates, invoices, change_orders, money | **FAIL R1:** full project row includes client_email; subs contains sub_slug/role_label. Financial parts covered. mcp/sjcos-mcp.mjs:653–684. |
| list_projects | invoices | Job total/paid/percentage, project/client display names; no contact channels. Covered, mcp/sjcos-mcp.mjs:625. |
| get_lead | leads, estimates, money | Lead/intake/activity/first-response plus optional rough estimate. Covered, mcp/sjcos-mcp.mjs:579–610. |
| list_leads | leads, estimates | Email/phone, scope and value_display. Covered, mcp/sjcos-mcp.mjs:557. |
| list_subs | subs, compliance, money | Contact channels, rate, COI status/expiry. Covered, mcp/sjcos-mcp.mjs:700. |
| list_vendors | vendors | Supplier email/phone/trade. Covered, mcp/sjcos-mcp.mjs:715. |
| list_users | leads, subs, chat | Public login/contact/role/permission fields across client/sub/team variants; no password material. Covered, mcp/team-tools.mjs:221. |
| get_purchase_order | purchase_orders, subs, vendors | Full PO vendor/contact header and quantity/unit cost/extended lines. Covered, mcp/sjcos-mcp.mjs:752–759. |
| list_purchase_orders | purchase_orders, subs, vendors | Vendor name/email, subtotal, state/dates. Covered, mcp/sjcos-mcp.mjs:733. |
| create_purchase_order | none | Returns only id/poNumber and fixed validation errors, not stored contact fields. Covered, lib/purchase-orders-agent.ts:44–79. |
| add_purchase_order_line | none | Returns only inserted id after recomputation. Covered, lib/purchase-orders-agent.ts:109. |
| invoice_balances | invoices | Amount/settled/pending/credits/returns and invoice delivery/milestone metadata in all scopes. Covered, lib/billing/core.ts:342–384. |
| invoice_payment_history | invoices | Payment amounts/method/provider/note/status/external sync. Covered, lib/billing/core.ts:438–442. |
| create_invoice_draft | invoices | Existing/new invoice id/number/status/amount, not only an ID on replay. Covered, mcp/billing-tools.mjs:291–306. |
| list_project_estimates | estimates, change_orders | Estimate cost/markup/extended lines plus CO prices; document title/status metadata. Covered, mcp/estimate-tools.mjs:72–149, :175–209. |
| create_estimate | estimates | New estimate metadata and existing estimate titles/status on duplicate-formal mode. Covered, mcp/estimate-tools.mjs:243–275. |
| add_estimate_lines | estimates | Extended amounts, default markup, recomputed totals and existing estimate status/title. Covered, mcp/estimate-tools.mjs:315–382. |
| get_bid_package | bidding, subs | Bid amounts/lines/exclusions and invited subcontractor names/email. Covered, mcp/bidding-tools.mjs:211–237. |
| compare_bids | bidding, subs | Sub names/trades, submissions, amount deltas, declined names. Covered, mcp/bidding-tools.mjs:256–282. |
| company_financials | money, invoices | Job profit/cost/funding summaries, invoice collections/outstanding, attention amounts. Covered, mcp/financials-tools.mjs:135–152, :247–259. |
| get_project_financials | money, invoices, change_orders, purchase_orders, estimates | Budget/price/cost/profit, CO prices, cost ledger, invoices, job-money components, owner hours; vendor labels, not contact channels. Covered, mcp/financials-tools.mjs:40–132, :219–227. |
| add_expense | none | saveExpense returns id/ok, including existing-source_ref updates; amounts not returned. Covered, lib/budget-writes.ts:286–321. |
| delete_expense | money | Returns removed vendor label/amount/date, unlike add_expense. Covered, mcp/financials-tools.mjs:424–441. |
| cost_learning_preview | cost_book, money | Cost changes and learning history/before-after amounts. Covered, mcp/estimating-tools.mjs:437–442; lib/estimating/learning.ts:169–172. |
| set_change_order_costs | none | Helper returns confirmation/validation, not current costs queried to merge patch. Covered, mcp/financials-tools.mjs final registration and lib/budget-writes.ts saveChangeOrderCosts. |

## Executed verification and limits

Ran files sequentially under a fresh `SJC_TEST_CLUSTER_TAG=c1r1sec-<timestamp>` with an EXIT cleanup trap; harness uses disposable Unix sockets. Cluster stopped successfully. Real website and narrow session identities plus signed owner/staff sessions were used by the DB fixtures.

- canvas-input-gates-db: 25 passed.
- canvas-provenance-db: 5 passed (including both real runner constructions with fake CLI).
- canvas-exports-db: 2 passed (multiple adversarial assertions per test).
- canvas-mcp: 40 passed.
- canvas-content: 52 passed.
- canvas-renderer: 7 passed.
- canvas-render-bridge: 17 passed.
- test-db-guard: 7 passed.

Total: 155 passed, zero failures/skips. These tests do not detect R1 and do not exhaust the constructors in R2. The separate pg-stub probe above demonstrates the latter without a socket. No source edits, subagents, installs, browsers, Next builds/servers, live/QA DB connections, service changes or deploys. No exit 137.

Production-served/minified HTML was not fetched or built in this review. Source-derived script-byte/hash tests pass, but they do not certify function.toString() behavior in the emitted production bundle or browser enforcement. Coordinator must retain actual served-byte CSP/hash and zero-network checks; the supplied nine-width/cross-person QA results are acknowledged as coordinator evidence, not rerun or claimed here. No additional exploitable gap is inferred solely from that verification limit.

Optional: automate classification contract checks using sensitive sentinel fields in real handler responses and fail the census when a broad SELECT * gains a new column. Keep a constructor inventory test separate from per-factory guard tests.
