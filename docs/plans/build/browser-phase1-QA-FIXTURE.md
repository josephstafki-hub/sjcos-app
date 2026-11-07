# Browser Phase 1 — QA-only overlay fixture (round 4)

This is a screenshot fixture, not production runtime/release acceptance. The
production website imports only `lib/browser/runtime-endpoints.ts`, whose
ordinary implementation uses the protected installed bridge and fixed
root-owned sockets. **Environment variables and a QA-named database cannot
select the fake in an ordinary production artifact.**

`node scripts/qa-browser-overlay.mjs OUT_DIR` creates a separate disposable
source artifact under `/home/joe/qa-sjcos/`. It copies regular tracked and
nonignored source files, excludes `.git`, env files, build directories and
TypeScript caches, symlinks the existing `node_modules` (no install), and
replaces **only** `lib/browser/runtime-endpoints.ts` with
`qa/browser/runtime-endpoints.ts`. `QA-BROWSER-OVERLAY.json` records the source
HEAD and both leaf hashes, explicitly marking the result QA-only. The copier
refuses existing output directories, symlink ancestors, traversal and output
inside either checkout. It executes no build, server or database command.

The replacement implements the exact SERVER interface at the top of
[browser-phase1-R2-SERVER-HANDOFF.md](browser-phase1-R2-SERVER-HANDOFF.md):
`browserWebEndpoint` (paths, purpose-separated keys, socket validation),
`loadWebsiteTrust` (fake hooks and local QA audit signer), and `readinessSource`
(existing flag evaluation). No production source imports `qa/**` or the fake.
The separate artifact is the trust boundary; DB/path/cluster checks are extra
protections, not proof of production-equivalent custody.

## Coordinator workflow

Run from `/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be` after builders freeze.
The coordinator supplies an already migrated **private** QA Postgres, including
round 2 migration 0115, and an explicit bootstrap superuser distinct from all
six application logins. The fixture never reads `.env.local`, provisions a
cluster, migrates it or guesses a live URL. Default port/explicit port 5432 is
refused before connecting. The connected server must also report a non-5432
port and an isolated non-live data directory.

```bash
export SJC_QA_SIDE_BUILD=1
export SJC_QA_BROWSER_FAKE=/home/joe/qa-sjcos/browser-p1
export SJC_QA_DATABASE_URL='postgresql://QA_BOOTSTRAP@127.0.0.1:QA_PORT/sjcos_qa_browser_p1'
export NEXT_PUBLIC_APP_URL='https://YOUR_PRIVATE_QA_ORIGIN'
mkdir -p /home/joe/qa-sjcos/browser-p1
chmod 700 /home/joe/qa-sjcos/browser-p1
node scripts/qa-seed-browser.mjs sjcos_qa_browser_p1 --state working > /home/joe/qa-sjcos/browser-p1/urls.json
node scripts/qa-browser-overlay.mjs /home/joe/qa-sjcos/browser-p1-r2-source
```

Create/chmod the fixture state directory to 0700 before redirecting `urls.json`
on first use. The seed pins the actual DB OID, server port and postmaster start
in `keys/cluster.json` (0600); fake hooks check this binding on scenario reads.
Use a new state directory after replacing/restarting that cluster. Never point
the bootstrap URL at the live cluster. This implementation builder never
connects to the coordinator's QA clusters (:5498 and :5499).

Real QA-cluster logins are `sjcos` (website), `sjcos_agent`, `sjcos_worker`,
`sjcos_readonly`, `sjcos_backup`, and `sjcos_browser`. Each has a generated,
persisted 0600 `keys/ROLE.password`, LOGIN and no superuser/create-role/create-DB/
replication/RLS-bypass privileges. If the disposable DB was loaded as the
bootstrap or a test website owner, its public application objects/functions
and website policy are transferred to `sjcos` inside that QA DB only. Existing
narrow table grants are retained, not widened. The bootstrap must be a
separate QA administrator; the fixture will not demote its own connection.

Generated URLs specify each actual username/password, remove any old `options`,
and are connected independently before environment publication. Every connection
must report matching `session_user` and `current_user` and no privileged role
attributes. There is no startup `session_authorization` URL trick and no
`SET ROLE` substitute. The fake alone retains the explicit QA bootstrap URL to
serialize its existing per-operation `SET SESSION AUTHORIZATION` website/service
calls; the website side process always connects as real `sjcos`.

The seed writes fixture-owned values to **`side.generated.env`**, and merges
those same keys into **`side.env`**. Comments and every unowned key are preserved,
including `SJC_ASK_DEPLOYMENT_STATE_DIR`, `SJC_CANVAS_*`, `AI_PROVIDER`,
`NEXT_PUBLIC_AI_PROVIDER`, `CRON_SECRET`, coordinator origin and dist settings.
The first seed supplies an origin default if missing. It does not own or reset
origin/dist on replay. `fake.env` holds the explicit QA bootstrap URL and fixture
keys. All generated env files are 0600, with systemd EnvironmentFile quoting:
**never print them or source them as shell code**. The generated application
URLs include `DATABASE_URL_BROWSER` in addition to the usual four narrow URLs.

Before building, merge/review the coordinator's other side-only isolation
settings in `side.env` (Ask journal/recovery/deployment, Canvas fixtures, fake
providers, cron, etc.). Use HTTPS for Secure cookies and CSRF. Sign in normally
as `qa-browser-owner@example.test` (Taylor) or
`qa-browser-staff@example.test` (Abigail), reading their passwords privately from
`keys/owner.password` and `keys/staff.password`. Existing user credentials and
rights are preserved; no auth-cookie bypass is added.

Only the coordinator runs the following commands. They are also printed by the
overlay script with its exact output directory and current fixture env path.
`SJC_DIST_DIR=.next-qa-browser` is deliberately passed to the process, overriding
any merged dist value so this artifact's build stays **inside the output tree**.
Next's installed documentation requires a relative dist directory within its
project. Neither the worktree nor `/home/joe/sjcos-app/.next` is a build target.

```bash
pgrep -af next
systemd-run --user --unit=sjcos-qa-browser-build --collect --wait --pipe -p MemoryMax=8G -p Restart=no -p WorkingDirectory='/home/joe/qa-sjcos/browser-p1-r2-source' -p EnvironmentFile='/home/joe/qa-sjcos/browser-p1/side.env' /usr/bin/nice -n 19 /usr/bin/env SJC_DIST_DIR=.next-qa-browser NODE_OPTIONS=--max-old-space-size=6144 ./node_modules/.bin/next build
systemd-run --user --unit=sjcos-qa-browser-fake --collect -p MemoryMax=512M -p Restart=no -p WorkingDirectory='/home/joe/qa-sjcos/browser-p1-r2-source' -p EnvironmentFile='/home/joe/qa-sjcos/browser-p1/fake.env' /usr/bin/node scripts/qa-browser-fake-controller.mjs sjcos_qa_browser_p1
systemd-run --user --unit=sjcos-qa-browser-side --collect -p MemoryMax=8G -p Restart=no -p WorkingDirectory='/home/joe/qa-sjcos/browser-p1-r2-source' -p EnvironmentFile='/home/joe/qa-sjcos/browser-p1/side.env' /usr/bin/env SJC_DIST_DIR=.next-qa-browser NODE_OPTIONS=--max-old-space-size=6144 ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3191
```

After QA, the coordinator stops just its fixture units:
`systemctl --user stop sjcos-qa-browser-side.service sjcos-qa-browser-fake.service`.
Never touch the live SJC/Ordinem units. Never run `next dev`. Exit137/Killed
means stop and report. Fake startup refuses existing socket paths; after a
killed fake, establish that its process is gone before removing only its two
stale QA sockets. A changed source snapshot requires a **new** overlay directory;
reseeded scenario state is reread without a build/restart.

## Choosing a state

Postgres enforces one live task per person and two concurrent contexts. The seed
keeps that invariant: on first use it creates real task/run/manifest/notice
examples for every base state, then archives them. It selects one current state
for both QA people. No terminal task is reopened. Archived URLs are historical,
**not simultaneously live screenshots**. Every returned ID is a real lowercase
UUID. Pick a state explicitly before shooting; refresh the URL map after every
selection (especially Watch URLs). Normal replay is idempotent; `--refresh`
creates fresh current tasks and authoritative short deadlines.

```bash
node scripts/qa-seed-browser.mjs sjcos_qa_browser_p1 --state read_review --refresh > /home/joe/qa-sjcos/browser-p1/urls.json
node scripts/qa-seed-browser.mjs sjcos_qa_browser_p1 --state owner_watch_before --refresh > /home/joe/qa-sjcos/browser-p1/urls.json
node scripts/qa-seed-browser.mjs sjcos_qa_browser_p1 --state final_blocked --refresh > /home/joe/qa-sjcos/browser-p1/urls.json
```

The fake rereads the atomic `scenario.json`; no fake/Next restart is needed for
state changes. Reload the relevant panel after reseeding. Each map entry has
`url`, `as`, `notes`, and where applicable `thread_id`, `task_id`, `watch_url`.
Own URL is `/panel?c=<real UUID>`; choose Browser. On `/today` select that own
thread in Operator to test sheet/dock. Owner Watch uses the **staff** entry's
`watch_url`, `/today?browser=<real staff task UUID>`. Owner settings is
`/settings/browser`. No tokens, frames, private values or credentials in URLs.

| `--state` | Render/capture procedure |
|---|---|
| `off`, `unsupported`, `empty` | Off uses the actual DB flag; unsupported: select non-Claude; empty uses an owned thread with no task. Restore by seeding another state. |
| `sites_empty`, `sites_added` | Open Sites; cancel/add a public address explicitly. Approved exact addresses come from the real initial manifest. |
| `queued`, `queue_full`, `queue_expired`, `offer`, `offer_expired`, `starting` | Real queued admission and offer functions; staff is position2 when both are waiting. Offer has its original30s deadline, queue5min. Full is a synthetic safe error projection, not an eight-user queue. |
| `working`, `paused`, `paused_private`, `other_device` | Real attached public run / paused transition / private barrier. Another device has a distinct persisted device hash. |
| `takeover_confirm`, `taking_over`, `controlling` | Start public; Take over → confirm. Taking-over ACK delays1s (below B's2s RPC timeout). Control token is minted by the real web route, in memory only. |
| `done` | Take over → confirm → Done; first prompt then Keep paused. Leave/return; no private Continue. |
| `fresh_confirm` | Private rest → menu → Fresh browser → cancel/confirm. Stable kernel boot and rotated context/listener generation use real SQL; a new pending read must be approved before Continue. |
| `idle_warning`, `idle_closed`, `crashed`, `latched`, `absent`, `turn_ended`, `owner_paused`, `unknown` | Fixed reason projection; idle warning has60s remaining and becomes idle-closed presentation. Terminal/revoked presentation sends no new frames. These are screenshot projections, not physical runtime fault/idle acceptance. |
| `auth_expired`, `access_removed`, `closed`, `service_unavailable` | Safe fixed error projection; not an actual revoked session/access mutation. |
| `read_review`, `resource_review`, `resource_20`, `resource_expired` | SQL-staged candidates and original59s deadlines; 1 or20 exact resources. Expired: wait60s, don't reseed mid-shot. Prefer `resource_expiring` below for a 20s deadline. |
| `write_blocked`, `final_blocked` | Real SQL prepare notice, with QA presentation kind for write. Final copy: “This version stops here. Nothing was submitted.” Close only; no grant/action submitted. |
| `owner_watch_before`, `owner_watch_after`, `public_watch`, `in_use` | Owner opens staff Watch URL. Private before: no image, even though canned private frame exists. After: explicitly Show the page (real POST + signed local QA checkpoint). In use: owner empty thread → In use → Watch. Staff watching indicator comes from real owner claims. |
| `guarded_menu`, `reload_confirm` | Open ⋯: Back/Reload enabled, Forward disabled, two bounded QA targets. Capture keyboard/focus, reload warning, Cancel and explicit Reload. Fake validates current epoch/context/document/read revision but only acknowledges navigation; canned pixels do not change. |
| `exact_path_review`, `exact_resource_review` | Same-origin `https://city.example/permits/details`, or document + CSS review together. Original 59s deadlines/revisions remain SQL-owned. Read once/Allow these files once, then a NEW explicit Reload; no automatic navigation. Sites accepts these exact catalog addresses through the real discovery adapter. |
| `watch_consent_reask` | Owner opens public staff Watch; staff takes over. Capture pixel clearing and Show the page again. Public advance consent is forbidden by SQL. |
| `watch_audit_pending` | Owner opens staff Watch and explicitly Show the page. Fake withholds its local checkpoint: real SQL stays unauthorized and UI shows “Waiting to show the private page…”. Reseed `owner_watch_after --refresh`, reload the new Watch URL and explicitly consent for recovery. This replaces the task; it is not same-stream outage recovery evidence. |
| `pre_frame_close` | No JPEG emitted. Switch Browser→Chat/Canvas; inspect authenticated state stream identity and exact planned-close ACK before GET abort. A second device must stay attended. Failed/lost ACK and delayed bootstrap remain coordinator transport checks. |
| `leave_confirm`, `pause_failed` | Leave confirmation is a real user action. Pause-failed: owner Watch → Pause agent → confirm; fake refuses fenced ACK. |
| `disconnected`, `reconnected` | Coordinator stops/starts only the fake, then explicit reconnect. |
| `settings` | Owner only; two named pilots, own-confirm preference and all later flags off/disabled. |

Both roles: 320/360/820/1180/1280 widths for applicable own states; also420 dock,
839/840 boundary,1000 content and popout on both sides of840. Owner-only Watch /
In use / settings must never appear for staff. At800×360 capture own task, own
read, own final-blocked, owner private Watch before/after consent. C's other
599/600, Safari820/744,360 iPad Split View, safe-area, keyboard/rotation/focus,
Canvas restoration and native-unavailable checks remain coordinator work.
Keyboard capture, IME/Escape, local Zoom/pan/Fit, pause live view, own-confirm,
owner replacement, leave cancellation and fresh consent are real UI actions;
the fixture deliberately doesn't add query-string UI state injection.

## Round 2 data and verification

Every selected task references the real QA project **Maple Ave kitchen**,
address **124 Maple Avenue**, with a readable permit-research purpose. SERVER's
normal projections derive `job_label`, `task_label`, owner `busy_with_label`,
read-candidate `suggested_by`/label, named pilot `people` and `project_id` from
these records. Pauses carry the new SQL `paused_by` identity; owner-paused and
turn-ended screenshot projections explicitly seed owner Taylor and agent
attribution. The fake adds the safe current site label “City permits”.

Join now retires expired attendance and may advance control epochs. Reseeding
re-reads the epoch after joining before stopping a previous task. The
`other_device` recipe deliberately retains its synthetic other-device attendance
for eight hours; other seed viewers leave immediately. This prevents the new
expiry guard from correctly clearing the very control record that recipe needs.
Normal replay is idempotent; upgrading an old scenario forces one current-task
refresh to apply the round 2 project metadata.

Run the fixture test file alone with its own unique tag; its after-hook stops
that tagged harness cluster and removes its unique state/overlay directories:

```bash
SJC_TEST_CLUSTER_TAG=browser-p1-r2q-UNIQUE_NONCE node --test tests/qa-browser-fixture.test.mjs
flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .
```

The overlay output is outside the worktree and therefore outside this TypeScript
project. Tests exercise real non-superuser login connections, narrow protected
write denial, environment merge/replay, every recipe, signed fake RPC/frames,
private consent and local audit pending/recovery, Continue/fresh/discovery,
production leaf refusal with QA env + a real QA-named database, and production
source scanning (`lib/`, `app/`, `components/`) for QA imports/env selectors.
They copy a real disposable source overlay without building or starting it,
check its marker/single-leaf substitution/dependency symlink and unsafe path
refusals, and execute the actual website adapter against seeded project,
people, pause attribution, In use and suggested-by data. Node socket IO is
mocked; no listener/browser is started by these tests.

Final R2 fixture: **19/19 passed**, zero failed/skipped, on tagged harness
`browser-p1-r2q-e341ca9`; its cluster was stopped by the after-hook.
Locked TypeScript check: **exit 0**. Earlier checks caught transient UI type
errors and a QA leaf inference annotation; both are resolved in the final check.
No next dev/build/start, browser, coordinator QA DB connection, live DB/service
operation or dependency installation is part of builder verification. The
coordinator still must build this **separate** artifact, inspect its module
separation, and check HTTPS auth/CSRF/SSE, cookies, geometry and devices.

Local QA checkpoint signatures exercise the real verifier and SQL consent
binding but use **qa_local_not_independent** custody. They do not attest an
independent production sink. Process bindings are inert, manual input never
edits canned JPEGs, fault/idle states are safe presentation projections, and
navigation ACKs do not drive real CDP/history. Do not count screenshots as
runtime privacy, revocation, root installation or network containment evidence.
`resource_21` now stages 21 candidates through the real SQL function. `loading`
still aliases starting. See the round 4 `earlier_view` integration limit below. A resource-only approval
still requires an approved document through real policy. Settings conflict or
backend failure needs a real concurrent edit/failure, not another fixture flag.

Private-query and root source inventories must be reviewed/refreshed by their
owners after all builders freeze, including these changed QA SQL/source hashes.
This task owns no scanner allowlist or root source inventory and weakens no scan.


## Round 4 recovery / missing-evidence recipes

Use `--state NAME --refresh` and reload the new `urls.json` URL before each
shoot. The scenario format is now revision 4; an older scenario gets one
automatic refresh. Controls are files in the selected fixture directory, not
query-string UI switches. A fresh selection/refresh removes old release files.
The fake rereads these files without restarting. Scope UI locators to
`[data-browser-ui]` and use the exact button/text names below.

| `--state` | What to click / wait for |
|---|---|
| `disconnected_public` | Open own task → Browser. SQL task is **paused**, public. The fake emits two signed frames and drops the frame socket on its third tick (~2 seconds after stream open). Capture “Connection lost. Browser paused.” / **Reconnect** promptly (normal 5s status polling can replace a transient error). Run `touch "$SJC_QA_BROWSER_FAKE/release-disconnect"`, then **Reconnect**. Capture “Connected. Review the page before continuing.” with **Resume**, **Take over**, **Stop browser**. Capture before clicking Resume; it starts a real new QA run. |
| `disconnected_private` | Open own task → Browser. SQL task is **paused**, private, with no synthetic competing device. Same two-frame/drop timing and release file. After **Reconnect**, capture **Take over again**, no Resume, at 820/1280. At 360 Take over is absent. If testing Done first, choose **Keep paused** before leaving/returning; do not reseed away the task in the middle of reconnect. |
| `pause_fails_503` | Open own task → **Take over** → confirm **Take over** (tablet/computer), then **‹ Chat** (or leave for Canvas), then **Pause and return**. The signed fake control response is `BROWSER_SERVICE_UNAVAILABLE`, mapped to HTTP **503**, never 409. Capture “Couldn't pause the browser. Keep this screen open, or stop the browser.” with **Try again** / **Stop browser**. Try again keeps failing; Stop browser still works. The older `pause_failed` alias also now returns 503, but use the leave flow for this copy. |
| `earlier_view` | Open own task → Browser; receive two signed frames, then after ~2s the fake retains the last frame and sends no replacement frames. Its signed `read_state` response reports `navigation.loading: true`; the QA navigation hook also reports loading. **Integration limit:** the current production `navigationProjection` discards loading and the UI's `browserModel` has no loading transition. The fixture alone therefore cannot yet render **Earlier view** through the current web contract. UI/server owners must wire a permitted loading signal without clearing the retained frame; then capture **Earlier view**, image name `Live view of city.example. Loading city.example….`. No forced UI state or product edit is included here. |
| `resource_21_pending` (also corrected `resource_21`) | Open own task → Browser. 21 pending resource candidates are submitted through `browser_web_read_candidates`, with original 59s deadlines. First page has **20**, **Next files** gives **1**. Capture “Too many files to review at once.”, disabled **Allow these files once**, and **Next files** before paging. |
| `resource_expiring` | Open own task → Browser immediately after refresh. Both real candidate and review notice deadlines are **20 seconds from seeding**; wait until 21 seconds after seed on the same page. Capture “These page addresses need a fresh review before they can be allowed.” and disabled **Allow these files once**. GET never extends the SQL manifest deadline. |
| `audit_pending_hold` | Owner opens **staff** entry's `watch_url` → **Show the page**. Capture “Waiting to show the private page…” with no image at 360/820. Held indefinitely: do not refresh/reseed. Run `touch "$SJC_QA_BROWSER_FAKE/release-audit"`; within the next normal 5s detail poll the website sends a signed presence proof to the fake, which writes the real local QA audit checkpoint/ACK. Consent stays bound to that same task/viewer; private image can then appear. This is local QA custody, not an independent production sink. |

`owner_queued` means the `owner_queued` URL-map entry selected by `--state queued`;
`--state queue_expired` supplies `owner_queue_expired`. Neither has a controller
boot or run before acceptance. The regression verifies successful joins and
queue projections for both people, and verifies an attempted owner events GET
fails **in the website before any fake socket call**, including after join.
Thus events 503 is not emitted by the fake. Opening SSE merely after join is
still too early for queued tasks; wait until active/paused. The parallel UI
builder now guards SSE by task state, stream ID/generation and enabled status.
Re-shoot the owner queue states using that UI update. No invented queue boot or
SQL admission bypass was added to this fixture.

Other Required 1 shots remain coordinator UI actions: at 820 on /today click
the Operator pill by its accessible name matching `/Operator/` (exclude the mic),
then **Browser**, and capture In use / **Watch**. For compact keyboard evidence,
use 820 landscape or 1180 and confirm
`[data-browser-compact-capture="true"]`, **Address ▸**, **Type it**. No browser,
Next process or screenshot was run by this implementation builder.

Round 4 fixture verification: **19/19 passed**, zero failed/skipped. The single
fixture file ran under unique `browser-p1-r4q-<nonce>` harness tags, with ambient
`DATABASE_URL` / `SJC_TEST_DATABASE_URL` unset. The after-hook stopped each
cluster and removed its private fixture/overlay directories. Coverage includes
real website 20+1 candidate pagination, actual 20-second expiration observed by
GET without deadline extension, paused public/private signed stream drop and
release, signed 503 pause refusal, local audit hold/release, and queued events
rejection before fake IO. Locked `tsc --noEmit -p .`: **exit 0**. No browsers,
Next commands, socket listeners, QA coordinator clusters, live services or
product-code edits were used by this builder. The Earlier view integration
limit above remains unresolved within fixture ownership.
