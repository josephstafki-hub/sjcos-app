# In-app agent browser — implementation plan

Status: design for review; no implementation or deployment authorized by this file.
Revision baseline: `t3/in-app-browser-agent-tools`, HEAD `c00af55d`, 2026-11-05.
Round-1 revision: all three reviews, owner decisions 1–8; proposed mechanisms
and release gates below are not claims of runtime verification.
Normative owner decisions: `_context-agent-browser-canvas.md`, “Joe's decisions.”
This plan owns the browser; `ask-canvas-plan.md` owns Canvas. Both depend on the
shared host/auth prerequisites (§6.2); neither renderer requires the other enabled. Technical names below are implementation names, not UI copy.

## 1. Joe's request and the result

> how feasable is in app browser use when using the web version? id like to be able
> to interact with the browser to fill out account info etc when needed. Id use this
> so the agent can pull permits and perform other functions. I'd like to have the
> other features of the claude and chatGPT apps as well like the canvas where it can
> draw diagrams etc

Joe has decided: **Joe and staff can use it; background agents cannot. Logins go in
an encrypted vault and people can take over for 2FA or CAPTCHA. Always stop before
final Submit / Pay / Sign. **Joe approves every company-committing final submit, sign and pay, including
staff runs. Saved logins are shared per site with named staff who never see
the password.** Pick the
first city later.** These are requirements, not questions awaiting another decision.

Smallest useful result: in the Ask window, open an allowed public site, watch the
agent read it, take over on a computer/iPad, and stop it. The first phase includes
network containment, identity checks and the final-step stop, even though saved
logins and payments arrive later. A permit application is not “pulled” merely
because a form was filled: success requires the portal's receipt and, separately,
evidence that the permit was issued. No change to construction-start gates here.

### Words used

| On screen | Meaning / control |
|---|---|
| Operator | Shipped panel name; “Ask” in technical prose refers to this same panel |
| Browser | Outside website being used for this Operator task |
| Open browser | Start after the person confirms the task's sites |
| Allowed sites / Add a site | Exact websites this task may reach; approval belongs to the person |
| Agent is working / Paused | Whether agent actions can run |
| Take over / You're in control | Acquire exclusive mouse and keyboard control |
| Give back to agent | Stop personal input, clear private fields, explicitly resume |
| Stop browser | Close this task's browser, preserve already saved files |
| Saved logins / Save a login / Fill login | Vault list, entry form, server-side fill |
| Only me / Shared with Abigail, Mark / From Joe | Owner-only, named sharing shown to Joe, delegated row shown to staff |
| Private — login or account details | No page content is being sent to the agent |
| Ready to submit / Ready to pay / Ready to sign | Final-step review card |
| Submit once / Pay $125.00 once / Sign once | Exact action approved now |
| Don't submit / Don't pay / Don't sign | Denial; no ambiguous “Dismiss” default |
| Waiting for Joe | Every staff company final step awaits Joe |
| Open review | Joe opens the protected decision; staff open their own read-only request status |
| Send this page / Send once | A separate reviewed save of answers; company saves still need Joe |
| Page controls / Keyboard | Accessible reviewed controls / opt-in remote key capture |
| Earlier view | Last frame while loading; cannot be used for input |
| Back to app / ‹ Chat | Restore app workspace / return to chat; neither navigates the outside site |
| Submitted / Paid / Signed / Check the site before trying again | Confirmed result versus uncertain delivery |
| Saved to project files / Open file | Confirmed local file save |
| Continue / Cancel / Try again / Close | Local UI actions; Continue never authorizes an outside final step |

No “broker,” “lease,” “principal,” “CDP,” “capability,” or “egress” in product copy.
Use existing `--paper`, `--paper-2`, `--ink`, `--ink-3`, `--ai-soft`, `--ai-2`,
`--flag`, `--rule` tokens. Flag states have an icon **and** a word. No color-only
warnings. Use app type tokens: `text-body` 13 px for existing chat (unchanged),
`text-heading` 17 px for state lines/card titles, `text-subheading` 14 px minimum
for summary rows/amounts. Targets: 44 px minimum everywhere (`size-11`), 48 px
review buttons, 56 px touch toolbar in take-over. Long sites wrap to two lines with full site
available to assistive technology; the trusted origin label is never page-provided.

## 2. Evidence and decisions that follow from it

The following source anchors were reread for this revision. New paths later in
this document are proposed. References describe current code, not security already built.

| Verified source | Consequence |
|---|---|
| `scripts/run-claude-agent.mjs:715` spawns without extra FDs; `:867–883` resumes conversation history; `:935–943` adds personal Chrome; `:976–1005` selects DB/env | Use authenticated rendezvous, separate browser history, strict new MCP config and narrow DSNs; remove optional Chrome hook. |
| `lib/actions/ai-chat.ts:67–85`; `lib/ai-chat.ts:76–81,110–116,138–181` list/load threads without user ownership | 0105 thread isolation is a Phase 0 prerequisite; Canvas rendering need not ship. |
| `mcp/sjcos-mcp.mjs:435–451` wraps SQL permission errors only | Add explicit registration **and** invocation filtering; existing wrapper is not a staff visibility guard. |
| `lib/db-login.mjs:74–90` may fall back to owner DSN | Strict mode must reject fallback in every browser-profile process. |
| `lib/session.ts:28–30,67–78` has development key fallback, Bearer fallback, cookie-only logout | Browser requires real signing key, cookie-only verifier and server-tracked sessions/logout revocation. |
| `lib/dispatch/authority.ts:227–253` is TypeScript over SQL | Cannot call it inside a SQL definer function; implement exact browser consume in SQL. |
| `components/panel/PanelDock.tsx:14–27,69–86`; `components/panel/PanelHost.tsx:229–266` | Preserve Operator header, measured widths, existing selector and Workbench navigation; adopt §6.2 shared host. |
| `components/panel/RunReview.tsx:7–29`; `app/globals.css:137–142` | Add outcomes above existing details; use real 13/14/17 px tokens. |
| `lib/upload-store.ts:85–108`; `lib/file-serve.ts:75–109` | Existing storage is not a cross-process transaction; add ledger and guarded decrypt reader, bypass generic thumbnail path. |
| `mcp/bidding-tools.mjs:333–416,462–473` | Real tools are `view_project_image` and `get_project_file` (including signed URLs); block every private-file variant. |
| `tests/_harness/testdb.mjs:118–139` | Extend fifth role and use real-login tests; SET ROLE does not test `session_user`. |
| `lib/workflow/construction-start.ts:128–136` | Preserve permit research and stable reference; browser handoff remains attended. |

### Installed versions, checked without launching a browser

This worktree has no `node_modules`. Read the installed Next 16.2.9 guides in
`/home/joe/sjcos-app/node_modules/next/dist/docs/`: Route Handlers, authentication,
route-segment config and cookies guidance. Handlers use Node runtime, Web
Request/Response streaming and `await ctx.params`; await cookies/headers. Authorize
in handlers/actions as well as pages. No caching of live/private responses, no
`use cache`, no reliance on removed Cache Components configuration exports.

Cache inventory: `~/.npm/_npx/9833c18b2d85bc59` contains `@playwright/mcp 0.0.81`
and `playwright[-core] 1.64.0-alpha-2026-09-14` (Chromium revision 1244);
`e41f203b7505f1fb` has `playwright[-core] 1.64.1` (revision 1248, Chromium
156.0.8078.4). Other cached releases include 1.61.1, 1.62.1 and 1.57.0.
`~/.cache/ms-playwright/chromium-1228` exists; **neither of the above releases
matches 1228**. Do not point a newer library at that binary by accident.

The original planning pass ran the cached **0.0.81** CLI's `--help`, which launches no browser. It supports
`--cdp-endpoint`, `--cdp-header`, `--cdp-timeout`, `--block-service-workers`,
`--image-responses`, `--isolated`, `--user-data-dir`, `--host`, `--port`, and
`--idle-timeout`, among others. Its allowed/blocked-origin help explicitly says
these do not secure redirects. It exposes capabilities inappropriate here, so
**choose our own small MCP wrapper**, not stock Playwright MCP exposed to models.
The approved feasibility direction of one supervised browser driven through
Playwright/CDP remains; this is a justified safety change to the adapter.

Pin the implementation's separate browser runtime lockfile to **playwright-core
1.64.1 + its revision 1248 Chromium**, exact versions/integrity. Install that
revision in the service's private cache during deploy; keep 1228 untouched.
`@playwright/mcp 0.0.81` is the audited comparator, **not a runtime dependency**;
no `npx @latest` in a run or unit. Pin the implementation's resolved MCP SDK too,
using the existing SDK API, with dependency/security verification before release.
An unavailable/vulnerable pin fails the release gate; do not substitute silently.

Upstream references: [Playwright MCP security and configuration](https://github.com/microsoft/playwright-mcp)
explicitly describes its security limits; [Playwright CDP attachment](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
is Chromium-only and lower fidelity than native Playwright protocol. Our release
fixture must exercise the actual pinned CDP operations, not assume full fidelity.
[Cloudflare cache control](https://developers.cloudflare.com/cache/concepts/cache-control/)
supports `no-store`/`no-transform`; actual Tunnel streaming is a deploy acceptance
check, not a latency guarantee from those headers.

Prior plans read: `in-home-consult-plan.md` and `discovery-call-plan.md` from
`origin/t3/sjcos-workflow-plans`, plus round-1 engineering/design reviews. Apply
their bar: exact schemas and authority boundaries, one shared contract, real
responsive layouts, every failure's copy, fenced retries, meaningful phase tests,
and preservation rollback. Describing an invariant alone is insufficient.

## 3. Architecture and resource envelope

### 3.1 One supervised browser, separate saved state per person and site

One new **system** service `sjcos-browser.service` runs a dedicated non-login
Linux account `sjcos-browser`, never Joe's account or personal Chrome profile.
It owns a controller and at most **one** Chromium process tree. Two isolated
non-default BrowserContexts can be live: one per active user, at most one task
per person. Joe + one staff or two staff may work concurrently. Staff do not share
Joe's cookies. A context is identified by `(user_id, saved_login_id or anonymous,
task_id)` and can never switch its identity while live.

**Persistent profiles decision:** per-person, per-login/site logical profiles,
not one shared Chromium user-data-dir and not one process per staff member.
Persist Playwright `storageState({indexedDB:true})` (cookies, local storage,
IndexedDB) **encrypted** under §5; restore into a fresh isolated context only
for the same person and entry. SessionStorage is not persisted; some sites will
require login/2FA again. Persistent default Chrome profiles would mix cookies
across staff; per-person full Chrome processes violate the memory goal. This
choice preserves supported logins with one process and makes the isolation
boundary explicit. Sharing a vault entry grants credential use, **not** another
person's saved cookie state. Partition additionally by exact site origin;
explicit, reviewed SSO login chains can include several origins (§5.3).

Default Chromium profile and downloads are on a private size-capped tmpfs,
never the repo, Joe's HOME or a backup of raw browser files. No unencrypted saved
state, passwords DB, crash dumps, session restore, tracing, HAR, video, console
capture or automatic screenshot-on-error. Root/service account reads only.
A new context starts with no pages before request/target guards attach; create
one `about:blank` page, restore only eligible origin state, then navigate. Close
all pages/context at task end, idle eviction or crash; do not reconnect to an
old uncontrolled tab. A second tab is allowed only as a tracked popup, maximum
**two tabs/context, four total**. Popup gets the same guards before resuming;
third tabs are blocked visibly. Context IDs and CDP target IDs never go to the model.

### 3.2 Process, CDP and network boundaries

Proposed files: `browser-runtime/package.json` + lock, `scripts/sjcos-browser.mjs`,
`lib/browser/{contracts,policy,network,control,approvals,vault,storage,audit}.mjs`,
`mcp/browser-mcp.mjs`, `deploy/sjcos-browser.service`,
`deploy/browser-network-setup.sh` and root-owned network configuration.
Keep testable browser logic dependency-free/pure where possible; UI adapters in
`lib/browser/*.ts` use `server-only`. No import of Playwright into client bundles.

Controller uses `chromium.connectOverCDP` internally. Launch arguments include
`--headless=new`, `--remote-debugging-address=127.0.0.1`,
`--remote-debugging-port=0`, private `--user-data-dir`, `--disable-quic`,
`--disable-background-networking`, `--disable-sync`, `--no-first-run`,
`--no-default-browser-check`, `--disable-breakpad`, `--disable-dev-shm-usage`
only if the private tmpfs sizing requires it, and
`--proxy-server=http://<private-proxy-address>:<port>`,
`--proxy-bypass-list=<-loopback>`. No `--no-sandbox`, `--disable-web-security`,
`--ignore-certificate-errors`, `--remote-allow-origins=*`, extension or arbitrary
CLI argument inputs. Disable password manager/autofill and permissions by policy;
Chromium sandbox must work in the deployed unit or admission stays off.

**Loopback alone is insufficient on a shared host.** Controller + Chromium run
inside a root-created private network namespace. CDP loopback exists only there;
no veth port forwards, nginx location or Cloudflare route to CDP. The web process
cannot query `/json/list`. The only host interface is a Unix domain controller
socket `/run/sjcos-browser/control.sock`, mode 0660, service owner + web group.
Allow a narrow API, never a raw CDP relay, arbitrary URL proxy or evaluation API.
Authenticated bridge envelopes are signed by the web process, short-lived, and
bound to route, body hash, actor, task, run, expiry and nonce; reject replay and
out-of-order mutation sequence. The stdio MCP launch uses the authenticated rendezvous in §4.2, not inherited
extra FDs: Claude and the SDK's stdio spawn do not forward them. MCP cannot mint
web approvals; web bridge keys never enter CLI env.

**Concrete request gate (replaces end-to-end CONNECT-only design).** Deploy a
separate request-aware `mitmdump` process with a reviewed SJC addon
`browser-runtime/egress_gate.py`, locked exact dependency/hashes in that runtime's
requirements lock before Phase 0 acceptance. TLS is terminated at this gate
using a private per-install CA trusted **only in the service Chromium NSS store**;
never install it in Joe's/system browser, never ignore certificate errors. Gate
validates upstream certificates/hostname normally. CA key is gate-only via
LoadCredential, excluded from host/application backups, not a vault KEK. A portal
with pinning/incompatible TLS is unsupported. This explicitly changes the prior
no-MITM recommendation because CONNECT cannot inspect HTTP method/path/body.

Root creates one private namespace for browser/controller and one for the gate.
Browser namespace nftables: default drop INPUT/OUTPUT/FORWARD, including IPv6,
UDP, DNS, direct TCP and host routes; permit namespace loopback CDP and TCP only
to two dedicated gate listener ports on the private veth. Gate namespace: ingress
only from that veth, upstream only public TCP 443 plus its fixed validating DNS
resolver. `Unbound` with a root-owned non-global-address deny list resolves DNS;
addon also validates the complete CNAME/A/AAAA chain and pins the selected public
IP per upstream socket. Gate has no route to app/CDP/DB. Controller reaches DB
through its scoped Unix socket, and gate via a separate authenticated Unix RPC.
Namespace setup is root-only; runtime has no NET_ADMIN/sudo/firewall access.

Each listener is assigned exactly one live context/task/boot and revoked before
reuse; two listeners support two contexts. New/reused listener has a new generation
and **all old TCP/TLS/upstream connections are closed before reassignment**. Use
`Target.createBrowserContext` proxyServer bound to that listener with no username,
password or Proxy-Authorization. BrowserContext traffic can't select the other
listener; a CDP fixture must prove this or admission stays off. No origin-unscoped
Playwright proxy credentials, hence 401 cannot elicit an internal password. Gate
maps listener+generation to task, not a reusable bearer string in page headers.
Deny 407 rather than forwarding auth. No CONNECT passthrough or upstream proxy.
Reject Host/`:authority`/CONNECT/SNI mismatch, IP literals, alternate ports,
request smuggling/ambiguous lengths, WebSocket upgrades, HTTP CONNECT inside TLS,
WebTransport and HTTP/3. Disable QUIC and close HTTP/2 push/extended CONNECT.

**One interception owner:** controller raw CDP session alone owns Target autoattach
(`waitForDebuggerOnStart`) and Fetch request-stage interception for page, iframe
and popup targets. Playwright is used for context/typed locators; no Playwright
`route`, `httpCredentials` or authentication handler is installed. CDP Fetch
credentials are never used; unsupported auth challenges cancel. Guard target
before resume; worker/service-worker/shared-worker targets are closed; no stored
service workers restored. The controller may continue a request toward the gate,
but cannot thereby authorize upstream transmission.

**Fail-closed proof obligation:** addon `requestheaders` withholds every request
upstream, including bodies/Expect:100-continue, until bounded buffering completes
and an exact authorization is consumed. Streaming uploads/download requests,
unknown/chunked unbounded request bodies and >25 MiB requests are rejected. No
upstream request headers/body are sent on a persistent tunnel by default. Gate computes a service-keyed HMAC over canonical method, authority, path/query, sanitized headers, body and listener
generation (no public plaintext-secret hash); requests a decision over Unix RPC. Each decision is for exactly that
request digest+unique flow nonce, ≤2 s, one use. It is neither a per-origin permit
nor a time window. Final decision requires the durable consume/audit receipt
§7.3; read/resource decision requires §8.1 value/provenance schema. Controller
loss, Fetch detach/target loss, timeout, invalid signature, policy mismatch or
addon exception -> deny and close flow, never pass through. Gate runs quiet with no flow/body/URL/console dump, no save-stream, only fixed
content-free addon events; disable all default request/error pretty-print paths.
Gate startup refuses
without addon; controller startup refuses without attested gate build/policy.
No direct route exists around it. If the gate crashes, sockets die; systemd cannot
restart into a passthrough configuration. Deny unknown requests even when CDP is
absent. Revocation kills task listeners and open upstream sockets.

An **already authorized** in-flight final request may have reached the site at
failure; it becomes unknown, not unsent. Interception loss cannot authorize a
buffered/new mutation, including on existing TLS/keepalive connections. This is
the boundary to demonstrate using packet capture at a hostile fixture's ingress:
kill/detach controller/Fetch before a decision, during buffered body, with live
TLS and child target, and during final dispatch. Observe zero unapproved bytes;
one previously consumed request can be unknown, never retried. Gate process is
part of trusted computing base, not proven safe by a watchdog. Phase 1, not just
payments, stays disabled until the real pinned-runtime fail-closed fixture passes.

Security boundary includes trusted service binaries, app authorization and the
OS; it does not resist root, Joe deliberately running arbitrary owner code on the
host, or a compromised approved outside site stealing a login it receives. Do not
claim the vault protects against its destination website. Browser-enabled turns
remove code/shell access (§4), so page injection cannot casually use Joe's normal
operator tools to read the vault or disable guards.

### 3.3 Proposed unit limits and admission

Resource containment is explicit across UIDs. Root deployment reads Joe's
numeric UID (do not assume 1000) and uses the existing common
`user-<joeUID>.slice` with MemoryMax=24G, MemorySwapMax=0, CPUQuota=800%.
New **system** service units (even with dedicated Linux UIDs) set
`Slice=user-<joeUID>-sjcosbrowser.slice`; systemd's hyphen hierarchy makes that
slice a child of `user-<joeUID>.slice`, not a sibling `sjcos.slice`. Supervisor
uses sibling `user-<joeUID>-sjcosbrowsersupervisor.slice` (32 MiB reserved).
Exact ControlGroup paths discovered from systemd are persisted in root-owned
`/etc/sjcos-browser/accounting.json`, typically
`/user.slice/user-<joeUID>.slice/user-<joeUID>-sjcosbrowser.slice`.
Verify both user manager and new feature are descendants of the same hard-capped
account slice, and enumerate `/proc` UID/cgroups for **every** Joe workload. Any
Joe-owned system service outside it must be assigned `Slice=user-<joeUID>.slice`
in a separate owner-authorized deploy/restart window, or activation stays blocked.
No unapproved live-service reparent/restart. Summing siblings alone is monitoring,
not a hard common ceiling; different UID never means free capacity.

Child `user-<joeUID>-sjcosbrowser.slice`: **MemoryHigh=2G, MemoryMax=3G, MemorySwapMax=0,
CPUQuota=150%, TasksMax=256**, includes controller/Chromium, gate, validator and
reader. Controller Node heap 256 MiB; gate unit MemoryMax=384M, CPUQuota=35%,
128 total connections / 32 per task / 8 upstream active per task, 10 s connect,
30 s headers and 60 s request timeout. Validator 384 MiB/50%/one job; reader
128 MiB/15%; Chromium context count remains two. Aggregate cap wins over sum.
Private tmpfs 384 MiB (profile 128, downloads 200, buffers 56), `/dev/shm` 128 MiB
charged to slice; encrypted persistent quarantine 256 MiB, staging 256 MiB,
profiles 64 MiB, audit spool 64 MiB. Enforce filesystem quotas and bounded buffers;
no unbounded spill to Joe's disk. Exhaustion denies work/marks result unknown.
Nice=15, OOMPolicy=stop, KillMode=control-group, TimeoutStopSec=15.

Root-owned `sjcos-browser-supervisor.service` lives **outside the child slice**
inside the budget (32 MiB reserved). It watches `memory.events`/systemd result;
root `ExecStopPost=browser-latch record` also records oom-kill, signal 9 or 137.
Write/fsync/rename `/var/lib/sjcos-browser-supervisor/oom-latch.json` (root 0600)
before restart. Before launch, supervisor persists an uncleared boot/running marker;
if it dies before recording the OOM, next startup treats the marker as latched.
`ExecStartPre=browser-latch check` checks latch, marker, prior cgroup OOM counter
and metrics availability. Missing/corrupt state denies launch. `Restart=on-failure`
may restart housekeeping, **never Chromium while latched**; no automatic latch
reset on reboot. Joe/root's explicit `browser-latch reset --incident <id>` after
inspection writes independent audit evidence and clears it. No model/web API can
reset. Cleanup/health and encrypted-file reader remain available in admission-off
mode; supervisor prevents a crash loop even if controller and Chromium die together.

Unit hardening: `User=sjcos-browser`, restrictive UMask 0077, NoNewPrivileges,
ProtectSystem=strict, ProtectHome, PrivateTmp, RuntimeDirectory, explicit writable
state/tmpfs paths, core dumps disabled, no unnecessary device access/capabilities.
Validate Chromium's user namespace sandbox with these restrictions; do not add
blanket seccomp restrictions that break it and then disable its sandbox.

Supervisor serializes all reservations with `/run/sjcos-browser-supervisor/admit.lock`
and persists at most two context slots; reservation and queue offer are one operation.
Global admission checks `MemAvailable`, common budget `memory.current` and child
`memory.current/events` via root supervisor read-only metrics RPC, before first
launch and before second context. Require ≥5 GiB available memory and total
relevant workloads ≤18 GiB on this 24 GiB box (reserve browser 3 + safety 3).
Cannot read metrics = no new context. At browser MemoryCurrent >2.5 GiB for 10 s,
pause work and evict idle context first; persist eligible state, close browser
if pressure persists. At host/account ≥21 GiB, suspend new commands and close
contexts within 5 s, even if a person is connected; show resource failure copy.
Do not kill/restart any other app. No resubmission in pressure recovery.

Queue: FIFO by explicit admission request, one entry/person, max eight entries;
staff sees only own queue position, no other identities/job details. Joe sees
“Browser is busy. Abigail is using it.” and the In use list (§6.3). No queue jumping by role.
A grant waiting for Joe does not reserve capacity indefinitely. Queue entries
expire after 5 min; admission offer lasts 30 s and requires the person still
present. UI heartbeat every 5 s; attendance means Operator panel open, document visible
and this task's conversation selected, **even while Chat or Canvas is selected**.
Browser stream may stop while hidden without ending attendance. Closing Operator,
backgrounding app or selecting another conversation drops that device presence;
when no initiator device is present for 15 s pause agent and deny requests. Any ongoing
read is cancelled; no final step starts with >5 s-old person heartbeat. Staff
waiting for Joe still need the staff person present to execute.

Pending review counts as activity until its 5 min expiry while initiator remains
present; no indefinite reservation. Otherwise no input/tool progress for 5 min closes context; last 60 s show warning. Viewer
frames/polls alone do not reset idle. No contexts for 60 s closes Chromium but
leaves the tiny controller ready on its socket. Controller housekeeping runs
independently of awaited tools every second. No timers/cron may open a context.

### 3.4 Failure/recovery and the state machine

Session states: `queued → starting → active ↔ paused → closed`; `starting/active/
paused → failed`. Active control is separate: `agent | person | none` with a
monotonic `control_epoch`. Privacy is `public | private | delegated_secret`; approval is a separate
immutable action record. Never conflate “agent waiting” with a CLI tool call that
must remain open for 24 hours.

Task/run associations are immutable (§9.1); current_run_id is only a fenced
pointer, never the parent of historical actions. An ended run's pending card can
be decided by the human web path while its browser context and attendance remain
valid. The service authenticates that web session independently of the expired
MCP capability; decision does not revive the model or change action.run_id.

| Task transition | Caller / precondition | Side effect / recovery |
|---|---|---|
| new → queued → starting → active | web admission + supervisor, valid session/sites/slot | Attach immutable run, fresh boot/context/epochs; bounded 20 s start or failed |
| active → paused (successful turn/end-to-wait) | runner finish authenticated by stored run | Revoke MCP capability; retain context ≤5 min; preserve pending card only; show “Agent turn finished. Browser is paused.” |
| paused → active (new turn) | explicit attended Continue, no live/pending review | Attach new immutable task_run; fresh capability/control epoch; browser-only history; stale older observations |
| paused + pending review → paused | web decision, original action/run still bound, current context and both required presences valid | Dispatch via independent web capability; no CLI starts. New model turn cannot race decision; task lock serializes. |
| any live → paused (absence/stream fault) | service attendance expiry | Fence commands; stale pending card when attendance invalidated, never dispatch after initiator leaves |
| any live → closed (Stop / 5 min inactivity) | web/service | Revoke capabilities, close context; expire undispatched action; executing becomes unknown if unconfirmed |
| any live → failed | runner unexpected death, CDP/Chromium/controller loss, permissions/flag off, pressure | Kill listeners/context; pending/approved expired, executing unknown; no automatic repeat |
| closed/failed → new task | explicit web restart, result reconciliation first | Fresh context; encrypted eligible state only; never reuse an old grant/card |

A runner intentionally ending with waiting status is different from a crash;
runner writes finish disposition before exit, otherwise supervisor treats it as
unexpected death. A review wait expires at 5 min, cancels request and releases
idle context; pending network buffer has its shorter TTL (§7.1). Re-creation
requires a new person-reviewed action, never replay. Any current run attachment
fails REVIEW_PENDING while a card/execution is live; simultaneous resume/approve
locks task first so exactly one succeeds.

On service restart reconcile old boot contexts as failed and any consumed action
as unknown **before** admission. Old ended-run records/grants remain unchanged.
Read-only reload requires Try again. Crash before state-save loses latest cookies,
not vault entries: “Sign in again.” Corrupted saved state is quarantined then
discarded, never restored as public or as another person.

## 4. Run admission and per-action authorization

Add a third run profile **`browser`**, based on business restrictions but also
removing Read/Glob/Grep, NotebookRead, Task/Agent, all shell/edit, WebFetch and
WebSearch, raw file reads, arbitrary MCP registration and code execution tools.
It gets the browser wrapper plus the exact filtered SJC OS allowlist in §4.2. In particular no credential-returning user tools, raw file/text
fetch tools in private mode, provider proxy, arbitrary HTTP, terminal/delegation
or tool that starts another operator. Do not rely on name prefixes for this
allowlist. `with_mcp=false`, bypass/auto and “Express permission” never weaken
browser guards. Run bounds initially 20 min active model work, 60 turns, existing
business cost cap; approval waits persist and finish the turn, not a busy CLI.
Resumption is a new, presence-checked browser turn on the same paused task.

Add server-set `dev_agent_runs.launch_source` enum
`legacy | panel_web | panel_mobile | panel_voice | telegram | background`,
`browser_task_id uuid NULL`, and profile CHECK extension, plus all TypeScript RunProfile unions/row decoders and
DB-role selection branches. Browser 0100 owns launch_source and immutable
continuation_of_run_id; shared H4 is normative, no parallel provenance field. Browser profile always selects the narrow agent
login for its SJC tools, including Joe; only service has the browser login. Existing rows backfill
`legacy`, never infer attendance from a nonnull principal. Only server-side `admitAskRun` for authenticated
Ask web UI POST can set `panel_web` + an expiring attendance record; trusted internal
start options are not accepted from message/tool JSON. In v1 browser requests
from any source except `panel_web` return `BROWSER_ATTENDED_ONLY`, including owner
Telegram runs, cron/business, voice delegations, worker and terminal/remote MCP.
A staff Ask turn remains restricted; browser profile is not an upgrade to operator.
Other model backends show “Browser works with Claude in this version. Start with
Claude”; do not silently route Hermes/Telegram gateway identity to an owner context.

`lib/authority/run-profile.mjs` defines and tests `browserEligible()`;
shared `admitAskRun` then `startClaudeRun()` store trusted source, current user,
continuation_of_run_id and task FK; runner rereads
all three before registering `mcp__browser`, and service rereads live DB identity
on **every command**, including reads. Add guarded browser tool classification
to the authority tool catalog. Main HTTP `sjcos-mcp.service` never registers
browser control, vault fill or approval tools. A guessed SJC_RUN_ID cannot attach.
Delete the old optional Playwright hook; resumed CLI sessions get a fresh strict
MCP config, not their former browser server/capability.

Task authority = active owner, or active staff with `ai` + **all** `required_areas`
and access to the referenced record under existing readers. Permit tasks require
`projects` + `compliance`; invoice-related tasks also `invoices`, purchases
`purchase_orders`, etc. No task can use a generic `ai` permission to browse all
business data. Server derives required areas from task kind and referenced record; Joe never
picks them. Model proposals cannot shrink them. Origin-specific constraints can add, never remove areas.
Staff sees only own browser tasks and own permitted credentials. Joe can review
all tasks but must explicitly Open review to join one; read access alone does not
show every staff private live frame. Client/sub roles never enter this feature.

UI routes: cookie session + fresh user row, active/revocation check, task/run/
record/area check; 401 for no valid login, 404 for another person's task/artifact,
403 for a known task whose authority was removed. Every stream rechecks every
5 s with an uncached DB authorization function (not React's per-render cache),
and before a private frame is delivered. Each mutation checks exact production
Origin + CSRF token, Fetch Metadata, JSON content type, size/rate limits; no
CORS wildcard, tokens in URLs, or cookie-less signed media URLs. GET never
mutates control. A service outage during auth check fails closed.

### 4.1 Thread ownership and real web sessions — prerequisites

**Thread isolation ships before Browser panel access for Joe or staff**, not
only before browser.staff_enabled. Per shared H5, Canvas **0105 / Phase 0** owns
thread/folder ownership, tombstones, backfill and access guards. Browser cannot
claim independent rollout before that privacy acceptance; apply 0100–0105 with
both features disabled and deploy guarded admission code afterward. Canvas
renderer/flag need not ship. Browser 0100–0104 stay additive and do not reference
new ownership columns at migration time; guarded functions that need them are
finalized/revalidated by 0105's common admission integration, not invoked earlier.
No duplicate ownership migration in Browser's reservation.
Add `ai_conversations.owner_user_id`, `ai_folders.owner_user_id` (UUID users FKs),
backfill only provable creator from run/message audit. Ambiguous legacy rows are
owner-only quarantine for Joe to assign, never “all staff.” New rows require owner.
Folder links cannot cross owners even if they point at the same job. Scope list,
search/count, load/messages, rename/archive/delete, folders/move, attachment
read/upload, steer/stop/start/resume/poll and RunReview by authenticated owner of
conversation, then record access. Joe's explicit browser review does not grant
full staff chat access. Shared job access never shares chat. Reread access at
actions **and** SQL adapters; reject restored panel IDs from another person.
Task.conversation_id/initiator never change; every attached run must have both
matching. No metadata leaks in errors/search/pending-run chips. Canvas rendering may ship
later, but Browser owner/staff access cannot bypass this common prerequisite.

Add server-side `web_sessions` with id UUID, user_id, auth_at, expires_at,
revoked_at, generation, created_at. Mint a signed JWT `sid` on real web login;
renewals keep sid/authAt, extend expires only via authenticated renewal policy.
Legacy JWTs without sid require sign-in again for Browser. Every browser handler
uses `readBrowserCookieSession`, reading only httpOnly secure session cookie,
validating HS256/issuer/audience/exp plus session row, current generation, active
user and revocation epoch. Do **not** use readSession's Bearer fallback. Missing,
known-development or short/invalid SESSION_SECRET disables browser activation.
Logout marks that sid revoked in DB before cookie delete, revokes any model
capability launched under that sid and stales its pending actions, fences attached viewers,
controls and attendance; sign-out-everywhere revokes all. Session replacement
revokes old sid; an old JWT cannot rejoin. No generic client-supplied sid/device
is trusted.

`browser_viewers` binds server-random device UUID/hash to sid, user, task, joined
role (initiator|owner_review), presence deadline, stream ID/generation, last frame,
last input seq and control epoch. Device secret is in memory, not localStorage or
URL; CSRF and cookie bind join. Same person on a second device explicitly joins
with their **own valid sid** and task access; max two initiator devices plus Joe.
Presence from another sid cannot renew the initiating device, but either authorized
initiator device can keep task attended. Hiding/closing one viewer leaves the other intact. Logout/expiry of the
model turn's launch sid still revokes that run even if another viewer remains;
that other device may explicitly start a new attended turn, never inherit the
old capability/card.
Joe's review device presence is additional, never substitutes for staff attendance.
Before every frame/dispatch check session expiry and viewer binding; query DB
at stream start and at most 5 s intervals, and immediately on revocation events.
No stream survives JWT expiry (deadline timer); blank private image on expiry.
This is authorized visible-UI presence, not proof of human attention: background
scripts or a person walking away cannot be detected with certainty.

### 4.2 Launch, exact tools and history isolation

Trusted runner creates a per-run directory (0700, no repo/env/vault mounts) and
registers three MCP servers in a generated config: `browser` (our wrapper),
`sjcos` (browser filter), `interact` (typed ask-human only). Config contains only
absolute node/script paths and nonsecret run/task IDs. CLI argv: `-p`,
`--input-format stream-json`, `--output-format stream-json`, `--verbose`,
`--strict-mcp-config`, `--mcp-config <generated-file>`, `--tools ''`, explicit
`--allowedTools` entries for **each** tool below, `--permission-prompt-tool
mcp__interact__approve_action`, validated model/effort, existing cost/turn bounds.
Use an isolated CLI settings/session directory with no ambient user/project MCP,
plugins, hooks or repo CLAUDE.md; Phase 0 verifies actual resolved CLI behavior.
No prefix-wide `mcp__sjcos` approval and no auto/bypass override. Unsupported CLI
restriction flag/behavior fails startup, not fallback.

Env allowlist: PATH, dedicated HOME/XDG config/session dirs, LANG/LC_ALL, bounded
TMPDIR, necessary CLI provider auth via protected credential channel, SJC_RUN_ID,
SJC_CONVERSATION_ID, SJC_RUN_PROFILE=browser, SJC_DB_LOGIN=agent,
SJC_DB_STRICT=1, SJC_BROWSER_TASK_ID. No app env, DATABASE_URL owner, key material,
proxy credentials or bridge signing key. MCP tools get the narrow DSN via their
protected launcher, not CLI env; they cannot read `.env.local` in strict mode.

**Supported rendezvous across both stdio hops:** trusted launcher records run,
task, principal, expected executable digests, process tree/cgroup and private
rendezvous socket path before spawning CLI. A proposed small Linux Unix-socket
helper obtains SO_PEERCRED (pid/uid), verifies descendant pid start-times and
cgroup against launch registry, plus exact wrapper executable. Each MCP process
on startup connects to `/run/sjcos-browser/launch.sock`, identifies only its
nonsecret run/tool-server kind, and consumes its one permitted registration slot.
Launcher gives that connection a task/run/profile-bound capability in memory;
not argv/config/env/model output. Descendant check plus slot prevents another run
or host process with copied IDs from attaching. Reconnect needs trusted launcher
reissue; no PID-only trust. SDK uses ordinary stdio 0–2; no unsupported FD forwarding.
Actual Claude→MCP rendezvous exchange is a Phase 0 gate. A compromised root/CLI
runtime is outside boundary; model tools cannot execute a process or open socket.

Exact SJC names, public **and private** browser profile (no implicit additions):

| Name | Permitted data / scope |
|---|---|
| `get_operating_context` | Fixed browser operating rules + task area IDs; strip global business dumps |
| `get_project` | Only bound task.project_id; Projects + all task areas; projected confirmed address, scope, permit checklist, company license facts, safe IDs; no arbitrary notes/emails/files/secrets |
| `get_lead` | Only bound lead task; Leads + task areas; same bounded confirmed-facts projection |
| `get_work_item` | Only task-linked work item + record access; safe status/due date/type, no arbitrary body/inbound text |

Filter registration and `callTool` **in `mcp/sjcos-mcp.mjs`** against this table,
verified browser run from rendezvous, per-call areas/record and output projection.
Tool names keep existing identities but browser profile uses strict narrowed input
and output schemas; normal tools elsewhere retain behavior. No list/search tools,
raw file fetch, knowledge capture, mail/send, provider proxy, start/delegate,
`request_owner_permission`, `record_agent_run`, `record_skill_used` or
`record_receipt` accepted from model. Controller creates typed audit/run/receipt
records with fixed templates and server-proven IDs, not arbitrary model text.
Interact exposes only `ask_owner` for bounded nonsecret questions to initiating
person; browser-filtered schema, no attachments/free-form serialized tool input.
`approve_action` exists only to **deny** unknown tool permissions, never autoallow
by read-like name or write inputs to generic interaction rows. In delegated-secret
mode the SJC subset stays identical; browser tools shrink to fixed adapter controls,
status/prepare/close; login lists/downloads return metadata only, never pixels.

Strict DB startup on **runner, sjcos, interact, controller, reader and gate DB
adapter (if one is added)**: resolve only explicit narrow DSN (protected env value,
then protected narrow file; never owner URL or `.env.local` fallback). Connect and
check session_user=current_user=required `sjcos_agent` or `sjcos_browser`; reject
owner-valued DSN, inherited SET ROLE, failed check or absent DSN **before tools
register or admission**. Runner's browser-specific persistence uses guarded app
bridge functions, not an owner connection. No logging connection strings. Existing
ordinary profiles are not silently changed by this requirement.

**Trust-profile history isolation:** `browser_task_runs.cli_session_id` and private
CLI storage partition by user+task+browser profile, separate from
ai_conversations.claude_session_id. Browser never writes/resumes the operator
session. A fresh Browser context receives only person-confirmed task facts/instructions,
not the full previous privileged transcript or its attachments. Browser transcript
messages carry trust_profile=browser; ordinary
operator, business or other-model turns must exclude them from unseenTranscript,
automatic summaries, attachments, cached prompts and background handoffs. A profile
upgrade starts a new conversation/CLI context after explicit human choice; only
fixed service outcomes/IDs and newly confirmed human instructions can cross.
No automatic “helpful summary” of page-derived instructions. Human thread may
still display browser events safely without feeding them into privileged model
history. Delete optional Playwright hook globally for these turns; merely refreshing
MCP config on an old tainted CLI session is insufficient.

## 5. Saved logins and the private part of a task

### 5.1 Vault contents and encryption

Use Node crypto **AES-256-GCM**, fresh random 96-bit nonce per encryption and
128-bit tag, 256-bit random data key per entry/profile. Wrap each data key under
an independent 256-bit key-encryption key; AAD canonically binds schema version,
entry/profile UUID, owner/user ID, exact origin and credential revision. Store
ciphertext, nonce, tag, wrapped key, wrapping nonce/tag, `key_id`, schema and
revision; never plaintext password, cookie or password-derived hash. Separate
keys/purposes for credentials, saved browser state and private action request
bodies; never reuse backup/Gmail/session keys. Errors contain IDs/codes, not buffers.

Root provisions `/etc/sjcos-browser/vault-keys.json`, root:service 0640, directory
0750, read only by the browser service through systemd `LoadCredential`. The
repository, `.env.local`, app/CLI env, database and backups of application data
contain **no vault key**. Website receives metadata and boolean results only.
Local controller RPC encrypts Save a login over Unix socket; web process handles
submitted secret transiently but must never stringify/log it or write agent rows.
Entry form is a direct authenticated API request, not a chat message or generic
Server Action result that echoes a submitted value. Password fields have
`type=password`, `autocomplete=new-password`; no password reveal/copy API, no
secret in analytics, error reports, request-body logs or APM. TLS and no-store
for the web form. Manual login secrets use the private input endpoint, not a
chat composer. Don't put card numbers/CVV/2FA seeds/recovery codes in this vault.

Keys have active + decrypt-only versions. Rotation tool is an owner deployment
operation, not MCP: install new key version, switch encrypts, rewrap data keys in
bounded transactions using revision CAS, verify counts/round-trip, keep old key
until live rows **and backup retention** no longer need it. Credential password
change increments revision, revokes active fill permissions and destroys saved
states for all delegated users; role/share revocation does likewise. If rotation
fails, never discard old key. Lost key means re-enter logins, not a fallback to
plaintext. Keep an offline encrypted key escrow outside DB backups with a tested
restore procedure; Joe controls it. Restores default to browser disabled and do
not automatically re-enable remembered login sessions.

#### Envelope format (normative for every private artifact)

DEK and KEK wrapping both use **AES-256-GCM**, independent random 96-bit nonces,
128-bit tags; DEK 32 random bytes per artifact/revision. KEKs are independent per
purpose, never a password KDF. AAD is UTF-8 RFC8785 canonical JSON (JCS), no floats,
keys/UUIDs lowercase, origin canonical, explicit null fields, version=1. Domain
prefix bytes `SJCOS/browser/data/v1\0` + JCS(bindings); wrap prefix
`SJCOS/browser/wrap/v1\0` + JCS({purpose,artifact_id,data_aad_sha256,kek_id,
wrap_revision}). Bind ciphertext/tag to immutable data AAD; wrap the DEK with wrap
AAD. Rewrap changes only wrap nonce/tag/key_id/revision, **not** data AAD or content
revision. Plaintext hash stays encrypted, ciphertext hash can be public.

| Purpose tag | Required immutable data bindings in addition to version/purpose |
|---|---|
| login | login_id, owner_user_id, exact origin, credential_revision |
| profile | profile_id, user_id, login_id, origin_chain_digest, credential_revision, profile_revision |
| request_body | artifact_id, task_id, action_id, initiating_user_id, origin, action_revision |
| review_image | artifact_id, task_id, action_id, initiating_user_id, origin, action_revision, document_epoch |
| quarantine_file | artifact_id, task_id, user_id, origin, download_id, revision |
| saved_file | artifact_id, file_id, project_id, source_task_id, user_id, origin, revision |

Changing any binding requires new DEK/data encryption, never relabeling ciphertext.
Reserve encryption counters durably before use; per-purpose KEK version hard limit
2^24 wraps or 90 days, whichever first. At limit/missing counter deny new encrypts
until rotate. Crash may waste reserved counter, never reuse nonce. Rotation CAS
and fixtures include wrong purpose/record/user/action/file, nonce/tag tamper,
old wrap metadata, interrupted rewrap and backup restore. Exclude plaintext
`/etc/sjcos-browser/vault-keys.json`, gate CA and LoadCredential runtime paths from
**host backup jobs as well as app backups**; escrow is separate encrypted media.

### 5.2 Visibility and filling

Each entry belongs to one SJC OS user. Staff creates/updates/deletes only their
own entries. Joe manages his entries and can grant named staff **use** of selected
company entries, with required areas. Joe can disable delegated access, but does
not get a “show staff password” feature. Staff never enumerates another user's
private entry; list results contain label + exact site, visibility, last-used,
never username/password/cookies. Joe-owned company credentials shared with staff
get per-staff saved state, but **delegated-secret mode is stricter than ordinary
private mode**. Staff never receive arbitrary pixels, DOM, page titles, account
settings/reveal controls, downloads or remote pointer/keyboard from a shared-secret
context, before or after filling/restoring. Joe alone can view that private context
via explicit owner join; even Joe's pixels never enter model context. Staff see
“Login from Joe. Only this site's supported steps are available.” with reviewed
business controls and released fixed-schema outputs, not a remote image. Account
settings, reveal links, generic takeover and raw artifact exports/uploads are
unavailable to staff; masking a password input is not the boundary.

Delegated operation requires a reviewed adapter whose safe outputs come from a
bounded verified business response, never arbitrary DOM strings/images. Adapter
must prove secret-bearing pages cannot be reflected in any staff output; labels
are static, result strings constrained to reviewed schemas/person-confirmed facts.
If that cannot be established, refuse delegated use: **“This site can't safely
share a login yet. Ask Joe to finish, or sign in with your own account.”** Joe may
finish privately; alternatively staff use their own separately authorized
per-person/passwordless site account in a **fresh** context. No generic shared
account takeover, and no weakening decision 5 to “no reveal API.” Staff cannot
export or upload artifacts from delegated contexts; Joe alone can review evidence; all delegated-context images/downloads (including
sanitized copies) remain Joe-only in v1 and cannot be uploaded/exported by staff
or filed as staff-readable project artifacts. Share only separately generated
fixed-schema business outputs, e.g. verified success/failure and already confirmed
application facts, not arbitrary remote references/strings/pixels. Reject any
output whose safe provenance cannot be proved; regex/secret matching is defense
in depth, never the release criterion. Raw secret-bearing evidence stays Joe-only.
Any separately authored receipt document must use those safe facts, not page bytes. Company final steps always Joe-only.

Entry deletion immediately revokes in-flight fills and
profile restore, writes a content-free audit tombstone and schedules ciphertext
purge. Existing sessions must close; logging out of the external site everywhere
is a separate site-specific action Joe may need to do.

Fill flow:

1. Agent calls `browser_fill_login` with entry ID + current observation ID, **no
   password, username, CSS selector or origin chosen by the model**. Service
   resolves entry against run user, areas, current top frame exact HTTPS origin,
   top-frame login form and approved server-owned locator mapping. Initial generic
   mapping requires a person to pick the username/password fields in private
   take-over. Ambiguous fields, cross-origin frames, HTTP/basic auth, shadow DOM
   it cannot safely locate, or changed form fingerprint: private take-over only.
2. Before decrypt/fill **or before any manual pointer/key/wheel/IME/Type it input**,
   service under the context lock atomically enters irreversible private mode, pauses tools,
   stops/acks screencast, drains/drops every pending frame, detaches model
   observers and invalidates prior observation handles. It waits for all outstanding observations to cancel/complete without publication,
   drops pre-transition public frame/observation buffers, fences stream generation,
   then suspends page reads,
   snapshots, downloads-to-model, tool error payloads, console/network events,
   Playwright traces, accessibility/DOM reads and all page-derived model output.
3. Service decrypts into a short-lived Buffer, fills server-side with no returned
   value; best-effort zeroes buffers and releases references. JavaScript runtimes
   cannot guarantee erasure of every memory copy: restrict process/dumps instead
   of claiming otherwise. DOM events stay within the approved site and request
   policy. Return only `{status:'private', login_filled:true}`. Fill does not
   click Sign in; the person does that in take-over, or approves a separate login
   action. It is still an outside form submission and must not auto-submit.
4. 2FA/CAPTCHA happens by personal input in the same private mode. No OTP tool,
   screenshots to model, SMS forwarding or secret transcript. Password input
   can cross the user's browser/Next/controller transiently, never model.
5. **V1 strict guarantee:** every take-over context (even with no apparent secret), filled vault context or
   restored profile is private for its remaining lifetime.
   No arbitrary screenshot, DOM text, page title/URL query, downloaded bytes,
   response body, field value or accessibility label from it reaches the model.
   Merely masking a password box or replacing the exact password string cannot
   protect against a page echoing/encoding it. This restriction also applies to
   restored logged-in state, which starts private. Authenticated agent actions
   may use a reviewed adapter's fixed control IDs and person-supplied business
   inputs; they return content-free statuses. A generic unknown portal can be
   worked by take-over; the agent can prepare data but cannot read its page.
6. Give back to agent in private mode resumes only those blind, typed actions;
   UI says **“Login pages stay private. I can fill the steps this site supports;
   take over for the rest.”** To resume unrestricted public research, open a
   **new anonymous context** after closing the private one. Never “unhide” a
   previously credential-bearing context or attach private screenshots to chat.

This is a deliberate v1 product limit, not a claim that regex redaction makes any
hostile page safe. It still permits generic manual account entry and later
reviewed city adapters that fill known permit fields. An adapter declares fixed
locators, field types, safe request patterns and receipt checks; model-controlled
code is never an adapter. Private downloads can save to project files for people,
but model-read APIs/attachments must honor the file's restricted provenance (§8).
**All** manual inputs use the no-log private endpoint regardless of field type;
no detection-after-typing exception. The service rejects attempts to type into
password/OTP/card/account-secret fields via ordinary `browser_act`; it redirects to Take over. Don't solicit secrets in chat.

### 5.3 Origin binding and sites

Bind to canonical HTTPS origin (scheme, IDNA host, port=443), not substring,
eTLD+1, wildcard or a matching page title. `city.example.evil`, userinfo URLs,
trailing-dot tricks, alternate ports and subdomains are different. Validate
origin again immediately before fill under the same serialized context lock;
navigation epoch changes abort. No fill into a cross-origin iframe, even if a
popup resembles the saved login. SSO is an explicit list of individually reviewed
HTTPS origins; each credential belongs only to its IdP origin, and no passwords
are copied across origins. Cookie domain scope must not broaden beyond an
approved chain. Redirect to an unapproved site pauses before request; saved
password never follows it. Sharing one provider's origin across unrelated
tenants requires tenant binding in the credential mapping; unsupported tenant
identification means Take over, not autofill.

Audit save/update/delete/delegate/revoke/fill attempts and success by entry ID,
actor, task/run, canonical origin, revision and reason code. No username, secret,
keystrokes, field text, URL query or body. Password change/revoke matters at the
service, not merely by hiding its UI row.

## 6. Live view, take-over and responsive screens

### 6.1 Transport and control contract

Use **SSE for frames + status; POST for input/control**. Existing app polling
continues for chat state; don't put base64 frames into `pollAgentRun`/Postgres.
CDP `Page.startScreencast` JPEG quality 55, canonical browser viewport 1280×800,
max encoded frame 160 KiB. Throttle changed frames to 2 fps watching, 5 fps for
the controlling person; 1 fps/960×600 presentation for constrained phone links,
without changing the actual browser viewport or invalidating an approval.
Screenshot review image max 1280×800/300 KiB. These are ceilings, not guaranteed
portal animation rates. Ack each CDP frame promptly even if dropped; latest-only
one-frame buffer/viewer. Drop slow frames, never queue a movie; per-session
encoded budget 1 MiB/s, max three authorized viewers (two devices for initiator +
Joe). Controller returns HTTP 429 before a fourth stream.

Events: `state`, `frame {stream_id,stream_generation,frame_id,seq,control_epoch,document_epoch,viewport,width,height,
jpeg_base64}`, `action`, `file`, `reauth`, `closed`. Frame seq is connection-local;
no persisted replay frames or Last-Event-ID recovery. Accidental disconnect pauses; reconnect fetches fresh state/new frame and requires
Resume. Planned 60 s rotation with overlapping reauthentication keeps attendance
and agent working; it only replaces stream/frame identity. Input from old stream
is rejected even if seq restarts at 1.
Heartbeat comment every 10 s; rotate stream every 60 s to force full session
reauth. `Cache-Control: private,no-store,no-transform`, `Content-Type:
text/event-stream`, `X-Accel-Buffering:no`; no compression, no service-worker
cache. Private context model streams never receive a frame; authorized human
stream may. Frame bytes are never in app logs or model logs.

New nginx location matching `/api/agent-browser/sessions/<uuid>/events` proxies
only to Next :3017 with HTTP/1.1, Connection empty, `proxy_buffering off`,
`proxy_cache off`, gzip off, `proxy_read_timeout 75s`, `proxy_send_timeout 75s`.
Leave `/mcp` separate. Apply the equivalent location inside the deployed TLS
server, which certbot owns. Cloudflare dashboard: bypass cache for
`/api/agent-browser/*`, no content transformation on events, verify Access/WAF
allows the authenticated stream. Tunnel unit/hostname remains as is. SSE avoids
Upgrade plumbing; if future WebSockets are proposed, that is a separate reviewed
change with Origin checks and explicit nginx Upgrade/Connection map.

Control is a server record `(web_session_id,viewer_id,person_device_id,
control_epoch,expires_at)`; only a server-minted joined viewer can hold it.
Take over acquires its exclusive lock, fences the agent, cancels not-yet-dispatched
commands, waits for in-flight command completion ≤2 s; if not cancellable, freeze
and show “Finishing the last step…” until its outcome is known. Do not let person
and agent race the same click. Control heartbeat 5 s, expires after 15 s;
expiry sets control none and pauses, **never returns to the agent automatically**.
Joe may explicitly replace a staff controller after warning; staff sees “Joe is
in control.” Device switching by the same user also requires Take over here.
Only that device's signed control token and monotonically increasing input seq
are accepted. Server dedupes seq and body digest (same seq/different body conflicts); input
must bind stream_id/generation/frame_id/document_epoch/control_epoch and device.
Outdated frame/epoch => 409 and no click.

Input forwarding: image-to-viewport coordinate mapping accounts for letterboxing,
zoom and devicePixelRatio. Send pointer down/up/move (coalesce moves 30/s), wheel,
key down/up, and IME committed text using CDP Input APIs. No raw JS evaluation,
clipboard read/write, file paths, developer shortcuts or navigation to `chrome:`.
All non-move input checks authority/epoch/presence. Rate ≤60 input events/s,
text payload ≤4 KiB; **all manual input**, including pointer focus, runs only
after permanent private transition, through the memory-only no-log input path.
There is no public manual-input bypass. Escape exits local keyboard capture; the remote Escape key is
an explicit control. Focus stays visible; screen-reader users get a **Page
controls** list for public content or reviewed adapter controls, never raw
credential field values. Browser image is labeled remote content, not an iframe.

Give back to agent releases person lock, invalidates pending approvals, clears
sensitive in-page fields where safe, persists only encrypted eligible state,
and asks **“Let the agent continue?” [Continue] [Keep paused]**. Continue creates
new observation/control epoch; private-mode restriction persists. Switching Browser↔Chat↔Canvas preserves attendance (§3.3). Closing Operator,
backgrounding app or changing thread drops that device presence; returning after
a pause requires Continue. “You left the browser. The agent paused.” [Continue]. Stop browser cancels
queue/actions, closes context, revokes fill capability and retains saved files.
Back/Close pane changes local view, not browser history; browser history controls
live in the toolbar and obey site/submit guards.

### 6.2 Placement; shared contract with Canvas

Adopt **[the shared Ask host contract](_ask-pane-host.md) H1–H5 verbatim by
reference**, committed in **`dc36db88`**. It owns placement, host/selection APIs,
840 px measured-content split, minima/gutter, dock/app-view expansion, phone
history/back, focus/Escape, attention priority, canonical provenance and migration
ownership. Canvas Phase 0 implements the shared `AskContentPane.tsx` once;
Browser supplies only its registry renderer. Browser does not redefine these
rules. Shared implementation + 0105 privacy acceptance are Browser release
prerequisites; Canvas rendering/feature flag need not be enabled.

Browser-specific values for every “Browser plan decides” slot:

* Snapshot `status` enum exactly `queued|starting|active|paused|closed|failed`;
  `id=task_id`, thread_id=task.conversation_id, user_id=initiator, run_id=current
  run or last original run if ended. `revision` is server task revision. Host
  `attention=needs_you` for login/review/reconnect/unknown-result, `new` for new
  safe activity, else none. `takeover=true` only while person control is active,
  not while a pane happens to be mounted. No frames/secrets/tokens in snapshots.
* Attendance is §3.3/§4.1: visible Operator + selected conversation + valid
  per-device session; Chat/Canvas selection alone does **not** drop attendance.
  Hidden Browser stops frames to save bandwidth. Other thread, closed Operator,
  backgrounded document or expired/logout session fences attendance; no initiator
  viewer for 15 s pauses. Joe review presence never replaces staff attendance.
* Explicit exit/switch during take-over (selector, ‹ Chat, Back to app, browser
  Back/iOS swipe, Escape or popout/redock) first displays **“Pause browser and
  return to Chat? [Pause and return] [Keep browser open]”** (destination name
  changes for Canvas/app). On confirm cancel undispatched input, wait ≤2 s for
  current command fence, release device control, increment control epoch,
  set control none/task paused, keep private mode, then unmount stream. Never
  hand control to agent. If in-flight action isn't cancellable: **“Finishing
  the last step…”**; keep Browser mounted until definitive/unknown outcome,
  then pause and complete exit. Service failure: **“Couldn't pause the browser.
  Keep this screen open, or stop the browser.” [Try again] [Stop browser]**;
  no silent unmount/control transfer. H3 popstate requests the same guard;
  while waiting restore the owned pane history entry without extra stacking.
* Exit without take-over preserves agent attendance/work when merely choosing
  Chat/Canvas; during a pending review it hides the view but keeps frozen action
  until its bounded expiry. Closing Operator/background/thread change pauses
  and stales undispatched review. Escape closes innermost review as **Keep paused**
  (never approval), then a later Escape follows host exit protocol. In-flight
  final action cannot be cancelled by hiding; preserve unknown if interrupted.
* Rejoin/reconnect/control expiry follows §6.1: server-minted viewer bound to
  valid sid; accidental stream loss pauses and needs Resume; planned authenticated
  rotation does not. Popout/redock needs fresh join, control never transferred by
  panelBus. Explicit Resume/Take over required after leave; no automatic agent
  resumption. “You left the browser. The agent paused. [Continue]”.
* Browser admits **only cookie-authenticated `panel_web`** in v1. Native
  `panel_mobile` Bearer and `panel_voice` (including delegation), Telegram,
  background and legacy sources return BROWSER_ATTENDED_ONLY. Safari/iPhone/iPad
  website is panel_web; phone can view/approve, remote input tablet/computer only.
  New human turns re-admit through `admitAskRun`, fresh attendance/capability;
  only same-active-turn continuation retains source. Browser restricted profile
  and task/run/device controls remain this plan's §4/§9, not host selection.

Shared tokens: state/card title `text-heading` 17, summaries `text-subheading` 14
minimum, existing chat `text-body` 13 unchanged; targets 44 minimum / review 48 /
take-over toolbar 56. Browser adds full-width 44 px status row below Chat header,
not another segmented rail. Render dot + accessible “Browser, needs you” in the
host's single selector and visible “Browser · Needs you” status/card; never steal
an explicitly selected Canvas. Workbench remains its existing record view.
Phone review link `?review=<actionId>` resolves to this task and participates in
H3's single owned pane history entry (replace aliases, never two entries).

### 6.3 Wireframes and complete start/task/review flows

All screens retain the shipped **Operator** header. Below 1024 viewport the
66dvh drawer expands to full-height for Browser and covers MobileTabBar; safe-area
insets and visualViewport keyboard resize apply. Sheet chevron/× disabled in content with “Return to Chat to close Operator.”
Host geometry/selector placement
are governed exclusively by §6.2; illustrative wide geometry never overrides it.
No address bar in v1. Trusted site label is canonical origin, not page title.
[‹] [›] [Reload] are outside-page history controls and obey the request guard;
“‹ Chat” and “Back to app” only change the SJC OS view. One pending action/task.

**360 phone and 420 dock Chat during a task.** Agent picker/job/history/New chat
remain the existing header; browser status occupies a separate full-width 44 px
second row, not another chip squeezed into it. Whole row opens Browser. This row
persists when Browser needs attention; attention never steals Canvas/Chat focus.

```text
┌────────────────────────────────────┐
│ Operator                      ⌃  ✕ │
│ [Agent ▾] [Larson bath] [History] + │
│ Browser · Agent is working      ›  │ ← 44 px full row
│                                    │
│ Browser · city.example              │
│ Reading the permit page             │ ← fixed controller event, not page text
│ [Open browser]                     │
│ Opened city.example                 │
│ Filled 6 fields                     │
│ Waiting for you to sign in          │
│                                    │
│ Agent turn finished.                │
│ Browser is paused. [Open browser]   │
│ Message…                           │
│ [Attach] [Browser] [Mic]            │ ← new 44 px Browser beside Attach
└────────────────────────────────────┘
```

Private activity has **no page-derived content**: only fixed statuses such as
“Waiting for you to sign in,” never private text/field labels/counts. Public
“Filled 6 fields” counts controller operations. Durable end card in transcript
and **above the first `<details>` log in RunReview**:
“Submitted to city.example · Reference 2026-1182 · [Open receipt]” or
“May have been received — check the site · [Open review]”. Reference is human-only
for private contexts unless explicitly adapter-released safe output; model gets
fixed status. Staff Open review opens only their read-only request/outcome;
Joe Open review opens owner decision. Generic run log remains collapsed below.

**Entry and Sites review.** New Browser composer button plus agent proposal
“Use the browser for this task? [Review sites]”; no nonexistent tool menu.
Purpose prefilled from chat; selected conversation is authenticated, task kind
server-classified. Reuse existing JobPicker. No areas picker.

```text
360 full-height sheet               420 side sheet (same fields)
┌──────────────────────────────────┐
│ Operator          ⌃(off) ✕(off) │
│ Queue   Chat   Canvas   Browser  │
│ Sites for this task        Close │
│ Task [Apply for Larson permit  ] │
│ Job  [Larson bath             ▾] │
│ https://city.example             │
│ [Add a site]                     │
│ Also loads files from            │
│ 5 other sites [Show]             │
│ [Allow these resource sites]     │ ← one explicit group decision, default off
│ Staff need: Projects, Compliance │ ← Joe only, if staff could run this kind
│ After you sign in, you'll fill   │
│ this site's form yourself. The   │
│ agent will list the answers      │
│ beside it.                       │ ← generic portal / no reviewed steps
│ [Open browser] [Cancel]          │
└──────────────────────────────────┘
Add a site:
[Paste address or type site name   ]
Site: https://www.cityoffargo.com
[Add] [Cancel]
Bad entry: Use an https website address.
```

A typed name must resolve to a proposed exact HTTPS address, shown before Add;
no silent search-result admission. Staff need line uses real permission labels;
server derives permit→Projects+Compliance from task and job. Show exact resource
origins under Show and purpose; one allow decision authorizes only bounded
resource requests, not data release or top-level navigation. Limit **32 origins**
(total: at most 8 document/identity and 24 resource) per task; this replaces 12,
allows common multi-host portals and stays bounded. Exceeding it is unsupported,
not automatically widened. Mid-task resource block:
“Part of this page was blocked: {origin}. [Allow for this task] [Keep blocked]”.
Only present initiator/Joe may decide; adding origin still cannot bypass value,
internal-address or delegated-secret controls. New resource defaults blocked.

**360 phone Browser viewing, 420 dock equivalent:** no phone remote takeover;
local image zoom/pan works while watching. Remote Page up/down only while agent
is paused, via authorized read guard; hide while working. Phone instruction is
text, no undefined device-transfer button.

```text
┌──────────────────────────────────┐
│ Operator          ⌃(off) ✕(off) │
│ Queue   Chat   Canvas   Browser  │
│ ‹ Chat       Browser             │ ← host narrow control (§6.2)
│ city.example                     │
│ [‹] [›] [Reload] [Pause live view]│
│ Agent is working          [Stop] │
│ ┌──────────────────────────────┐ │
│ │ live image (contain/zoom)     │ │
│ └──────────────────────────────┘ │
│ [Zoom]                           │
│ Take over on a tablet or computer│
│ Open SJC OS on your iPad or       │
│ computer, then Operator › Browser│
└──────────────────────────────────┘
```

**820 iPad portrait**, full-height sheet, one content pane. Take over atomically
makes context private before *any* input; below image “Your answers” remains usable
above soft keyboard. One-finger tap, two-finger scroll, local pinch zoom, Bluetooth
keyboard/IME; no hover/orientation requirement. Delegated staff get reviewed
controls in place of image and takeover (see §6.4).

```text
┌───────────────────────────────────────────────────────────────┐
│ Operator                                      ⌃(off) ✕(off) │
│ Queue             Chat             Canvas         Browser    │
│ ‹ Chat                  Browser                               │
│ city.example · Larson bath                                    │
│ [‹] [›] [Reload]       [city.example] [Payment window]          │ ← max two tabs
│ You're in control            [Give back to agent] [Stop]      │
│ Keys go to the website · Esc to stop                           │ ← capture only
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ Private — login or account details. Remote image.           │ │
│ └───────────────────────────────────────────────────────────┘ │
│ [Keyboard] [Page controls] [Zoom] [Pause live view]             │ ← 56 px touch
│ Your answers                                                  │
│ Address: 123 Main St                              [Type it]   │
│ Scope: Bathroom remodel                          [Type it]   │
│ License #: person-confirmed value                [Type it]   │
│ Owner: person-confirmed value                    [Type it]   │
└───────────────────────────────────────────────────────────────┘
```

“Your answers” comes only from prepared, person-confirmed chat facts, never from
page observations. Each Type it is ≥44 px; sends that value as committed text to
the focused remote field over the same private person-input endpoint, with
frame/epoch/control checks. No clipboard. Display source and Edit in chat; confirm
before first use; sensitive login/card/OTP values never join this list. Beside
image at ≥960 *browser-pane* width, underneath at 820/narrower (not confused with
host split threshold). Focus moves to remote input only by explicit control.

**1280 desktop / 1180 iPad landscape:** ≥1024 viewport starts as the real docked
420 aside. Explicit Open browser invokes §6.2 temporary workspace over app; Back
to app restores prior width without writing layout.width. Host determines split
and chat/browser minima, rails collapse; never four squeezed columns.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Operator · Larson bath            [Back to app] [Dock back if popout]│
│ Queue · Chat · Canvas · Browser                                     │
├──────────────────────────┬───────────────────────────────────────────┤
│ Chat                     │ Browser                                   │
│ Browser · Needs you   ›   │ city.example · [‹] [›] [Reload]             │
│ Application ready.       │ Paused · [Saved logins] [Stop browser]     │
│ Ready to pay             │ [live image]                              │
│ [Open review]            │ Ready to pay · Larson bath                 │
│                          │ $125.00 USD to City of Fargo               │
│                          │ [Review image] · Files: plan.pdf           │
│                          │ [Pay $125.00 once] [Don't pay]             │
│ Message…                 │ The page is locked while this review is open.│
└──────────────────────────┴───────────────────────────────────────────┘
```

Both sides refer to **the same pay action**, no simultaneous submit card. Staff
variant always “Waiting for Joe. Nothing has been submitted. [Open review]
[Cancel request]” for submit; pay variant adds amount and says nothing paid.
During correction, cancel request first; control change stales snapshot.

**Send-this-page versus final submit, at 360:** agent waits paused; no model turn
held busy. Field/value manifest and attachments shown, private values human-only.
Company draft saves/Next/autosave also release company data: **Joe** approves.
Personal own-account login/contact and named delegated login-only are the only
staff self-approval categories; neither releases company form data. A site/page
calling a save “nonbinding” cannot downgrade company authority.

```text
Mid-form, title = text-heading       Final card, distinct title + warning
┌────────────────────────────────┐ ┌────────────────────────────────┐
│ Send this page to city.example?│ │ Ready to submit                │
│ This saves your answers on the │ │ This submits the application. │
│ site. It is not the final submit.│ │ Review image · answers · files │
│ [Review answers] [Review image] │ │ Attestations · Fee: not shown  │
│ Joe: [Send once] [Take over]    │ │ Joe: [Submit once] [Don't submit]│
│ Staff: Waiting for Joe.        │ │ Staff: Waiting for Joe.        │
│ [Open review] [Cancel request] │ │ Nothing has been submitted.    │
└────────────────────────────────┘ └────────────────────────────────┘
```

Place under image in full-height pane; opening review uses full-height sheet
with sticky 48 px decision buttons. Phase 1 has **no working bypass**:
“This version can only read pages. This button sends information to the site.
[Take over] [Close]”. Take over can inspect/prepare locally but Phase 1 **still
blocks all network writes**, including POST search; explain “Sending information
isn't available in this version.” A final card says “This version stops here.
Nothing was submitted. [Don't submit] [Close]”.

**Joe phone owner review.** Bell + Telegram notification only:
“Abigail needs your OK: Pay $125.00 to City of Fargo · Larson bath · expires
2:41 PM” [Open review]. Deep link `/panel?review=<actionId>` (ID, no secret)
opens authenticated Operator full-height directly to this review, joining Joe
as owner_review, not as staff controller. `/engine/permissions` links here too;
no generic approve or Telegram decision button.

```text
┌──────────────────────────────────┐
│ Operator          ⌃(off) ✕(off) │
│ Queue   Chat   Canvas   Browser  │
│ ‹ Chat       Ready to pay        │
│ Abigail · Larson bath            │
│ $125.00 USD                      │ ← trusted summary, subheading minimum
│ To: City of Fargo                │ ← separate from escaped page text
│ [Review image]                   │
│ Files: plan.pdf, application.pdf  │
│ Attestation from site:           │
│ “I certify …”                    │ ← untrusted escaped quoted block
│ Expires in 3:12                  │
│ The page is locked while this    │
│ review is open.                  │
│ [Pay $125.00 once               ]│ ← sticky 48 px
│ [Don't pay                     ]│
└──────────────────────────────────┘
```

Countdown updates each second normally; reduced motion whole minutes, no
animation (expiration itself exact). If initiator absent: “Abigail left the
browser. It can't be paid until they open it again. [Remind Abigail]”, Pay disabled
with inline reason; remind creates rate-limited internal notification only, no
client message. Staff: “Waiting for Joe · keep this screen open · 3:12 left”.
Joe decision: “Joe said don't pay.” / “Joe approved — paying now…”. Both presences
required at dispatch; absence stales/requires fresh review. Submit/sign use same
layout and precise verbs. A pending review suspends idle warning until review
expires, not session validity. Direct final-click path has identical authority.

**Joe-only Browser empty state's In use list**, content-free except trusted task
metadata (not staff chat/private frames):
“Abigail · Permit — Larson bath · Agent is working [Open review]”.
Open review is an explicit authenticated join; no automatic staff private pixels.
Joe can review task status, choose private view if needed, or confirm “Take over
from Abigail? Their control ends.” Staff sees “Joe is in control.” Queue copy for
Joe names user; staff never sees someone else's identity/job.

### 6.4 Saved logins, field mapping and private file save

```text
360 full-height; 820/1280 same fields in 420 side sheet
┌──────────────────────────────────┐
│ Saved logins               Close │
│ City permit office               │
│ https://city.example             │
│ Only me              [Fill login]│ ← Joe's private entry
│ Shared with Abigail, Mark        │ ← Joe's shared entry, named
│ From Joe                         │ ← staff delegated entry
│ [Save a login]                   │
│ Name [City permit office       ] │
│ Site [https://city.example      ] │
│ Username [                     ] │
│ Password [••••••••             ] │
│ [Save login] [Cancel]            │
└──────────────────────────────────┘
```

Sharing is decision 5 implemented, not an unresolved policy: Joe's sheet
“Let these people use this login” [Abigail] [Mark], named staff checkboxes,
“They can sign in without seeing the password.” Default Only me. Required
areas derived/read-only. Staff own logins editable by them; delegated row no
Edit/Share/Reveal. Remove access: “Their open browser will close.” Delete:
“Delete this saved login? You'll need to sign in again. [Delete login] [Cancel]”.
Save success: “Login saved. Your password isn't sent to the agent.” Validation:
“Use an https website address.” / “Enter a name.” / “Enter a username and password.”
Never echo password/error payload; volatile form state only. Unsaved navigation:
“This login hasn't been saved. Leave without saving?”

**First-fill mapping (Joe or own-login user on tablet/computer):** context already
private before picking. No model selectors. Service issues candidate field handles,
person taps field; navigation/form fingerprint change invalidates choice.

```text
┌────────────────────────────────────┐
│ Private — login or account details  │
│ Tap the username box on the page.   │ → Now tap the password box.
│ [private human live image]          │
│ Username selected · Password selected│
│ [Fill login] [Start again] [Cancel] │
└────────────────────────────────────┘
Phone: Take over on a tablet or computer.
Open SJC OS on your iPad or computer, then Operator › Browser.
```

Delegated staff **cannot** pick fields/view this page. Joe configures reviewed
adapter mapping privately; unsupported site refuses delegated use (§5.2). Staff
see fixed supported-step controls, status and person-confirmed answers instead.
No generic give-back can turn a private/delegated context into public.

**Private download Save sheet (360), only after §8.2 mandatory sanitizer:**

```text
┌──────────────────────────────────┐
│ Save to project files      Close │
│ Job [Larson bath              ▾] │
│ Name [Permit receipt — Larson bath]│ ← human-editable, confirmed
│ Tag [PERMIT · Receipt         ▾] │
│ This file is for people. The     │
│ agent can't read it.             │
│ [Save file] [Cancel]             │
└──────────────────────────────────┘
```

People see confirmed name/tag; generic files row/model metadata uses “Private
browser file <id>.pdf”. Human name lives encrypted and is decrypted only for
human files UI; no leaked name through ordinary owner model SQL/CLI. Prefill uses
trusted task/project facts, not downloaded filename. Delegated raw artifacts are
Joe-only, including sanitized copies; staff receive only separately generated
fixed-schema safe business output (§5.2), not those artifacts.

### 6.5 States, exact copy and recovery

| State / event | What the person sees | Available action / outcome |
|---|---|---|
| No task | “Open a website with the agent. You can watch and take over.” | Open browser; choose task/sites first |
| Feature off | “Browser isn't available yet.” | Close; no dead control |
| No supported agent | “Browser works with Claude in this version.” | Start with Claude; explicit new turn |
| Sites review | “This task can use these sites.” + full origins, project, areas | Open browser / Add a site / Cancel |
| Empty sites | “Add at least one site to start.” | Add a site; Open disabled with inline reason |
| Queue | “Browser is busy. You're number 2 in line.” | Leave line; no staff job details |
| Admission offer | “Browser is ready. Open within 30 seconds.” | Open browser / Leave line |
| Starting | “Opening browser…” | Cancel; 20 s timeout then retryable error |
| Page loading | “Loading city.example…” with last frame labeled “Earlier view” | Stop loading; 30 s tool timeout |
| Agent live | “Agent is working” | Take over / Stop browser |
| Taking over | “Finishing the last step…” | Stop if safe; input disabled until fence acknowledged |
| Person live | “You're in control. The agent is paused.” | Give back to agent / Stop browser |
| Other controller | “Open on your other device.” or “Joe is in control.” | Take over here when authorized; no passive input |
| Multiple viewers | “You're watching. {You on iPad / Joe} is in control.” | Take over, subject to explicit replacement |
| Private/model | “Private — login or account details. The agent can't see this page.” | Human view continues; private adapter actions only |
| Login missing | “No saved login for this site.” | Save a login / Take over (phone: use tablet/computer) |
| Fill blocked | “This page doesn't match the saved login's site.” | View saved site / Cancel; no override fill |
| 2FA/CAPTCHA | “Take over to finish signing in.” | Take over; phone instruction |
| Unsupported private portal | “This site needs you for the next step.” | Take over; agent can prepare business data in chat |
| Final review loading | “Preparing your review. Nothing has been submitted.” | Cancel; no final action until screenshot+summary valid |
| Await final | Ready to submit/pay/sign + exact summary | Exact once / Don't …; server enforces role |
| Page changed | “The page changed. Review the new version before submitting.” | Review again; old button removed |
| Owner pending | “Waiting for Joe. Nothing has been paid.” | Open review / Cancel request |
| Approval expired | “Review expired. Nothing was submitted by this approval.” | Review again; don't claim an unrelated manual action didn't happen |
| Review denied | “Not submitted.” / “Not paid.” / “Not signed.” | Edit in take-over / Stop browser |
| Confirmed result | “Submitted. Reference: {reference}.” / “Paid $125.00. Receipt saved.” | Open receipt / Continue; only after verified evidence |
| Unknown result | “The site may have received it. Check the site before trying again.” | Open site in read-only / Take over; no Retry submit |
| Site blocked | “This site isn't allowed for this task: {origin}.” | Review site / Cancel; never grant from page text |
| Internal address blocked | “This address can't be opened in the browser.” | Choose another site; no owner bypass in feature |
| File received | “Downloaded. Check the file before saving.” | Review / Save to project files / Delete |
| File saved | “Saved to project files.” + name | Open file; success only after file row+bytes committed |
| File rejected | “This file type isn't supported.” / “File is too large. Maximum 25 MB.” | Delete / Choose another file |
| Upload review | “Send plan.pdf to city.example?” | Joe: Send this file / Cancel; staff Waiting for Joe for company upload |
| Offline/view lost | “Connection lost. Browser paused.” | Reconnect; no offline input queue |
| Reconnected | “Connected. Review the page before continuing.” | Resume / Take over / Stop browser |
| Idle warning | “Browser closes in 60 seconds.” | Keep open; explicit user activity |
| Idle close | “Browser closed after 5 minutes without activity.” | Open again; forms may need re-entry |
| Resource cap | “Browser stopped because the server is busy. Your saved files are safe.” | Close; Joe checks host before restart |
| Crash | “Browser stopped. Check the site before repeating a final step.” | Open again; private state may require sign-in |
| Key unavailable | “Saved logins are unavailable. You can sign in yourself.” | Take over; Save/Fill disabled; no plaintext fallback |
| Auth expired | “Sign in again to continue.” | Sign in; blank private image immediately |
| Access removed | “Your access changed. Browser stopped.” | Close; erase frame DOM/object URLs |
| Service unavailable | “Couldn't connect to the browser.” | Try again / Close; never launch a second service |
| Start/run ended | “Agent turn finished. Browser is paused.” | Continue with Claude / Take over / Stop browser |
| Stop complete | “Browser closed.” | Return to chat; durable file/review links remain |

Additional required states (same table semantics):

| State / event | Exact copy / behavior |
|---|---|
| Approved/executing | “Approved. Submitting now — don't close this.” / “Approved. Paying $125.00 now…”; buttons removed, no retry |
| Queue full | “Browser is busy and the line is full. Try again in a few minutes.” |
| Offer missed | “You missed your turn. [Get back in line]” |
| Queue expired | “You left the line after 5 minutes. [Get back in line]” |
| Third tab blocked | “The site tried to open another window. Only two are allowed for a task.” |
| Popup open | Toolbar strip “[city.example] [Payment window]”; guarded before first request |
| Unapproved redirect | “The site wants to go to {origin}. It isn't on this task's list. [Add a site] [Stay here]” |
| Joe replaces staff | Confirm “Take over from Abigail? Their control ends.”; staff “Joe is in control.” |
| Frozen review | “The page is locked while this review is open.” |
| Idle warning | “Browser closes in 60 seconds. [Keep open]”; pending review suspends idle countdown until expiry |
| Mid-form save | “Send this page to city.example? This saves your answers on the site. It is not the final submit.” Joe [Send once] [Take over], staff Waiting for Joe |
| Phase 1 write | “This version can only read pages. This button sends information to the site. [Take over] [Close]”; no write allowed via takeover |
| Attendance lost | “You left the browser. The agent paused. [Continue]” |
| View paused locally | “Live view paused. The agent may still be working. [Resume live view]” |
| Delegated site unsupported | “This site can't safely share a login yet. Ask Joe to finish, or sign in with your own account.” |
| File validation pending/failure | “Checking the file…” / “This file couldn't be made safe. It wasn't saved.”; no Open raw file |

Frame updates aren't live-region announcements. State changes are polite live
regions; denied/expired/access errors are alerts. Review sheet traps focus,
returns focus to Open review, supports Escape=keep paused, and never treats Escape
as approval. Screenshot has textual summary; zoom modal has keyboard pan/zoom,
full-site label and Close. Disabled controls have visible explanation. Accessible image name: “Live view of city.example. Agent is working.” Update on
state changes, never each frame. Reduced motion keeps content frames updating but
stops pulse dots/transitions; Pause live view is always available, stops presentation
only, not attendance/agent. Persistent capture bar immediately above image: “Keys
go to the website · Esc to stop”. Focus order: back-to-chat, site/history, state,
Take over/Give back, Keyboard, Page controls, Zoom, Pause live view, Stop, answers.
On review appearance, move focus to card heading; preserve prior target for return.
No remote keyboard capture until person explicitly selects it.

## 7. Always stop before Submit / Pay / Sign

### 7.1 Detection is layered; heuristics are not a guarantee

A model declares a final step through `browser_prepare_action`. The controller
also inspects submit controls, form actions, accessible role/text (submit, send,
place order, purchase, pay, authorize, sign, certify, agree, apply, complete),
Enter on forms, associated labels and known portal endpoints. Classification
uses the **more restrictive** of model declaration, reviewed site adapter,
page/button heuristic and network-request guard. “Continue,” untranslated text,
SVG controls, a JavaScript click and GET links can all commit; unknown ≠ safe.

Enforcement is in the service, independent of Claude's permission mode:

* Every navigation, popup, frame navigation, redirect and request is checked.
  Workers/service workers are blocked; existing stored SW registrations are not
  restored. Disable arbitrary downloads, sockets, WebRTC, background sync,
  push and permissions. Attach Fetch interception to every target before resume;
  no unguarded page is ever navigated. No raw JS, network replay or CDP tool.
* Generic model operations default to observation, local scroll/focus and
  navigation to **person-confirmed read URLs**. A click/fill/select/key action
  that can dispatch a site request is allowed automatically only under a
  reviewed, immutable adapter rule declaring it noncommitting. Such a rule
  specifies origin, method, exact path template, field **value/provenance** schemas
  (§8.1) and allowed response action;
  it cannot include a final endpoint or arbitrary regex. Filling that fires an
  autosave is an outside write and must be reviewed too.
* All unknown/non-read HTTP requests, including mutating GETs, are paused at
  both controller request stage and independently at gate request stage before any request bytes leave the request-aware gate upstream. Safe public resources are
  only approved document/read endpoints and static assets on approved resource
  origins. POST/PUT/PATCH/DELETE, beacon, fetch, form navigation and an unknown
  GET need a human review. A final-looking click is stopped **before click**;
  a disguised final click that escaped the heuristic is still stopped before
  its network request transmits. Deny unknown WebSocket/WebTransport entirely
  in v1; a site requiring them is unsupported, not exempted.
* Navigation itself can have side effects on a badly designed site. Never call
  all GETs safe or say semantic heuristics can prove arbitrary sites harmless.
  User-entered read destinations and trusted site adapters define the accepted
  read surface. If safe read behavior cannot be established, show Take over
  with request-by-request review; don't silently weaken the hard stop.
* Network permissions cover exact request(s), not “let this site write for a
  minute.” Login is a distinct person-approved submit, not a blanket exception.
  Unknown pages may prompt more often. This is the explicit cost of a generic
  hard stop, and the reason city-specific adapters come after the browser.

A pending intercepted request lives only in controller memory, maximum 60 s,
with request body encrypted if durably retained for review. An approval card can
last longer (§7.3), but an expired network request is **not replayed**. A card depending on that buffered
request becomes stale at 60 s (display shorter countdown); a pre-click adapter
review can last 5 min and create its request only after approval. Rebuild
the review from the current page; require a new person click if the live request
was lost. Server must never “test click” a final button against a live site just
to discover its behavior. Unknown bodies, ambiguous submission semantics or
multiple unbounded mutation requests mean **Take over / unsupported**, not an
unreviewed macro. Reviewed adapters may define a bounded ordered request manifest
(e.g. prepare then commit) with one exact final request and explicit outcomes;
no wildcard subordinate approval. Reject subsequent unrelated requests.

### 7.2 Who approves which step

| Step | Staff initiator | Joe | Take-over rule |
|---|---|---|---|
| Their own sign-in, 2FA/CAPTCHA or their own personal-account contact details | May approve exact personal step; permitted own account only | Himself | Direct deliberate person action; private input and exact login endpoint |
| Login from Joe shared with named staff | May request blind Fill login and explicitly approve a reviewed exact login endpoint under named site use; no view/reveal/arbitrary controls | Sets mapping, may handle private login/2FA | Delegated-secret restriction persists after sign-in; unsupported = refuse |
| Any company final submit, permit application, request/form or account change; even described “nonbinding” | **Cannot approve. Waiting for Joe. Nothing has been submitted.** | Exact one-use owner grant | Staff manual click cannot bypass; company scope derives from account/task, not model label |
| Company draft save / Next / autosave / business data release, upload/send | Must ask Joe | Exact recipient+field/value/request approval; external_browser_submit subtype company_save/send | Review is visibly mid-form, not final; no generic staff nonbinding release category |
| Company pay/deposit/purchase/subscription/authorization, including $0 authorization | Cannot approve | Exact owner grant with amount/currency/payee | Staff Pay blocked even in take-over; Joe direct click uses same one-use grant |
| Signature, attestation, company terms/commitment | Cannot approve | Exact owner grant; person applies signature when required | Staff cannot sign for Joe; unclear effect owner-only |
| Unknown category/amount/payee | Cannot approve | Review privately; no payment until amount/payee established | Unsupported ambiguous request never transmitted |

Decision 6 is unconditional for company final steps. Areas, authority grants,
button labels, “nonbinding,” free price and staff-initiated takeover do not change
that. Only own-account personal contact/login and named delegated **login-only**
steps can self-approve; delegated login is a use permission, never a company
form/account-change/final-step approval. No other staff self-approval exists; company saved
login account settings are company steps and delegated staff cannot access them.
Company requests send only after the exact immutable snapshot Joe approved.

A deliberate final click by the controlling person is the decision-3 exception
to an **agent** approval card, not a blanket bypass. The input handler first
pauses the final event, derives the same action snapshot, binds an authenticated
human-input nonce (5 s, target + control/document epochs), and verifies that
the on-screen action, amount/payee and category are determinable. It records
`approval_method=direct_person_click` and uses the web-only approval command.
For Joe's company payment/sign/submit it mints and consumes the same exact owner
grant; no second agent approval is needed. For staff owner-only actions it
creates Waiting for Joe and transmits nothing. If the snapshot is ambiguous,
show the first-party review card; never infer permission from arbitrary keydown,
a programmatic site click, a hidden element or stale human input. A site-driven
request without the correlated human nonce remains guarded as an agent request.

### 7.3 Review snapshot, token, expiry and one execution

Review card contains server-derived canonical origin/payee, task + project,
action type, full plain summary, field/value manifest excluding login secrets,
attachments with file hashes, amount in integer cents + displayed currency,
terms/attestation text when relevant, **protected human-only screenshot** and
time. Unknown fee is “Fee: not shown,” never $0. Human-only screenshot of a
private context is never a model image attachment or ordinary files row. Page
strings are untrusted; render escaped text only and visibly distinguish them
from trusted origin/amount/accounting labels. Agent summary is supplemental,
never the sole source of payment amount. Login/action secret fields are omitted
from summary and blurred for retained human review when reliably locatable;
if not, do not retain pixels, show live protected private view and require
human take-over. Review requires both an available image/live view and a summary.

Action snapshot binds:
`task_id, run_id, initiating_user_id, context_boot_id, control_epoch,
document_epoch, origin, action_kind, target_handle, request_manifest_hmac,
form_manifest_hmac, attachment_ids+sha256, amount_cents, currency, payee,
screenshot_sha256, adapter_version, revision, expires_at`.
HMAC uses a service-held key so secret-containing request bodies do not become
password-guessing hashes. All private page-derived review strings, images and
request/body data remain encrypted in storage; the public snapshot contains
only fixed IDs, typed status, and person/adapter-confirmed business facts. Never
copy an arbitrary private page label/title/filename into general audit or grant
detail. Private hashes outside encrypted envelopes bind ciphertext, not an
unauthenticated digest of a potentially secret-bearing small plaintext. Snapshot digest covers nonsecret canonical fields and
those HMACs. Human-only screenshot bytes are encrypted at rest. Handles expire
on navigation/DOM control invalidation; no CSS selector supplied in an approval.

Freeze **all input and agent execution** while a final card is pending. Relevant
DOM/form mutation, navigation, frame change, file/hash change, permission change,
Take over, grant revoke, fee/payee change or page reload invalidates the card.
Unrelated clock animations do not invalidate a reviewed adapter's stable form
manifest; generic sites invalidate on any form/target change. Before dispatch,
recompute the manifest under context lock and compare
bound epochs, current user/areas/presence and target origin. A refreshed human
frame is presentation only; do not compare JPEG bytes across incidental animation.
The approved image remains hash-bound to the immutable review, while a relevant
form/target change always requires a new image and review. Mismatch returns
`BROWSER_REVIEW_STALE`; no effect occurs.

Cards expire after **5 min**. A pending review suspends the ordinary inactivity
countdown until card expiry, provided initiator attendance stays valid; it does
not renew the card, attendance, request or session lifetime. Owner grants for
browser actions expire no later than card. Approved token expires after **30 s**,
is 256-bit random, stored hashed, one-use, bound to snapshot and executing
control epoch. It stays between web/controller, **never in model output**.
Approval POST includes card ID + expected revision + idempotency UUID; model
cannot call it. Personal/delegated login or own-contact approval is recorded in the browser action table
by authenticated web-only command; it does not mint an owner grant.

Add gated actions `external_browser_submit`, `external_browser_pay`,
`external_browser_sign` with target kind `browser_action` and UUID target ID;
company upload/send uses `external_browser_submit` with category recorded.
Extend `GATED_ACTIONS`, labels, target kind, grant detail, `grantCovers`,
`lib/dispatch/authority.ts`, owner grant actions and decision readers together.
Browser branch in `grantCovers` must require **exact action, target, run, snapshot
digest, amount/currency/payee where relevant, max_uses=1** before its general
wildcard logic. Reject existing `actions:['*']`, unbound Express permission,
pre-existing general grants and other targets even if Joe approved them. No
model-supplied scope field can mint or decide that grant.

Extend `request_owner_permission` only to stage these browser targets by looking
up a real immutable action; no raw arbitrary browser request body accepted.
Decision notification links to authenticated Open review. Generic GrantCard,
`approveGrant`, grant-execution, Telegram approve callbacks and manual Permissions
editor must recognize browser targets and refuse decision/dispatch without the
browser review path. Don't let a general `decideGrant` call mark the action as
approved; browser final authority requires the separate reviewed action row,
which only the web browser review command can write. A granted row by itself
never dispatches. Add Open review UI to GrantCard/Permissions rather than a
second generic Approve button. This preserves the meaning of always ask **here**.

Approval/execution protocol, no external request inside a held SQL transaction:

1. Web command locks task → action → owner grant in that order. Rechecks actor,
   live session, snapshot/revision/presence, unexpired request. Sets approved
   actor/time, token hash and, for owner-required step, exact approved grant in
   the same DB transaction. Stores idempotent response. No agent/worker write
   permission on approval columns or functions.
2. Controller locks context and calls a one-purpose DB consume command, under
   task → action → grant lock order. It atomically consumes token, grant use
   (the one-purpose SQL validator/consumer in §9.2; **not** the TypeScript
   `consumeGrantRun`) and sets `executing`, command UUID,
   request-dispatch timestamp placeholder. Rechecks all bindings/authority.
3. Gate consumes the signed one-use dispatch authorization bound to the DB
   consume receipt and exact request digest/flow nonce; then transmits that one
   buffered request, or authorizes the one reviewed adapter click's exact manifest. Record `transmitted_at` as conservatively as
   possible, never asserting atomicity between Postgres and a remote portal.
   Idempotency prevents repeat controller dispatch, not duplicate behavior by
   the outside site. Follow only reviewed redirects/resource reads.
4. Verified portal success/receipt => `succeeded`, receipt reference/hash/files,
   grant outcome. Definitive site rejection => `failed` with safe reason.
   Timeout/socket loss/crash after token consume or possible transmission =>
   `unknown`. **Never refund/retry an ambiguous external step.** A failure known
   to occur before any dispatch remains failed; a new review is still required.
5. A duplicate approval/input call returns the existing action state; it never
   generates another grant/click. `executing` left by an old boot ID becomes
   unknown on recovery. Human checks application/payment history with read-only
   navigation before a new final review. Do not automatically infer “not sent”
   from lack of a receipt.

Denial, timeout or leaving the task expires token/request, cancels pending
network request, leaves a readable outcome in chat and pauses. No prompt-timeout
fallback to “use your judgment.” For private contexts model sees only a
content-free `waiting | succeeded | failed | unknown` status; human sees review.

Action transitions (DB enforced; every row retains original run/grant):

| From → to | Caller / precondition | Effect / recovery |
|---|---|---|
| none → pending | service prepare, valid original task_run and immutable snapshot | Freeze input, capture human-only evidence, set shorter request/card expiry |
| pending → approved / denied | web decision, current authorized reviewer/session/presences, matching revision | Approve: exact token/grant + transactional evidence; deny cancels gate buffer |
| pending/approved → stale/expired | service or web invalidation, epoch/data/access change or deadline | Cancel request/token; a fresh review is required; no silent rebuild/replay |
| approved → executing | service SQL consume, exact grant/token/digest/state | Atomically one grant use/command/audit; gate waits independent checkpoint acknowledgment |
| executing → succeeded / failed | service, definitive bounded site evidence | Persist outcome/receipt, never infer receipt from click success |
| executing → unknown | service recovery, crash/loss/possible transmission | Human reconciliation only, never retry/refund automatically |
| terminal → terminal | duplicate idempotent command only | Return stored outcome; cannot change identity or reopen same action |

## 8. Sites, files and hostile pages

### 8.1 Task allowlist and SSRF

Person confirms a task manifest: purpose, project/lead, required areas, document
origins, separately named resource origins, and intended actions. Model may
propose another origin; only a present authorized person can add it, and only
Joe can add an origin to the reusable company catalog. Add a site sheet shows
full origin + why needed; don't precheck a page-suggested site. Resource-only
origins cannot become top-level documents or credential destinations. Revision
change revokes old capabilities/reviews. Default HTTPS/443 only, maximum 32
origins/task (8 document/identity + 24 resource). No local files/data/javascript/chrome/extension/FTP, userinfo URLs,
IP literal sites, arbitrary ports or embedded OS file chooser access.

Proxy resolver rejects **any** mixed public/private answer, follows/validates
CNAME chains, pins validated IP to socket connect and revalidates each new
connection/redirect. Request-aware TLS gate matches CONNECT authority, decrypted HTTP Host/`:authority`
and TLS SNI; a pure end-to-end CONNECT proxy cannot inspect HTTP. Don't allow
CONNECT as an arbitrary byte tunnel to a different host/port. No direct browser
DNS, DOH or QUIC. Deny all non-global IPv4/IPv6 (RFC6890 registry classifier),
including loopback, RFC1918, CGNAT, link-local, IPv6 ULA/link-local, mapped IPv4,
unspecified/multicast/reserved, metadata `169.254.169.254`, `100.100.100.200`,
IPv6 metadata variants and IPv6 transition/embedded-address tricks. Deny service
hostnames, `.local`, numeric/hex/octal IPv4 aliases, trailing-dot aliases and
DNS rebinding. Block **all** SJC OS public/alternate/tunnel hosts and this host's
public IPs, not just `/admin`: `/api`, `/mcp`, `/settings`, `/engine/permissions`,
portal and file endpoints cannot be reached from the browser through another
path. Public IP aliases to the host are blocked even if a DNS name is allowed.
Host/namespace firewall rejects internal routing even if interception fails.

Tests must prove child frames, popups, CSS/font/image URLs, redirects, fetch,
beacon, download, same-site redirect to metadata, prefetch/preconnect and worker
attempts obey the same boundary. Deny network if adapter/interception detaches;
the independent gate denies without a per-request decision; watchdog additionally
closes context. Closure alone is not the safety mechanism (§3.2). A blocked site cannot be made
reachable by Take over or owner grant; use a different task outside this feature.

#### Outbound data policy (reads and resources included)

An origin allowlist is **not** authority to release data. Gate canonicalizes URL
once, rejects double encoding/ambiguous normalization, applies exact versioned
adapter or person-reviewed read manifest to path segments, query keys/values,
headers, body and recipient. Each model-chosen URL with variable business data
requires a person-reviewed release bound to exact values/recipient even if GET,
image load, search or classified noncommitting. Company data release needs Joe;
own personal login/contact can be approved by that person. Model cannot invent
new query/path/header values from arbitrary SJC records merely because site allowed.

| Request class | Allowed value/provenance policy |
|---|---|
| Anonymous public document/read | Person-confirmed exact URL (including all path/query values) or fixed adapter URL; no dynamic secret/business interpolation |
| Static resource | Fixed manifest path or bounded content-addressed filename (hash/schema validated) with no query by default; fixed version query allowed only enumerated; no parameterized image/analytics URL. Unknown asset paths/parameters stop, not automatically approved. |
| Header | Strip Referer for all cross-origin requests (private: all Referer), strip URL-fragment-derived data, unknown custom headers and browser internal auth. Allow fixed Accept/UA/content type and bounded known fetch headers only. Cookie/Auth only exact credential origin/tenant + reviewed endpoint manifest. Never forward app cookies/headers. |
| Login secret | Only credential-bound login endpoint/action, exact field mapping and approved personal/Joe login decision; no secret-bearing query/path. No reflected token to a second approved origin. |
| Private same/cross-origin | Reviewed bounded manifest including response-derived tokens with typed provenance; identity tokens only bound IdP/RP exchange. Cross-origin assets receive no credentials/referrer and exact static paths. Unknown authenticated endpoints blocked. |
| Business fields / uploads | Human-confirmed fact IDs, exact serialized values/hash and recipient approved for that action; derived values must be included, no arbitrary model text. Adapter field schemas bound length/enum/numeric range; approval records actual values, not just field names. |

Response-derived CSRF/session tokens remain opaque controller/gate private data;
never model input nor transferable to another endpoint/origin. Unknown value
provenance fails closed. Allowing a blocked origin does not release blocked query
values; separate data review required. Third-party scripts are effectively same
site code and may attack secrets; gate disallows their unauthorized outbound
channels. Cannot prevent the destination credential endpoint itself misusing its
own password; do not imply that stronger guarantee.

### 8.2 Download, upload and file provenance

Downloads land in a per-task private quarantine outside uploads, server-random
O_EXCL/O_NOFOLLOW basename, directory fd-relative opens, mode 0600, no symlinks,
hard links or page-chosen paths. Streaming max 25 MiB/file, 100 MiB/task,
200 MiB feature; compressed transfer expansion ≤50 MiB and ratio ≤20. Encrypt at
rest immediately (including public-site downloads until validated). V1 accepts
PDF/PNG/JPEG only; reject HTML/SVG/archives/executables/macros/polyglots/unknowns.
There is **no raw preview or filing before mandatory validation**.

Proposed `sjcos-browser-validator.service`: separate UID/namespace, no network,
DB/vault/CA keys, read-only executable root, no HOME, no-new-privileges/seccomp,
private bounded tmpfs 128 MiB, MemoryMax=384M, CPUQuota=50%, TasksMax=16; one job,
15 s wall time / 10 CPU seconds. Controller streams decrypted original over
bounded pipe, validator writes output on a second pipe; no shared writable upload
path. Limit images 20 megapixels, dimension 8192, one frame; decode/re-encode to
new PNG/JPEG, discard metadata. Parser crash/timeout/oversize = rejected, not skip.

PDFs: max 100 pages, 20 MiB expanded per page / 100 MiB total parser allocation,
reject encryption, JavaScript, Launch/OpenAction/AA, forms/XFA, embedded files,
portfolio/RichMedia and external references/actions. Mandatory pinned qpdf
structural check **plus isolated rasterize/rebuild** into image-only PDF, no
preserved links/actions/fonts/attachments. Mandatory malware scan with pinned,
fresh signature engine (e.g. ClamAV in a separately capped no-network validation
job, ≤384 MiB and 15 s, signatures updated by deploy process, age ≤48 h).
If engine cannot work within cap, rebuild fails, signatures stale, or any step
cannot be provided, keep **PDF filing disabled**; never call optional scan
“safe.” PNG/JPEG re-encode plus mandatory scan has same failure policy. Validator
only parses in sandbox, not Next/sharp thumbnail process. Rendered safe output
still untrusted document content, not proof its business claims are true.

Store original evidence hash **inside encrypted evidence envelope**, sanitized
output hash separately; retain validator build/policy/signature IDs and bounded
safe outcome. Sanitization changes bytes and may lose interactive fields; say so
before filing. Raw original not downloadable/openable by staff; Joe-only evidence
export, when required, is explicit quarantine warning and never project filing.
Delegated-context artifacts remain Joe-only even after sanitization (§5.2);
only separately generated fixed-schema business output can be released to staff. Scanner success alone does not prove
password secrecy. No automatic OCR/ingestion/model parsing.

Person previews through a protected attachment-only route (images re-encoded,
PDF download rather than app-origin inline scripting) and chooses **Save to
project files**. Project required; no silent company-wide unfiled bucket. Require
current record/area access and resolve project UUID → canonical `project_key`
using existing project reader; never let page/model supply an arbitrary key.
Tag permit paperwork `PERMIT · Application` / `PERMIT · Receipt` / `PERMIT · Issued`
only when supported by evidence. A download alone is not an issued permit.

Extend `lib/upload-store.ts` with exported transactional `storeBrowserFile` using
existing safe storage naming, hash and schema: stage+fsync bytes, insert files
row + browser file link under a unique `(task_id,download_id)` transaction,
rename-to-final with recovery ledger. Never call private `persistBlob`. Either
crash order has a reconciler: committed staged row missing rename is retryable
save; orphan bytes are swept, never return Saved before final bytes exist.
Serve existing files through `lib/file-serve.ts` only **after** file authorization.
Files retain existing project policy; quarantined/review files do not inherit it.

Add `files.browser_private boolean NOT NULL DEFAULT false` and
`browser_source_task_id uuid NULL`. Every file/thumbnail/signed-link reader,
`get_project_file`, `view_project_image`, binary/text fetch, attachment composer,
runner attachment serialization and background ingestion must check this tag.
Private-context downloads can be read by authorized people but cannot become
model input **in any run** through another tool/path. Private project-file bytes
remain envelope-encrypted under the service key even after save: the existing
upload directory contains ciphertext, not a second plaintext copy an ordinary
owner coding run could read. Add `files.browser_cipher_envelope jsonb NULL`
with CHECK `(browser_private AND browser_cipher_envelope IS NOT NULL) OR
(NOT browser_private AND browser_cipher_envelope IS NULL)`. Private filenames
stored in generic files rows are server-generated “Private browser file <short-id>.pdf”
(or image extension), never page-provided strings. Person-confirmed display name/tag (§6.4), original filename and any
page-derived descriptive metadata stay encrypted. Human files-list endpoint
decrypts only authorized display metadata; generic model lists omit it. `files.sha256` binds stored
ciphertext; plaintext digest stays inside the encrypted envelope and is verified
only in the service. The human file route calls the service's authorized decrypt
stream, bypassing generic `serveFile`/disk thumbnail caches; no plaintext temp
file. Decrypted private image resizing happens in bounded memory only. The
service performs a reviewed upload by decrypting directly to its allowed portal
stream, never sending plaintext file bytes to a model or CLI. Model list returns only
server-issued ID, generic “Private browser file,” size/type and restricted=true;
no page-provided filename/subtitle. Model cannot clear the flag. Human-origin
ordinary files are unaffected. This closes the backdoor from vault private mode
through project files. A future person-reviewed extraction feature needs a
separate security design; v1 does not “unhide” private files.

Upload is only a person-picked existing project file, freshly authorized at
selection and transmission, ≤25 MiB, with stable file hash. Service receives a
stream via authenticated internal bridge, not filesystem path or reusable
signed URL. Never permit `/etc`, HOME, repo files or `file://`. Review **“Send
{name} to {origin}?”**, exact site/attachment hash once; if part of a final form,
bind upload manifest to that action. Client/vendor-facing document send or
company attestation requires Joe's grant under §7; a company upload, including a draft upload,
requires Joe's exact release approval. Browser cannot send private files to another
site without person review and appropriate owner authority. Payment card entry
is Joe's private take-over; never saved, extracted or transcripted.

#### Private file path inventory, cross-UID save and rollback reader

Phase 2 inventory is a release checklist, not “every reader” by assertion:

* `/api/files/[id]`: cookie-only human branch for private files; deny exp/sig,
  HEAD bypass, `?w=` thumbnail and Range before decrypt authorization.
* `/api/mobile/files/[id]`, `/api/mobile/unsorted/[id]/file`,
  `/api/mobile/subs/[slug]/documents/[id]/file`, `/api/mobile/sms/[id]/media/[fileId]`,
  `/api/mobile/calls/[id]/recording`: deny private in v1 (no Bearer browser API).
* `/api/portal/project-file/[id]`, `/api/portal/bid-file/[id]`,
  `/api/portal/sign-doc/[id]`, `/api/portal/floorplan/[id]`,
  `/api/portal/mood-image/[id]`, `/api/portal/selection-image/[id]`,
  `/api/newsletter/img/[token]`: deny private sources regardless of public token.
* `lib/file-serve.ts` generic/thumbnail cache, `lib/file-sign.ts` mint/verify,
  `mcp/bidding-tools.mjs` `get_project_file` base64/url/text/pages and
  `view_project_image`, `list_project_files`: deny private bytes/URLs/metadata;
  list safe generic ID/name/type only. No post-denial path falls back to disk.
* Writers/replacers: `lib/upload-store.ts`, `lib/actions/files.ts` (including
  client_visible), `mcp/bidding-tools.mjs` save_project_file overwrite,
  `mcp/upload-tools.mjs` put/commit replacement, `lib/file-trash.ts` trash/restore.
  Cannot clear provenance, overwrite ciphertext/hash/envelope or reuse same name
  to replace private row; create new ordinary ID instead. Trigger covers owner web
  paths too; private changes only guarded file command, never arbitrary UPDATE.
* Attachment/send/ingestion builders: `lib/attachments.ts`, runner attachment
  serialization, `lib/unsorted-docs-core.ts`, email/document/newsletter/SMS/bid
  attachment assembly and the existing AI file-ingestion modules deny private source IDs and
  storage paths. Implementation must run repository-wide storage_path/file_id
  scan to enumerate any newly added reader/writer before flag; inventory fixture
  fails if a known path lacks the common private-file gate. Existing cached text,
  thumbnails and signed-link/AI exports are purged when private provenance lands;
  new private artifacts have no prior exports. External copies cannot be recalled.

`storeBrowserFile` never renames service-owned files as Next UID. Protocol:
service validates+sanitizes, encrypts under **saved_file** purpose with reserved
file_id; creates fsynced ciphertext in service-owned durable staging. Web app
calls guarded file_prepare with artifact/hash/project/idempotency, inserts files
pending + ledger; generic readers deny pending. Service publishes through
`sjcos-browser-file-reader.service` using opaque staging handle and authenticated
RPC, reader-owned file store; reader fsync/atomic rename within **its own mount**,
then file_commit transaction marks ready. Standard uploads path holds at most
ciphertext; authorized reader streams, never Next rename/copy of plaintext.
Stage-before-DB orphans sweep after 1 h; DB-before-publish retry uses same file ID
and hash; publish-before-commit reconcile verifies ciphertext then commits.
No “Saved” until durable ready+hash exists. Same key/different body =409.
Reconciler can finish/clean using maintenance authority after model capability
expires, never dispatch an outside action. Preserve pending ledger on crash.

Retain separate bounded **reader/cleanup** unit and minimal compatible route
baseline during rollback, browser disabled or controller downtime; keys via
reader-only LoadCredential (file/profile retention keys as needed, no browser
control). `browser-file-read` authorization signed by fresh web session binds
file/project/viewer/request method/range and expires ≤5 s; reader rechecks DB
provenance/access, revocation and ready state. Service roles cannot self-authorize
human decrypt. HEAD returns approved safe metadata only. Authenticated Range
bounded ≤4 MiB, max two parallel ranges/person, no decrypted cache/temp; AES-GCM
whole-file ≤25 MiB verification before releasing any plaintext. If reader/key
unavailable return 503, never ciphertext as fake PDF or plaintext fallback.
Delete uses tombstone→unlink→ledger; trash/restore retains envelope/AAD and name.
Rollback cannot go below this file guard/reader baseline while private files
exist. Restore validates wraps/ACLs and starts browser controls off; readable
retained files remain available only through this human route.

### 8.3 Prompt injection

Web text is data. Public snapshots wrap it as `untrusted_page`, separate from
trusted instructions; truncate to 32 KiB and strip active markup, hidden inputs,
password/OTP/payment values and URL tokens. Model may follow the person's task,
not page instructions to change sites, credentials, tools, permissions or project.
Model outputs are escaped; page text cannot manufacture a first-party review
card. Tools don't accept executable selectors/code, arbitrary DB/HTTP requests,
allowlist edits, grant decisions or secret payloads. New referenced file/site is
an ask to the person. Browser profile's SJC tool allowlist prevents page injection
from exfiltrating via email/knowledge capture or creating another privileged run.
Standard owner-grant gates apply in addition to browser gates, never instead.

Public pages may still contain malicious content aimed at model reasoning.
Technical guards contain effects; prompts are supplementary. In private mode,
no arbitrary page-derived text enters the model at all (§5.2). Private action
errors are allowlisted codes, never site exceptions containing field values.

## 9. Schema, migrations and database authority

The original planning pass fetched `origin` with prune and inspected `origin/main` plus
all available remote branch migration trees. Main's highest is
`0073_users_call_phone.sql`; no 0100–0109 file was present in those refs.
Unpushed branches cannot be discovered. Reserve **0100–0104 for Browser**,
leave **0105–0109 to Canvas**. Recheck before implementation/merge, coordinate
by feature filename; never renumber an applied migration. No migrations created
by this planning task; copy canonical DDL to `db/schema.sql` during the build.

### 9.1 Tables, constraints and indexes

IDs are UUID unless noted; times are timestamptz. FK types follow existing
`users`, `projects`, `dev_agent_runs`, `ai_conversations`, `owner_grants` UUIDs;
`files.id` is text. Explicitly resolve slugs at the app boundary. Every new row
has `created_at`, `updated_at` where mutable. All foreign-key delete behavior
is RESTRICT unless explicitly listed below; no accidental cascade deleting audit.

| Table / migration | Fields and enforceable contract |
|---|---|
| `browser_tasks` (0100) | id, initiator_user_id→users, conversation_id→ai_conversations, project_id→projects NULL, lead_slug NULL, purpose varchar(500), required_areas text[], origins JSONB exact typed manifest, manifest_revision int>0, state enum queued/starting/active/paused/closed/failed, private bool, adapter_id text NULL, adapter_version text NULL, current_run_id→dev_agent_runs NULL (guarded pointer only), privacy_mode enum public/private/delegated_secret (CHECK private=(privacy_mode<>public)), initiating_web_session_id→web_sessions, bridge_nonce_seq bigint DEFAULT 0, controller_boot_id UUID NULL, queue_requested_at, queue_offer_expires_at, queue_expires_at, admission_reservation_id UUID NULL, document_epoch bigint>=0, control_epoch bigint>=0, controller_user_id→users NULL, controller_device_hash bytea NULL, control_token_hash bytea NULL, control_expires_at, last_activity_at, closed_at, failure_code. At most one of project/lead; task area list nonempty, valid keys; closed state requires closed_at. Partial UNIQUE(initiator_user_id) WHERE live state. Index(state,last_activity_at), (current_run_id), (conversation_id,created_at). Task state/epochs/presence are protected columns. |
| `browser_commands` (0100) | UUID id, task_id, run_id, initiator_user_id, epoch, seq bigint, idempotency_key UUID, input_digest, safe operation enum, state accepted/running/succeeded/failed/unknown, safe_result JSONB, timestamps. UNIQUE(task_id,idempotency_key), UNIQUE(task_id,epoch,seq). Same key+different digest = conflict. Never stores literal text/input/password. Composite FK(task_id,run_id,initiator_user_id)→browser_task_runs, never current-run pointer. Web commands have viewer_id/web_session_id, idempotency_key+body_digest, stream/generation/frame/epoch/seq bindings; no input text persisted. |
| `browser_logins` (0101) | id, owner_user_id, label varchar(80), canonical_origin varchar(255), tenant_binding NULL, required_areas[], field_mapping JSONB with trusted version/fingerprint, secret_ciphertext bytea, nonce/tag, wrapped_key+nonce/tag, key_id, crypto_schema, revision int>0, disabled_at, deleted_at, last_used_at. Encrypted plaintext holds username/password; metadata never username. Unique(owner_user_id,canonical_origin,label) WHERE deleted_at IS NULL. CHECK nonce/tag lengths 12/16; ciphertext/wrap nonempty; exact HTTPS origin parser validated in service and DB shape check. |
| `browser_login_access` (0101) | login_id, user_id, granted_by_user_id, granted_at, revoked_at, revision. PK(login_id,user_id); grants only owner-of-entry Joe, no onward delegation, no broad roles. Enforced in owner web command, not direct agent writes. |
| `browser_profiles` (0101) | id, user_id, login_id NULL, origin_chain_hash, encrypted storage state using independent envelope, revision, credential_revision, saved_at, expires_at (30 days maximum), revoked_at. UNIQUE(user_id,login_id,origin_chain_hash) for live entries, anonymous profiles never persist. Restore validates current access and matching credential revision/chain. No disk profile paths. |
| `browser_actions` (0102) | id, task_id, run_id, initiating_user_id, kind enum login/save_page/submit/pay/sign/upload, category enum personal_login/delegated_login/personal_contact/company_save/company_submission/company_send/company_payment/company_signature/unknown, needs_owner bool, snapshot_digest bytea, snapshot JSONB nonsecret, secret_manifest_ciphertext NULL + envelope, screenshot_artifact_id NULL, document/control epochs, revision int, amount_cents bigint NULL, currency char(3) NULL, payee varchar(255) NULL, state pending/approved/executing/succeeded/denied/expired/stale/failed/unknown, expires_at, approved_by_user_id NULL, approved_at NULL, approval_method enum card/direct_person_click NULL, token_hash bytea NULL, token_expires_at NULL, token_consumed_at NULL, owner_grant_id→owner_grants NULL, command_id UUID NULL, transmitted_at NULL, receipt_reference NULL (public or explicitly safe confirmed fact only; private raw reference encrypted artifact), outcome_code NULL, checked_at NULL. Composite(task_id,run_id,initiating_user_id) FK→browser_task_runs; server derives kind/needs_owner, not model. Only pending may become approved; unknown never automatically retries. Payment requires amount>=0 + currency/payee; company payment (including zero-dollar authorization) needs Joe. Approved/executing owner-required rows require exact owner_grant_id and owner approver. UNIQUE(owner_grant_id) where nonnull; partial one pending/approved/executing action/task. Index(state,expires_at), (task_id,created_at). Hashes 32 bytes. Approved fields can only change via owner/person web approval functions; service can consume, never approve. |
| `browser_artifacts` (0102) | id, task_id, action_id NULL, kind review_image/quarantine_file, safe_name, canonical origin (no query), MIME, byte_count, sha256, private bool, storage_key (opaque basename), envelope metadata when private (sha256 then binds ciphertext, plaintext hash inside envelope), expires_at, deleted_at. Task/action composite FK, max byte constraint, no public URL. Quarantine uniqueness by task/download ID. |
| `browser_file_links` (0103) | id, task_id, artifact_id→browser_artifacts, project_id, file_id text→files NULL, download_id UUID, state staged/committed/failed, sha256, private bool, actor_user_id, safe_error_code. UNIQUE(task_id,download_id), UNIQUE(file_id) WHERE nonnull. This is the save/recovery ledger, not a duplicate files table. Composite project/task and artifact/task checked. |
| `browser_audit` (0100; event variants extended later) | bigint identity, event UUID UNIQUE, task_id NULL, run_id NULL, actor_user_id NULL (retained tombstone if account removed), event enum, canonical_origin NULL, object_id NULL, revision NULL, result_code, at. Append-only, authenticated chain fields per §9.3; no arbitrary payload/URL/body/text column. Index(task_id,at), (at), (event,result_code,at). |
| Existing rows (0100/0103) | dev_agent_runs launch_source/browser_task_id/profile extension (§4); files provenance + encryption-envelope columns (§8). Add browser_task_runs after task/run rows exist in same transaction; a model service command requires the current attached live run. Web review of ended-run action uses immutable association, not live MCP capability. |

Additional 0100–0103 relations/fields (required, not implementation discretion):

| Relation | Durable fields / constraints |
|---|---|
| `browser_task_runs` (0100) | task_id, run_id PK composite, initiator_user_id, conversation_id, profile=browser, launch_source=panel_web, cli_session_id, capability_hash/expiry/revoked_at, launch_web_session_id, disposition running/waiting/completed/crashed/stopped, attached_at/ended_at. UNIQUE(run_id), UNIQUE(task_id,run_id,initiator_user_id); immutable identity FKs + matching task/run initiator/conversation. Historical actions/commands reference immutable triple, no cascade update. |
| `web_sessions` (0100 auth prerequisite) | §4.1 sid/user/authAt/expiry/revocation/generation; owner-only writes from authentication, no narrow privileges. Coordinated shared prerequisite, not invented preexisting sessions table. |
| `browser_viewers` (0100) | id, task_id, web_session_id, user_id, device_hash, joined_role, device_secret_hash, joined_at/left_at, visible_until, control expiry, stream_id/generation, last_frame_id/document_epoch, input_seq/digest; unique live task/session/device; revocation fences only matching device; timestamps bounded to session expiry. |
| `browser_web_commands` (0100) | id, task_id nullable at admission, session/viewer, operation enum, idempotency UUID, body_digest, safe_result, state, created/expiry (30d); UNIQUE(session_id,operation,idempotency). Changed body conflicts; never retain manual text/password. |
| `browser_maintenance_jobs` (0100) | id, kind enum cleanup/reconcile/revoke/profile_purge/file_publish, object_id, expected_revision, due_at, state/attempts/lease_boot/lease_until/safe_code. No outside network action kind, leased bounded retry idempotent. |
| actions/artifacts/files additions (0102/0103) | action.request_deadline, approver_session_id, audit_consume_seq, request_digest, dispatched_flow_nonce, gate_generation, original-run association, last_verified_at; artifact sanitizer/version/signature/result/original encrypted hash + sanitized ciphertext hash; file ledger staging_handle, publish_digest, ready_at, tombstoned_at/deleted_at, expected_revision, encrypted display metadata. |
| `browser_audit_heads` / checkpoints (0100) | singleton locked seq/digest; checkpoint_id, through_seq, digest, key_id, signature, external_ack_id/time, retained boundary. No narrow direct writes; chain and independent anchor in §9.3. |

Shared H5 assigns conversation/folder privacy and tombstones to **0105**.
Apply 0100–0104 additively first (no ownership-column DDL dependency), then 0105;
only then deploy/run `admitAskRun` guards and enable **either** Browser user role.
Browser 0100 owns canonical launch_source/continuation_of_run_id/run identity;
0105 finalizes thread-dependent guarded admission. Neither Canvas renderer nor
Canvas flag is needed for Browser, but shared code/schema/privacy acceptance is.

0104 adds no city-specific tables: record the generic permit runbook version and
browser rollout settings/tool catalog. Reusable site adapters are reviewed
versioned files, not model-editable SQL scripts. No new “permit issued” flag that
bypasses existing compliance readers. Enums may be CHECK text to ease additive
updates; enumerate exact transitions in guarded command functions and tests.

### 9.2 Protected writes and narrow-role matrix

All browser tables have **no grants** to `sjcos_agent`, `sjcos_worker` or
`sjcos_readonly`, with a manifest `note` explaining private browser/vault data.
No DEFAULT grant giving them SELECT later. Website's owner login serves
permission-checked reads/writes. `sjcos_backup` retains encrypted full-backup
read via its existing `pg_read_all_data`; no new writes. Monitoring gets aggregate
health through authenticated app health output, not browser rows. Agents use
stdio wrapper RPC, never direct browser table SQL. This also prevents broad
narrow-login reads from bypassing staff privacy or minting approvals.

Provision dedicated **`sjcos_browser`** login for the service, with
`DATABASE_URL_BROWSER` loaded as a systemd credential, not in CLI environment.
Add to `deploy/db-roles-bootstrap.sql`, manifest roles, `scripts/db-roles-sql.mjs`
NARROW_ROLES, apply/scan/tests (inspect every hardcoded four-role list),
`deploy/db-roles.md` and `lib/db-login.mjs`. No fallback from missing browser DSN
to owner; refuse startup. Use the existing Postgres **Unix socket**, with a
root-installed local password-auth rule for this login and a socket-form DSN;
network namespace has no TCP exception to Postgres. Mount only the necessary
Unix socket path read-only into the service namespace. DB password is loaded
only into controller memory, never inherited by Chromium. Validate local pg_hba
and filesystem access during deploy; if unavailable, keep admission disabled.
Its rights:

| Object | Browser service | Agent / worker / readonly |
|---|---|---|
| Tasks, commands, actions, artifacts, file links, audit, vault/access/profiles | No direct SELECT/I/U/D; scoped functions only | none |
| users, web_sessions, projects, files, owner_grants | No broad SELECT; only scoped functions below | unchanged existing rights; no browser approval additions |
| Service command functions | EXECUTE the listed functions only | no EXECUTE |
| Web approval/share/admission functions | no EXECUTE | no EXECUTE |
| policies / authority_grants / app_settings / users | no writes | no new rights |

No direct table SELECT for `sjcos_browser` (stronger than column grants in the
summary above); all reads use scoped typed functions below. Explicit nonsecret
projection `TaskSafe` = id,current_run_id,state,private,manifest_revision,
control_epoch,document_epoch,controller_boot_id,attention; `ActionSafe` = id,
original_run_id,state,kind,needs_owner,revision,expires_at,result_code; `FileSafe`
= id,task_id,private,mime,byte_count,ciphertext_hash,state. Ciphertext reads only
via `browser_read_secret`, never key material. No broad users/projects/owner_grants
SELECT. Health exposes counts, not rows. No direct I/U/D on any browser table.

All proposed functions revoke PUBLIC EXECUTE and are `SECURITY DEFINER SET
search_path=public,pg_temp`, fixed SQL/qualified tables, no caller SQL/role IDs.
Gate role using explicit `session_user`=approved login, **not current_user**, since
definer current_user is owner. Required actual login at startup must also match;
no SECURITY DEFINER changes to `sjcos_guard_narrow_writes` (stays invoker).

Normative function catalog; T=task UUID, R=run UUID, V=viewer UUID, A=action UUID,
B=boot UUID, K=32-byte capability hash, D=32-byte digest, I=idempotency UUID,
J=strict bounded versioned JSON schema (unknown keys rejected). `proof` is a
web-authorized one-use DB command row, never caller-supplied user identity.
Caller columns are **exclusive EXECUTE grants**; website means actual owner web
DB login, not agent. All writes required by the feature map below.

| Function signature → return | Caller | Guarded transition / writes |
|---|---|---|
| `browser_web_admit(conversation uuid,project uuid,kind text,manifest J,session uuid,I,D) → TaskSafe` | website | §4 session/thread/record/areas, creates task+web command; derives initiator/required areas |
| `browser_web_join(T,session uuid,device_hash bytea,role text,I,D) → V` / `browser_web_leave(V,I) → bool` | website | own task or explicit Joe review; creates/revokes viewer, fences device control/streams |
| `browser_web_presence(V,visible bool,generation bigint,I) → expiry` | website | selected conversation/open panel proof; ≤15 s and session expiry; per-device |
| `browser_web_sites(T,V,expected_revision int,manifest J,I,D) → TaskSafe` | website | present initiator/Joe, cannot lower areas, revalidates data policy, stale approvals |
| `browser_web_attach_run(T,R,V,expected_epoch bigint,I) → TaskSafe` | website | task/conversation/identity match, no pending action; immutable task_run+guarded pointer; capability row |
| `browser_web_control(T,V,op text,epoch bigint,I,D) → TaskSafe` | website | take_over/give_back/resume/stop, session holder; irreversible private transition before takeover proof; epoch fence |
| `browser_web_input(T,V,frame uuid,epochs J,seq bigint,I,D) → proof` | website | private person-control/no-log input digest authorization; never stores text, delegated staff denied; exact stream generation checked |
| `browser_web_capability(T,R,V,server_kind text,process_binding J,I) → hash/expiry` | website | trusted launcher only after run attachment; mint/revoke wrapper registration, one slot/kind, bound process start/cgroup; no user-supplied run impersonation |
| `browser_web_prepare(T,V,R,ref text,kind text,I,D) → proof` / `browser_web_decide(A,V,revision int,decision text,I,D) → ActionSafe` | website | prepare binds controlled human input/ended original run without reviving MCP; exact web review/session/role, lock task→action→grant; approve/deny, create one-use exact grant/token + audit atomically; never generic decideGrant |
| `browser_web_login(op text,login uuid,revision int,session uuid,metadata J,envelope J,I) → metadata` | website | save/edit/delete by owner of entry; ciphertext created only after authorized service encrypt; rotate/revoke profile jobs; no secret SQL input |
| `browser_web_share(login uuid,session uuid,revision int,user_ids uuid[],I) → revision` | website | Joe's own entry/named active staff only; revoke fills/profiles/contexts |
| `browser_web_field_mapping(T,V,login uuid,revision int,candidates J,I) → revision` | website | own-login person or Joe only, private live candidate handles/fingerprint, not CSS; service verifies then commits version |
| `browser_web_file_prepare(T,V,artifact uuid,file_id text,project uuid,D,display_envelope J,I) → FileSafe` / `browser_web_file_commit(file_id text,publish_proof uuid,I) → FileSafe` | website | authorized human project access + sanitized output; stage files+ledger then mark ready after service publish proof; no premature saved |
| `browser_web_file_authorize(file_id text,session uuid,method text,range J,I) → proof` | website | human-cookie project reader/HEAD/Range rights, no model/signed URL; ≤5 s one-use |
| `browser_authorize(T,R,K) → TaskSafe` | service | current browser run/capability/session/areas/flags; no arbitrary user argument |
| `browser_read_state(T,K,scope text) → TaskSafe/ActionSafe/FileSafe` | service | task-scoped state projection; scope enum task/action/files, immutable associated run |
| `browser_read_secret(T,object uuid,purpose text,proof uuid) → envelope J` | service/reader | purpose/mode-specific proof; login/profile only controller and current use grant, saved_file only reader with human proof or Joe-approved exact portal upload; no generic decrypt oracle |
| `browser_command_begin(T,R,K,I,epoch bigint,seq bigint,op text,D) → command uuid/state` / `browser_command_finish(command uuid,B,result text) → state` | service | strict model op+bindings; safe enums only; cannot approve/alter identities; dedupe |
| `browser_enter_private(T,B,expected_epoch bigint,mode text) → TaskSafe` | service | public→private/delegated only; drop observations under lock before any input; cannot revert |
| `browser_action_create(T,R,auth J,snapshot J,artifact uuid,I) → ActionSafe` / `browser_action_stale(A,B,revision int,code text) → ActionSafe` | service | auth is live MCP capability or web preparation proof for ended original run; derive classification, immutable digest; pending→stale only; never accepts approved_by/token/grant supplied by service |
| `browser_consume_action(T,A,token_hash bytea,D,B,epoch bigint) → command uuid/consume_seq` | service | SQL exact validation + one atomic consume, see below; no approval authority |
| `browser_action_result(A,B,result text,evidence J) → ActionSafe` | service | executing→succeeded/failed/unknown only; safe bounded evidence, transactional audit; no retry/approve |
| `browser_artifact_put(T,B,kind text,envelope J,metadata J,I) → artifact uuid` / `browser_artifact_transition(artifact uuid,B,next text,code text) → FileSafe` | service | only review_image/quarantine/sanitized, sizes/AAD/expiry/source/task checked; quarantined→validated/rejected/tombstoned, no direct ready project file |
| `browser_login_used(T,login uuid,revision int,B,result text) → bool` / `browser_save_profile(T,login uuid,revision int,envelope J) → revision` | service | authorized current login use; last_used/audit or profile upsert, immutable person/origin/credential revision |
| `browser_file_publish(file_id text,staging uuid,D,B) → proof` | reader | pending ledger bound hash, publish/fsync then proof; no arbitrary path/contents/provenance changes |
| `browser_runtime_transition(T,B,epoch bigint,next text,code text) → TaskSafe` / `browser_run_end(T,R,disposition text,B) → TaskSafe` | service | exact §3.4 transitions/fencing; normal end preserves card, unexpected death closes; no authority upgrade |
| `browser_maintenance_claim(B,limit int) → jobs` / `browser_maintenance_finish(job uuid,B,result text,proof J) → bool` | service/reader | boot-bound lease, ≤25 jobs; expiry/revocation/purge/reconcile/tombstone/delete only from prederived jobs, no new outside dispatch; can operate without old MCP capability |
| `browser_append_audit(T,event uuid,event text,object uuid,code text,chain J) → seq` / `browser_checkpoint(seq bigint,D,key_id text,signature bytea,external_ack text) → bool` | service | chain verified/current head locked, enum event, no arbitrary text; checkpoint acknowledgment cannot replace chain |

Inputs have 64 KiB max for nonsecret JSON, envelope bounds per artifact, finite
enums from contracts; invalid caller `42501`, bad shape `22023`, identity/not-found
`BROWSER_NOT_FOUND`, session/revoked `BROWSER_REVOKED`, stale epoch/revision
`BROWSER_REVIEW_STALE`, changed idempotency digest `BROWSER_IDEMPOTENCY_CONFLICT`,
wrong state `BROWSER_BAD_STATE`, expired `BROWSER_CAPABILITY_EXPIRED`. No side effects
on failed transaction. File read proof for a retained ready file uses fresh session/project ACL even
when source task is closed and viewer/run no longer exists; closed task permits
no browser dispatch. Login management similarly uses fresh session without a
live task; ciphertext encryption proof binds login ID/revision before save.
Audit append uses expected-head CAS: service computes HMAC for prospective next
seq, SQL rechecks head under lock; mismatch retries only chain preparation, never
remote dispatch.
All write functions append appropriate audit record or
transactional audit outbox before commit; inability to chain/anchor pre-dispatch
fails closed. Maintenance functions cannot impersonate a live run or approve.

**Atomic grant SQL implementation:** `browser_consume_action` locks task, action,
then exact owner_grants row. Check web-approved action and approver session,
initiator session/device attendance, immutable original run/task association,
snapshot/document/control/listener epochs, active user/areas, expiration,
request readiness, hashed token, grant status/action/target=browser_action:A,
run_id=action.run_id, snapshot digest, amount/currency/payee, max_uses=1 and uses=0.
Reject `*`, null scope, wrong run and general Express grants. In that same SQL
transaction set grant uses=1/used_at, append grant use evidence, consume token,
set executing+command UUID and write chained consume audit/outbox. No TypeScript
`consumeGrantRun` inside SQL; browser-specific SQL implements this exact narrow
branch and parity tests compare invariants with grantCovers. No network I/O in
transaction. Subsequent outcome and grant result logging are transactional browser
records; best-effort generic recordGrantResult is supplementary only.

Service SELECT matrix summary above is superseded by function-only access;
explicitly **zero direct columns** granted. Extend bootstrap/generator/apply/scan,
manifest and `tests/_harness/testdb.mjs` fifth-role lists. Keep existing SET ROLE
transport for general grant tests, but add **real LOGIN/password local disposable
DB** tests for browser service/session_user checks (SET ROLE keeps superuser
session_user and must be rejected). Attack every definer directly as agent,
worker, readonly, backup and service; prove service cannot call web functions,
create approval/share, change provenance or invoke arbitrary decrypt; no PUBLIC
execute/default privilege leak.

Each phase updates manifest and pastes the **actual** generator output into the
migration for its new tables/changed roles. Zero-grant entries print no lines;
explicitly revoke inherited/default rights and document why. Generator extension
is needed for `sjcos_browser`; don't claim current output already supports it.
`files` provenance isn't an agent-grant expansion; add a guard preventing narrow
logins from clearing `browser_private`/source or replacing private bytes. DB
triggers alone don't stop model reads: §8 reader coverage is required too.

### 9.3 Retention and audit ownership

Live frames: memory only, erased on replacement/disconnect. Review images/body
manifests: encrypted private artifacts, delete after outcome or expiry + **24 h**,
never ordinary project files/backups of temp dirs. Quarantine: delete on reject,
or at session close + 1 h, absolute 24 h; total disk quota enforced. Commands
safe results: 30 days, then keep only IDs/state/digests. Action nonsecret summary,
digest, approver, amount, portal reference and content-free audit: **2 years**;
project receipts saved to files follow existing project file retention. Saved
login: until user deletes, or Joe disables a departed staff account; encrypted
profile: 30-day max renewed only by explicit use, immediate purge on revocation.
Deleted vault ciphertext and unused wrapped keys purged within 24 h. Backup
copies age under the existing backup policy; deletion cannot erase old backups
instantly. Exclude runtime/tmpfs/quarantine directories from backup inventories;
DB ciphertext may be backed up, key escrow separately. Restore starts off.

Controller's one-second housekeeping expires controls/requests; separate bounded
minute cleanup removes expired files/profiles and reconciles staged saves.
Health exposes last-cleanup timestamp/backlog; stale >5 min blocks new vault
fills/downloads until repair. If a browser is not running, the small controller
still cleans; no worker browser access needed. Disk deletion follows durable
tombstone → unlink → mark deleted so crash retry is safe. Legal/project retention
changes require owner policy decision; never keep screenshots indefinitely as a
substitute for receipt evidence. Log purge counts, not content.

#### Tamper-evident audit and independent anchors

Each content-free event carries sequence, event UUID, task/run/actor IDs, enum,
timestamp, previous_digest, digest=SHA256(domain + JCS(event_without_digest) +
previous_digest), service HMAC-SHA256 authentication and audit_key_id. Audit keys
separate from vault/bridge, LoadCredential service-only. Lock audit head to allocate
sequence; no gaps accepted by verifier except explicit retained boundary checkpoint.
Web approval writes a fixed outbox event atomically with grant/action; service
chains it and verifies before consume. Consume writes service-authenticated chained
evidence transactionally with grant use; **gate cannot transmit until checkpoint
ack for approval+consume exists**. A content-free checkpoint (seq,digest,time,
install/boot ID) is Ed25519-signed by service and sent to an independently
administered append-only/WORM sink (not mutable app DB or owner-mounted writable
path). A bounded root-supervised `sjcos-browser-checkpoint-exporter.service`
(32 MiB, 5% CPU in feature slice) receives **only signed fixed-size checkpoint
records** on a root-owned Unix socket; it has no browser/vault/DB access. Its
separate egress policy allows only pinned audit-sink HTTPS endpoint with writer
credential via LoadCredential. It verifies service signature, forwards checkpoint,
and returns sink-signed append acknowledgment which controller verifies. This
closes the namespace routing gap without giving Chromium/controller arbitrary
outbound HTTP or access to sink credentials. Deployment must provision that sink before final dispatch; unavailable
ack blocks dispatch. Also checkpoint every 60 s/100 events and on shutdown.
No credentials/URLs/amount text in sink; IDs/hashes only.

Proposed offline `browser-audit-verify` compares full chain/HMAC and signed anchors,
requires monotonic expected highest seq stored at sink, detects modified/deleted
middle rows, tail truncation and old-DB restore. Restore reconciles checkpoint
before enable; divergence is incident, admission stays off. Retain signing public
keys indefinitely with checkpoints; encrypt audit HMAC keys through two-year row
retention plus backup expiry; key rotation creates signed transition event. Before
retention deletes old events, anchor boundary digest/seq and retain checkpoint
past row retention, never reset chain to genesis. Audit spool max 64 MiB; failure
or full spool stops new effects, not drop evidence. Missing terminal outcome can
leave consumed event unknown; cannot fabricate remote success.

This detects DB-only owner-login edits/rollback; it does not defeat root or a
compromised trusted service holding signing keys, collusion with checkpoint sink,
or an outside portal lying about success. Existing unrestricted owner coding
runs are outside service/root trust boundary, but cannot silently edit independent
checkpoints. Generic owner-grant audit JSON alone is not tamper-evident evidence.

## 10. MCP, internal adapters and web routes

### 10.1 Exact wrapper contract (version 1)

Register these **only** on stdio server `browser`, injected into a verified
browser-profile run. Never expose on the global HTTP MCP server. Every schema
is strict (reject unknown keys); UUIDs validated, strings bounded, no caller
principal/approval boolean/URL policy fields. Tool response is MCP JSON text
with `{ok:true,...}` or `isError:true` and
`{ok:false,code,message,retryable,task_id:null|uuid}`. No stack/DOM/HTTP bodies.
All operations authorize even if nominally read-only. `task_id` must match the
inherited capability; for brevity table uses T for that required UUID.

Common returned `Task` exactly:
`{task_id,run_id,state:'queued'|'starting'|'active'|'paused'|'closed'|'failed',
control:'agent'|'person'|'none',private:boolean,privacy_mode:'public'|'private'|'delegated_secret',allowed_sites:string[],
required_areas:string[],manifest_revision:int,control_epoch:int,
document_epoch:int,attention:'none'|'person'|'joe'|'check_result'}`.
`allowed_sites` are person-approved canonical origins, never URL query/path.
Common errors: `BROWSER_DISABLED`, `BROWSER_ATTENDED_ONLY`,
`BROWSER_NOT_AUTHENTICATED`, `BROWSER_NOT_FOUND`, `BROWSER_FORBIDDEN`,
`BROWSER_REVOKED`, `BROWSER_BUSY`, `BROWSER_RESOURCE_LIMIT`,
`BROWSER_SERVICE_UNAVAILABLE`, `BROWSER_CAPABILITY_EXPIRED`,
`BROWSER_BAD_INPUT`, `BROWSER_IDEMPOTENCY_CONFLICT`. Only BUSY, resource and
transient service errors are potentially retryable; no blind action retry.

| Exact name | Input (required unless `?`) | Exact success output beyond ok / additional errors |
|---|---|---|
| `browser_open` | `{task_id:T}` | `{task:Task,queue_position:int|null}`. Opens **already person-approved** task, never creates/changes allowlist. Already open returns same task. No presence → ATTENDED_ONLY. |
| `browser_status` | `{task_id:T}` | `{task:Task,pending_action_id:uuid|null,last_result:'none'|'succeeded'|'failed'|'unknown'}`. Private result has no outside strings. |
| `browser_observe` | `{task_id:T}` | Public: `{observation_id:uuid,document_epoch:int,expires_at:ISO,untrusted_page:{origin:string,text:string,controls:[{ref:string,role:enum,label:string}]},private:false}`. Max 32 KiB, max 150 controls; refs scoped to observation, TTL 30 s. Private: `{observation_id:uuid,document_epoch:int,expires_at:ISO,private:true,adapter_id:string|null,controls:[{ref:string,operation:enum,field_key:string|null}]}` where keys/operations come only from reviewed adapter, no outside labels/text. Without adapter controls=[]. No screenshot tool. |
| `browser_navigate` | `{task_id:T,url:string<=2048,observation_id:uuid,idempotency_key:uuid}` | `{task:Task,result:'loaded'|'waiting_for_review',action_id:uuid|null}`. Only preapproved read destinations; canonical origin allowed, no credentials/token queries. SITE_BLOCKED / ADDRESS_BLOCKED / REVIEW_REQUIRED. |
| `browser_act` | `{task_id:T,observation_id:uuid,ref:string<=80,operation:'click'|'fill'|'select'|'check'|'scroll'|'key',value?:string<=4000,checked?:boolean,direction?:'up'|'down',key?:'Tab'|'Shift+Tab'|'Enter'|'Escape',idempotency_key:uuid}` | `{result:'done'|'waiting_for_review'|'needs_take_over',action_id:uuid|null,document_epoch:int}`. Discriminated union: fill/select require value; check requires checked; scroll direction; key key; click none. No coordinates/code/selectors/files. Every value must match a person-confirmed fact/release from §8.1; delegated mode fixed adapter refs only. CONTROL_HELD / OBSERVATION_STALE / PRIVATE_INPUT_REQUIRED / REVIEW_REQUIRED / ADAPTER_REQUIRED. Adapter type validates values, no secret fields. |
| `browser_list_logins` | `{task_id:T}` | `{logins:[{id:uuid,label:string,origin:string,can_use:boolean}]}` authorized entries matching current task origin only; no owner names/usernames/share roster. |
| `browser_fill_login` | `{task_id:T,login_id:uuid,observation_id:uuid,idempotency_key:uuid}` | `{status:'private',login_filled:true}` or needs take-over error, never secret values. LOGIN_NOT_AVAILABLE (no enumeration distinction) / LOGIN_ORIGIN_MISMATCH / LOGIN_FIELDS_CHANGED / VAULT_UNAVAILABLE / PRIVATE_INPUT_REQUIRED. Does not submit. |
| `browser_prepare_action` | `{task_id:T,observation_id:uuid,ref:string<=80,kind:'login'|'save_page'|'submit'|'pay'|'sign'|'upload',summary:string<=1000,idempotency_key:uuid}` | `{action_id:uuid,state:'pending',needs_owner:boolean,expires_at:ISO}`. Service derives authoritative manifest/amount/classification; caller cannot downgrade. REVIEW_UNAVAILABLE / AMOUNT_UNKNOWN / OBSERVATION_STALE. Private summary must be person/adapter business facts, not page text. |
| `browser_request_take_over` | `{task_id:T,reason:'login'|'two_factor'|'captcha'|'unsupported_step'|'review'}` | `{task:Task,requested:true}`; creates typed human notice, not control token. Phone shows limitation. |
| `browser_action_status` | `{task_id:T,action_id:uuid}` | `{action_id,state:'pending'|'approved'|'executing'|'succeeded'|'denied'|'expired'|'stale'|'failed'|'unknown',result_code:string|null,needs_person:boolean}`. No screenshot/body/token/secret-derived result; private references not returned to model. |
| `browser_list_downloads` | `{task_id:T}` | `{downloads:[{download_id:uuid,name:string,mime:'application/pdf'|'image/png'|'image/jpeg',bytes:int,private:boolean,state:'quarantined'|'saved'|'rejected'}]}`. Private name is fixed “Private browser file.” |
| `browser_stage_upload` | `{task_id:T,file_id:string<=120,observation_id:uuid,ref:string<=80,idempotency_key:uuid}` | `{action_id:uuid,state:'pending',needs_owner:boolean,expires_at:ISO}`. PROJECT_FILE_REQUIRED / FILE_FORBIDDEN / FILE_CHANGED / FILE_TOO_LARGE. This stages only; agent cannot call setInputFiles directly. |
| `browser_close` | `{task_id:T,reason:'finished'|'cancelled'}` | `{task_id,state:'closed'}` idempotent; unknown outcome stays unknown. |

There is deliberately no `browser_execute`, `browser_approve`, `browser_eval`,
`browser_get_password`, raw screenshot, arbitrary request, profile export or
allowlist-edit tool. **Human approval performs the one action** via internal
controller command, not an instruction for the model to call a second tool.
Tools return quickly (≤30 s max page read, ≤5 s most calls); pending approvals
are polled by UI/service, not a blocked MCP call with a 24-hour timeout.

Internal adapter `BrowserTaskV1` is this exact Task plus server-only actor,
capability, manifest and state references. `PermitBrowserHandoffV1` (§11) uses
`task_id`, not a second session/entity. Export definitions from
`lib/browser/contracts.mjs`, consumed by MCP, route validator, UI types and tests.
Version fixture `tests/fixtures/browser-contract-v1.json` verifies all three.

### 10.2 Web API and components

Routes are `app/api/agent-browser/**/route.ts` (`runtime='nodejs'`), authenticated
cookie session only in v1. No new public mobile Bearer API. Use `await params`,
Web ReadableStream, abort/disconnect cleanup, no cache. Shared handler guard
`requireBrowserTaskAccess(req,taskId,operation)`; never assume a layout/proxy guard
protects a route. Permission/identity is reread, not request body user IDs.

| Method and path under `/api/agent-browser` | Request / response; authorization beyond common guard |
|---|---|
| POST `/tasks` | `{conversation_id:uuid,task_kind:'public_research'|'permit'|'invoice'|'purchase',purpose,project_id?:uuid,lead_slug?:string,origins:[{origin,role:'document'|'identity'|'resource'}],adapter_id?:string,idempotency_key}` → `{task:Task}`. Person initiator only, conversation owned by signed-in person, areas derived from task_kind/record (not caller selectable), manifest reviewed. Staff cannot reduce catalog requirements. No run launched until Open. |
| GET `/tasks/[taskId]` | `{task,active_run_id,available_controls,pending_action,downloads,queue_position}` safe UI metadata; owner cross-user explicit review mode, staff own only. |
| POST `/tasks/[taskId]/sites` | `{origin,role,expected_revision,idempotency_key}` → revised Task. Initiator/owner present; validated site; invalidate old observations/actions. |
| POST `/tasks/[taskId]/start` | `{idempotency_key}` → `{task,run_id}`. Creates browser-profile panel_web run and capacity request, preserves task identity; no unattended path. |
| GET `/sessions/[taskId]/events` | SSE §6; authorized viewer, max streams, no URL token. Initial state sent immediately, every 5 s fresh auth; private frames only to explicitly joined authorized human viewer; delegated-secret frames Joe-only, staff receive fixed-schema controls/status instead. |
| POST `/sessions/[taskId]/presence` | `{viewer_id,device_secret,visible:boolean,conversation_id,expected_epoch,idempotency_key}` → `{present_until}`; bounded 5 s heartbeat, no arbitrary expiry. Visibility false revokes that viewer presence; task pauses only if no valid initiator viewer remains. Browser pane visibility alone is irrelevant. |
| POST `/sessions/[taskId]/control` | `{action:'take_over'|'give_back'|'resume'|'stop',viewer_id,device_secret,expected_epoch,idempotency_key}` → `{task,control_token?:string,expires_at?:ISO}`. Token only to owning human device; never query/log/persist. Resume requires explicit confirmation. |
| POST `/sessions/[taskId]/input` | Discriminated input body specified below + viewer/device, control_token, stream_id, stream_generation, frame_id, document_epoch, control_epoch, seq, idempotency_key. Returns `{accepted_seq}`. Holder only, CSRF, dedupe/stale/rate checks; no recording text or queuing offline. All manual input goes through `/private-input` after irreversible transition; `/input` accepts no manual payload (422 PRIVATE_INPUT_REQUIRED), retained only for reviewed content-free adapter controls. No field-type detection switch. |
| POST `/sessions/[taskId]/private-input` | Full strict manual Input body below → `{accepted_seq}`; permanent private transition/no-log memory-only for **all** manual input, not just passwords; staff delegated context always denied. |
| GET `/actions/[actionId]` | UI-only protected review snapshot + image route, current status/revision/expiry/role. Initiator sees task; Joe can explicitly join for owner review. Delegated staff response excludes all screenshot/body/page strings/artifact links, exposes only fixed status and person-confirmed facts. Never model fetch. |
| POST `/actions/[actionId]/decision` | `{decision:'approve'|'deny',expected_revision,idempotency_key}` → `{action_id,state,result_code}`. Authenticated actor must satisfy §7 table. Approval creates exact grant if needed and dispatches once while both required people/presence are valid; not generic owner-grant action. |
| GET `/artifacts/[artifactId]` | Stream authorized review image/private file; authorize task+action+TTL on **every** GET/HEAD/Range. Private no-store, nosniff, no public/signed link; query thumbnail bypass forbidden. Deleted/expired →410. Human view only; delegated-secret artifacts/screenshots Joe-only regardless of initiator. |
| POST `/downloads/[downloadId]/save` | `{project_id,expected_sha256,display_name,tag,idempotency_key}` → `{file_id,href,private}`. Human current project access; same task project; save/recovery ledger. |
| DELETE `/downloads/[downloadId]` | Cancel/delete quarantine, idempotent; no general project file deletion authority. |
| GET/POST `/logins` | List permitted metadata or save `{label,origin,username,password}` (areas derived); private form only. POST → `{id,label,origin,revision}`, never echoed username/password. Staff forced own entry; request owner ignored/rejected. |
| PATCH/DELETE `/logins/[loginId]` | Entry owner changes fields with expected_revision / deletes; exact revision conflict 409. Joe may disable delegated entry without revealing password; replacement password must come from its owner. |
| POST `/logins/[loginId]/access` | `{user_ids:uuid[],expected_revision}`; Joe's own entry only, active staff/areas checked; replace/revoke access with close+purge. Response metadata only. |
| POST `/internal/command` | **Not public HTTP**: controller Unix-socket protocol with signed envelopes. App-only methods approval/fill input cannot be invoked with MCP capability. Controller reverse health/results bridge, if HTTP needed, binds loopback and verifies signature+nonce+body with a dedicated secret; no public proxy route. |

Additional public route operations (same cookie-only/CSRF guards):

| Method/path | Strict body → result |
|---|---|
| GET `/csrf` | Same-origin/no-store; issues random CSRF bound to sid and viewer nonce in memory; verify double-submit token + server binding, expires ≤30 min/session |
| POST `/tasks/[taskId]/join` | `{mode:'initiator'|'owner_review',idempotency_key}` → `{viewer_id,device_secret,expires_at,task}`; device identity minted server-side, owner join does not take control |
| POST `/tasks/[taskId]/leave` | `{viewer_id,device_secret,idempotency_key}` → `{left:true}`; revoke only own joined device |
| POST `/tasks/[taskId]/field-mapping` | `{login_id,expected_revision,observation_epoch,username_candidate,password_candidate,idempotency_key}` → `{mapping_revision}`; service-generated candidate handles, own login/Joe private picker only |
| DELETE `/tasks/[taskId]/field-mapping` | `{login_id,expected_revision,idempotency_key}` → `{cleared:true}`; same authority, navigation invalidates handles |
| POST `/actions/[actionId]/remind` | `{idempotency_key}` → `{queued:true}`; Joe or own initiator, internal notification only, max one/60 s |
| GET `/files/[fileId]/metadata` | Human cookie/project access → decrypted confirmed display name/tag; never accessible as model or signed URL |

Exact domain enums: viewer role `initiator|owner_review`; privacy
`public|private|delegated_secret`; site role `document|identity|resource`;
action category as §9.1; adapter operation `focus_field|fill_business_field|
select_business_value|check_business_option|scroll|next_page|prepare_login|
prepare_submit|prepare_pay|prepare_sign|prepare_upload|read_safe_result`.
Adapter registry gives fixed ref→operation+schema; no model-chosen locators/code.
Ref becomes stale after document epoch or manifest revision changes.

Manual input common schema (all required): `{viewer_id:uuid,device_secret:string,
control_token:string,stream_id:uuid,stream_generation:int,frame_id:uuid,
document_epoch:int,control_epoch:int,seq:int,idempotency_key:uuid,event:Input}`.
`Input` strict union:
* `{type:'pointer',phase:'down'|'up'|'move',x:number,y:number,button:0|1|2,
  buttons:int,modifiers:('Alt'|'Control'|'Meta'|'Shift')[]}`; finite viewport CSS
  coords, out-of-image clicks rejected; moves coalesced, never buffered offline.
* `{type:'wheel',x:number,y:number,delta_x:number,delta_y:number}`; deltas bounded
  ±1200 per event, viewport coords finite.
* `{type:'key',phase:'down'|'up',key:string,code:string,modifiers:enum[]}`;
  bounded key/code allowlist; no devtools/clipboard/navigation accelerators.
* `{type:'ime_commit',text:string<=4096}`; committed Unicode text only, no raw
  composition logging, cannot bypass final-step Enter guard.
* `{type:'type_answer',answer_id:uuid,confirmed_revision:int}`; service retrieves
  person-confirmed fact; no arbitrary page-derived value, same no-log path.

Reviewed-control `/input` has separate strict body
`{viewer_id,device_secret,control_token,document_epoch,control_epoch,
manifest_revision,ref:string<=80,operation:AdapterOperation,
answer_id?:uuid,confirmed_revision?:int,idempotency_key}`; service resolves
registry schema/confirmed value, never accepts x/y/key/text/selector/raw URL.
In delegated mode it can only act on supported safe controls; any final step
still stages Joe's card. No frame requirement because no remote pixels exist
for staff; binds safe adapter revision/observation instead.

Private endpoint body is memory-only, max 8 KiB JSON, TLS, request logging/APM
body capture disabled end-to-end, process errors codes only. Under task/context
lock reject delegated staff, finish permanent private transition/drain before
forwarding **any** event. Old stream/frame/epoch or device mismatches return 409;
same seq+same digest returns prior acceptance, changed body conflicts. No input
text saved in browser_web_commands (keyed HMAC for dedupe, not plaintext hash).

Scoped Unix RPC envelope:
`{v:1,method,task_id,original_run_id:null|uuid,viewer_id:null|uuid,
boot_id,command_id,sequence,issued_at,expires_at,nonce,body_digest,payload,signature}`.
JCS bytes signed HMAC-SHA256 with independent web/service direction keys;
≤5 s expiry, nonce once, sequence monotonic per connection generation, 64 KiB
JSON max except explicit bounded binary stream. Web methods whitelist
`admit|join|leave|presence|sites|control|manual_input|login_encrypt|login_mapping|
review_decide|file_save|file_read|health`; MCP methods exactly §10.1 tools;
maintenance `reconcile|purge|checkpoint` only trusted service. Each payload uses
above route/DB schemas, never a generic pass-through CDP or arbitrary URL.
Model capability cannot call web methods. Service-origin callbacks are limited
to signed safe status/publication proofs, not DB authority grants. Large secrets/
artifacts use a dedicated bounded binary stream with digest+length and no log,
not embedding uncontrolled page bytes into JSON error/audit. Forged caller,
expired/replayed nonce/sequence, bad digest/method, stale session/epoch and body
size return defined BROWSER_BAD_INPUT/REVOKED/IDEMPOTENCY_CONFLICT/REVIEW_STALE;
never reuse a failed bridge message to dispatch.

Error mapping: input 400/413, auth 401, role/revoked 403, other task/object 404,
stale/control/duplicate-body 409, expired 410, unsupported 422, capacity/rate 429,
service 503, operation timeout 504. Error response exactly
`{ok:false,code,message,retryable}`. No 307 login HTML in an SSE/error JSON route.
Log only method, templated route, safe error, duration; never raw URL/query/body.

UI file ownership for build: `BrowserPane.tsx`, `BrowserLiveView.tsx`,
`BrowserToolbar.tsx`, `BrowserSitesSheet.tsx`, `BrowserReviewCard.tsx`,
`BrowserLoginSheet.tsx`, `BrowserFileReview.tsx`, `useBrowserSession.ts`, shared
`AskContentPane.tsx`. Wire these into `PanelDock`, `PanelChat`, `useAgentChat`,
`PanelHost`, `PanelWindow`, `RunReview` and owner Permissions review link.
`lib/actions/dev-agents.ts` poll adds only `{browser_task_id,state,attention}`;
no frames, controller token, vault data or private screenshot in general polling.
`lib/actions/browser.ts` is the typed UI bridge where actions are suitable;
stream and sensitive form/input use the route handlers directly. Login list UI
lives at `/panel/logins` (ai area) plus sheet; owner deployment/settings at
`/settings/browser` remains owner-only. `proxy.ts`/permissions paths must allow
the personal route without opening `/settings` to staff; handler guards remain
required for APIs. No navigation item to a nonexistent standalone dashboard.

## 11. Generic permit-pull runbook and later handoff

Do not select a city or assert a local permit requirement in this build. Ship a
generic runbook definition/draft, reviewed through existing Skills/Runbooks.
No background registration giving the permit research agent a browser.

`PermitBrowserHandoffV1`:
`{version:1,project_id:uuid,project_slug:string,work_item_id:uuid,
research_file_ids:string[],portal_origin:string|null,city:string|null,
confirmed_facts:{address:string|null,applicant_name:string|null,
license_number:string|null,scope_summary:string|null},
missing:string[],required_areas:['projects','compliance'],
next_step:'review_sites'|'confirm_details',source_trigger_ref:string}`.
Facts are references/confirmed business facts, never login/payment values. Portal
origin remains NULL until researched and person confirmed. Attachment manifests
use file IDs/hashes, not paths. Export type in `lib/browser/contracts.mjs`;
fixture shared by research handoff and attended start.

| Runbook step | Work and stop condition | Proof / next step |
|---|---|---|
| Find requirements | Existing unattended permit research checks official sources, scope/city and creates brief | `PERMIT · Requirements` file + sources and date; uncertainties explicit |
| Ask a person to open the site | Stage human to-do “Apply for the permit — {project},” link Ask task proposal | Person reviews site/project/areas; no browser until attended start |
| Check applicant and documents | Confirm address, scope, contractor/license, property owner/applicant authority and required plan files | Person-correctable checklist; missing item stays open, never invented |
| Sign in | Choose allowed login; private mode; person handles 2FA/CAPTCHA | Audit credential use without credential value |
| Fill application | Use generic safe operations/public pages or reviewed adapter's typed private fields | Draft only; unsupported portal = Take over |
| Review application | Show exact form summary, files, attestations and fee shown | Permit certification/company commitment goes to Joe; no blanket task approval |
| Submit | One fresh final card for the application | Portal reference + evidence; unknown result requires manual check |
| Pay if required | Separate fresh card, amount/currency/payee; Joe grant even for staff | Receipt; no inferred payment/automatic invoice update |
| Save records and follow up | Save application/receipt and issued permit when actually available | Project files, `record_agent_run`, `record_skill_used`, `record_receipt`; work item status reflects actual step |

Application submitted is **not** permit issued. Awaiting review/inspection requests
remain to-dos; `due_at` is the actual work day and the existing Central-midnight
snooze trigger keeps future work out of Today. No promotion writes. Fee paid at a
portal is not a client invoice payment or a job-money override: stage bookkeeping
with receipt; use existing financial tools only for their actual documented
transactions. Never change contract_value/collected_to_date/progress directly.

Later integration at `lib/workflow/construction-start.ts:129`: preserve existing
`kind:'permit',ref:'project:<id>:permit'` research dedupe. Research completion
calls a **typed internal adapter** `stagePermitBrowserHandoff(run, payloadV1)`
which creates/reuses the human work item under unique source trigger ref, with
Open browser proposal link. It does **not** call `startClaudeRun` or browser_open.
Extend the worker's write manifest only for actual handoff/work-item writes;
worker still has no browser task/session table privileges. A human opening that
proposal creates browser task/admission under their own signed-in identity.
Record runbook/task/work-item relationship for resume; resuming after login loss
starts a fresh private context, never repeats a submitted application. Existing
construction-start status and financials trigger remain unchanged.

## 12. Delivery phases, tests and release acceptance

All tests below are proposed, not claimed run by this planning task. Pure tests
use Node's test runner and mock CDP; DB tests use an explicitly disposable test
database, never live. Browser/security fixtures are run later by an authorized
coordinator in a capped isolated service, **not by this design sub-agent**.
No new next dev, next build/start, browser/server or live-service action during
planning. When implementation type checking is needed, one process only:
`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`.
Run named test files singly, not `npm test`; no unconstrained parallel browsers.

### Phase 0 — release contracts and hard boundaries

Ship verified staff thread/folder isolation, real cookie-only web sessions, strict
DB startup and browser-history partitions first (§4). Browser owner/staff panel access cannot
turn on before shared 0105 acceptance, regardless of Canvas renderer rollout.
Build schema 0100–0102 additively (vault/action schema may exist while disabled),
manifest/new login support, runtime pins, systemd/network setup spec, browser
profile/source checks and RPC contracts; no app control exposed. Implement/test
network containment and permission enforcement before operating a real site.
All flags off. Backup/restore fixture verifies encrypted state cannot decrypt
without independent key and restore defaults to off.

Named tests:

* `tests/browser-contract.test.mjs`: strict schemas, no extra principal/secret/
  selector fields, private/public observation union, shared handoff fixture.
* `tests/browser-run-profile.test.mjs`: owner+staff Ask web eligible, Telegram/
  worker/cron/orchestrated/legacy/inactive not; copied run IDs/capabilities,
  resumed operator sessions, with_mcp=false, global config and Express checkbox
  cannot restore raw browser/Bash/Read/other-model proxy. Check actual argv/env.
* `tests/browser-network.test.mjs`: parser/IDNA, userinfo, public→private redirect,
  mixed DNS/CNAME/rebinding/IPv4-mapped IPv6, metadata, same-host public aliases,
  app host/MCP/admin paths, resource-origin document navigation, ports/schemes.
* `tests/browser-roles-db.test.mjs`: real narrow SQL tries SELECT ciphertext,
  change task user/areas, approve/consume/share, clear files private tag and
  direct function abuse; all rejected as agent/worker/readonly/service as
  appropriate. Service may consume a genuine web approval, cannot create one.
* Existing `tests/db-roles-manifest-db.test.mjs`,
  `tests/db-roles-paths-db.test.mjs`, plus scan `--diff`: no unaccounted writes,
  PUBLIC execute/default grants or five-role generator gaps.

Gate: signed-off network namespace/proxy unit and sandbox run fixture, not just
Playwright route mocks. Actual isolated test checks no egress/CDP from host,
namespace scan, DNS/UDP/IPv6/QUIC bypass attempts, dropped interception closes
context, and secrets absent from journald/CLI/app error outputs.

### Phase 1 — smallest useful public browser

Enable `browser.enabled` for Joe pilot, then named staff with areas. Public
anonymous pages only, live view, desktop/iPad take-over, phone viewing, queue,
stop/idle/crash, generic review card. Vault/final dispatch/upload/download saves
remain off. Any final/unknown write is blocked; card says **“This version stops
here. Nothing was submitted. [Don't submit] [Close]”**. A disabled release feature
has honest copy, not a Submit button that appears to work. Staff parity (ordinary
public tasks) is part of this phase's acceptance, not an unplanned owner-only v1.

* `tests/browser-controller.test.mjs`: two-context/four-tab limits, FIFO offers,
  expired queue, one task/person, restore isolation, pressure/idle shutdown,
  frame ack/backpressure, lost CDP, old boot/epoch and command dedupe, no retry
  of unknown action. Simulated 137 latches off, no restart loop.
* `tests/browser-routes.test.mjs`: every GET/HEAD/Range/input/control/events route
  unauthenticated, wrong staff, removed ai/record area, disabled session,
  revocation during stream, CSRF/replayed bridge, duplicate input, frame token
  query, stale epochs, fourth viewer and bounded body/rate.
* `tests/browser-ui.test.mjs`: 360/820/1280 available-pane layouts, queue/threads
  coexistence, popout/redock, no private data in panelBus/store, focus/back/Escape,
  iPad keyboard resize, phone Take over explanation, keyboard-only public page
  controls and live-region behavior. Deterministic rendered component tests.
* `tests/browser-submit-guard.test.mjs`: Submit/Pay/Sign, Enter, hidden JS button,
  misspelled/non-English label, mutating GET, autosave, beacon, iframe/popup,
  arbitrary evaluate/network tools absent, future timer request after person
  leaves, unknown outgoing POST blocked. No “all GET safe” branch.

Coordinator manually checks actual Safari/iPhone/iPad and desktop transport via
real Cloudflare→TLS nginx; capture frame latency/bandwidth, disconnect expiry,
one controller only. Phone view and 48/56 px targets need real visual review;
this plan does not claim a screenshot inspection occurred.

### Phase 2 — saved logins and project files

Activate 0101 vault code; apply 0103 files provenance/recovery migration and all
reader guards **before** any private download can be saved. Enable vault,
private take-over, encrypted per-person restore, quarantine and human file save.
No final outside business dispatch yet. Login submit works only through direct
person approval; ownership/company financial rules still apply to all input.

* `tests/browser-vault.test.mjs`: AES-GCM known fixture/tamper/tag/AAD/wrong
  user/origin/revision/key, nonce uniqueness, rotation CAS/partial failure,
  missing key, old backup restore, deleted entry and delegated revocation.
* `tests/browser-private.test.mjs`: password reflected as text/encoded image,
  fake reveal control, console/network error, DOM/accessibility snapshots,
  stale prefill frame buffer, tracing/HAR, actor switch, cached screenshots,
  private profile restore. Assert no private bytes reach **any** model output,
  transcript/tool log/receipt, including after navigation/hand-back. Private
  contexts cannot be made public; no assumed regex secrecy proof.
* `tests/browser-files-db.test.mjs`: streamed size/magic/polyglot/bomb rejection,
  cross-project selection, hash change while upload pending, symlink/traversal,
  repeated save, crash before/after file/DB/rename, cleanup ownership; all file,
  thumbnail, signed-link, MCP and attachment/ingestion readers enforce
  browser_private. Backup/temp directory exclusions tested.
* `tests/browser-login-access-db.test.mjs`: staff private entry lookup guessing,
  shared credential per-user cookie isolation, cross-origin iframe/SSO/tenant
  confusion, changing role/site during fill, staff cannot edit Joe entry.

Gate: fill canary credential into isolated hostile fixture; inspect all output
channels for canary and transformed variants. Assert no page-derived private
model channel exists, stronger than searching one string. A separate ordinary
owner coding run sees only ciphertext/generic names when reading upload bytes
or file rows; only authorized human web streaming can decrypt. Restore isolation and
lost-key/manual-login path work; coordinator checks Save/Fill form copy.

### Phase 3 — exact final-step approvals

Enable final review execution and owner-grant extensions from 0102; apply 0104
settings/catalog/runbook seed. Make existing permission surfaces browser-aware
before enabling dispatch. Still no chosen city automation and no unattended use.

* `tests/browser-approval-db.test.mjs`: simultaneous staff/Joe decisions, duplicate
  clicks, stale screenshot/form/amount/file/payee/terms, revoked/expired/wildcard
  grants, mismatched target/run/context, generic approveGrant/Telegram routes,
  service direct SQL/function abuse, cross-staff review, payment staff takeover,
  one grant consumed once. Agent-declared nonbinding cannot downgrade Pay/Sign.
* `tests/browser-dispatch.test.mjs`: crash before approval, after commit, after
  token consume, before/after transmission and before receipt; unknown never
  auto-retries/refunds. Request pause TTL vs card expiry, late approval, bounded
  redirect chain and second mutation, lost person heartbeat, changed control
  epoch all fail closed. No atomic-remote-delivery fiction.
* `tests/browser-retention.test.mjs`: 24 h artifacts/quarantine, 30-day profiles/
  safe results, two-year audit, tombstone/unlink crash, no temp backup, stale
  cleanup disables fill/download admission.

Gate: sandbox payment/submit/sign fixtures with both owner/staff roles; no real
company charge. Joe confirms UI role matrix by using exact final cards on phone
while initiating staff/tablet remains present. Payment buttons state amount and
recipient; only a verified remote receipt yields Paid.

### Required regression and runtime gate additions by phase

Each named file runs singly against disposable fixtures. These extend, not
replace, the above tests and make every round-1 fix falsifiable:

| Phase / named file | Required cases |
|---|---|
| 0 `tests/browser-thread-access-db.test.mjs` | Staff A cannot list/load/search/count, read messages/attachments/folders, attach task/run, steer/stop/resume/start or infer B/Joe metadata by direct actions or restored panel IDs; ambiguous legacy ownership stays Joe-only; shared job does not share chat. |
| 0 `tests/browser-run-profile.test.mjs` | Actual generated CLI config/argv/stdio wrapper rendezvous exchanges; unknown SJC calls and each forbidden write/raw file/provider tool denied at registration and invocation; profile/task/person CLI stores separate; browser→operator and →other backend injection via unseenTranscript/summaries/attachments excluded. Test every browser-process DSN absent/owner-valued, env owner preceding file narrow, SET ROLE and real login; fail before tools register. |
| 0 `tests/browser-egress-gate.test.mjs` | Pinned Chromium/mitmdump addon/Unbound in authorized namespace fixture: origin 401/no credential leak, 407 denied; two contexts cannot exchange listeners; Host/SNI mismatch; popup first request and child iframe; preflight, redirect, worker/shared worker/SW/WebRTC/socket/QUIC/IPv6 bypass; live TLS/keepalive after controller kill, Fetch detach, gate crash, buffered final mutation, additive unauthorized second request; capture upstream **zero unapproved headers/bodies**. No pass based only on context closure. |
| 0 `tests/browser-outbound-data.test.mjs` | Already-approved resource origin receives encoded password image query/path/header/Referer attempts: all denied. Injected SJC address/license via nominal read GET, static query/unknown resource parameters fail without exact recipient/value release. CSRF token forwarded only bound endpoint; no app cookies. |
| 0 `tests/browser-roles-db.test.mjs` | Every catalog function called directly as each role, real session_user tests, no PUBLIC execute; service cannot approve/share/change principal/areas/provenance/decrypt without proof. Manifest bootstrap/generator/scan/harness fifth role matches exact grants; invoker narrow-write guard unchanged. |
| 1 `tests/browser-multiturn-db.test.mjs` | Turn 1 action FK survives turn 2; ended-run card can dispatch only via valid web review, old model capability rejected; successful wait vs crash vs Stop vs 5 min expiry; simultaneous resume/approval one winner, old grant/run never rewritten. Crash at each consume/transmission boundary produces unknown without replay. |
| 1 `tests/browser-routes.test.mjs` | Cookie-only rejects Bearer-only, absent/development secret blocks feature; JWT expires during SSE; sid logout/replacement/revocation fences devices. Swapped conversation, copied device secret with wrong sid, wrong stream generation/frame after reconnect/navigation, same seq different body; one of two devices hides vs both; Joe joins private view without control. Planned rotation preserves attendance; accidental lost stream pauses. |
| 1 `tests/browser-supervisor.test.mjs` | Serialized simultaneous admission, unavailable/incomplete accounting, outside-budget workload discovered; controller killed before latch write, marker survives reboot, ExecStopPost failure, OOM counter and persistent latch, root-only reset; pressure during executing action→unknown, queue reconciliation; temp/disk/connection/CPU ceilings; safe cleanup/reader while latched. |
| 1 `tests/panel-content-pane.test.mjs` + `tests/browser-ui.test.mjs` importing `tests/fixtures/ask-pane-host.mjs` (shared with Canvas) | 360/820/1280 + 420 dock at wide viewport and 1180 iPad landscape; content switching in both directions, composer retained, no duplicate rails, temporary expansion/back, popout/redock, Browser attention never steals Canvas and Canvas never steals takeover/review, Chat/Canvas switching preserves attendance/control; panel close/thread change/background pauses. |
| 1 `tests/browser-ui.test.mjs` | All §6 wireframes/states: start fields derived areas, grouped resource sites, In use owner/staff privacy, mid-form versus final, phone owner review/presence/countdown, one action, token sizes/44–48–56 targets, reduced motion, live accessible name, focus capture/review return and Pause live view behavior. |
| 2 `tests/browser-private.test.mjs` | Public→takeover permanently private **before first pointer/key/IME/Type it**; deceptive text box, focus swap, concurrent public observation/frame cancellation and handback; restored state starts private. Delegated staff account-settings/reveal/plaintext/image/encoded reflection, download/export/upload all denied; unsupported adapter refuses, fresh per-person login separate. Joe-only view still absent from every model channel. |
| 2 `tests/browser-vault.test.mjs` | Cross-purpose/record/action/file substitution, JCS byte fixtures/domain prefixes, wrong data/wrap AAD, key counter limits, CAS rewrap/partial rotation/restore, plaintext provisioning path absent from host+app backup inventory. |
| 2 `tests/browser-file-validator.test.mjs` | Valid malicious PDF actions/JS/embedded payloads/forms, polyglots, decompression/pixel/page bombs, malformed parser input, sanitizer/scan crash/timeouts/stale signatures; reject without raw preview/save; original and sanitized hashes distinct, rebuilt PDF has no active content; bounded no-network/no-key sandbox. |
| 2 `tests/browser-files-db.test.mjs` | All actual read/export/signed/base64/text/pages/mobile/portal/thumbnail/attachment/ingestion variants; overwrite/tag clear/trash restore preserve provenance, purge old cached exports; cross-UID crash at stage/DB/publish/commit, repeated-save changed body, reader authorization HEAD/Range and closed task; feature off/controller down/rollback/backup restore retains compatible reader; shared-secret artifacts always Joe-only, only separate fixed-schema safe output can be released. |
| 3 `tests/browser-approval-db.test.mjs` | Every company submit/sign/pay plus “nonbinding”/draft company request staff-denied, staff direct click cannot bypass; personal own-login/contact and named delegated login-only self-approvals. Grant/token/audit consume concurrent and atomic; wildcard/wrong snapshot rejected, original run preserved, absent either person disallows dispatch. |
| 3 `tests/browser-audit.test.mjs` | Approval and consume evidence durable with grant use; failed chain/checkpoint write blocks gate; mutate/delete/truncate/restore old DB detected against independent sink; retained-boundary checkpoint, key rotation/verifier, signed consume receipt bound to flow; no best-effort logging-only execution. |

### Phase 4 — generic permit handoff, then separately a first-city adapter

Ship generic handoff/runbook and preserve existing research/construction flow.
`tests/permit-browser-handoff-db.test.mjs` proves one human to-do/trigger ref,
no browser launch from worker/research, signed+deposit construction trigger
unchanged, future due_at stays snoozed, submission≠issuance, receipt provenance,
ordinary financial ledger unchanged. `tests/browser-adapter.test.mjs` validates
adapter version, fixed controls, endpoint/request manifests, private blind fills,
final-step boundaries and portal-change invalidation. A first-city selection
later adds a reviewed adapter fixture and sandbox/manual acceptance under a
separate brief; no hidden first-city prerequisite for phases 1–3.

## 13. Operations, flags, rollback and Joe's deployment work

### Observability

Structured **content-free** events: admission/queue, runtime start/stop/crash,
network blocked, private entered, fill attempt/success, control transfer, review
created/invalidated/denied/expired, approval/grant consumed, request dispatched,
result confirmed/unknown, file committed, ciphertext/profile purged. Include
correlation task/run/action/command IDs, boot ID, safe code and durations.
Do not put full URLs, usernames, text, bodies, passwords, image base64, tokens
or cookie headers in stdout/journal/analytics/traces. Test failure paths too.
User sees the relevant durable outcome; owner sees redacted event history through
Open review; staff only own. No viewer/input recording “for debugging.”

Internal health returns version/browser revision, enabled/latch status,
contexts/tabs/queue count, slice MemoryCurrent/pressure, frame drops/bytes,
auth-check failures, block counts, unknown action count, cleanup lag, profile
save failures; no task titles/sites/actors in unauthenticated metrics. Alert Joe
on OOM, repeated crashes, failed cleanup, key mismatch or unknown final result
with one deduped incident per task/action; existing notification routing, no
new client-facing sends. Unknown result remains a visible person task, never a
worker retry. Audit/receipt calls use safe IDs/results, not private page contents.

### Flags and activation

Owner-owned app settings (no narrow writes), default false:
`browser.enabled`, `browser.staff_enabled`, `browser.vault_enabled`,
`browser.files_enabled`, `browser.final_steps_enabled`,
`browser.permit_handoff_enabled`. Optional named-user pilot allowlist and global
resource/admission latch live in owner-only configuration. Environment
`SJC_BROWSER_ENABLED=0` is an overriding emergency off switch, not a model input.
Service rechecks effective flags at admission/every action; live kill switch
invalidates controls/approvals and closes contexts within 5 s. Staff flag off
closes only staff tasks. Vault flag off prevents restore/fill and closes private
contexts; final-steps off cancels undispatched business submit/pay/sign/upload actions,
never replays them later. Personal or named delegated login-only Sign in in Phase 2 has its own strictly typed
direct-person approval path; it cannot authorize a business write or charge.
Phase 1 permits neither login submits nor any other outside writes.
File flag off denies new download/upload/save; existing authorized project files
still readable by people. No historical backfill of browser profiles/tasks.

Migration delivery rule: `db/migrate.mjs` applies all pending migration files;
there is no apply-through-number switch. Either ship only that phase's available
migrations, or apply all **additive** 0100–0105 up front and keep later behavior
flags off. Shared 0105 ownership/privacy and real-session prerequisite must pass before
any Browser panel activation; coordinate its migration once with Canvas. No hidden dependency on
Canvas rendering or Canvas flag. Each phase's role/trigger/read guards precede
its feature flag. Recheck all branch migration allocations before merge.

### What Joe must do to deploy (future, not performed here)

1. Confirm deployment readiness against the already-decided role matrix and privacy limits; select a pilot
   owner task and one staff account with ai + relevant areas. No first city
   decision required. Schedule a short rollout window; check memory/CPU headroom
   and `pgrep -af next` before any authorized capped verification build.
2. Apply additive migrations 0100–0105 with feature flags off; 0105 privacy
   acceptance precedes any Browser panel access; bootstrap the new
   non-login Linux user/group and `sjcos_browser` DB login with random password,
   apply manifest grants, run isolated role tests. No service DSN owner fallback.
3. Root installs reviewed namespaces/request-aware TLS gate/Unbound/firewalls,
   private browser-only CA trust, common account cgroup child slices and independent
   persistent-latch supervisor; verifies every Joe workload's cgroup. Also provisions
   independent append-only checkpoint sink and verifier. Installs the new system
   units, root-owned runtime directory/socket groups, private tmpfs limits
   and Chromium sandbox dependencies. Explicitly verify namespace-only CDP,
   socket group and no host/public listener. Nothing added to tunnel for CDP.
4. Install exact runtime lockfile + Chromium 1248 in private service cache;
   provision LoadCredential database/bridge/vault/audit/file-reader keys and gate CA, separate offline key
   escrow, directory permissions, backup exclusions and restore test. Record
   nonsecret versions/key IDs, never paste key bytes into Ask or git.
5. Update deployed **TLS** nginx with the events location, validate config and
   owner-authorize reload; set Cloudflare cache bypass and verify real Tunnel
   streaming. Do not overwrite certbot TLS settings with the pre-TLS example.
6. Owner-authorize normal app deploy/restarts if needed. Coordinator alone uses
   a separate SJC_DIST_DIR production build, side-port service in MemoryMax=8G,
   checks and stops it in the same turn, without touching live `.next`.
   This planning task does none of those operations and never calls systemctl.
7. Enable phases in order; public owner+staff pilot first, then vault/files,
   then final approvals. Confirm real device layouts, all guards, resource
   measurements and cleanup. Keep later flags off until each gate passes.

The implementation handoff includes exact installation files/commands and
measured idle/one-user/two-user memory; theoretical caps alone are not release
proof. If sandbox, namespace or Cloudflare stream checks fail, keep disabled,
report the failing gate, and retain ordinary Ask/project operations.

### Rollback and incident recovery

First turn browser.enabled off in owner settings/emergency override: revoke
capabilities, stop streams/input/new dispatch, close contexts, expire pending
reviews. An executing/possibly transmitted action becomes unknown, preserved
for human reconciliation; don't label it cancelled or refund company money.
Then owner may stop **only the new browser/gate execution units**, keeping the
bounded encrypted-file reader, cleanup and audit verifier baseline running, remove nginx browser
location after streams drain, and roll back app code with browser source/profile
compatibility protected (old runner must not revive optional Playwright hook).
Do not remove existing security file-read guards while private files remain.
Keep additive tables/role restrictions/encrypted vault and saved project files;
no down migration deleting audit or signed/submitted evidence. Keep keys needed
for retained encrypted data/backup restore. Re-enable only through a new attended
admission; old tokens, contexts and approvals stay invalid. Revocation/compromise
also requires Joe to revoke external-site sessions/change affected logins; SJC OS
cannot force a city portal to forget a copied credential.

## 14. Remaining business decisions and known limits

No new business question is introduced; no business answer blocks the generic build. Decisions 1–8 govern this
plan. Decision 5 is settled: saved logins are shared **per site with named staff**,
default Only me; Joe's share sheet says “Let these people use this login” / “They
can sign in without seeing the password.” Decision 6 is settled: **Joe approves
every final step committing the company**, even “nonbinding” staff requests and
direct take-over clicks. No staff-signing or company-submit authority is being
asked for in v1. Required areas are derived, not a Joe setup chore.

| Later question | Recommended answer |
|---|---|
| Which permit portal first? (already deferred by decision 4) | City with the next real application, after generic phases 1–3; one reviewed adapter and sandbox/manual rehearsal first. |

Known visible limits: no unattended/Telegram browser; phone views/approves but
remote input needs iPad/computer; generic authenticated forms are filled by the
person using Your answers; delegated staff login works only with reviewed safe
controls and outputs, otherwise Joe finishes or staff use their own authorized
account; no arbitrary model private-page vision; no password reveal/export;
WebSocket/pinned-TLS/unknown request portals may remain unsupported. Read-only
Phase 1 blocks even POST search. The reviewed TLS gate, session/thread prerequisites,
common resource hierarchy and independent audit sink are deploy gates, not claims
that existing infrastructure already provides them. PDF filing stays off if the
bounded mandatory sanitizer/scanner gate cannot be met.

Planning verification: reread source anchors and all reviews/owner decisions,
checked plan consistency and file ownership only. No code, database, service,
browser, server, build, tsc or test suite run by this revision. This plan alone
is staged/committed; real-device, fail-closed network, file sandbox and resource
acceptance belong to the authorized coordinator. Proposed tests are not claimed
as passing.

## Appendix — Round-1 fixes

Review item numbering follows each review's “Required to reach 10” list.
All listed tests are required future acceptance, not results claimed by this plan.

| Lens + item | Changed sections / resolution |
|---|---|
| Design 1 | §6.2 shared host adoption, §6.3 screens, §12 shared fixtures |
| Design 2 | §1 Words, §6.3–6.4 Operator name and defined controls |
| Design 3 | §3.3, §4.1, §6.1 attendance survives Chat/Canvas |
| Design 4 | §6.3 360/420 Chat status/events/outcome; §10.2 RunReview |
| Design 5 | §6.3 start/Sites sheet/resources, §8.1, §10.2 task creation |
| Design 6 | §1, §6.3, §6.5, §7.1–7.2 mid-form versus final and Phase 1 |
| Design 7 | §5.2, §6.3–6.4 private picker, Your answers, upfront limit |
| Design 8 | §6.3, §7.3, §10.2 Joe phone deep link/review/presence |
| Design 9 | §5.2, §6.3–6.4, §7.2, §14 decisions 5–6 implemented |
| Design 10 | §6.3, §6.5 all missing states, popup and pending-review idle |
| Design 11 | §6.3–6.4, §8.2 owner sharing labels/file names/device instruction |
| Design 12 | §6.2–6.3 one action/history/site/1180 iPad/sheet chrome |
| Design 13 | §1, §6.2 app tokens 13/14/17 and targets 44/48/56 |
| Design 14 | §6.1, §6.5 accessible name/motion/view pause/capture/focus |
| Design 15 | §3.3, §4, §6.3 Joe In use list and explicit join |
| Engineering 1 | §4.1, §9, §12 ownership prerequisite and thread-access tests |
| Engineering 2 | §3.4, §7.3, §9.1, §12 immutable task_runs/multi-turn recovery |
| Engineering 3 | §3.2, §4.2, §10.1, §12 exact tools/rendezvous/history |
| Engineering 4 | §7.3, §9.1–9.3, §10.2, §12 complete SQL functions/atomic grants/roles |
| Engineering 5 | §3.2, §7.1, §8.1, §12 plaintext request gate/interception owner/no proxy auth |
| Engineering 6 | §4.1, §6.1, §9.1, §10.2, §12 full web/control/frame/device contracts |
| Engineering 7 | §3.3, §12–13 cgroup accounting, supervisor and persistent OOM latch |
| Engineering 8 | §8.2, §9.3, §12–13 actual file paths/cross-UID commit/rollback reader |
| Engineering 9 | §6.2, §10.2, §12 shared pane implementation/fixture prerequisite |
| Security 1 | §5.2, §6.4, §7.2, §8.2, §12 delegated-secret mode; no staff pixels/exports |
| Security 2 | §5.2, §6.1, §10.2, §12 permanent private before every manual input |
| Security 3 | §4.2, §8.3, §12 browser history never upgrades to privileged runs |
| Security 4 | §7.1, §8.1–8.3, §12 exact outbound values/provenance/recipient authorization |
| Security 5 | §3.2, §7.1, §8.1, §12 independently fail-closed plaintext request gate |
| Security 6 | §4.1, §6.1, §9.1–9.2, §10.2, §13 concrete cookie/session/device binding |
| Security 7 | §4.2, §9.2, §12–13 strict DSN/actual login checks for every process |
| Security 8 | §5.1, §7.3, §8.2, §9.1, §12 wrapping AES-GCM and purpose-specific canonical AAD |
| Security 9 | §7.3, §9.3, §12–13 authenticated audit chain/independent checkpoint/verifier |
| Security 10 | §8.2, §12 mandatory bounded isolated file sanitizer/scanner gate |
