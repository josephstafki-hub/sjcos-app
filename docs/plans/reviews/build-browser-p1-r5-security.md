SCORES: design=10 completeness=10

Security judge, build round 5. Reviewed HEAD `c7ce2675` on `t3/browser-phase1`, round 4 security review, R4 UI, R4b UI, R4c SERVER and R4d AUDIT handoffs, and changes since `2400225b`. No source edits, delegates or commits. Scores cover source security and the tests below, not deployment approval.

## Verified

1. **Earlier view respects the presentation fences.** `components/panel/useBrowserSession.ts:35–53` clears the frame ref, displayed URL and control token on context generation, privacy boolean or privacy-mode changes; owner private authorization loss also clears presentation. The frame gate rejects regressing revision/generation. Lifecycle replacement clears presentation and recreates the gate. Stream cleanup, reauthentication and changed stream bindings discard retained pixels; aborted/stopped/rotated callbacks cannot republish them (`:114–130`). Replacement frames must match current control/document epochs. Earlier view adds only a loading presentation state; it does not create a frame history or a new fetch path.

   The 217 UI tests include retained-frame privacy/context/rotation/stream-ID/generation cases and replay late callbacks. Four additional in-memory tests passed: an owner watching public Earlier view transitions to private with no consent and loses all displayed pixels; auth-signal, conversation and owner-role changes each clear the retained frame and reject the old callback. Existing owner Watch tests require explicit consent and server audit authorization. `BrowserView.tsx:15–17,93` independently suppresses the image for unauthorized private Watch. Different viewer/session authority remains checked by the server on every frame; no new cross-person frame path was found.

2. **Retention is application-level, not guaranteed physical erasure.** Frame references and displayed data URLs are cleared at observed fences, without storage/history/cache fallback. API requests use `cache:'no-store'`; frame/SSE responses use private/no-store/no-transform headers (`components/panel/browser/api.ts`, `lib/browser/web-transport.mjs:51`). Leases retain join metadata/credentials, not frames. An authorized browser can still have immutable strings, pending decode buffers, React's prior state or decoded image memory until garbage collection; this code does not securely erase those bytes, and no such guarantee should be claimed. Nor can a remote transition erase pixels already delivered before the client observes revocation. No application-accessible retained-frame replay across the inspected fence paths was demonstrated. These are the existing authenticated-human presentation semantics, not model access to private pixels.

3. **Loading is strictly bounded current public metadata.** `lib/browser/web.ts:121–135` obtains loading through controller task `read_state`, parses strict `TaskSafe` and `ControllerNavigation`, and matches task ID, boot, run, context generation, document epoch and control epoch. It then rereads the task and exact viewer/task/session/person binding, requiring unretired current attendance and unchanged stream ID/generation. Private/delegated, unavailable, malformed, absent and stale replies yield false; no cached loading fallback exists. `website-bridge.mjs:56` also forces false for non-public/private tasks. The strict schemas reject coercible values and page fields. Route tests cover changes during the read, including epoch/context/privacy and both stream fields. No other task's state or page text/URL/title enters the boolean projection. Loading grants no navigation, model or input authority.

4. **Lease ownership is local ordering, not server authority.** `useBrowserSession.ts:62–112` transfers effect ownership, waits for pending acquisition before cleanup, checks the departing owner immediately before Leave, and holds replacement acquisition behind an already-sent Leave ACK. Failed retirement blocks replacement; it does not mint authority. The real website/SQL UI test covers five retirement orderings with a second attended device and verifies the accepted viewer stays renewable without pausing its task.

   A malicious client bypassing those local tokens still faces `web.ts:54–84,165`: current authenticated person/session/task authorization, exact viewer ID and device-secret validation, and a task/session/viewer-bound command proof. `browser_web_leave` retires the proven viewer; `browser_web_presence` requires a live viewer and current stream, person and host claim. Neither an ACK delay nor a client ownership token changes those database checks. Revoked sessions/retired viewers cannot be renewed through this UI change. A genuine last-viewer departure or departure of the control holder can intentionally pause the task; this is not arbitrary retirement of another device. The round 4 caveat remains: the random device UUID plus the same authenticated session is confidential recovery material, not hardware identity.

5. **Phase 1 containment remains intact.** Private, submit-guard, outbound-data, production-factory, roles and bridge regressions pass. These changes introduce no model write/submit/final-action execution surface. Private transition fences and drains public capture/output; private frames remain an intentional authenticated human-only channel with owner consent/audit checks, not model/log/transcript/receipt content. The loading helper serializes only a boolean and catches failures without error/page text. Per-frame website authorization and atomic frame recording still check current session, attendance, stream, task epochs/context and private Watch authorization (`web.ts:211–223`). No new private-content sink was found.

6. **QA is not selected by production runtime configuration.** Production `lib/browser/runtime-endpoints.ts` still uses fixed protected sockets and the installed website bridge. The QA endpoint leaf is a separate side-build overlay. Reviewed QA deltas add fixture recipes/loading/audit-release controls; they do not add a production import or environment selector. QA hooks retain explicit QA database/private-path/cluster-pin/scenario checks. Private-query scan passes. No emitted-bundle exclusion or new root network/RSS acceptance is claimed: builds, browsers and network work were prohibited. The coordinator's committed acceptance results are external evidence, not runs by this judge.

## REQUIRED fixes

None.

## Optional

1. Promote the four in-memory owner/scope retained-frame probes into permanent UI tests. Preserve the distinction between removing application references and guaranteed browser-memory erasure in documentation.
2. Retain prior optional production-artifact QA exclusion verification and authenticated project-search throttling. Neither became a demonstrated authorization bypass in this round.

## Verification and cleanup

Single-file runs, sequential, all passed with zero failures/skips/cancellations:

| File | Passed |
|---|---:|
| browser-ui | 217 |
| browser-owner-review | 18 |
| browser-routes | 53 |
| browser-contract | 41 |
| browser-live-view | 13 |
| browser-private | 22 |
| browser-submit-guard | 20 |
| browser-outbound-data | 33 |
| browser-production-factory | 62 |
| ask-private-query-scan | 11 |
| browser-phase1-bridges-db | 29 |
| browser-roles-db | 12 |
| Additional in-memory UI fence probes | 4 |

Total **535 passing executions**. Additional probes were appended by an stdin-created Node loader, selected by test-name pattern, without writing a test/source file. The same loader removed the UI suite's hardcoded R4 cluster-tag assignment in memory so every DB-bearing run used `SJC_TEST_CLUSTER_TAG=browser-p1-sj5-9c83a`. Both database URL environment variables were unset; outbound adapters were disabled. All database work used `tests/_harness/testdb.mjs` disposable Unix sockets. UI fixture cleanup stopped its cluster; the outer finally stopped the subsequent cluster and returned `stopCluster true`.

No live DB, QA cluster, network, browser, Next command, tsc, sudo/systemctl, dependency installation or service operation. No killed/137 process. QA fixture tooling was source-reviewed, not executed in this round. Only this review file was authored; test harness temporary database artifacts were cleaned up.
