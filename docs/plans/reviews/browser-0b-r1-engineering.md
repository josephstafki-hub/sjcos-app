SCORES: design=8 completeness=7

Engineering judge, round 1. Reviewed `6d3503ee..f11ca3b3` on `t3/browser-0b-acceptance`, including the Phase 0 runtime/memory contracts in `agent-browser-plan.md`, owner context, RESULT, all eight requested handoffs, source changes and every touched test file. Scope is the isolated Phase 0b runtime and its acceptance runner; deferred UI, production wiring, vault workflows and service RPC catalogs are not required fixes here. No source changes or commit. This review is not a root attestation.

What is verified

- Both supplied final1 documents validate against the current validator and bind the current runtime-lock SHA256 `7ff7d9945c4de0891936f419ed1f48ed53349a870b39311311835ac7ebc7b18a`. Network has 28 distinct passing cases; RSS has 15. Both say realRuntime=true, simulated=false, parserTransportIntegrated=true, releaseReady=false. Every case reports zero remaining flows/reservations. RSS reports baseline 50,593,792 bytes, cgroup peak 157,450,240 bytes, request/response/transport pool maxima 52,432,896 / 117,440,512 / 4,194,304 bytes, two response slots/two contexts, directional queue high-water 16,406 bytes, zero OOM and no latch. The actual slow-deadline case took 60,167 ms. These are reported root measurements, not measurements independently rerun by this reviewer.
- Root artifact directories under `/tmp/browser-0b-*-final1.json.d` exist but their root0700 contents return EACCES. Thus I could inspect the supplied summaries, runtime-check log, measurement-producing code and tests, but could not independently recompute PCAP/event/origin/receipt hashes or verify sink signatures from raw artifacts. A summary hash is not independently examined trace evidence. The coordinator/reviewer must examine those private artifacts before signing.
- The applied patch is reproducible against the exact upstream fingerprint. Its tests load the actual patched bundle without launching a browser, enumerate all seven removed upstream resume sites, exercise root/recursive ownership, refuse workers/unknown types/persistent boot/reconnect, and fence detach/crash/revocation. Fresh tests additionally cover pageFor delayed registration, dead boot and timeout, plus prepared-guard expiry and repeated resume.
- Durable exclusive journal claims, exact signed requests, canonical signature rejection, concurrent single-use and distinct identical-request manifests, replay on recreated authority and revoke-during-checkpoint behave as intended in the tested cases. Expiry across durability awaits does not; see required fix 1.
- The 108-case real pinned Python transport suite passed. It exercises actual bounded TLS/parser/socket IO on loopback, downstream TCP acknowledgment, original deadlines, all 15 RSS scenario names, consumed-write unknown/no-retry and repeated cancellation. Its DNS/authority/public-peer substitutions are explicit; it does not replace root containment/RSS evidence. Fresh loopback tests also passed abort-during-authority, seven cancellations while a response send is blocked, short response refusal, clean close_notify EOF acceptance and bare EOF refusal, with complete pool/flow cleanup.
- Launcher argv retains sandboxing and exact ephemeral loopback CDP, HTTP1, no ambient profile or credential shortcuts. Profile-prefix ambiguity/length checks pass. Root ownership, namespace identity and candidate-versus-release gating are present. Actual sandbox kernel state, nft state and launcher cleanup were not executed independently by this nonroot review; flags/release readiness remain off as they should.

Verification performed

Each touched Node file ran separately with a unique `SJC_TEST_CLUSTER_TAG`; each matching cluster stop reported no cluster running afterward. Startup alone used the explicitly disposable `_harness/testdb.mjs` database, real narrow LOGIN and temporary Unix broker. No default/live database was used.

| Touched Node file (`tests/browser-*.test.mjs`) | Passed |
| --- | ---: |
| acceptance-drivers | 11 |
| acceptance-integration | 33 |
| controller | 87 |
| launcher | 15 |
| parser-adapter | 44 |
| playwright-patch | 29 |
| response-budget | 13 |
| root-runner | 17 |
| runtime-boundaries | 19 |
| runtime-gate | 61 |
| runtime-startup | 18 |
| transport | 1 wrapper over 108 Python tests |
| Total | 348 |

All four touched Python test files were covered: parser44 and provision9 through their Node wrappers, transport108 through its Node wrapper, and root-runner5 directly with `/opt/sjcos-browser/py/bin/python -B`. These overlapping wrapper counts are not additional independent tests. The required locked/niced `tsc --noEmit -p .` exited 0; `git diff --check` passed. No browser, Next server/build, root acceptance, sudo, installation or service action was performed. Loopback helpers and disposable test clusters were stopped. No resource-limit kill occurred.

REQUIRED fixes

1. **P1 — Do not release or dispatch authority after its signed expiry.** `lib/browser/controller-authority.mjs:61` checks expiresAt only before four durability/verification awaits at lines 68–71; their subsequent checks inspect only `dead`. `lib/browser/controller-gate.mjs:37` then gives that receipt an independent decision deadline without carrying the manifest expiry. Reproduced using real Ed25519 signatures and a real temporary DurableJournal: signed expiry=10010, checkpoint advances injected clock to10011, and the gate returns allow=true, expiresInMs=989; the subsequent server_connect is also accepted. This is a dispatch after the signed authorization expired, not just a journal entry completing late. Exact change: recheck the original manifest expiry after each asynchronous consume/checkpoint step and immediately before returning authority; retain the burned claim/unknown state on refusal. Carry the signed authority expiry in the receipt and cap the gate/transport transmission deadline by it, so expiry between decision and connect/TLS cannot restore permission. Add regressions for read and write expiry during journal/checkpoint/verifier awaits and between decision and first send.

2. **P1 — Refuse incomplete packet captures, including kernel drops and abnormal final exit.** `lib/browser/controller-network.mjs:20`–27 reads bounded stderr only for readiness, ignores tcpdump's final status and drop statistics, and resolves the exit promise without checking its value. The larger 250k-packet/40MiB budget avoids one early-exit cause but cannot establish completeness. An injected tcpdump process that reports `2 packets dropped by kernel` and exits0 is accepted by capturePackets; final nonzero/SIGKILL exits are likewise unchecked in the finally path. Exact change: retain/parse bounded terminal capture statistics, require a normal expected termination and zero dropped packets, reject missing/unparseable completeness statistics, and wait for stderr close before accepting the PCAP. Preserve that status with each case's measurements. Test early exit, packet-budget exhaustion, kernel drops, abnormal shutdown and truncated records; rerun root network/RSS with this strengthened capture gate before signing their zero-packet claims.

3. **P1 — Make the root RSS pass mean the planned stress actually completed.** `lib/browser/root-fixture.mjs:157`–160 and `:216`–221 accept a historical two-slot maximum plus one sample with any positive response charge; multi-client completion size/digest and the sustained slow-drain interval are never checked. Reproduced: two clients with received=0, only `/control` at the origin, and `{slots:2,pools:{response:1}}` pass `validateRssCase('two-25MiB-slow-readers', ...)`. Simple success cases require only received>0, which includes response headers; they do not prove complete declared/chunked/EOF payloads. Exact change: parse/store safe response metadata, assert exact payload sizes/digests for both25MiB clients and all successful framing cases, exact112MiB charge throughout a measured no-read window and final outstanding TCP tail, and independent2→1→0 slot release. Exercise the plan's eight candidates per context (currently only two active plus six losers total), subsequent completion in both contexts, and concurrent held/frozen request storage with response buffering rather than separate small-response/large-upload cases. Include these facts in observations and rerun the root RSS suite. The stronger loopback checks are good, but do not prove the installed cgroup's acceptance run exercised them.

4. **P2 — Validate per-case evidence semantics and preserve every failing aggregate.** `lib/browser/acceptance.mjs:10`–22 checks only recursive scalar shape and trusts top-level booleans. Starting with the real final1 network document, changing one case's remainingReservations to1 still validates; so does setting diagnosticOnly=true while retaining the full inventory. Existing `browser-acceptance-integration.test.mjs:29` explicitly accepts every measurement as `{packets:0}`. `lib/browser/root-fixture.mjs:215` overwrites automaticRetries and consumedWriteOutcome with the last case: reducing an earlier retry1 followed by retry0 returns0. Exact change: require the actual measurement schema, positive control/event counts, bound hashes, per-case zero unauthorized/private/retained counts and verified ordering; reject diagnostic documents explicitly. Recompute/check top-level totals from cases. Reduce retries conservatively and preserve/reject invalid consumed-write outcomes across every relevant case rather than taking the last one. Replace the permissive test positives with complete realistic measurements and add mutations of real-shaped documents. This does not require pretending schema validation authenticates root provenance; that remains the independent signature's job.

5. **P2 — Prove each actual write's authority and the child's own barrier path.** `lib/browser/root-fixture.mjs:211` skips authority checking entirely when a nonzero upstream write lacks requestDigest; its `verifyOrdering` returns true for a write with no digest or consume as long as unrelated attach/guard/Fetch events exist. The touched test at `tests/browser-root-runner.test.mjs:50` endorses that behavior. The origin-to-consume comparison at root-fixture:166 is existential, so repeated identical bytes can match one consume. The popup/OOPIF test at:167 only counts requests to the same path, without requiring a distinct paused child of the expected type/target. Exact change: require valid flow/target/digest identity on every nonzero write, match it to a unique durable consume/checkpoint and digest registration, and check matching target attach→guard→Fetch ordering. Compare origin requests/consumes as a multiset, not `some()`. Require a real child page/iframe attach with its own guard/resume and origin request; do not let the parent's positive navigation satisfy child acceptance. Add missing-digest, duplicate-origin, wrong-target and no-OOPIF negative tests; rerun the affected root cases. The final1 summary's three origin requests alone cannot prove that specific barrier path.

6. **P2 — Remove the startup test's stdout/exit race.** `tests/browser-runtime-startup.test.mjs:88` awaits child `exit` and immediately JSON.parse(out) at:89. Node permits exit before the stdout pipe drains. A real child writing a small JSON document with stdout paused until exit produces out="" at exit and complete JSON at close. Delaying this test's launcher stdout data delivery also reproduces `Unexpected end of JSON input` at:89 (17/18 passing). The original uninstrumented load-only failure did not recur here, so I cannot assert it had this exact cause; this is nevertheless a concrete race in the touched test. Exact change: create a completion promise immediately after spawn that waits for `close`/stdio EOF (handling error and a bounded timeout), then parse the complete output. Do the same wherever stderr is needed for exit diagnostics, and clear timeout handles. Add a regression using ordinary delayed/paused pipe consumption rather than rerunning until green; do not relax replay/role assertions or just increase the timeout.

Harness-change assessment

- The source/type-bounded NDP/MLD exception is narrower than ignoring all IPv6; fresh tests confirm link-local UDP still counts private. It is reasonable for fixture link control, but it is classification, not a proof that a packet was kernel-generated. Optionally require valid message structure/hop limit and record a small count bound rather than accepting arbitrary bytes with an exempt type.
- Counting only dedicated-gate-UID processes after its deliberate exit70 is reasonable because the root supervisor is intentionally charged to the same cgroup. It proves no gate-UID process remains there, not literally an empty cgroup. The separate final cgroup teardown must still succeed. No requirement to pretend a dead gate can return terminal allocation stats.
- TLS close_notify for the unknown-length origin is correct. Fresh clean/bare EOF tests passed, preserving truncation refusal; document the real-server interoperability limitation as RESULT already does.
- Worker-source JSON.stringify and explicit waiting-worker/no-resume observations correct the former vacuous SyntaxError test. The8s external navigation bound is appropriate for nullProgress, provided a timeout cannot itself count as a semantic refusal; the remaining positive/negative checks need fixes3–5.
- Headless-shell selection keeps the unknown-target deny policy intact; the short hashed profile prefix preserves task/user separation with mkdtemp freshness. SO_REUSEADDR, uppercase case names, root-only fixed diagnostic codes, ENOENT close handling, DNS readiness retry, network-only nsenter and private nft files are reasonable integration fixes. Larger capture limits require fix2 rather than assuming no packets were lost.

Optional follow-ups

- Refactor launchVerified cleanup to return a shared close promise and put initial directory creation/chown inside its cleanup scope (`lib/browser/launcher.mjs:63`–69). A concurrent close currently returns immediately once closed is set, and early mkdir/chown failure precedes the try/finally. The root runner's final cgroup/artifact cleanup limits the present acceptance impact, but the launcher API should have independently testable cleanup completion/failure semantics.
- Preserve explicit independent proof of actual Chromium sandbox state and redacted secret-canary checks in the signed acceptance bundle. Current argv/code checks and the two JSON summaries alone do not establish kernel sandbox state or absence of secrets across journald/CLI/app error outputs. Actual CLI resolved-policy/sandbox/reviewer evidence remains a correctly named runtimeReadiness blocker and must not be inferred from this review.

Fresh adversarial results (expectations were recorded in this file before execution)

Cases1–6,8–18,22–25 met expectations. Case7 reproduced required fix1. Cases19–20 reproduced required fix4. Case21 reproduced the reducer defect in required fix4. Cases23–25 used real loopback TLS/socket/parser IO and closed all helpers. Case25 additionally ran both close_notify and bare-EOF variants. The restart case used a shared exclusive-claim fixture; the existing controller file separately exercised real DurableJournal restart/replay. The real-filesystem, signed authority→gate repro above further confirmed case7. Extra adversarial probes reproduced required fixes2,3,5 and the stdout race in6. No browser or privileged root runner was invoked.

25 fresh adversarial expectations:
1. Duplicate concurrent exact signed reads consume one claim and acknowledge at most once.
2. Two independently signed manifests for identical reads allow both concurrent consumes, without reusing a pair.
3. Restart against the same journal refuses an admitted manifest replay.
4. Revocation while a checkpoint is pending cannot return successful authority.
5. A signature with altered request bytes is rejected before journal writes.
6. An expired manifest is rejected before admission.
7. A late original request deadline cannot be extended by a successful checkpoint.
8. A stalled Fetch-enable attach times out and never resumes.
9. A prepared guard that expires before resume cannot later resume.
10. A duplicate guard resume never sends a second runIfWaitingForDebugger.
11. Worker attach closes/revokes without any resume.
12. Revoke RPC rejection during fire-and-forget barrier failure stays contained.
13. pageFor returns a page registered after attach approval.
14. pageFor refuses a dead boot even if a page map entry exists.
15. pageFor timeout refuses and revokes without a page.
16. Launcher arguments preserve sandboxing and refuse relative/NUL profiles.
17. Profile prefixes distinguish ambiguous user/task concatenations and stay short.
18. Evidence with a failed case cannot pass a full suite.
19. Evidence with diagnosticOnly:true cannot qualify as full acceptance.
20. Evidence with a per-case nonzero retained reservation cannot qualify as a passing suite.
21. RSS aggregation cannot erase an earlier retry or invalid unknown outcome.
22. Packet classification counts link-local UDP as private, while accepting only the specified ICMPv6 control traffic.
23. Transport cancellation while waiting for authority releases all slots/representations and closes the listener on fatal policy loss.
24. Transport retains reservations until downstream acknowledgment and releases them after repeated cancellation.
25. Response refusal and TLS clean/bare EOF paths never leak partial responses or retained buffers.

