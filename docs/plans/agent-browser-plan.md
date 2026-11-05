# In-app agent browser — implementation plan

Status: design for review; no implementation or deployment authorized by this file.
Authoring baseline: `t3/cf34c1be`, `cf3057285888d754205f1bab22155da22525dcbe`, 2026-11-05.
Normative owner decisions: `_context-agent-browser-canvas.md`, “Joe's decisions.”
This plan owns the browser; `ask-canvas-plan.md` owns Canvas. Neither feature depends
on the other shipping. Technical names below are implementation names, not UI copy.

## 1. Joe's request and the result

> how feasable is in app browser use when using the web version? id like to be able
> to interact with the browser to fill out account info etc when needed. Id use this
> so the agent can pull permits and perform other functions. I'd like to have the
> other features of the claude and chatGPT apps as well like the canvas where it can
> draw diagrams etc

Joe has decided: **Joe and staff can use it; background agents cannot. Logins go in
an encrypted vault and people can take over for 2FA or CAPTCHA. Always stop before
final Submit / Pay / Sign. Company payments require Joe's owner grant. Pick the
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
| Browser | Outside website being used for this Ask task |
| Open browser | Start after the person confirms the task's sites |
| Allowed sites / Add a site | Exact websites this task may reach; approval belongs to the person |
| Agent is working / Paused | Whether agent actions can run |
| Take over / You're in control | Acquire exclusive mouse and keyboard control |
| Give back to agent | Stop personal input, clear private fields, explicitly resume |
| Stop browser | Close this task's browser, preserve already saved files |
| Saved logins / Save a login / Fill login | Vault list, entry form, server-side fill |
| Only me / People Joe picked | Login's visibility, never “shared profile” on screen |
| Private — login or account details | No page content is being sent to the agent |
| Ready to submit / Ready to pay / Ready to sign | Final-step review card |
| Submit once / Pay $125.00 once / Sign once | Exact action approved now |
| Don't submit / Don't pay / Don't sign | Denial; no ambiguous “Dismiss” default |
| Waiting for Joe / Open review | Staff's company-money or company-commitment step |
| Submitted / Paid / Signed / Check the site before trying again | Confirmed result versus uncertain delivery |
| Saved to project files / Open file | Confirmed local file save |
| Continue / Cancel / Try again / Close | Local UI actions; Continue never authorizes an outside final step |

No “broker,” “lease,” “principal,” “CDP,” “capability,” or “egress” in product copy.
Use existing `--paper`, `--paper-2`, `--ink`, `--ink-3`, `--ai-soft`, `--ai-2`,
`--flag`, `--rule` tokens. Flag states have an icon **and** a word. No color-only
warnings. Office controls are at least 48×48 CSS px, touch toolbar controls 56 px;
body text 17 px, labels at least 14 px. Long sites wrap to two lines with full site
available to assistive technology; the trusted origin label is never page-provided.

## 2. Evidence and decisions that follow from it

Paths/lines refer to the baseline; new paths in later sections are proposals.

| Existing implementation | Consequence |
|---|---|
| `scripts/run-claude-agent.mjs:935–944` conditionally loads `mcp/playwright-mcp.config.json` for operator runs and preapproves all Playwright tools | Remove this hook for in-app runs; a file appearing must not silently restore unrestricted browser access. Never attach to Joe's personal Chrome. |
| `mcp/playwright-mcp.config.example.json:6` uses `@latest`, loopback :9222 | Example is a development precedent, not a safe production policy. Replace documentation/example in the implementation. |
| `lib/authority/run-profile.mjs:1–118`; `lib/dev-agents.ts:646–705`; runner `:840–910` | Business profile alone does not distinguish staff in Ask from unattended runs. Add trusted launch provenance and an attended browser profile; do not enable all business agents. |
| Runner `:976–1005` gives operator runs the app environment and owner DB login | Browser-enabled Joe runs must also be restricted; do not expose the vault key or raw CDP to an owner model with Bash. Ordinary owner coding runs keep their current behavior but get no browser. |
| `lib/actions/dev-agents.ts:125–151` checks own run for staff; `:167–195` only polls owner grants for Joe | Reuse run ownership; add browser state and staff-visible pending final-step cards independently of owner-grant polling. |
| `mcp/interact-mcp.mjs:54–72,107–151` autoallows some tools and persists inputs for general permissions; `lib/agent-interactions.ts:91–115` includes untagged interactions | General Allow is not an outside-site approval. Browser cards have mandatory run/session/action IDs, never untagged fallback and never secret inputs. |
| `PanelDock.tsx:15–22,66–104` has 560/880 px **dock** breakpoints; `PanelHost.tsx:25–33,155–185,231–273` uses a mobile sheet below 1024 viewport px | Do not add a permanent fourth column or pretend Workbench is still mounted in the dock. Browser is an explicit Ask content pane. |
| `PanelWindow.tsx:108–119` intercepts app links; `PanelChat.tsx`, `useAgentChat.ts` own active-run state | Browser actions use buttons, not intercepted links; popout/redock reconnects by run ID. |
| `WorkbenchPanel.tsx:15–19` is the existing live record view; `GrantCard.tsx:15–30`, `RunReview.tsx:10–29` preserve approval outcomes | Keep record view intact; add dedicated browser cards and durable outcomes instead of repurposing Workbench or transcript HTML. |
| `AssistantMarkdown.tsx:3–4,39` intentionally refuses images/raw HTML | Leave it safe. Frames/screenshots render only in authenticated first-party browser components. |
| `lib/permissions.ts:61–78,110–119,132`; `lib/dal.ts:70–97` | Staff need `ai` **and** every task area. Areas grant visibility, not authority. `/settings` is owner-only; personal saved logins need a panel route. |
| `owner-grant-types.ts:13–49,94–130`; `owner-grants.ts:117–131,136–214,255` | Existing wildcard run grants and target-only checks cannot satisfy always-ask or immutable browser actions. Extend exact browser action binding, not a prompt reminder. |
| `lib/backup/crypto.ts:1–47` uses age or CBC/PBKDF2 for backup artifacts; `lib/gmail.ts:57`, `lib/mailbox.ts` use existing token configuration | Do not copy backup CBC into a record vault; use authenticated encryption with separate keys. Existing email token storage is not a vault implementation. |
| `lib/file-serve.ts:109` sandboxes HTML; `lib/upload-store.ts:62–108` exports `storeBuffer`, `persistBlob` is private and uses its own DB connection | Use existing files after a transactional save adapter; don't call the private helper or invent atomicity it lacks. Browser review images stay out of general files. |
| `deploy/nginx-sjcos.conf:27–38,54–66` uses Connection empty and already has an unbuffered MCP SSE location | Use SSE + POST for live view; add a separate unbuffered browser-events location. No WebSocket upgrade changes needed in v1. |
| `deploy/sjcos-tunnel.service:3–9` routes public host through nginx :443 in Cloudflare's dashboard | Add no CDP/tunnel hostname. Verify the real TLS nginx location, not just the pre-TLS example. |
| `deploy/db-roles.md:7–29,136–159`, manifest, `scripts/db-roles-sql.mjs:19` | Narrow logins cannot approve or see secrets. New browser tables require manifest entries; generator currently knows only four narrow roles. |
| `lib/workflow/construction-start.ts:129–136`; `lib/agent-runtime/claude-runner.mjs` web-research exception | Today construction-start enqueues permit **research**, not portal submission. Keep research unattended, stage an attended task later. |

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

Ran the cached **0.0.81** CLI's `--help`, which launches no browser. It supports
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
out-of-order mutation sequence. The stdio MCP process gets a task-bound opaque
capability via inherited private FD, not command-line arguments or model-visible
environment; it has only the wrapper's permitted methods. It cannot mint web
approvals. Web bridge signing material is not put in browser-enabled CLI env.

A privileged one-shot setup unit creates namespace/veth/firewall; the runtime
has no CAP_NET_ADMIN, no sudo and no writable unit/CA/firewall files. Outbound
namespace traffic is **default deny**, including DNS, IPv6 and UDP. It can reach
only the dedicated validating HTTP CONNECT proxy/DNS resolver, not host services.
Run proxy as a separate UID under the same feature resource slice. Proxy checks
exact task origin for every connection and resolves/pins destination addresses;
request interception supplies a controller-created per-context proxy credential set through the pinned
Playwright context proxy options (integration-test CDP support),
not model-controlled headers. It cannot be used from a different context. Strip
internal auth at the proxy. TLS remains end to end; no local MITM CA. CDP request
guards handle method/body approval; proxy+firewall provide independent containment.

Security boundary includes trusted service binaries, app authorization and the
OS; it does not resist root, Joe deliberately running arbitrary owner code on the
host, or a compromised approved outside site stealing a login it receives. Do not
claim the vault protects against its destination website. Browser-enabled turns
remove code/shell access (§4), so page injection cannot casually use Joe's normal
operator tools to read the vault or disable guards.

### 3.3 Proposed unit limits and admission

The feature's `sjcos-browser.slice` caps controller + Chromium + proxy together:
**MemoryHigh=2G, MemoryMax=3G, MemorySwapMax=0, CPUQuota=150%, TasksMax=256**.
Controller Node `--max-old-space-size=256`, proxy 128 MiB soft budget; aim ≤2 GiB
steady-state with two contexts. `Nice=15`, `OOMPolicy=stop`, `KillMode=control-group`,
`TimeoutStopSec=15`, `Restart=on-failure`, `RestartSec=10`, start limit 2/10 min.
A cgroup OOM/exit 137 latches browser admission **off**, so systemd restart cannot
launch another Chromium; recovery is Joe's explicit action after inspection.
Shared account's 24 GiB/8-thread limit remains the global ceiling even if a new
system UID is used: deploy adds this slice to the host's resource accounting;
never treat a different UID as free capacity. No automatic changes to live services.

Unit hardening: `User=sjcos-browser`, restrictive UMask 0077, NoNewPrivileges,
ProtectSystem=strict, ProtectHome, PrivateTmp, RuntimeDirectory, explicit writable
state/tmpfs paths, core dumps disabled, no unnecessary device access/capabilities.
Validate Chromium's user namespace sandbox with these restrictions; do not add
blanket seccomp restrictions that break it and then disable its sandbox.

Global admission checks actual host headroom plus Joe's cgroup, before first
launch and before second context. Require ≥5 GiB available memory and total
relevant workloads ≤18 GiB on this 24 GiB box (reserve browser 3 + safety 3).
Cannot read metrics = no new context. At browser MemoryCurrent >2.5 GiB for 10 s,
pause work and evict idle context first; persist eligible state, close browser
if pressure persists. At host/account ≥21 GiB, suspend new commands and close
contexts within 5 s, even if a person is connected; show resource failure copy.
Do not kill/restart any other app. No resubmission in pressure recovery.

Queue: FIFO by explicit admission request, one entry/person, max eight entries;
Joe sees queue position, no staff identity/job details. No queue jumping by role.
A grant waiting for Joe does not reserve capacity indefinitely. Queue entries
expire after 5 min; admission offer lasts 30 s and requires the person still
present. UI heartbeat every 5 s; no initiating-person visible view heartbeat
for 15 s pauses the agent and removes network mutation permission. Any ongoing
read is cancelled; no final step starts with >5 s-old person heartbeat. Staff
waiting for Joe still need the staff person present to execute.

No input/tool progress for 5 min closes context; last 60 s show warning. Viewer
frames/polls alone do not reset idle. No contexts for 60 s closes Chromium but
leaves the tiny controller ready on its socket. Controller housekeeping runs
independently of awaited tools every second. No timers/cron may open a context.

### 3.4 Failure/recovery and the state machine

Session states: `queued → starting → active ↔ paused → closed`; `starting/active/
paused → failed`. Active control is separate: `agent | person | none` with a
monotonic `control_epoch`. Privacy is `public | private`; approval is a separate
immutable action record. Never conflate “agent waiting” with a CLI tool call that
must remain open for 24 hours.

On lost CDP, child exit, controller boot ID change, socket loss, permissions
revocation, flag off or runner death: revoke capabilities, fence epochs, stop
network dispatch, mark live actions (§7) expired/unknown as appropriate. Close
all contexts. On controller restart, reconcile DB sessions from earlier boot
IDs as failed **before** accepting work. Read-only page reload requires a person
to choose Try again; restart never repeats clicks, uploads, submits or payments.
Crash before state-save loses latest cookies, not vault entries; say “Sign in
again.” Don't restore Chrome's “last tabs.” A corrupted encrypted saved state is
quarantined by hash/key version, then discarded with a visible login request.

## 4. Run admission and per-action authorization

Add a third run profile **`browser`**, based on business restrictions but also
removing Read/Glob/Grep, NotebookRead, Task/Agent, all shell/edit, WebFetch and
WebSearch, raw file reads, arbitrary MCP registration and code execution tools.
It gets the browser wrapper plus an explicit SJC OS tool allowlist appropriate
to task areas. In particular no credential-returning user tools, raw file/text
fetch tools in private mode, provider proxy, arbitrary HTTP, terminal/delegation
or tool that starts another operator. Do not rely on name prefixes for this
allowlist. `with_mcp=false`, bypass/auto and “Express permission” never weaken
browser guards. Run bounds initially 20 min active model work, 60 turns, existing
business cost cap; approval waits persist and finish the turn, not a busy CLI.
Resumption is a new, presence-checked browser turn on the same paused task.

Add server-set `dev_agent_runs.launch_source` enum
`ask_web | ask_voice | telegram | business | worker | orchestration | unknown`,
`browser_task_id uuid NULL`, and profile CHECK extension, plus all TypeScript RunProfile unions/row decoders and
DB-role selection branches. Browser profile always selects the narrow agent
login for its SJC tools, including Joe; only service has the browser login. Existing rows backfill
`unknown`, never infer attendance from a nonnull principal. Only authenticated
Ask web UI POST can set `ask_web` + an expiring attendance record; trusted internal
start options are not accepted from message/tool JSON. In v1 browser requests
from any source except `ask_web` return `BROWSER_ATTENDED_ONLY`, including owner
Telegram runs, cron/business, voice delegations, worker and terminal/remote MCP.
A staff Ask turn remains restricted; browser profile is not an upgrade to operator.
Other model backends show “Browser works with Claude in this version. Start with
Claude”; do not silently route Hermes/Telegram gateway identity to an owner context.

`lib/authority/run-profile.mjs` defines and tests `browserEligible()`;
`startClaudeRun()` stores trusted source, current user and task FK; runner rereads
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
business data. Owner picks required areas during site/task setup; model proposals
cannot shrink them. Origin-specific constraints can add, never remove areas.
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

### 5.2 Visibility and filling

Each entry belongs to one SJC OS user. Staff creates/updates/deletes only their
own entries. Joe manages his entries and can grant named staff **use** of selected
company entries, with required areas. Joe can disable delegated access, but does
not get a “show staff password” feature. Staff never enumerates another user's
private entry; list results contain label + exact site, visibility, last-used,
never username/password/cookies. Joe-owned company credentials shared with staff
get per-staff saved state. Delegated use grants effective access to that outside account. There is no
SJC OS password-reveal feature, but an approved site itself may expose account
details to someone permitted to operate it; do not promise credential secrecy
from an authorized human at the destination. Joe should delegate only accounts
whose effective access that person may hold. The model secrecy guarantee remains
strict and independent of that human visibility.

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
2. Before decrypt/fill, service atomically enters private mode, pauses tools,
   stops/acks screencast, drains/drops every pending frame, detaches model
   observers and invalidates prior observation handles. It suspends page reads,
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
5. **V1 strict guarantee:** once a vault password or personal login/account
   secret enters a context, that context is private for its remaining lifetime.
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
The service rejects attempts to type into password/OTP/card/account-secret fields
via ordinary `browser_act`; it redirects to Take over. Don't solicit secrets in chat.

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

Events: `state`, `frame {seq,control_epoch,document_epoch,viewport,width,height,
jpeg_base64}`, `action`, `file`, `reauth`, `closed`. Frame seq is connection-local;
no persisted replay frames or Last-Event-ID recovery. Reconnect fetches fresh
state/new frame, then requires explicit Resume to permit agent work again.
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

Control is a server record `(person_device_id,control_epoch,expires_at)`.
Take over acquires its exclusive lock, fences the agent, cancels not-yet-dispatched
commands, waits for in-flight command completion ≤2 s; if not cancellable, freeze
and show “Finishing the last step…” until its outcome is known. Do not let person
and agent race the same click. Control heartbeat 5 s, expires after 15 s;
expiry sets control none and pauses, **never returns to the agent automatically**.
Joe may explicitly replace a staff controller after warning; staff sees “Joe is
in control.” Device switching by the same user also requires Take over here.
Only that device's signed control token and monotonically increasing input seq
are accepted. Server dedupes seq; outdated frame/epoch => 409 and no click.

Input forwarding: image-to-viewport coordinate mapping accounts for letterboxing,
zoom and devicePixelRatio. Send pointer down/up/move (coalesce moves 30/s), wheel,
key down/up, and IME committed text using CDP Input APIs. No raw JS evaluation,
clipboard read/write, file paths, developer shortcuts or navigation to `chrome:`.
All non-move input checks authority/epoch/presence. Rate ≤60 input events/s,
text payload ≤4 KiB; secrets routed through a memory-only endpoint with body
logging disabled. Escape exits local keyboard capture; the remote Escape key is
an explicit control. Focus stays visible; screen-reader users get a **Page
controls** list for public content or reviewed adapter controls, never raw
credential field values. Browser image is labeled remote content, not an iframe.

Give back to agent releases person lock, invalidates pending approvals, clears
sensitive in-page fields where safe, persists only encrypted eligible state,
and asks **“Let the agent continue?” [Continue] [Keep paused]**. Continue creates
new observation/control epoch; private-mode restriction persists. Closing or
hiding a pane drops presence; returning doesn't auto-resume. Stop browser cancels
queue/actions, closes context, revokes fill capability and retains saved files.
Back/Close pane changes local view, not browser history; browser history controls
live in the toolbar and obey site/submit guards.

### 6.2 Placement; shared contract with Canvas

Add `components/panel/AskContentPane.tsx` as the single host for **Browser** and
**Canvas**. Browser implementation provides a registry entry and typed snapshot
`{kind:'browser',task_id,run_id,status,attention,label}`; Canvas provides its own.
Selection is per local panel device, not a model-created URL or blob in Markdown.
The host is implemented once, coordinated with Canvas author; neither overwrites
the other's state. Browser data contracts/routes/components belong to this plan;
the host can start with just Browser if Canvas hasn't shipped. No changes to
`AssistantMarkdown` and no invented shared migration.

Discovery: Ask composer tool menu **Open browser**; an agent's proposed task
renders **“Use the browser for this task?” [Review sites]**. The person reviews
sites/task/record, then Open browser. Active run gets a persistent **Browser ·
Agent is working / Needs you** chip in chat header and a compact event card with
Open browser. New browser on another conversation shows **“You have a browser
open for {task}. [Open it] [Stop it and start this]”**. Other people's tasks are
never offered to staff. Browser remains reachable after a turn ends through the
same task card and RunReview, until its idle limit closes it.

Layout uses **available Ask pane width**, not whole-screen width. At <720 px,
Chat / Browser / Canvas (when available) replaces content using one pane; Queue
and Threads retain their existing controls, rather than crowding all choices
onto one row. At ≥720 px content width, show chat (min 320) beside browser (min
380); temporarily collapse queue/thread rails in expanded Browser mode. At
1280 viewport when dock is only 400, Open browser expands the Ask workspace over
the app view to 960 px with **Back to app**, not a 300 px remote viewport. Below
1024 viewport, reuse PanelHost's modal sheet, expanded to `100dvh` for Browser.
Popout/redock reconnects by task ID with new device authorization; server control
doesn't move via BroadcastChannel. Frames/secrets/control tokens never enter
panelStore, localStorage, history URLs or panelBus.

### 6.3 Wireframes (all labels use the Words table)

**360 px phone, public viewing; no phone pointer/keyboard take-over in v1.**
View, scroll the local image, zoom, stop and approve cards work. Remote scroll
uses explicit Page down/up controls through the read action guard. Login/2FA
that requires input shows the tablet/computer instruction. Native iOS app is
not changed; use the authenticated web panel in Safari. Phone approval is still
possible while a computer/tablet controls the browser; payment is Joe-only.

```text
┌──────────────────────────────────┐
│ ‹ Chat        Browser        ⋯   │ 48 px, local Back
│ city.example                     │ trusted label, wraps
│ Agent is working          Stop   │
│ ┌──────────────────────────────┐ │
│ │   live remote image          │ │ contain; 328×205
│ └──────────────────────────────┘ │
│ [Zoom] [Page down] [Page up]      │
│ Take over on a tablet or computer│
│ [Open on another device]         │ authenticated link, no token
│                                  │
│ Ready to submit                  │ card pushes below image
│ Lake bath · Permit application   │
│ [Review image]                   │ opens protected full-screen image
│ To: city.example                 │
│ Address: …  Files: plan.pdf       │
│ Fee: none shown                  │ never imply $0
│ [Submit once                   ] │ sticky in review sheet only
│ [Don't submit                  ] │
└──────────────────────────────────┘
```

**820 px iPad portrait**, full-screen Ask sheet, one pane; landscape gets split
only if ≥720 px content remains. Safari soft keyboard shrinks image using
visualViewport; toolbar stays above safe-area inset. Tap acts remotely only in
You're in control, one finger taps/clicks, two-finger scroll maps to wheel; local
pinch zoom does not click. No swipe-only controls, hover-dependent actions or
orientation requirement. Bluetooth keyboard/IME supported; hardware Tab remains
within remote page only while explicit keyboard capture is on.

```text
┌─────────────────────────────────────────────────────────────┐
│ ‹ Chat           Browser                       Close        │
│ city.example · Lake bath                                    │
│ You're in control                  [Give back to agent] [⋯] │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 1280×800 remote page, scaled; tap targets zoomable        │ │
│ │ Private — login or account details                      │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [Keyboard] [Page controls] [Zoom]          [Stop browser]     │
│ [Saved logins]  “Your password isn't sent to the agent.”      │
│ ┌── Keyboard / Page controls sheet ────────────────────────┐ │
│ │ [Tab] [Shift Tab] [Enter] [Escape] [Close keyboard]        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**1280 px desktop**, expanded workspace, app navigation still recoverable.
Within 960 px content, allocate 340 chat + 620 Browser including gutters. A full
1100 px popout can allocate 360 + 740. Never squeeze four permanent columns.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Ask · Lake bath                       [Back to app] [Dock back if popout]│
├───────────────────────────┬──────────────────────────────────────────────┤
│ Chat                      │ Browser                  Canvas (if present)│
│ Agent: application filled │ city.example     Agent is working           │
│ Ready to submit           │ [Take over] [Saved logins] [Stop browser]     │
│ [Open review]             │ ┌──────────────────────────────────────────┐ │
│                           │ │ live image                               │ │
│                           │ └──────────────────────────────────────────┘ │
│                           │ Ready to pay · Lake bath                    │
│                           │ $125.00 USD to City permit office           │
│                           │ Application #… · [Review image]              │
│                           │ [Pay $125.00 once] [Don't pay]               │
│ Message …                 │ Only Joe can approve company payments.      │
└───────────────────────────┴──────────────────────────────────────────────┘
```

**Staff review variant**, same widths: “Ready to pay” card has **“Waiting for Joe —
$125.00 to City permit office.” [Open review] [Cancel request]**. No disabled
Approve masquerading as available authority, no grant ID or settings link. Staff
can take over to correct business fields, which invalidates the old request;
Pay/Sign stays guarded. Joe's owner view includes task initiator + project,
amount/payee, screenshot, exact action and expiration, with final action button.
For a staff-authorized ordinary submission show Submit once. Owner-only actions
also appear on `/engine/permissions` but require Open review; Telegram/bell links
can notify, never approve a browser action from a text-only button.

### 6.4 Saved login sheets and private view

```text
360: Browser › Saved logins          820/1280: side sheet, width 420
┌───────────────────────────────┐   same fields/controls, no new dashboard
│ Saved logins           Close  │
│ City permit office            │   staff list: own + delegated entries
│ https://city.example          │   owner list filter: Only me / People Joe picked
│ Only me          [Fill login] │   no usernames in the list or model result
│ [Save a login]                │
├───────────────────────────────┤
│ Save a login                  │   screen opens in app, not remote website
│ Name [City permit office    ] │
│ Site [https://city.example  ] │   exact site shown before Save
│ Username [                  ] │
│ Password [••••••••          ] │   never echoed on validation error
│ Use: Only me                  │   owner can choose named staff + areas
│ [Save login] [Cancel]         │
└───────────────────────────────┘
```

After Save: **“Login saved. Your password isn't sent to the agent.”** Form resets
and secrets leave component state; list query returns only metadata. Validation:
**“Use an https website address.” / “Enter a name.” / “Enter a username and
password.”** Failed save keeps entry only in volatile form until Retry/Cancel;
navigation warns “This login hasn't been saved. Leave without saving?” No local
persistence. A staff-delegated row offers Fill login but no Edit/Share. Owner
share sheet: **“Let these people use this login”** with named checkboxes and
**“They can sign in without seeing the password.”** A separate **Remove access**
confirm says “Their open browser will close.” For delete: **“Delete this saved
login? You'll need to sign in again.” [Delete login] [Cancel]**.

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
| Upload review | “Send plan.pdf to city.example?” | Send this file / Cancel; owner-only if client-facing send |
| Offline/view lost | “Connection lost. Browser paused.” | Reconnect; no offline input queue |
| Reconnected | “Connected. Review the page before continuing.” | Resume / Take over / Stop browser |
| Idle warning | “Browser closes in 60 seconds unless you continue.” | Keep open; explicit user activity |
| Idle close | “Browser closed after 5 minutes without activity.” | Open again; forms may need re-entry |
| Resource cap | “Browser stopped because the server is busy. Your saved files are safe.” | Close; Joe checks host before restart |
| Crash | “Browser stopped. Check the site before repeating a final step.” | Open again; private state may require sign-in |
| Key unavailable | “Saved logins are unavailable. You can sign in yourself.” | Take over; Save/Fill disabled; no plaintext fallback |
| Auth expired | “Sign in again to continue.” | Sign in; blank private image immediately |
| Access removed | “Your access changed. Browser stopped.” | Close; erase frame DOM/object URLs |
| Service unavailable | “Couldn't connect to the browser.” | Try again / Close; never launch a second service |
| Start/run ended | “Agent turn finished. Browser is paused.” | Continue with Claude / Take over / Stop browser |
| Stop complete | “Browser closed.” | Return to chat; durable file/review links remain |

Frame updates aren't live-region announcements. State changes are polite live
regions; denied/expired/access errors are alerts. Review sheet traps focus,
returns focus to Open review, supports Escape=keep paused, and never treats Escape
as approval. Screenshot has textual summary; zoom modal has keyboard pan/zoom,
full-site label and Close. Disabled controls have visible explanation. Respect
reduced motion. No remote keyboard capture until person explicitly selects it.

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
  specifies origin, method, anchored path, fields and allowed response action;
  it cannot include a final endpoint or arbitrary regex. Filling that fires an
  autosave is an outside write and must be reviewed too.
* All unknown/non-read HTTP requests, including mutating GETs, are paused at
  the request stage before bytes leave Chromium. Safe public resources are
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
last longer (§7.3), but an expired network request is **not replayed**. Rebuild
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
| Sign in, 2FA, CAPTCHA, ordinary account contact details | Person themselves, permitted origin/entry only | Himself | Person's direct action suffices; secret traffic remains private |
| Nonbinding request/form, no company money, no legal attestation, no client/vendor send | Initiator with all task areas, active control/presence; a card is still required for agent execution | May approve | Person may click final themselves; audit direct-human result |
| Permit application containing certification, agreement to terms, license/owner attestation; unknown legal effect | Must ask Joe | Exact one-time owner grant | Staff cannot avoid Joe by clicking; classify uncertain as owner-only |
| Any company payment, deposit, purchase, subscription, payment authorization, saved payment-method charge | Must ask Joe, regardless of money area/authority grants | Exact one-time owner grant with amount/currency/payee | Staff manual Pay is intercepted until Joe's exact approval; Joe's own deliberate click mints/consumes its exact grant |
| Signature, company agreement/commitment, client/vendor-facing send or upload of a binding document | Must ask Joe | Exact one-time owner grant, plus person applies any signature | Staff cannot sign for Joe; owner card permits agent only if typed/reviewed signature action is supported |
| Unknown action/category/amount/payee | Cannot approve | Review/take over; cannot approve payment with unknown amount/payee | No “approve up to any amount” or company-money bypass |

This intentionally does not grant staff a new company-signing authority. Ordinary
staff submissions are limited to the person's own attended task and areas;
existing authority catalog grants cannot bypass the browser's owner-only cases.
Company payment UI is inaccessible in staff Take over until Joe grants it. Once
Joe approves, the service sends the exact pending request itself; staff cannot
alter a card field and spend a grant for a different payment.

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

Cards expire after **5 min**, bounded by context idle timeout. Owner grants for
browser actions expire no later than card. Approved token expires after **30 s**,
is 256-bit random, stored hashed, one-use, bound to snapshot and executing
control epoch. It stays between web/controller, **never in model output**.
Approval POST includes card ID + expected revision + idempotency UUID; model
cannot call it. Ordinary staff approval is recorded in the browser action table
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
   (`consumeGrantRun` in this transaction) and sets `executing`, command UUID,
   request-dispatch timestamp placeholder. Rechecks all bindings/authority.
3. Continue the one intercepted request or perform the one reviewed click via
   allow-once network manifest. Record `transmitted_at` as conservatively as
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

## 8. Sites, files and hostile pages

### 8.1 Task allowlist and SSRF

Person confirms a task manifest: purpose, project/lead, required areas, document
origins, separately named resource origins, and intended actions. Model may
propose another origin; only a present authorized person can add it, and only
Joe can add an origin to the reusable company catalog. Add a site sheet shows
full origin + why needed; don't precheck a page-suggested site. Resource-only
origins cannot become top-level documents or credential destinations. Revision
change revokes old capabilities/reviews. Default HTTPS/443 only, maximum 12
origins/task. No local files/data/javascript/chrome/extension/FTP, userinfo URLs,
IP literal sites, arbitrary ports or embedded OS file chooser access.

Proxy resolver rejects **any** mixed public/private answer, follows/validates
CNAME chains, pins validated IP to socket connect and revalidates each new
connection/redirect. Match CONNECT authority, HTTP Host and TLS SNI; don't allow
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
watchdog closes context, not just the model tool. A blocked site cannot be made
reachable by Take over or owner grant; use a different task outside this feature.

### 8.2 Download, upload and file provenance

Downloads land in a per-task private quarantine outside public uploads, random
server filename, no client-provided path; max 25 MiB/file, 100 MiB/task, 200 MiB
feature quarantine. Enforce streaming limits before buffering; abort compressed
bombs, executable/HTML/SVG/script/archives/macro Office files, unknown types and
polyglots. V1 accepts PDF, PNG, JPEG only with magic/type validation; reject
malformed images/PDFs. No execution, OS-open, automatic document parsing or
model attachment. Optional malware scanner must be bounded and fail closed if
configured as required. Download URL is not a signed-in app URL forwarded to a
model. Cross-origin download is still subject to sites policy.

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
`fetch_project_file`, `view_project_image`, binary/text fetch, attachment composer,
runner attachment serialization and background ingestion must check this tag.
Private-context downloads can be read by authorized people but cannot become
model input **in any run** through another tool/path. Private project-file bytes
remain envelope-encrypted under the service key even after save: the existing
upload directory contains ciphertext, not a second plaintext copy an ordinary
owner coding run could read. Add `files.browser_cipher_envelope jsonb NULL`
with CHECK `(browser_private AND browser_cipher_envelope IS NOT NULL) OR
(NOT browser_private AND browser_cipher_envelope IS NULL)`. Private filenames
stored in files rows are server-generated “Private browser file <short-id>.pdf”
(or image extension), never page-provided strings. Original filename and any
page-derived descriptive metadata stay encrypted. `files.sha256` binds stored
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
company attestation requires Joe's grant under §7; a staff nonbinding upload
may use ordinary task approval. Browser cannot send private files to another
site without person review and appropriate owner authority. Payment card entry
is Joe's private take-over; never saved, extracted or transcripted.

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

Fetched `origin` with prune during planning and inspected `origin/main` plus
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
| `browser_tasks` (0100) | id, initiator_user_id→users, conversation_id→ai_conversations, project_id→projects NULL, lead_slug NULL, purpose varchar(500), required_areas text[], origins JSONB exact typed manifest, manifest_revision int>0, state enum queued/starting/active/paused/closed/failed, private bool, adapter_id text NULL, adapter_version text NULL, run_id→dev_agent_runs NULL, capability_hash bytea NULL, capability_expires_at, initiating_auth_at timestamptz, bridge_nonce_seq bigint DEFAULT 0, controller_boot_id UUID NULL, document_epoch bigint>=0, control_epoch bigint>=0, controller_user_id→users NULL, controller_device_hash bytea NULL, control_token_hash bytea NULL, control_expires_at, initiator_present_until, last_activity_at, closed_at, failure_code. At most one of project/lead; task area list nonempty, valid keys; closed state requires closed_at. Partial UNIQUE(initiator_user_id) WHERE live state. Index(state,last_activity_at), (run_id), (conversation_id,created_at). Task state/epochs/presence are protected columns. |
| `browser_commands` (0100) | UUID id, task_id, run_id, epoch, seq bigint, idempotency_key UUID, input_digest, safe operation enum, state accepted/running/succeeded/failed/unknown, safe_result JSONB, timestamps. UNIQUE(task_id,idempotency_key), UNIQUE(task_id,epoch,seq). Same key+different digest = conflict. Never stores literal text/input/password. Composite task/run reference checked by command function. |
| `browser_logins` (0101) | id, owner_user_id, label varchar(80), canonical_origin varchar(255), tenant_binding NULL, required_areas[], field_mapping JSONB with trusted version/fingerprint, secret_ciphertext bytea, nonce/tag, wrapped_key+nonce/tag, key_id, crypto_schema, revision int>0, disabled_at, deleted_at, last_used_at. Encrypted plaintext holds username/password; metadata never username. Unique(owner_user_id,canonical_origin,label) WHERE deleted_at IS NULL. CHECK nonce/tag lengths 12/16; ciphertext/wrap nonempty; exact HTTPS origin parser validated in service and DB shape check. |
| `browser_login_access` (0101) | login_id, user_id, granted_by_user_id, granted_at, revoked_at, revision. PK(login_id,user_id); grants only owner-of-entry Joe, no onward delegation, no broad roles. Enforced in owner web command, not direct agent writes. |
| `browser_profiles` (0101) | id, user_id, login_id NULL, origin_chain_hash, encrypted storage state using independent envelope, revision, credential_revision, saved_at, expires_at (30 days maximum), revoked_at. UNIQUE(user_id,login_id,origin_chain_hash) for live entries, anonymous profiles never persist. Restore validates current access and matching credential revision/chain. No disk profile paths. |
| `browser_actions` (0102) | id, task_id, run_id, initiating_user_id, kind enum login/submit/pay/sign/upload, category enum personal/nonbinding/company_submission/company_send/company_payment/company_signature/unknown, needs_owner bool, snapshot_digest bytea, snapshot JSONB nonsecret, secret_manifest_ciphertext NULL + envelope, screenshot_artifact_id NULL, document/control epochs, revision int, amount_cents bigint NULL, currency char(3) NULL, payee varchar(255) NULL, state pending/approved/executing/succeeded/denied/expired/stale/failed/unknown, expires_at, approved_by_user_id NULL, approved_at NULL, approval_method enum card/direct_person_click NULL, token_hash bytea NULL, token_expires_at NULL, token_consumed_at NULL, owner_grant_id→owner_grants NULL, command_id UUID NULL, transmitted_at NULL, receipt_reference NULL, outcome_code NULL, checked_at NULL. Composite(task_id,run_id,initiator) FK/unique parent relation; server derives kind/needs_owner, not model. Only pending may become approved; unknown never automatically retries. Payment requires amount>=0 + currency/payee; company payment (including zero-dollar authorization) needs Joe. Approved/executing owner-required rows require exact owner_grant_id and owner approver. UNIQUE(owner_grant_id) where nonnull; partial one pending/approved/executing action/task. Index(state,expires_at), (task_id,created_at). Hashes 32 bytes. Approved fields can only change via owner/person web approval functions; service can consume, never approve. |
| `browser_artifacts` (0102) | id, task_id, action_id NULL, kind review_image/quarantine_file, safe_name, canonical origin (no query), MIME, byte_count, sha256, private bool, storage_key (opaque basename), envelope metadata when private (sha256 then binds ciphertext, plaintext hash inside envelope), expires_at, deleted_at. Task/action composite FK, max byte constraint, no public URL. Quarantine uniqueness by task/download ID. |
| `browser_file_links` (0103) | id, task_id, artifact_id→browser_artifacts, project_id, file_id text→files NULL, download_id UUID, state staged/committed/failed, sha256, private bool, actor_user_id, safe_error_code. UNIQUE(task_id,download_id), UNIQUE(file_id) WHERE nonnull. This is the save/recovery ledger, not a duplicate files table. Composite project/task and artifact/task checked. |
| `browser_audit` (0100; event variants extended later) | bigint identity, event UUID UNIQUE, task_id NULL, run_id NULL, actor_user_id NULL (retained tombstone if account removed), event enum, canonical_origin NULL, object_id NULL, revision NULL, result_code, at. Append-only; no arbitrary payload/URL/body/text column. Index(task_id,at), (at), (event,result_code,at). |
| Existing rows (0100/0103) | dev_agent_runs launch_source/browser_task_id/profile extension (§4); files provenance + encryption-envelope columns (§8). Add task→run deferred/composite linkage after both rows exist in same transaction, or leave run NULL until attachment function verifies principal/conversation; a service command requires attached run. |

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
| Tasks, commands, actions, artifacts, file links, audit, vault/access/profiles | SELECT required columns/ciphertext, no direct I/U/D | none |
| users, sessions, projects, files, owner_grants | No broad SELECT; only scoped functions below | unchanged existing rights; no browser approval additions |
| Service command functions | EXECUTE the listed functions only | no EXECUTE |
| Web approval/share/admission functions | no EXECUTE | no EXECUTE |
| policies / authority_grants / app_settings / users | no writes | no new rights |

Grant exactly service SELECT columns needed (vault ciphertext allowed only here);
service cannot read login key from DB because it does not exist there. Apply
`REVOKE ALL ON FUNCTION … FROM PUBLIC`, owner-only functions never executable
by narrow roles. Every **new** trigger/function needing owner rights uses
`SECURITY DEFINER SET search_path=public,pg_temp`, qualified identifiers, no
dynamic SQL, bounded types and explicit `session_user` authorization. Do not
alter the existing invoker narrow-write guard into definer or add a general
“execute SQL as owner” bridge.

One-purpose service functions, typed parameters and outputs:

* `browser_authorize(task_id uuid, run_id uuid, capability_hash bytea) →
  {user_id,allowed,reason_code,task_revision,epochs,private}`: verify unexpired
  web-minted capability bound to launch source + task/run/user, fresh active/
  revoked session epoch, record/areas and flags. Store capability hash in
  protected task runtime metadata, never readable by agent/worker; service
  checks the web bridge nonce too. No caller-provided role/user substitution.
* `browser_command_begin(task,run,capability_hash,command_uuid,epoch,seq,
  operation,input_digest) → {command_id,state,safe_result}`: authorization,
  fences, operation allowlist, dedupe. Related finish function accepts only
  safe outcome fields, cannot write approved state or approval columns.
* `browser_consume_action(task,action,token_hash,expected_digest,boot_id,
  control_epoch) → {command_id,authorized}`: locks task/action/grant, verifies
  web approval, consumes exact grant/token atomically; no way to supply a new
  approved_by or amount. Outcome function may only execute→result and appends
  audit. It cannot turn pending/denied/expired into executable.
* `browser_save_profile(task,login,expected_revision,cipher_envelope) →
  {profile_id,revision}`: current entry delegation/access, service revision,
  ciphertext envelope lengths, user resolved from task; never caller user ID.
* `browser_runtime_transition(task,boot_id,expected_epoch,next_state,code) →
  {state,epoch}`: only pause/fail/close/epoch fencing, not approve or lower areas.
* `browser_append_audit(task,event_uuid,event_enum,object_uuid,result_code) →
  {event_id}`: derives actor/run/origin, rejects free text; idempotent.

All have revocation/capability checks appropriate to command, fixed size limits
and current boot binding. Website-only admission, grant creation/decision,
sharing and vault row changes use typed trusted commands with fresh session
checks. Do not trust a custom SQL `SET user_id` from a narrow role as identity.
No worker function can create a browser task or resume one.

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
control:'agent'|'person'|'none',private:boolean,allowed_sites:string[],
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
| `browser_act` | `{task_id:T,observation_id:uuid,ref:string<=80,operation:'click'|'fill'|'select'|'check'|'scroll'|'key',value?:string<=4000,checked?:boolean,direction?:'up'|'down',key?:'Tab'|'Shift+Tab'|'Enter'|'Escape',idempotency_key:uuid}` | `{result:'done'|'waiting_for_review'|'needs_take_over',action_id:uuid|null,document_epoch:int}`. Discriminated union: fill/select require value; check requires checked; scroll direction; key key; click none. No coordinates/code/selectors/files. CONTROL_HELD / OBSERVATION_STALE / PRIVATE_INPUT_REQUIRED / REVIEW_REQUIRED / ADAPTER_REQUIRED. Adapter type validates values, no secret fields. |
| `browser_list_logins` | `{task_id:T}` | `{logins:[{id:uuid,label:string,origin:string,can_use:boolean}]}` authorized entries matching current task origin only; no owner names/usernames/share roster. |
| `browser_fill_login` | `{task_id:T,login_id:uuid,observation_id:uuid,idempotency_key:uuid}` | `{status:'private',login_filled:true}` or needs take-over error, never secret values. LOGIN_NOT_AVAILABLE (no enumeration distinction) / LOGIN_ORIGIN_MISMATCH / LOGIN_FIELDS_CHANGED / VAULT_UNAVAILABLE / PRIVATE_INPUT_REQUIRED. Does not submit. |
| `browser_prepare_action` | `{task_id:T,observation_id:uuid,ref:string<=80,kind:'login'|'submit'|'pay'|'sign'|'upload',summary:string<=1000,idempotency_key:uuid}` | `{action_id:uuid,state:'pending',needs_owner:boolean,expires_at:ISO}`. Service derives authoritative manifest/amount/classification; caller cannot downgrade. REVIEW_UNAVAILABLE / AMOUNT_UNKNOWN / OBSERVATION_STALE. Private summary must be person/adapter business facts, not page text. |
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
| POST `/tasks` | `{purpose,project_id?:uuid,lead_slug?:string,required_areas:string[],origins:[{origin,role:'document'|'resource'}],adapter_id?:string,idempotency_key}` → `{task:Task}`. Person initiator only, areas/record resolved, manifest reviewed. Staff cannot reduce catalog requirements. No run launched until Open. |
| GET `/tasks/[taskId]` | `{task,active_run_id,available_controls,pending_action,downloads,queue_position}` safe UI metadata; owner cross-user explicit review mode, staff own only. |
| POST `/tasks/[taskId]/sites` | `{origin,role,expected_revision,idempotency_key}` → revised Task. Initiator/owner present; validated site; invalidate old observations/actions. |
| POST `/tasks/[taskId]/start` | `{idempotency_key}` → `{task,run_id}`. Creates browser-profile ask_web run and capacity request, preserves task identity; no unattended path. |
| GET `/sessions/[taskId]/events` | SSE §6; authorized viewer, max streams, no URL token. Initial state sent immediately, every 5 s fresh auth; private frames only to explicitly joined human viewer. |
| POST `/sessions/[taskId]/presence` | `{device_id,visible:true,expected_epoch}` → `{present_until}`; bounded 5 s heartbeat, no arbitrary expiry. Visibility false pauses. |
| POST `/sessions/[taskId]/control` | `{action:'take_over'|'give_back'|'resume'|'stop',device_id,expected_epoch,idempotency_key}` → `{task,control_token?:string,expires_at?:ISO}`. Token only to owning human device; never query/log/persist. Resume requires explicit confirmation. |
| POST `/sessions/[taskId]/input` | Discriminated pointer/wheel/key/IME body + control_token, epoch, seq, frame_seq. Returns `{accepted_seq}`. Holder only, CSRF, dedupe/stale/rate checks; no recording text or queuing offline. Sensitive text has separate no-log memory-only `/private-input` handler with same checks. |
| GET `/actions/[actionId]` | UI-only protected review snapshot + image route, current status/revision/expiry/role. Initiator sees task; Joe can explicitly join for owner review. Never model fetch. |
| POST `/actions/[actionId]/decision` | `{decision:'approve'|'deny',expected_revision,idempotency_key}` → `{action_id,state,result_code}`. Authenticated actor must satisfy §7 table. Approval creates exact grant if needed and dispatches once while both required people/presence are valid; not generic owner-grant action. |
| GET `/artifacts/[artifactId]` | Stream authorized review image/private file; authorize task+action+TTL on **every** GET/HEAD/Range. Private no-store, nosniff, no public/signed link; query thumbnail bypass forbidden. Deleted/expired →410. Human view only. |
| POST `/downloads/[downloadId]/save` | `{project_id,expected_sha256,idempotency_key}` → `{file_id,href,private}`. Human current project access; same task project; save/recovery ledger. |
| DELETE `/downloads/[downloadId]` | Cancel/delete quarantine, idempotent; no general project file deletion authority. |
| GET/POST `/logins` | List permitted metadata or save `{label,origin,username,password,required_areas}`; private form only. POST → `{id,label,origin,revision}`, never echoed username/password. Staff forced own entry; request owner ignored/rejected. |
| PATCH/DELETE `/logins/[loginId]` | Entry owner changes fields with expected_revision / deletes; exact revision conflict 409. Joe may disable delegated entry without revealing password; replacement password must come from its owner. |
| POST `/logins/[loginId]/access` | `{user_ids:uuid[],expected_revision}`; Joe's own entry only, active staff/areas checked; replace/revoke access with close+purge. Response metadata only. |
| POST `/internal/command` | **Not public HTTP**: controller Unix-socket protocol with signed envelopes. App-only methods approval/fill input cannot be invoked with MCP capability. Controller reverse health/results bridge, if HTTP needed, binds loopback and verifies signature+nonce+body with a dedicated secret; no public proxy route. |

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
  worker/cron/orchestrated/unknown/inactive not; copied run IDs/capabilities,
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
never replays them later. Personal Sign in in Phase 2 has its own strictly typed
direct-person approval path; it cannot authorize a business write or charge.
Phase 1 permits neither login submits nor any other outside writes.
File flag off denies new download/upload/save; existing authorized project files
still readable by people. No historical backfill of browser profiles/tasks.

### What Joe must do to deploy (future, not performed here)

1. Review/approve this plan's role matrix and privacy limits; select a pilot
   owner task and one staff account with ai + relevant areas. No first city
   decision required. Schedule a short rollout window; check memory/CPU headroom
   and `pgrep -af next` before any authorized capped verification build.
2. Apply additive migrations 0100–0104 at their release gates; bootstrap the new
   non-login Linux user/group and `sjcos_browser` DB login with random password,
   apply manifest grants, run isolated role tests. No service DSN owner fallback.
3. Root installs reviewed namespace/proxy/firewall setup and the new system
   units/slice, root-owned runtime directory/socket groups, private tmpfs limits
   and Chromium sandbox dependencies. Explicitly verify namespace-only CDP,
   socket group and no host/public listener. Nothing added to tunnel for CDP.
4. Install exact runtime lockfile + Chromium 1248 in private service cache;
   provision LoadCredential database/bridge/vault keys, separate offline key
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
Then owner may stop **only the new browser/proxy units**, remove nginx browser
location after streams drain, and roll back app code with browser source/profile
compatibility protected (old runner must not revive optional Playwright hook).
Do not remove existing security file-read guards while private files remain.
Keep additive tables/role restrictions/encrypted vault and saved project files;
no down migration deleting audit or signed/submitted evidence. Keep keys needed
for retained encrypted data/backup restore. Re-enable only through a new attended
admission; old tokens, contexts and approvals stay invalid. Revocation/compromise
also requires Joe to revoke external-site sessions/change affected logins; SJC OS
cannot force a city portal to forget a copied credential.

## 14. Remaining business decisions

None blocks the generic build. Joe has already chosen users, vault, always-ask
and company-money owner approval. Technical safety choices in this plan are
resolved recommendations, not requests to approve each engineering detail.

| Later decision for Joe | Recommended answer |
|---|---|
| Which permit portal first? | Pick the city with the next real permit application after phases 1–3 work; start with one portal and a nonpayment sandbox/manual rehearsal. |
| Which company logins may staff use? | Only named staff who do that work; default every new login to Only me, grant one site at a time. |
| Does any staff role need company-signing/permit-attestation authority later? | Keep Joe-only in v1. Add a specific reviewed authority later only if actual workload requires it; never infer it from area access. |

Known v1 limits are visible in-product: phone take-over requires a tablet/computer;
no unattended/Telegram browser; no password-reveal tool; private authenticated
pages are human-viewed/adapter-driven, not arbitrary model vision; unsupported
WebSocket-dependent portals and unknown forms require take-over or remain
blocked. No claim that a generic browser can safely automate every city website.

Planning verification: source/config/installed guides, cached CLI help and remote
migration refs inspected. No browser/server, app build, tsc, test suite, database
or service was started, queried or changed by this task. Only this plan is to be
staged and committed; visual/runtime acceptance remains with the coordinator.
