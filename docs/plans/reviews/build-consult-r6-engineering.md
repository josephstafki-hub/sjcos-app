# Build R6 — Engineering judge

SCORES: design=9 completeness=9

Reviewed `t3/in-home-consult-backend` at `2f30e57d9bfb3571eb100614d8059bd2f55ba7b9`, R5 engineering, the in-home consultation plan (Phase 0/1 scope), and commits `c2707285`, `f5b2668a`, `2f30e57d`. No code edits or commits. Deferred audio, helpers and form editor are not scored as missing Phase 1 work.

## Required fixes

1. **P1 — Close is not fenced across lock/unlock or engine replacement.** `lib/consult/ui/controller.ts:521–555`, especially `:543–547`, and `:579`. The transport timeout correctly fences a timed-out HTTP promise, but `resumeClose()` captures neither the controller memory epoch nor the engine identity. Lock/lease expiry/dispose clears decrypted state while the pending Close continues. Its eventual completion calls refresh, clears the Close intent through the current `this.engine`, and publishes its old result. An old failure likewise publishes state and schedules retries after lock.

   **Repro:** start a persisted Close with its response held; call `lock()` before releasing the response. In an in-memory controller reproduction using the actual `post`/deadline transport, state goes from `closing=null` after lock to `closing={step:"done", result:...}` after release. Repeat with a replacement engine installed after lock (the unlock boundary): the old response invokes that replacement engine's `clearCloseIntent()` once and sets `done`. This can erase a newer durable Close intent and show an old result after re-entry. The phase guard currently prevents immediate rendering on the locked screen; it does not protect the new unlocked session or durable intent.

   **Fix:** give Close an owned attempt token containing engine identity and memory epoch; invalidate it on lock/dispose and engine replacement. Check it after every await and before writing requests, clearing intent, setting results/errors, changing guards or scheduling retries. Bind operations to the captured engine and clear only the matching durable request. Keep the same-request idempotent replay on transport timeout. Add regression tests for late success and failure after lock, re-unlock with a newer Close intent, and lease expiry/revocation during refresh. Do not reset a shared boolean in an old attempt's finally when a newer attempt owns it.

## Requested checks

- **R5 close-stall fix:** fixed for transport timeout/retry. `deadlineFetch` consumes `arrayBuffer()` inside the 15-second race, aborts on expiry and maps it to `http_408`. Late body resolution has no caller continuation. R4 logic tests cover stalled bodies, direct and drain-owned Close, exact durable request replay, and late old-body completion. Production evidence reports the 26-second POST hold, visible timeout and Try again settling to Needs finishing. This does not cover the separate lock/engine boundary above.
- **Reconcile after every answer:** serialized with controller writes, bounded by pinned slots/presets, no recursive call into public answer in the reconciler. It only writes when required instances/defaults are absent; ordinary answers do incur extra snapshot/model reconstruction and scans but no extra durable batch when nothing is missing. Footing zone writes the dependent depth and reconciles twice, a bounded overhead. No runaway loop found. One active capture device is the Phase 1 contract; reservation locking and device epochs exclude simultaneous authorized capture devices. Random required-instance IDs are not a distributed multiwriter reconciliation protocol; do not enable helpers on this implementation without that later work. Same-enrollment multi-tab writing is not established as supported by these tests.
- **Shared flags:** server protocol and device model call `evaluatedFlags`, backed by the same `conditionMatches`. Device globals now include pinned scalar derivations, and hidden/derived flags enter the wrap flag list. The test compares device flag keys with server-style evaluation, including a derived field. No new device/server mismatch found.
- **Summary and initials:** `closing.summary` is correctly optional in the seed/test. Client acknowledgment passes the rendered allowlisted recap text; engine capture stores the summary operation and initials metadata together in one encrypted visit-record commit. Blob bytes are saved first; failure of the metadata commit can leave an orphan blob but cannot publish half an acknowledgment. No additional summary text entry is required. The controller builds this operation outside its normal answer-write chain; the current client-only screen and awaited Closing setup constrain that path. Do not treat it as general concurrent answer capture without serializing operation construction too.
- **1/16:** parser accepts denominator 16 and preserves storage to sixteenths; fields with sixteenth precision pass it through to formatting. R4 logic tests exercise sixteenths; keypad has the sixteenths choices. No expression evaluation introduced.
- **RRP:** No with unknown or pre-1978 year now raises the written-reason conflict; known newer years do not. Unknown/unanswered/skipped age remains conservative. This is code-path consistency review, not a new legal opinion.
- **Pinned screens / scroll:** fixed viewport roots and clipped document scrolling coexist with the pane-scoped scroll helper; it finds an ancestor pane rather than scrolling the document. No static regression found. Accepted coordinator phone/portrait/tablet evidence and zero-overflow logs; the supplied log also contains failed tabletL automation selectors, so it is not complete tablet interaction proof. User-supplied successful phone/tabletL fuel-appliance evidence supports immediate child creation. No new browser or physical-device verification performed.
- **DB roles:** no new tables or DB write paths in these three commits. Existing command bridges and manifest isolation remain covered by the manifest and narrow-role path suites.

## Verification

**172/172 tests passed, zero failures/skips, across 32 files**, run individually and sequentially with `SJC_TEST_CLUSTER_TAG=consult-judge nice -n 19 node --test tests/<file>.test.mjs` (bootstrap first). The tagged cluster was stopped after the last test process exited. Prescribed type-check `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p . ; echo exit=$?`: **exit=0**.

| Test file | Passed |
| --- | ---: |
| `tests/consult-migration-bootstrap.test.mjs` | 1 |
| `tests/consult-access-db.test.mjs` | 3 |
| `tests/consult-backend-integration-db.test.mjs` | 3 |
| `tests/consult-completeness.test.mjs` | 6 |
| `tests/consult-findings-db.test.mjs` | 9 |
| `tests/consult-forms.test.mjs` | 5 |
| `tests/consult-formula.test.mjs` | 3 |
| `tests/consult-hints.test.mjs` | 7 |
| `tests/consult-length.test.mjs` | 3 |
| `tests/consult-mcp.test.mjs` | 2 |
| `tests/consult-offline-db.test.mjs` | 4 |
| `tests/consult-offline.test.mjs` | 23 |
| `tests/consult-queue.test.mjs` | 5 |
| `tests/consult-r1-copy.test.mjs` | 4 |
| `tests/consult-r1-logic.test.mjs` | 6 |
| `tests/consult-r2-design.test.mjs` | 9 |
| `tests/consult-r3-logic.test.mjs` | 8 |
| `tests/consult-r4-design.test.mjs` | 4 |
| `tests/consult-r4-logic.test.mjs` | 16 |
| `tests/consult-r5-design.test.mjs` | 8 |
| `tests/consult-readiness.test.mjs` | 2 |
| `tests/consult-scope-facts-db.test.mjs` | 4 |
| `tests/consult-scope-facts.test.mjs` | 2 |
| `tests/consult-seed-publication-db.test.mjs` | 1 |
| `tests/consult-seed.test.mjs` | 12 |
| `tests/consult-send.test.mjs` | 2 |
| `tests/consult-sync-db.test.mjs` | 2 |
| `tests/consult-todos-db.test.mjs` | 3 |
| `tests/consult-ui-model.test.mjs` | 6 |
| `tests/estimating-readiness-consult.test.mjs` | 1 |
| `tests/db-roles-manifest-db.test.mjs` | 6 |
| `tests/db-roles-paths-db.test.mjs` | 2 |

Only the disposable `consult-judge` harness cluster was used. No live or QA database, prohibited files, Next command, browser, app server or service operation was used. Additional late-completion reproductions ran entirely in memory and wrote no source/test files. The requested review is the only repository file written.
