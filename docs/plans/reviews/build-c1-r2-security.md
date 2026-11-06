SCORES: design=10 completeness=9

Security judge — Canvas Phase 1 build, round 2. Reviewed a0c436ff on t3/in-app-browser-agent-tools, including 6ea30751 and ddbabe0a. Verdict: no demonstrated exploitable/data-exposure gap remains in the reviewed changes. Round-1 R1 and R2 are resolved within the application paths inspected and tested. Completeness is 9 because current, production-served DOM/all-response isolation across widths, sheets and wrappers was not independently verified under the explicit no-browser/no-server rules.

REQUIRED fixes: None.

## Round-1 R1 — resolved

`lib/canvas-classification.mjs:171` now includes Leads and Subs alongside estimates, invoices, change orders and money for get_project. Its actual handler still returns client_email and project subcontractor assignments; classification now covers them. `tests/canvas-provenance-db.test.mjs:168` exercises the actual MCP handler, provenance, version, rendering, Save and saved-file resolver. Removing either Leads or Subs from another reader denies access; granting the complete set permits it. This passed using real signed staff sessions and the harness website session identity.

Historical handling is conservative: `lib/ask-context-provenance.mjs:11` unions the corrected classification into old get_project inputs on read, preserving output hashes. `lib/canvas-exports.ts:32` incorporates current provenance into Save policy and its revision. `lib/canvas-file-access.ts:5` identifies affected immutable old copies through their recorded input references; resolver, listing predicate and lifecycle withhold those copies from staff. The historical-copy regression passed, including denial before names/counts are returned and continued owner access. This is a read-time correction, not a claim that immutable stored bytes were rewritten.

### 25 returned-contract re-samples

Rechecked returned projections/objects and relevant helper contracts against the registry. Each row below passed; “none” means the response contains only confirmation/identifiers or fixed validation, not that the write itself lacks authority requirements. Record-local prose remains in its record's area.

| Tool | Returned contract and matching fences |
|---|---|
| get_project | Full project/contact row, subs, job ledger and paperwork: estimates/invoices/change_orders/money/leads/subs. mcp/sjcos-mcp.mjs:653. |
| list_projects | Job total/paid/progress and display names: invoices. mcp/sjcos-mcp.mjs:625. |
| get_lead | Lead/intake/activity/rough estimate: leads/estimates/money. mcp/sjcos-mcp.mjs:579. |
| list_leads | Contact channels and value_display: leads/estimates. mcp/sjcos-mcp.mjs:557. |
| list_subs | Contact, rate and COI: subs/compliance/money. mcp/sjcos-mcp.mjs:700. |
| list_vendors | Supplier email/phone/trade: vendors. mcp/sjcos-mcp.mjs:715. |
| list_users | Cross-role contact/account fields, no password material: leads/subs/chat. mcp/team-tools.mjs:221. |
| get_purchase_order | Full vendor header and priced lines: purchase_orders/subs/vendors. mcp/sjcos-mcp.mjs:752. |
| list_purchase_orders | Vendor email, subtotal and state: purchase_orders/subs/vendors. mcp/sjcos-mcp.mjs:733. |
| create_purchase_order | id/poNumber: none. lib/purchase-orders-agent.ts:44. |
| add_purchase_order_line | Inserted id, not recomputed totals: none. lib/purchase-orders-agent.ts:109. |
| invoice_balances | Amounts, balances, credits and settlement metadata: invoices. lib/billing/core.ts:342. |
| invoice_payment_history | Payment amounts, methods and notes: invoices. lib/billing/core.ts:438. |
| create_invoice_draft | New/replayed invoice amount and status: invoices. mcp/billing-tools.mjs:287. |
| list_project_estimates | Priced estimates/lines and CO paperwork: estimates/change_orders. mcp/estimate-tools.mjs:72. |
| create_estimate | Existing estimate titles/status on duplicate-formal path: estimates. mcp/estimate-tools.mjs:243. |
| add_estimate_lines | Extended amounts, markup and totals: estimates. mcp/estimate-tools.mjs:315. |
| get_bid_package | Bid amounts and invited subcontractor contacts: bidding/subs. mcp/bidding-tools.mjs:211. |
| compare_bids | Submission totals/deltas and sub names/trades: bidding/subs. mcp/bidding-tools.mjs:256. |
| company_financials | Costs, profit and collections: money/invoices. mcp/financials-tools.mjs:135. |
| get_project_financials | Cost/price/billing/CO/PO/estimate breakdowns; vendor labels rather than contact channels: money/invoices/change_orders/purchase_orders/estimates. mcp/financials-tools.mjs:40. |
| add_expense | id/ok on insert and source-ref replay: none. lib/budget-writes.ts:286. |
| delete_expense | Removed expense amount/vendor/date: money. mcp/financials-tools.mjs:424. |
| cost_learning_preview | Cost changes/history: cost_book/money. mcp/estimating-tools.mjs:437. |
| set_change_order_costs | Confirmation rather than internally queried costs: none. lib/budget-writes.ts:386. |

Additionally executed the entire 285-registration classification census, returned-money-field scan, known incidental/helper financial contract assertions, and narrow contact/subcontractor scan. These include money-adjacent scheduling, selections, funding, document, work-item, catalog and measurement tools. No omission surfaced. The AST scanner is deliberately bounded: it is not a mathematical proof of arbitrary helper outputs or every future schema addition, and the manual table above is a 25-contract sample rather than a claim to have manually traced all 285 handlers.

## Round-1 R2 — resolved for current runtime paths

`lib/guarded-pg.mjs:2` is the sole runtime pg import in the inspected app/lib/MCP/scripts/db source census (type-only imports excluded). Runtime constructors now use the guarded module. Its proxies check before construction and before connect/query. `lib/test-db-guard.mjs:10` requires an explicit harness URL matching tagged state, owned temporary directory, postmaster socket directory/port and a real Unix socket. Marker-only URLs, localhost TCP, duplicate/extra URL keys and configuration overrides fail closed. Test context survives normal child inheritance via the tag or test URL. Environment builders choose test configuration before runtime env-file fallback.

All 23 guard tests passed under node --test, including the complete runtime import census and actual invoice-collision, capabilities, runner, worker, migration and import entrypoint negative probes. Their pg interception recorded zero constructor/connect/query calls despite hostile PG environment defaults.

Independent check with real pg: set PGHOST=localhost, PGPORT=5432, PGDATABASE=sjcos, PGUSER=runtime and PGHOSTADDR=127.0.0.1. A harness URL connected successfully with current_database=sjcos_test and inet_server_addr=NULL (Unix socket). Then intercepted net.Socket.connect and tried Client and Pool with missing config, empty config, live-shaped TCP URL and explicit host/port overrides: eight rejections, zero socket attempts. Thus PG defaults do not redirect accepted application URLs to localhost:5432. This guarantee concerns current application paths and ordinary inherited test configuration; arbitrary test code deliberately importing raw pg or removing all interlocks is outside that boundary.

## SVG normalization — pass

`lib/canvas-renderer.mjs:116` rejects URL/expression/javascript/backslash/@ style input before copying. Only exact finite enum values and the small font-size set are copied; declarations not selected are discarded along with the style attribute. Independent `validateCanvasSvg` validation/reconstruction follows at :183. CSS comments, case variants or unrecognized syntax cannot become a new executable attribute through this translation. Inline styles and stylesheet nodes do not survive reconstruction.

Palette class names select fixed local presentation values (:77–158). They are not evaluated as CSS/selectors or merged into arbitrary objects. Prototype-like keys (__proto__, constructor, toString) produced no injected attributes in adversarial execution. Fixed selector queries for markers/labels only set static presentation. Text stroke=none adds no active capability. Text/entity decoding is followed by escaping in `lib/canvas-content.mjs:306`; text containing escaped script markup remained text. New state notes retain source size/grammar limits and pass the same output sanitizer.

Ran 12 extra in-memory tests against the actual bridge bootstrap and existing XML adapter: URL, expression, !important, var(), oversized font size, backslash CSS, inherited enum, four untrusted class cases, and escaped script text. All passed. No source/test file was edited. Existing content and bridge tests also passed external-reference, event-handler, foreignObject, dimensions and real pinned Mermaid fixture cases. This adapter tests normalization, not browser layout or CSP enforcement.

## Routes, CSP and isolation — pass in tested scope; live QA not recertified

The new `app/panel/canvas/[id]/not-found.tsx:1` has only fixed unavailable copy and /panel navigation; it reads no identifiers, titles or source. The page continues to call the authenticated canvasGet before rendering and invokes notFound for foreign/invalid IDs. Route tests exercised the 404 boundary signal and generic rendered fallback. This does not independently prove the status of a production streamed response.

Opaque origin remains: iframe and response sandbox allow-scripts without allow-same-origin. Exact inline hashes are computed over emitted scripts; the pinned Mermaid digest is checked. Network/resource policies remain default-src/connect-src/img-src/font-src/etc. none, with no form or frame capability. Wrapper framing denial remains scoped to /panel/canvas; renderer has no conflicting X-Frame-Options. All 20 route tests passed, including actual handler response script-byte/hash checks and private/no-store headers. The separate SWC-minified builder test passed too; no Next build was run.

Disposable DB command/input/provenance/export tests exercised real website/narrow session identities, signed owner/staff sessions, foreign ownership and saved-file audience denial. These are stronger than mocked auth alone but are not DOM/all-network-response captures. Round-1 coordinator isolation evidence is recorded in build-c1-r1-design.md:27; it cannot certify this new HEAD. Current UI handoff still requests live wrapper 404/header and cross-person capture checks. Coordinator should verify owner/staff DOM and every response across widths, sheets and wrappers, including another person's canvas yielding a generic 404 with no data. No new exploitable gap is inferred solely from this verification limit.

## Execution and cleanup

Sequential single files under SJC_TEST_CLUSTER_TAG=c1r2sec-1793938074:

- test-db-guard: 23 passed.
- canvas-classification: 8 passed.
- canvas-content: 54 passed.
- canvas-renderer: 7 passed.
- canvas-render-bridge: 29 passed.
- canvas-routes: 20 passed.
- canvas-provenance-db: 5 passed.
- canvas-exports-db: 2 passed.
- canvas-input-gates-db: 25 passed.
- canvas-commands-db: 21 passed.

194 passed, zero failures/skips. Additional bridge run: 41 passed (29 repeated + 12 adversarial). Independent real-pg positive and eight no-socket negative probes passed in a separate c1r2sec-pg tagged cluster. Both database clusters stopped; main run used EXIT cleanup. No killed processes, subagents, installs, browsers, app servers/builds, live/QA DB access, service changes, deployment-state operations or deploys. Only this review is staged/committed.
