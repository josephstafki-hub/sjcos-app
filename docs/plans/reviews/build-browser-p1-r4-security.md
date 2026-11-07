SCORES: design=10 completeness=10

Security judge, build round 4. Reviewed `9d2db040` on `t3/browser-phase1`, the round 3 security review, both R3 SERVER/UI handoffs, and changes since `e741ccf2`. Scores cover the requested source/security review, not deployment approval or unperformed installed-browser acceptance. No source edits or commits.

## Verified

1. **Round 3 required fix is complete.** `tests/browser-outbound-data.test.mjs` retains 25 pending candidates, preserves revision/no-digest/no-approval assertions, accepts 192 and refuses 193. All 33 tests pass. Route paging remains limited to 20 and its suite passes 52/52. Storage of pending candidates does not confer read/transmit authority.

2. **Device reuse is session- and task-bound.** `lib/browser/web.ts:136` derives the initial credential with HMAC-SHA256 over a purpose tag, verified session ID, task ID and parsed device UUID. Different request keys do not change it. Supplied viewer credentials instead pass `authorize`/`loadViewer` (`web.ts:54–75`); the row must belong to the task, session and person, be unretired and have current attendance. Credential hash comparisons at that web boundary use `equal`, backed by `timingSafeEqual` (`web-transport.mjs:56`). A UUID alone under a different session cannot recover the other session's credential, even for the same person. Fresh real-website-LOGIN probes confirmed distinct viewer IDs/secrets for that case and 403 for copied viewer/secret headers under the other session, without retirement or stream mutation.

   **Exact security semantics:** the in-memory `crypto.randomUUID()` in `useBrowserSession.ts:19` is itself a session-scoped recovery secret, not a public device label. Knowing that UUID *and possessing the same authenticated session* intentionally recovers the same viewer and device secret without the previous response. This is the lost-response recovery contract; it is not an independent hardware-device identity or a defense against compromise of both values. Neither guessing a random UUID nor supplying another session's UUID gives this authority. The join body is digested for the command record; no raw UUID/device-secret logging was found in the inspected join/client transport path. SQL compares server-derived fixed-size hashes using ordinary equality, not a claimed constant-time SQL primitive; externally supplied existing credentials are checked in constant time in the web layer. Do not describe all SQL comparisons as constant-time.

3. **Limits, retirement and private Watch remain fenced.** `db/migrations/0115_browser_phase1_runtime.sql:187–228` retains the task lock around retirement, same-session/device reuse and slot counting. Invalid identity/role/proof is rejected before retirement. Reuse does not increment the number of viewers or mint a control token. Two initiator slots and one owner slot remain enforced; independent LOGIN contention tests pass. Additional probes confirmed a second owner session using the first owner's UUID gets 429, while retries in the original session reuse its viewer. Expired attendance produces a new viewer/stream and retires the old row; a revoked web session gets 401. Existing DB tests confirm stale streams/control cannot revive and retirement clears private consent. A fresh owner private-view request advances the consent serial and requires its own independent audit ACK; private-context/stream changes invalidate prior authorization. No cross-session theft of an existing private Watch authorization was found. Same-session recovery has the secret semantics described above.

4. **Project picker authorization and minimization pass.** `lib/actions/browser-projects.ts:9` uses `askBoundary`; `lib/ai-chat.ts:369–379` revalidates the signed-cookie principal and current active/revocation/role/AI rights via `threadPrincipal`, then checks current Projects access. Owners see all projects; staff need AI and Projects. This matches the current Projects area model: no additional per-project ACL exists to apply. Clients and revoked or permission-removed staff fail. The real action runs through an actual website LOGIN fixture. Queries select only `slug,name` from `projects`, with a literal `kind:'project'` added to the response: no lead/client lookup, contacts, money or separate address fields. A project name/slug may naturally contain a client or street name; those are the requested authorized picker labels, not a promise of anonymous labels. Input must be a string of at most 120 characters, parameters are bound, `%`, `_` and backslash are escaped, and results cap at 20 with deterministic ordering. Errors serialize fixed codes rather than SQL/error details. Rate limitation is addressed explicitly below.

5. **Phase 1 containment remains intact.** The changed server paths add no model-write, submit or final-action execution surface. Submit guard, outbound-data, private fencing, production factory and route regressions all pass. Private transition cancels/drains public observations, model capture and output before manual/private operation; stale work cannot publish afterward. No new page-content path to model/log/transcript/receipt was found. Private frames remain an intentional authenticated human channel, not a model output: current viewer/stream authority and, for owner Watch, consent plus audit ACK are required. This is source and mocked-transport/real-SQL evidence, not a new installed-browser private-canary run.

6. **QA remains separate from production execution.** Production `web.ts`/`web-rpc.ts` still import the fixed `runtime-endpoints.ts`, which delegates to the protected installed bridge; runtime QA environment values cannot select the fixture. The source graph scan and real QA fixture suite pass, including real role LOGINs, guard refusal, scenario membership and refresh retirement. The seed change stays in `scripts/qa-seed-browser.mjs`. No production-reachable QA selector was found. As in round 3, this does not establish exclusion from emitted Next chunks/traces: no build was permitted. Coordinator root network/RSS results are external acceptance evidence, not tests performed by this review.

## REQUIRED fixes

None.

## Optional hardening

1. Add an authenticated-principal search throttle before the project query at `lib/ai-chat.ts:369` (or in the action). The new server action does **not** traverse Browser's `RateWindow`; neither `askBoundary` nor `threadQuery` supplies a rate limit. The 120-character/20-result bounds limit one call, not request frequency or a leading-wildcard scan's work. This is an authenticated read availability improvement; no authorization bypass or unbounded result disclosure was demonstrated. Keep failures fixed-code and test burst refusal plus recovery without logging queries.
2. Document `device_id` as confidential recovery material and preserve its memory-only lifecycle and exclusion from telemetry. Promote the two additional session/expiry/owner-slot probes below into permanent regressions if desired.
3. Retain round 3's optional QA artifact hardening: mark built QA output, reject it at production promotion, and inspect the coordinator-built production dependency traces for fixture modules. Source reachability tests do not substitute for that artifact check.

## Verification and cleanup

Sequential single-file runs, all zero failures/skips/cancellations:

| Test file | Passed |
|---|---:|
| browser-r3-server | 4 |
| browser-outbound-data | 33 |
| browser-phase1-bridges-db | 29 |
| browser-roles-db | 12 |
| browser-private | 22 |
| browser-submit-guard | 20 |
| ask-private-query-scan | 11 |
| qa-browser-fixture | 19 |
| browser-production-factory | 62 |
| browser-routes | 52 |

An additional stdin-only loader appended two probes to `browser-r3-server` in memory (no test/source file written), rerunning its four tests plus: same UUID across two sessions/cross-session credential refusal/expiry/revocation; and owner same-session reuse versus second-session slot refusal. All **6/6** passed. Thus 270 passing executions, including four repeated baseline tests.

All database operations used `tests/_harness/testdb.mjs` with `SJC_TEST_CLUSTER_TAG=browser-p1-sj4-f7a92`, DATABASE_URL/SJC_TEST_DATABASE_URL unset and disposable Unix sockets. Authorization checks used actual website/narrow LOGIN connections; historical administrative fixture setup is not counted as LOGIN proof. Final explicit `stopCluster()` returned **true**. No live/QA-port database, network request, browser, Next command, sudo/systemctl, dependency installation, tsc or service operation; no exit 137/Killed. Only this review file was authored; the concurrently appearing engineering review was left untouched.
