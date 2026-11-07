SCORES: design=10 completeness=10

Engineering judge, round 3. Reviewed HEAD `6e82a50500af1368d973352aa99318c2f5c364b9` on `t3/browser-0b-acceptance`, draft PR #123, the round 1/2 engineering and round 2 security findings, the Phase 0 runtime/failure/memory contracts, commit `7b102970`, and RESULT’s “Round 2 fixes” and “Round 2 — root re-acceptance”. Scope remains the isolated Phase 0b candidate. This review file is the only authored write; no source edits or commit. No root/sudo, browser launch, Next server/build, installation, protected-runtime writes, live database or service actions. This is not a new root attestation or release approval.

Fresh adversarial expectations, recorded BEFORE execution:

1. Dispatch with a foreign listener cookie refuses, even with the correct digest and decision.
2. Binding replacement while the dispatch binding lookup is awaited refuses.
3. Original signed expiry reached during the dispatch binding lookup refuses.
4. A real blocked upstream socket send, resumed after controller death, sends no further bytes; pidfd watcher cuts without the periodic lease.
5. Controller death while the final dispatch RPC is pending refuses before any request send/dispatch-confirmed event.
6. Retained capture with an abnormal terminal signal refuses even if copied capture fields claim success.
7. A retained PCAP whose record count differs from terminal captured count refuses.
8. Altered raw allocation maxima cannot hide behind unchanged copied per-case and aggregate RSS objects in a complete signed artifact round trip.
9. A non-finite raw RSS sample refuses before aggregate reduction.
10. A buffered response already closed at the overlap sample cannot prove frozen-request/response overlap.
11. OOPIF subresource digest registration attributed to the opener cannot substitute for the child's own registration/write.
12. OOPIF in another browser context refuses despite valid parent navigation and child subresource paths.
13. Parent document navigation with a different frame ID cannot establish the selected OOPIF's identity.
14. Lost detach ACK plus an observed detach for another target refuses despite a matching session string.
15. A named detach revocation preceding the independently observed session detach cannot establish causality.

Fresh results: **15/15 met their recorded expectations**. Cases 1–3 and 6–15 ran as one Node stdin module without modifying a test/source file. The artifact cases first passed a complete filesystem round trip with actual Ed25519 checkpoint signatures, consume records, independent sink records, receipt hashes, PCAP, terminal statistics, origin/events/results, allocation samples, and retained tail evidence. Each mutation then failed at its intended predicate. Cases 4–5 ran with `/opt/sjcos-browser/py/bin/python -B`: case 4 included both resuming a genuinely full kernel socket after controller SIGKILL (zero additional bytes), and independent pidfd-watcher cancellation of that pending write with no lease task. Case 5 killed the separate controller while the final RPC was parked, then released a correctly bound stale success reply; no dispatch-confirmed event or upstream send became possible. All helper processes/sockets/tasks and temporary artifacts were cleaned up.

## Round 2 required items verified

- **E1 — FIXED.** `lib/browser/root-fixture.mjs:462` now reads retained ingress and bypass capture terminal facts/stderr, reruns `captureStatus` and `fixturePacketMetrics` with the retained interface identity, and compares the derived statistics, packet classes/counts, wire bytes and hashes. The original clean-summary/kernel-drop, private UDP and bypass contradictions all refuse. `deriveRss` at `:441` reconstructs RSS from capped raw allocation samples, terminal pool/handler stats, cgroup observations, gate/controller events, origin results and exact write-bound durable unknown receipts; artifact verification compares that result with both copied RSS objects. `lib/browser/acceptance.mjs:65` rejects invalid case-local values and requires each named case’s backpressure/unknown/compression predicate before reducing aggregates. `root-fixture.mjs:368` requires strictly ordered samples covering the hold with <=250 ms gaps; `:376` binds simultaneous frozen request charge to a genuinely buffered, not-yet-closed response. Existing negatives plus fresh 6–10 cover retained contradictions, raw/copy disagreement and dead-flow overlap. Positive complete signed artifact revalidation passes.
- **E2 — FIXED.** `lib/browser/root-fixture.mjs:279`–312 preserves the exact parent document request, binds its frame ID to the actual iframe target and the opener’s browser context, and additionally requires the iframe’s own guarded `GET https://child.example/oopif-first-request/sub` Fetch → consume → digest registration → flow write → origin digest. `verifyOrdering` independently checks the unique durable consume/checkpoint and target guard ordering. The real fixture HTML issues the subresource and the explicit authority inventory approves it. Existing unrelated-frame/removed-Fetch negatives and fresh opener-registration/cross-context/wrong-navigation-frame mutations refuse. The coordinator’s r2a summary reports childBarrierVerified=true under the new predicate; its private raw event chain was not independently accessible here.
- **E3 — FIXED.** `lib/browser/fixture-controller.mjs:92` independently observes the bound session’s parent CDP detach, forwards it to the registered production disconnect handler, and retains session binding, detach attempt and observed session/target identity. `lib/browser/controller.mjs:86` produces the named session-specific fence/revocation. `root-fixture.mjs:314` recomputes the attempt/binding and, for lost ACK, requires that observed detach followed by its matching `BROWSER_SESSION_DETACHED` revocation. Arbitrary later boot failure no longer suffices. Production-handler enabled/disabled regressions pass; invalid-session/unrelated-revoke, wrong-target and reversed-causality probes refuse. The supplied root detach is acknowledged=false, detachObserved=true, detachRevoked=true, with nonempty session/target and eventMark=21; zero browser survivors and exact durable unknown are reported.
- **E4 — FIXED.** `tests/browser-response-budget.test.mjs:15` starts from complete per-case evidence that actually validates, then mutates the named compression/backpressure cases; 13/13 pass. `deploy/browser/root_runner_tests.py:12` explicitly returns True for successful settlement and separately asserts both False and None cannot acknowledge durable revoke; 13/13 pass. Production checks were preserved.
- **Security S1 — FIXED within the documented dispatch contract.** `lib/browser/controller-gate.mjs:50` requires single-use post-TLS dispatch authority for the exact flow, binding, request digest, decision and original expiry. `deploy/browser/transport_control.py:161` pins the authenticated controller’s kernel pidfd; its independent watcher revokes/cancels IO without waiting for a lease. `transport_runtime.py:300`–329 rechecks the original decision deadline and that pidfd after the dispatch RPC, between TLS records and through the guard in `AsyncSocket.write` immediately before every nonblocking kernel send, including after a blocked send resumes. The two real TLS/separate-process SIGKILL regressions pass inside the 118-test transport suite: post-TLS/pre-dispatch sends zero HTTP bytes; upload death permits only the already queued prefix, leaves exact fsynced unknown/no-retry, and consumes once. Fresh 1–5 exercise further binding/expiry/await/blocked-send boundaries. The root fixture releases both fault holds immediately after kill without waiting for loss observation and applies the zero-byte/upload-prefix predicates; r2a reports both passing.

## REQUIRED fixes

None.

## Evidence and limits

Both supplied r2a JSON documents were loaded and independently passed the current `validateEvidence`: network **28/28**, RSS **15/15**, realRuntime=true, simulated=false, parserTransportIntegrated=true, releaseReady=false. They bind runtime-lock SHA256 `09f06b8481f8ee6c6a721dc60f9b5819ef4d4f02c89690c2ca2cee54278e9b0c`, matching HEAD. All 61 local files in that lock and all 35 launcher inventory files match their recorded hashes. The coordinator ran root acceptance at `7b102970`; `6e82a505` adds the RESULT record, without changing runtime bytes.

The summaries live at `~/qa-sjcos/browser-acc/r2a/browser-0b-{network,rss}-r2a.json`. Their retained artifact directories `/tmp/browser-0b-{network,rss}-r2a.json.d` return EACCES. Thus the root packet traces, cgroup samples, actual OOPIF/session event chains and signatures are coordinator-reported evidence, not raw artifacts independently reread by this reviewer. The actual new artifact verifier and complete positive/negative artifact round trips were exercised locally, without claiming to have rerun root acceptance.

The RESULT now accurately states the dispatch linearization point and its limit: a userspace pidfd check plus send is not an atomic physical-death fence. Death racing that syscall and already queued/in-flight bytes cannot be recalled; a dispatched consumed mutation stays unknown and cannot retry. This closes the previously unchecked post-TLS and between-record paths without claiming zero-time revocation. The existing active-response case still waits for independent controller-loss observation before reader release; it does not certify kill-to-CUT latency or zero bytes from the instant of SIGKILL. Release readiness remains false.

## Verification performed

Every Node test file touched since base `6d3503ee` ran separately, using `SJC_TEST_CLUSTER_TAG=r3-eng-6e82a505-20261107`; the matching cluster stop ran after each file and again at completion. Startup used only `tests/_harness/testdb.mjs`’s disposable Unix-socket PostgreSQL. No default/live DB URL was used. Each cleanup reported no cluster running at the point it was checked.

| Touched Node file (`tests/browser-*.test.mjs`) | Passed |
| --- | ---: |
| acceptance-drivers | 11 |
| acceptance-integration | 42 |
| controller | 87 |
| launcher | 15 |
| parser-adapter | 44 |
| playwright-patch | 30 |
| response-budget | 13 |
| root-runner | 17 |
| round1 | 69 |
| round2 | 26 |
| runtime-boundaries | 19 |
| runtime-gate | 61 |
| runtime-startup | 19 |
| transport | 1 wrapper over the 118-test Python suite |
| Total | 454 |

All four touched Python test files were covered using the pinned `/opt/sjcos-browser/py/bin/python`: transport118, parser44 and provision9 through their individual Node wrappers; root-runner13 directly with `-B`. These wrapper/Python counts overlap. The shared `browser-round2-fixtures.mjs` helper was exercised by response-budget and round2. The fresh Python cases also used that pinned interpreter with `-B`.

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited 0. `git diff --check` passed. No resource-limit kill occurred; SIGKILLs in the tests deliberately targeted the named disposable controller processes. Test loopback listeners and disposable helper processes were cleaned up by their fixtures. Another reviewer’s `browser-0b-r3-security.md` appeared during verification and was left untouched.

## Optional follow-ups

1. Preserve explicit kill/release/first-CUT timestamps and independent ingress-byte observations for the active-response controller-loss case (`lib/browser/root-fixture.mjs:156`), so a later review can measure the response-side detection/drain interval. This is still optional; the current RESULT states its limitation.
2. Earlier optional release-artifact hardening remains optional: independently retain actual Chromium sandbox state and redacted secret-canary/journal checks in the eventual signed release bundle. This isolated candidate’s engineering score does not bypass readiness blockers or authorize Phase 1/release promotion.

