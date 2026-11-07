# Browser Phase 1 R4c — server loading handoff

Authenticated task detail now includes optional boolean `navigation.loading`.
The website reads it from the controller's signed `read_state` task response,
not the website navigation hook, page text, URL, title, frame age or missing
frames. The existing hook still supplies guarded navigation controls/targets.
Loading alone can produce a navigation projection when no controls/hook exist.

`ControllerNavigation` and `NavigationProjection` are strict schemas with an
optional boolean loading field; coercible strings, numbers, null and page
fields are refused. BrowserStatus reflects that optional boolean. No SSE
schema change is required: the UI reloads detail on state events and polls it.

Before the read, the adapter snapshots the authenticated task/viewer and records
an existing presence proof for the metadata RPC. The response's strict TaskSafe
must match task ID, controller boot, run, context generation, document epoch
and control epoch. After the response, it rereads the task and authenticated,
still-visible viewer and checks the same task binding plus stream ID/generation.
A private/fenced context, unavailable controller, missing loading, malformed
metadata or changed binding produces false/absent loading. There is no cached
loading fallback. Loading conveys no control authority. A controller that does
not report this metadata continues to show no loading intent.

The 32 KiB signed metadata ceiling, paging and QA fixture/scripts are unchanged.
No factory, root inventory, source refresh, dependency installation, Next
command, browser, live DB/service or coordinator QA cluster was touched.

## Expectations and checks

Both new expectations failed before implementation (missing validator and
missing loading propagation). The adapter regression covers current loading;
stale epoch, context generation, boot and run; stream ID/generation rotation;
private/delegated contexts; task epoch/context/privacy changes during the read;
missing metadata; nonboolean loading; and loading without a navigation hook.
The strict-contract regression checks both booleans, rejects nonboolean values
in both schemas, and refuses page text/title/URL fields.

Files ran individually:

| Test file | Passed | Failed / skipped |
|---|---:|---:|
| browser-routes.test.mjs | 53 | 0 / 0 |
| browser-live-view.test.mjs | 13 | 0 / 0 |
| browser-contract.test.mjs | 41 | 0 / 0 |

Total: 107 passed, 0 failed, 0 skipped. Routes used only the disposable
`tests/_harness/testdb.mjs` cluster with unique `browser-p1-r4c-<nonce>` tags,
ambient DATABASE_URL/SJC_TEST_DATABASE_URL unset, and `stopCluster()` in a
finally block after each run.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0.
`git diff --check`: exit 0.

## Root source inventory and coordinator check

Changed files listed in `deploy/browser/runtime-lock.json`:

- `lib/browser/phase1-contracts.mjs`
- `lib/browser/website-bridge.mjs`

Their inventory hashes were deliberately not refreshed. The coordinator owns
review/refresh after all builders freeze. `web.ts` and `web-types.ts` also
changed but are not entries in that root inventory.

Coordinator visual acceptance remains: use the unchanged `--state earlier_view`
fixture on the separately built QA artifact, receive retained frames, and
confirm **Earlier view** and image name
`Live view of city.example. Loading city.example….`. Confirm a replacement
frame ends Earlier view, and context/privacy/stream replacement retains no old
pixels. No screenshot acceptance is claimed by this server change.
