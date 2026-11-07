SCORES: design=8 completeness=8

Engineering judge, round 2. Reviewed HEAD `31bf355dc933878190cef8d5bfe61892a29cdd91` against round 1 (`3797df0e`), both prior reviews, the plan's target/gate/memory/failure contracts, RESULT including both requested round 1 sections, all changed runtime/acceptance code and every test file touched since base `6d3503ee`. No source edits or commit; this review is the reviewer's only authored repository file. Another review file appeared during the run and was left alone. This is not a root attestation or release approval.

Round 1 required items verified (one line each)

- Engineering 1 — FIXED: signed expiry is rechecked across durability/checkpoint/verifier awaits, carried into gate authority and bounded through connect/TLS/send; fresh GET/POST expiry probes, including real Ed25519 + DurableJournal fsync/unknown files, refuse dispatch and retain burned claims.
- Engineering 2 — LIVE CAPTURE FIXED; ARTIFACT RECHECK INCOMPLETE: close/stdio completion, zero drops, normal termination, early exit/budget/missing-stat refusal are implemented and regressions pass; required fix 1 below covers contradictory retained capture artifacts still accepted during independent revalidation.
- Engineering 3 — SUBSTANTIALLY FIXED: exact payload sizes/digests, sixteen candidates, measured no-read interval, both real outstanding tails, independent 2→1→0 release and simultaneous frozen upload/response storage are exercised; sample-span and artifact-semantic gaps remain in required fix 1.
- Engineering 4 — PARTIALLY FIXED: placeholder/diagnostic/retention/bad-total evidence refuses, retries use maxima and invalid unknown is sticky; case-local RSS contradictions can still be masked by aggregate reduction, required fix 1.
- Engineering 5 — WRITE CORRELATION FIXED; OOPIF COVERAGE INCOMPLETE: every nonzero write needs identity, unique durable consume/checkpoint/digest registration and target ordering; duplicate origins consume multiplicity; OOPIF parent navigation still substitutes for exercising the child's own Fetch path, required fix 2.
- Engineering 6 — FIXED: startup installs close/stdio completion before parsing, clears timers, and includes the paused-until-after-exit regression; startup 19/19 including disposable narrow-login/replay integration passes.
- Security 1 — FIXED IN REVIEWABLE IMPLEMENTATION: synchronous policy/barrier fencing, shared fatal promise, independent kill versus bounded revoke, Python lifetime-pipe supervision and ongoing gate lease are present; fresh shutdown/control probes and real pinned transport cancellation/loaded cleanup regressions pass; final2 reports zero browser survivors before teardown.
- Security 2 — MOSTLY FIXED: a separate controller is actually SIGKILLed after consume and during retained TLS response, gate exits 70, and independent survivor scans exclude only named supervisors and fail unreadable identity; detach's ack-or-any-later-revoke predicate still cannot establish the named fault, required fix 3.
- Security 3 — IPv6 FIXED; ARTIFACT SEMANTICS INCOMPLETE: full checksummed/bounded/provenance-attributed NDP/MLD replaces the raw type exemption and malformed SECRET-IN-NDP tests refuse; independently recomputing capture/private-packet/RSS facts remains required fix 1.

REQUIRED fixes

1. **P2 — Recompute evidence facts from artifacts and reject case-local contradictions before reducing aggregates.** `lib/browser/root-fixture.mjs:395` checks stderr and PCAP hashes/counts, but does not parse the retained terminal statistics or recompute packet classification. Fresh repro used actual temporary files, a valid signed consume/checkpoint/independent sink, exact write ordering and all required measurement fields: the PCAP contains a private UDP packet to127.0.0.1, tcpdump stderr says `2 packets dropped by kernel`, while the measurement says privatePackets=0/droppedPackets=0. Both `verifyCaseArtifacts` and `validateCaseMeasurement` accept; independently calling `fixturePacketMetrics` returns privatePackets=1 and `captureStatus` rejects kernel-drops:2. Matching hashes prove which bytes were retained, not the facts asserted about them. `lib/browser/acceptance.mjs:65` requires only the existence of RSS observations before aggregate maxima/OR reduction: mutating final2's first case to negative request-pool/queue values, preallocation-backpressure=false, or controller-loss-unknown outcome=null can still validate with unchanged healthy aggregates. `root-fixture.mjs:318` also accepts sixteen hold samples all stamped at the window's first instant, so its artifact pass does not prove a sustained interval.

   Exact change: retain the trusted fixture interface identity/capture exit facts needed for revalidation, rerun captureStatus and fixturePacketMetrics on every retained ingress/probe artifact, and compare every derived capture/classification/count field to its measurement. Recheck bypass artifacts as well. Validate finite nonnegative, capped per-case RSS fields and scenario-specific unknown/backpressure requirements before aggregation; derive/recheck RSS maxima, terminal allocations and named-case predicates from samples/events/results/receipts rather than comparing two copied RSS objects. Require strictly ordered hold samples covering the claimed interval with a bounded sampling gap and explicit buffered-response/frozen-request overlap. Add the above negative artifact round trip and final2-shaped mutations; coordinator must revalidate root artifacts with these checks, rerunning cases where required identity/timing evidence was not retained. Do not weaken the live capture or zero-allocation gates.

2. **P2 — Exercise and bind the OOPIF's own guarded request path.** `lib/browser/root-fixture.mjs:275` picks the first iframe attachment without binding it to the requested frame; `:284`–290 accepts the child-host request entirely on the opener before that iframe exists. A fresh full `verifyOrdering` + `verifyChildBarrier` repro passes with a correctly consumed parent-target child.example navigation and a separate iframe called UNRELATED which only attaches/guards/resumes; it has no Fetch, consume, write or origin request of its own. This does not establish that the OOPIF's installed Fetch handler actually intercepts its first request, the round 1 requirement. The parent-target navigation model is legitimate, but cannot alone supply that missing coverage.

   Exact change: preserve parent navigation proof, retain frame/context/session identity linking that navigation to the actual cross-site iframe, and make the committed frame issue a deterministic same-origin fetch/resource request handled on its own guarded child session. Require child attach→guard→resume→Fetch→unique consume/digest registration→write/origin correlation for that request, plus the original parent's exact navigation authority. Add unrelated-frame and absent/disabled child Fetch negatives, including a mutation that removes child interception. Rerun oopif-first-request under --site-per-process and retain both paths in the artifacts. Popups can continue using distinct browser-level page attachment with their existing own-target request checks.

3. **P2 — An unacknowledged detach needs session-specific fault evidence.** `lib/browser/root-fixture.mjs:91`–93 catches every Target.detachFromTarget error, then `:244`–246 treats any later boot_revoked as proof of actual detach. The revoke event currently carries a reason but no detached-session identity. `lib/browser/acceptance.mjs:63` accepts any string sessionId and that boolean, and artifact verification only compares the copied faultProof objects. A fresh final2 mutation replacing the session with `nonexistent`, acknowledged=false and bootRevokedAfter=true still validates. More fundamentally, the live predicate accepts an unsuccessful detach followed by unrelated policy refusal/monitor failure; that establishes a revoked boot, not the named fault. Final2's actual detach has acknowledged=false, so this is the predicate its claim depends on.

   Exact change: record the intended bound target/session and detach-attempt sequence; when the ack is lost, require an independently observed CDP detach/disconnect for that same session/target, with a correlated detach-triggered fence/revocation recorded before later generic failures. Preserve those events through the bridge and recompute the predicate from artifacts, rather than trusting bootRevokedAfter. Retain no origin / durable unknown / no retry / zero survivors checks. Add negatives for invalid-session protocol rejection followed by unrelated revocation and for disabled detach cleanup; rerun the root fetch-detach case. An ack OR correlated detach observation is reasonable; an ack OR arbitrary boot revocation is a loosening.

4. **P2 — Repair the two reproducibly failing touched test files without relaxing production checks.** `tests/browser-response-budget.test.mjs:14` calls the strict validator expecting success with missing parserTransportIntegrated and placeholder `{parserBytes:1}` measurements; it fails BROWSER_ACCEPTANCE_RUNTIME (12/13). `deploy/browser/root_runner_tests.py:12` supplies `settled=lambda:asyncio.sleep(0)`, which returns None after successful await, and therefore correctly fails the new explicit confirmation check with BROWSER_REVOKE_UNCONFIRMED (8/9).

   Exact change: replace the response-budget positive with a complete realistic evidence fixture, and make its compression/backpressure mutations target the corresponding case predicates so assertions cannot pass merely because the baseline is invalid. Make the Python successful settled fake explicitly return True, and separately assert that False/None raises and cannot return a durable revoke ACK. Rerun both files individually. Their failures contradict the current all-passing handoff claims.

Evidence and acceptance-change assessment

Both supplied final2 summaries validate at HEAD: network28/28 and RSS15/15, realRuntime=true, simulated=false, parserTransportIntegrated=true, releaseReady=false. Their runtime-lock digest is `f26d1131ba1d861604a050ad591dc05f5d2dc99ec9025e08c0434477cedf8099`, matching the current committed lock. RSS reports baseline51,429,376 bytes, cgroup/RSS peak208,654,336 bytes, pool maxima52,436,992 /117,440,512 /4,194,304 bytes, two contexts/two response slots, directional queue16406 bytes, zero OOM/latch/remaining allocations and automatic retries. The slow deadline case is present. The supplied root artifacts `/tmp/browser-0b-{network,rss}-final2.json.d` return EACCES, so raw PCAP/events/samples/signatures were not independently re-read here. These are coordinator measurements, not this reviewer's root observations. Source has only documentation changes after45982097, so final2 is bound to the current runtime inventory.

The readable r1a–r1q logs support the described progression: missing popup/iframe, parent-navigation ordering, detach/loss assertions, slot/tail/shutdown failures, then three successful r1q repeats. They do not replace the inaccessible raw evidence.

- Browser-level popup attachment is reasonable: distinct page target, paused admission, guard/resume and its own exact child-host write remain required. Fresh parent-write substitution refuses.
- --site-per-process strengthens coverage and keeps the worker/unknown-target deny policy; no sandbox-disabling flag was added.
- Parent-target OOPIF navigation is consistent with the observed model, but the new predicate loses child-request coverage as detailed in fix2.
- Ack loss when detach tears down its own transport is plausible. Accepting arbitrary later revocation loses fault specificity, fix3.
- Waiting for controller_lost before releasing the held reader is appropriate for proving socket CUT after independent loss detection. An already authorized buffered response draining during detection is not new authorization and is compatible with the plan's in-flight/unknown qualification. This revised case does not prove zero bytes from the instant of SIGKILL or independently measure the claimed <0.5s worst case: it allows a3s observation wait and does not store kill→CUT timestamps. Keep that limit explicit; optional improvement below.
- The shortened review hold avoids overstaying the dispatch decision. It still puts a fully frozen25MiB request beside an already buffered response before release and keeps storage charged during downstream hold. It demonstrates short review/storage coexistence, not an end-to-end human review lasting up to the original60s. Production review/dispatch separation remains outside this candidate's demonstration.
- Controlled final16KiB pauses are a sound fix for an observational race: real SIOCOUTQ pending bytes, distinct flow IDs, two112MiB-reserved tails, five held samples and independent release are required. Fresh duplicate/ACKed-tail negatives refuse; actual changed fixture client is exercised by the pinned transport suite.
- Eight pending control peers are separate from two body slots. The real five-call consumed GET/POST burst passes, its backlog2 negative control remains in the suite, and a fresh fourteen-connect burst returned nine successes/five fixed EAGAIN refusals without dropping acknowledged registrations or expanding handlers/body slots. Terminal RPCs off the event loop and sticky unconfirmed cleanup are supported by loaded real-transport tests, not merely increased timeouts.
- Launcher pre-start caller/options/config/hash codes are content-free and do not bypass checks. Nonroot caller/release refusal was executed; protected root-only config/hash checks were inspected, not executed against /opt or /run.

Verification performed

Every Node test file touched since base ran individually under unique `SJC_TEST_CLUSTER_TAG=r2-eng-20261107-31bf`; a matching cluster stop ran after each, with no cluster left running. Startup used only `tests/_harness/testdb.mjs`, with the harness's own disposable narrow LOGIN. No default/live database was used.

| File (`tests/browser-*.test.mjs`) | Result |
| --- | --- |
| acceptance-drivers | 11/11 |
| acceptance-integration | 42/42 |
| controller | 87/87 |
| launcher | 15/15 |
| parser-adapter | 44/44 |
| playwright-patch | 30/30 |
| response-budget | 12/13, required fix4 |
| root-runner | 17/17 |
| round1 | 69/69 |
| runtime-boundaries | 19/19 |
| runtime-gate | 61/61 |
| runtime-startup | 19/19 |
| transport | 1/1 wrapper over116 Python tests |

Node total427/428. All four touched Python files were exercised with the pinned `/opt/sjcos-browser/py/bin/python -B`: transport116/116, parser44/44 and provision9/9 through their wrappers; root-runner directly8/9, failure above. Wrapper/Python counts overlap. Fresh stdin probes are additional, not committed tests. The14-control-peer probe initially asserted two allocated body slots before header admission; that reviewer assertion was wrong (two handlers, zero body slots is correct) and was corrected to test the actual cap and registration acknowledgments. No production defect is attributed to that probe mistake.

The required `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited0. `git diff --check` passed. No browser, Next dev/build/start, sudo, installation, root acceptance, privileged runtime modification, live service or secret-directory access occurred. Test-local loopback helpers and the disposable cluster were stopped. No resource-limit kill occurred.

Optional items

- Record monotonic fault initiation, lease observation, socket CUT and browser disappearance timestamps; verify a declared fault-to-CUT bound independently. The current policy-loss case proves post-detection closure, not the entire detection interval.
- Address launcher early mkdir/chown cleanup and concurrent cleanup failure semantics from round1's optional note; this was not promoted into a new scope requirement.
- Have the coordinator independently recompute the private artifacts and canary/sandbox proof after fixes; preserve root-only permissions. Current hashes, candidate enablement=false and releaseReady=false must not be described as independent release approval.

Fresh adversarial outcomes

The expectations below were recorded before executing the fresh probes. Cases1–9,12,14,17,19,20 met their stated safety expectations (case8 after correcting the reviewer's pre-header body-slot assertion). Case10 accepted clustered timestamps; case11 showed that RSS artifact validation does not itself require buffered-byte event evidence, although the live writer does. Case13 accepted an unrelated iframe with no child request. Case15 accepted an invalid-session/later-revoke proof; case16 accepted arbitrarily long summary duration without fault-to-CUT proof (reported as an optional timing limitation, not a demonstrated runtime lease failure). Case18 accepted the named case-local RSS contradictions. The additional complete signed artifact repro under expectations17–18 accepted private packet/kernel-drop facts contradicted by its own artifacts. Fresh expiry probes included nine asynchronous boundary variants plus real filesystem GET/POST claims; all refused and remained burned. No observed result establishes an unauthorized browser transmission.

Fresh adversarial expectations (recorded before execution):
1. Reentrant fatal close from its fence returns the same promise and kills/cleans exactly once.
2. Rejected revoke reports revoke-failed promptly while kill and cleanup finish.
3. Hung revoke reports revoke-timeout within its configured bound while kill and cleanup finish.
4. Fence exception cannot skip kill or cleanup and reports fence-failed.
5. Kill exception cannot skip cleanup and reports kill-failed.
6. Cleanup exception reports cleanup-failed without raw error content.
7. Real Unix control burst with both consumed requests retains both digest registrations at backlog8; backlog2 negative control fails safely.
8. More than eight concurrent control connections may refuse but cannot silently succeed with a dropped digest or expand two body slots.
9. Complete realistic two-tail stress validates; one flow counted twice or a zero pending-byte tail refuses.
10. Sustained no-read proof cannot pass with samples clustered at one instant rather than spanning the hold.
11. Frozen upload charge must overlap actual buffered response bytes, not merely reserved empty slots.
12. Browser-level popup requires a distinct paused page, full barrier and exact child-host write.
13. OOPIF proof requires the expected child navigation; an unrelated iframe target must not stand in for that frame.
14. Parent-target OOPIF navigation remains exact-authority checked and missing child guard/resume refuses.
15. Fetch-detach proof must distinguish actual detach-triggered revocation from unrelated boot revocation.
16. Controller-loss proof must bound fault-to-socket closure and preserve no-retry/unknown across the real fault.
17. Validator rejects diagnostic, retained-allocation, malformed capture and wrong aggregate mutations of final2.
18. Validator rejects RSS per-case failures masked by healthy aggregate maxima/OR flags.
19. Signed GET and POST authority expiring during asynchronous consume/checkpoint cannot dispatch and remain burned.
20. Nonroot acceptance launcher refuses with the fixed caller code before protected filesystem access; production launcher refuses missing release attestation.

