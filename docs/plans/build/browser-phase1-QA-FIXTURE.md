# Browser Phase 1 — coordinator screenshot fixture

QA only, not runtime/release acceptance. No Next build/start/dev, browser, socket
listener, service command, live DB or :5499 connection was run by this builder.
The seed and fake use an explicit QA bootstrap URL; neither loads `.env.local`.
No new dependency, role grant, migration, executable installation or send grant.

## Coordinator commands

Run from `/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be`. The coordinator supplies
an already migrated **private** QA Postgres (through 0115). Its bootstrap URL must
connect as a QA superuser: SQL session identities must be the actual website
owner and `sjcos_browser`, using `SET SESSION AUTHORIZATION`, never `SET ROLE`.
The script does not create a cluster, migrate it, or guess a DB URL/port.

```bash
export SJC_QA_SIDE_BUILD=1
export SJC_QA_BROWSER_FAKE=/home/joe/qa-sjcos/browser-p1
# Set these to the coordinator's actual private QA database and HTTPS side origin.
export SJC_QA_DATABASE_URL='postgresql://QA_BOOTSTRAP@127.0.0.1:QA_PORT/sjcos_qa_browser_p1'
export NEXT_PUBLIC_APP_URL='https://YOUR_PRIVATE_QA_ORIGIN'
mkdir -p /home/joe/qa-sjcos/browser-p1
chmod 700 /home/joe/qa-sjcos/browser-p1
node scripts/qa-seed-browser.mjs sjcos_qa_browser_p1 --state working > /home/joe/qa-sjcos/browser-p1/urls.json

systemd-run --user --unit=sjcos-qa-browser-fake --collect \
  -p MemoryMax=512M -p Restart=no \
  -p WorkingDirectory=/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be \
  -p EnvironmentFile=/home/joe/qa-sjcos/browser-p1/fake.env \
  /usr/bin/node scripts/qa-browser-fake-controller.mjs sjcos_qa_browser_p1
```

`QA_BOOTSTRAP`, `QA_PORT` and the origin above are explicit coordinator inputs;
there is deliberately no usable default pointing at a running cluster. Do not
print either generated env file. They use systemd EnvironmentFile quoting;
**do not source them in a shell**. Keys remain in `keys/{request,response,frame}.hex`
(mode0600), independent random 32-byte HMAC keys. Passwords and the isolated
session secret are also generated once, mode0600, and preserved on replay.

The generated `side.env` adds:

- `SJC_QA_SIDE_BUILD=1`, `SJC_QA_BROWSER_FAKE`, `SJC_BROWSER_ENABLED=1`;
- the SAME production key inputs `SJC_BROWSER_WEB_RPC_KEY`,
  `SJC_BROWSER_WEB_RESPONSE_KEY`, `SJC_BROWSER_FRAME_KEY` (hex file contents);
- `DATABASE_URL` with actual website session authorization, and the four narrow
  URL variables with their respective actual QA logins; no inherited live DSN;
- isolated `SESSION_SECRET`, `SJC_OUTBOUND_DISABLED=1`, coordinator's
  `NEXT_PUBLIC_APP_URL`, and `SJC_DIST_DIR=.next-qa-browser`.

Merge the coordinator's other existing QA isolation variables (Ask journal /
recovery/deployment state, Canvas fixture settings, etc.) into the side unit;
this fixture doesn't provision unrelated subsystems. Use an HTTPS side origin
for Secure cookies and the real CSRF origin check. Sign in normally as
`qa-browser-owner@example.test` (Taylor) or `qa-browser-staff@example.test`
(Abigail), with passwords read privately from `keys/owner.password` and
`keys/staff.password`. Existing user credentials/permissions are preserved;
a conflicting ID or insufficient staff rights refuses. No auth-cookie bypass.

Only the coordinator runs these build/start commands, after reviewing the
other builders' readiness and QA setup. Both units use their own dist, never
`/home/joe/sjcos-app/.next`; inspect existing Next processes first. These commands
are instructions, not evidence that a production side build was exercised.

```bash
pgrep -af next
systemd-run --user --unit=sjcos-qa-browser-build --collect --wait --pipe \
  -p MemoryMax=8G -p Restart=no \
  -p WorkingDirectory=/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be \
  -p EnvironmentFile=/home/joe/qa-sjcos/browser-p1/side.env \
  /usr/bin/nice -n 19 /usr/bin/env NODE_OPTIONS=--max-old-space-size=6144 ./node_modules/.bin/next build
systemd-run --user --unit=sjcos-qa-browser-side --collect \
  -p MemoryMax=8G -p Restart=no \
  -p WorkingDirectory=/home/joe/.t3/worktrees/sjcos-app/t3-cf34c1be \
  -p EnvironmentFile=/home/joe/qa-sjcos/browser-p1/side.env \
  ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3191
```

Stop just those fixture units when finished (coordinator only):

```bash
systemctl --user stop sjcos-qa-browser-side.service sjcos-qa-browser-fake.service
```

Never touch the four live SJC/Ordinem units. Exit137/Killed means stop and report,
not retry. The fake refuses existing sockets; normal graceful stop removes its
own sockets. If a killed unit leaves stale socket paths, establish that its
process is gone before the coordinator removes just those two QA paths.

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
| `fresh_confirm` | Private rest → menu → Fresh browser → cancel/confirm. New boot/generation fence uses real SQL. |
| `idle_warning`, `idle_closed`, `crashed`, `latched`, `absent`, `turn_ended`, `owner_paused`, `unknown` | Fixed reason projection; idle warning has60s remaining and becomes idle-closed presentation. Terminal/revoked presentation sends no new frames. These are screenshot projections, not physical runtime fault/idle acceptance. |
| `auth_expired`, `access_removed`, `closed`, `service_unavailable` | Safe fixed error projection; not an actual revoked session/access mutation. |
| `read_review`, `resource_review`, `resource_20`, `resource_expired` | SQL-staged candidates and original59s deadlines; 1 or20 exact resources. Expired: wait60s, don't reseed mid-shot. |
| `write_blocked`, `final_blocked` | Real SQL prepare notice, with QA presentation kind for write. Final copy: “This version stops here. Nothing was submitted.” Close only; no grant/action submitted. |
| `owner_watch_before`, `owner_watch_after`, `public_watch`, `in_use` | Owner opens staff Watch URL. Private before: no image, even though canned private frame exists. After: explicitly Show the page (real POST + signed local QA checkpoint). In use: owner empty thread → In use → Watch. Staff watching indicator comes from real owner claims. |
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

## Product-code hook inventory (every touched product line)

Line numbers refer to this candidate; use the diff if parallel changes move them.

| File | Added/changed lines | Purpose |
|---|---|---|
| `lib/browser/phase-flags.mjs` | 17–26 | `qaBrowserDirectory`: exact side flag, canonical absolute directory under `/home/joe/qa-sjcos/`, actual `SELECT current_database()` matching `sjcos_qa_*`; absent env returns null without DB I/O. |
| `lib/browser/web-rpc.ts` | 8,28–37,43–44,52–53 | Optional connected DB; runtime guarded alternative socket directory; lstat/no-symlink/private QA ancestry checks. Otherwise original root-owned `/run/sjcos-browser/{control,frames}.sock` trust checks and signatures. |
| `lib/browser/web.ts` | 6–7,201,208,211 | Import QA bridge/guard; select fixture hooks only after guard; provide DB to real Unix client; recheck guard before cached handler reuse (changed/missing guard fails503). |

No signing checks were removed or substituted. Ordinary production keeps the
installed protected website loader, fixed root-owned sockets, real auth/CSRF,
independent keys, frozen schemas,32KiB caps, response command/boot/sequence
verification and signed binary frame gate. The fixture has **no import-time I/O**.
No protected installation, production readiness evidence or owner grant is
fabricated. Private owner consent uses actual event/checkpoint signatures and
the existing protected audit writer/verifier + repository SQL. The seed also
creates mode0600 `audit.hex`, `checkpoint.pem`, and `sink.pem` under `keys/`.
The local QA sink is explicitly identified `qa_local_not_independent`; it is not
an independently administered production sink. The guarded website hook sends
a signed presence proof to the fake to anchor the exact viewer/stream/generation
consent binding before the existing SQL private-view gate can succeed. The alternative website projection/run attachment exists exclusively
inside the explicitly guarded screenshot bridge. Its fake runs spawn no agent.

## Verification and limits

Tests use `tests/_harness/testdb.mjs`, explicit tagged socket URLs and fresh
`sjcos_qa_browser_fixture` / `sjcos_guard_browser` harness DBs. The test file's
after-hook stops its tagged cluster and removes only its unique test directory.
No test opens a listener: B's real Unix client runs with only Node socket/filesystem
IO mocked. A's actual RPC signer and B's actual response/frame verifiers run.

```bash
SJC_TEST_CLUSTER_TAG=browser-p1-qa-1107fixture node --test tests/qa-browser-fixture.test.mjs
SJC_TEST_CLUSTER_TAG=browser-p1-qa-1107fixture node --test tests/browser-routes.test.mjs
SJC_TEST_CLUSTER_TAG=browser-p1-qa-1107fixture node --test tests/browser-live-view.test.mjs
SJC_TEST_CLUSTER_TAG=browser-p1-qa-1107fixture node --test tests/browser-flags-db.test.mjs
SJC_TEST_CLUSTER_TAG=browser-p1-qa-1107fixture node scripts/test-db.mjs stop
flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .
```

Final counts: fixture15/15, routes41/41, live-view13/13, flags DB12/12 (81 passed). An earlier routes run
observed the preexisting navigation test-stub seam while concurrent repair was
in progress; it passes after that owner's stub update. No unowned test was edited
by this builder. Locked tsc initially passed; the final shared-tree result is
recorded below. The tagged cluster was explicitly stopped (no cluster running).

Not covered / must not be claimed:

- Added-site discovery is not supplied by this fixture's trusted catalog; the
  concurrent `discover` hook remains an installation dependency. Existing seeded
  sites/approved addresses render; don't claim a successful arbitrary add-site.
- Production build/bundling/start, actual Unix listener IO/systemd lifecycle,
  HTTPS/cookies/CSRF/SSE through the side host, visual geometry, device/IME or
  screenshots. Coordinator must exercise these before accepting the fixture.
- Real website HTTP requests, browser/model execution, page mutations, private
  output containment, runtime crash/latch/expiry/revocation or hostile canary.
  JPEGs are fictional public pages (city permit and county property) drawn as SVG
  then converted with preinstalled `/usr/bin/convert`, baseline JPEG52KB each,
  embedded in the owned script; no browser/dependency/extra asset files.
- `loading` with Earlier view cannot be forced by the available safe server
  projection; it currently aliases starting. `resource_21` cannot be persisted by
  0115 (max20); it aliases the legal one-resource review and is **not a21-item
  screenshot fixture**. These require the existing renderer tests/coordinator
  resolution, not another product bypass. Settings conflict/unavailable backend
  requires real concurrent edits/backend failure, not a seed flag.
- Actual closed/failed tasks refuse join. Closed/crash/expiry/revocation shots use
  paused records with safe fixed projections so that the UI can join; archived
  true terminal records still exist. Idle expiry blanks presentation, not a real
  controller close. Do not count these shots as terminal authorization tests.
- Pending read/resource candidate approvals exercise existing real policy. A
  resource-only proposal still lacks the document required by the manifest
  builder; no approval success is fabricated. Retained command-notice Watch links
  may hit the existing owner-view SQL action-table check; this fixture supplies
  own notices and current Watch, not a bypass for that seam or bell dispatch.
- Fresh reset clears the run in SQL. Continue/new launch uses only the QA hook;
  no real runner is attached. Manual input is acknowledged against the real
  web boundary but does not edit a canned JPEG.

Final locked shared-tree tsc: **exit1**, TS2322 in the concurrent production
`discover` adapter signature (`website-bridge.mjs` requires `{task,...}` while
`WebsiteHooks.discover` currently takes generic `Row`). The QA hook compiled
successfully before that concurrent change. This builder did not cast away or
edit the other owner's type. Resolve and rerun tsc before the coordinator build.
The root source inventory also needs coordinator refresh after all builders
freeze; changing phase-flags changes its recorded hash. No source locks refreshed.
