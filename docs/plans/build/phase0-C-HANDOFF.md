# Phase 0 slice C — pure containment, contracts, and deployment specifications

Implemented on `t3/in-app-browser-agent-tools`, starting at
`9ce3caaa753a7d8cb6c1bc0e5009453955a10ef4` (2026-11-05).
This is the browser-independent slice, not Phase 0 release acceptance. No
subagents, browser/server processes, DB access, network test traffic, namespace
creation, systemctl, deployment or live-service changes occurred.

## Files and behavior

- `lib/browser/network-policy.mjs`: one bounded WHATWG/IDNA parser; HTTPS/443,
  canonical origin handling, exact query encoding/order, credential/fragment/
  userinfo/control/invalid Unicode/ambiguous path/query rejection. Numeric and
  literal address sites, trailing-dot and local/service names fail closed.
  Common credential-bearing query names are refused; lexical detection does not
  replace the required exact read/action manifest and trusted value provenance.
  Pure origin manifest validation enforces 8 document/identity + 24 resource
  origins, 32 total. Resource origins cannot be documents/popups/subframes or
  credential destinations. Worker/unknown request kinds deny. All resource kinds
  use the same hostname/address boundary, including prefetch/preconnect/beacon.
- The same module classifies non-global IPv4/IPv6, metadata (including Azure
  control IP), CGNAT, reserved/documentation ranges, mapped/compatible IPv6,
  NAT64/6to4/Teredo/ISATAP and ULA/link-local/multicast/unspecified ranges.
  Classification is conservative: some special global exceptions are also
  refused. Resolver input must supply a complete, unexpired bounded CNAME chain
  and complete A/AAAA answer set. Every address/name is checked; mixed answers,
  broken chains, loops, same-server public aliases and private rebinding deny.
  New connection/redirect requires a fresh validated result. Socket peer, host,
  expiry and listener generation must match the selected pin.
- `lib/browser/contracts.mjs`: strict Zod schemas using the existing dependency,
  exact 13 v1 tool inputs/successes/errors, discriminated act variants,
  TaskV1/BrowserTaskV1/PermitBrowserHandoffV1 and the private/public observation
  union. Exports SDK-ready JSON Schemas as well as actual runtime validators;
  JSON Schema alone does not implement contextual refinements. Nested unknown
  fields are rejected. Public observations are limited to 32 KiB UTF-8 JSON and
  150 controls. Private observations have no page text/labels; no-adapter means
  no controls. Contextual validation checks <=30 s TTL, epoch and controls against
  a trusted reviewed adapter. Private download name is fixed. Errors use fixed
  code messages (no exception or outside strings); only the three planned
  transient codes can be retryable. No MCP registration or tool implementation.
- `lib/browser/response-budget.mjs`: immutable pure ledger with 56/112/24 MiB
  nonborrowable pools, fixed 56 MiB response slots (two globally), explicit
  baseline <=144 MiB, <=336 MiB accounted peak, 384 MiB cap/48 MiB headroom.
  Worst-case request copies and response capacity reserve before collection or
  upstream/consume. Simultaneous contenders get rotating priority; two active
  contexts get at most one response slot each, with refusal instead of body queue.
  Response copies/overhead charge within the reservation; <=25 MiB payload,
  identity encoding only, <=64 KiB directional transport queues. Backpressure
  refuses allocation before read; drain releases transport. Original 60 s flow
  deadline, terminal cleanup and consumed-write unknown/no-retry decisions are
  explicit. Expiry returns both the new ledger and outcomes for persistence.
- `lib/browser/runtime-pins.mjs`: exact Playwright core 1.64.1 / Chromium 1248
  (156.0.8078.4), SDK 1.29.0 and comparator-only MCP 0.0.81, including observed
  package-lock integrity strings. All six flags default false. Metadata checks
  deliberately never return releaseReady true. Gate/Unbound versions and patch/
  dispatcher/addon digests are explicitly unset blockers, not invented attestations.
- `deploy/sjcos-browser.service`, `deploy/sjcos-browser-proxy.service`,
  `deploy/sjcos-browser-supervisor.service`: uninstalled, activation-gated review
  specs, with dedicated users, root-rendered UID placeholders, shared parent
  slices, controller heap cap, gate 384 MiB cap, independent 32 MiB supervisor,
  no swap, CPU/task limits, hardening, private capped tmpfs, credential references,
  no public CDP and no content stdout/stderr. No Install/WantedBy startup hook.
- `deploy/browser/{REVIEW.md,account-slices.conf,gate-options.conf,network-boundary.conf}`:
  reviewed-text requirements for shared 24 GiB/8-thread accounting, 3 GiB child,
  persistent OOM latch, root namespace/veth/nftables setup, fixed validating DNS,
  public-only gate, private per-install CA, listener generations, no bypasses,
  preallocation parser integration, hook ordering and release checks. These are
  specifications, not an installer, working firewall config or implemented latch.
- `tests/browser-network.test.mjs`, `tests/browser-contract.test.mjs` and
  `tests/fixtures/browser-{network-cases,contract-v1,response-budget}.mjs`:
  expectations-first fixtures and pure tests. Thirty fresh hostile URL cases
  were written before implementation. Both named tests initially failed with
  ERR_MODULE_NOT_FOUND, then passed after implementation and review additions.

No root package/lock changes and no new dependencies. No files owned by slice A
or judges were edited/staged/committed by this slice.

## Integration contract and choices

1. Construct network policy from root/controller-trusted complete app/alternate/
   tunnel/service host and same-server public-IP inventory. Empty/missing app or
   public-IP inventory refuses construction. Deployment must validate inventory
   completeness/freshness; models must never provide these values.
2. `decideRequest` returning ok proves containment only, explicitly returning
   `requiresRequestAuthorization:true` and `requiresAuthorityBinding:true`.
   It does not authorize navigation or forwarding. The gate must separately
   call `validateAuthorityBinding` with actual CONNECT/HTTP Host/TLS SNI, enforce
   exact ReadManifestV1/action authorization, data provenance, revisions/use
   counters, signed decisions and listener/context binding. Origin permission
   alone NEVER authorizes a GET or resource, nor releases business/secret data.
   Resolve relatives server-side against the guarded document before confirmation.
3. Feed complete trusted resolver outputs as `{hostname,complete:true,expiresAt,
   chain:[{name,cname,addresses}]}`; nonterminal CNAME nodes have no addresses,
   terminal node has cname:null and full A/AAAA addresses. Times use milliseconds
   in one trusted clock. Pass exact validated pin to socket dial, retain original
   SNI/certificate name, then compare actual peer. Never dial unchecked hostname.
4. Structural tool parsing does not authorize. Match inherited task capability,
   actor, session, areas and task state for every operation. Use
   `validateObservation` with trusted time/epoch/adapter before publishing; never
   populate private controls from page strings or a model-supplied adapter.
   Control-role vocabulary is a small exported normalized enum; unsupported
   controls require Take over. Result codes are fixed safe enums, not page text.
5. The shared contract fixture is `.mjs`, matching this slice's allowed fixture
   ownership, instead of the plan's `.json` filename. Consumers share that one
   fixture. §11's literal handoff payload has no task_id; it does not invent one:
   the eventual server associates the payload with a task on attended Open.
6. Pure accounting is a single-owner serialized state machine. Keep its latest
   returned immutable budget; never reuse stale snapshots concurrently. Reserve
   request representations + response slot before body read or action consume,
   use `admitContenders` for simultaneous competition, and charge every parser/
   TLS/socket/copy allocation BEFORE it occurs. Retain reservations until drain.
   Use `markFlowConsumed` before a write may commit; use `abortFlow` on
   disconnect/revoke/exception and persist its unknown outcome on failure,
   then release all references and reservations in finally. No automatic retry.
   This ledger cannot enforce allocation in an unmodified Python parser.

## Verification

Run named test files separately, without network, DB or browser APIs:

- `node --test tests/browser-network.test.mjs`: **94 passed, 0 failed**.
- `node --test tests/browser-contract.test.mjs`: **23 passed, 0 failed**.
- `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**.
  Repository tsc follows its existing TS configuration; it is not proof of Python
  or deployment validity (the pure `.mjs` modules execute under the Node tests).
- `npx -y @playwright/mcp@0.0.81 --help`: **exit 0**, comparator CLI only;
  no browser launched. Confirms its own origin flags do not secure redirects.
- Local installed package metadata + cached lockfile comparison: Playwright core
  1.64.1, browsers.json Chromium revision1248/version156.0.8078.4, installed SDK
  1.29.0, comparator0.0.81 and all three lock integrities match runtime-pins.
  Existing chromium-1228 was neither launched nor repurposed; metadata does not
  establish that a private revision1248 browser binary has been deployed.

## Not done; mandatory real isolated runtime fixture later

No Playwright patch, sole-autoattach/resume-barrier census, controller, live MCP
wrapper, proxy/addon/dispatcher/parser integration, installed service, namespace,
nftables rules, CA, DNS service, credentials, real UI/session admission, DB schema,
vault, owner-grant dispatch, file handling, deployment or flag activation here.
Some belong to slice A or later phases; none are claimed passing by this handoff.

The coordinator must implement/run the plan's real
`tests/browser-response-budget.test.mjs` against pinned mitmdump addon/dispatcher
in authorized capped namespaces. This slice provides its pure scenario in
`tests/fixtures/browser-response-budget.mjs`; counter tests cannot satisfy it.
Prove two contexts with eight connection candidates each, two 25 MiB responses
held by slow readers, held request bodies/reviews, parser copies, repeated fair
contention/completion, declared/unknown/chunked/short/oversize/slow responses,
compression bombs rejected before decode, and disconnect/controller-loss/
exception/finally cleanup. Require zero completed body/history/cache retention,
56/112/24 MiB maxima, two slots, baseline <=144 MiB and measured RSS/cgroup peak
<=336 MiB inside 384 MiB, no OOM/latch. Capture packets proving refusal BEFORE
upstream/consume and actual socket backpressure before parser allocation;
consumed interrupted writes stay unknown with no refund/retry.

Likewise the actual pinned revision1248 gate/namespace fixture must prove target
barriers before first popup/OOPIF/worker traffic, listener isolation, context
revocation on detach/controller loss (including live keepalive/TLS), peer/SNI
pinning, 401/407 behavior, Host/authority mismatch refusal, DNS/UDP/QUIC/IPv6/direct
socket bypass rejection, host/public CDP inaccessibility and zero unapproved
headers/bodies. Signed patch/addon/dispatcher attestations, exact options/hash
lock and security checks precede activation. All flags stay off until that and
shared 0105/session/privacy/audit prerequisites pass. No visual check was run;
the future coordinator must validate real UI/runtime behavior in isolation.
