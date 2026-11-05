SCORES: design=9 completeness=9

Engineering judge, BUILD round 3, Phase 0, reviewing `08f8561a3a72e05ffdbc4440f3fd4469433b0a59` on `t3/in-app-browser-agent-tools`. **Not accepted: two required typed-state/recovery-UX fixes remain.** Both round-2 required privacy/restore fixes are verified. No new cross-person disclosure was reproduced. A1 governs; Browser Phase 0b is excluded from these scores.

## Round-2 items verified / not fixed

1. **Required filing bypass: fixed.** `lib/unsorted-docs.ts:103–130`, `lib/ask-private-bridge.mjs:7–24`, `lib/ask-private-transport.mjs:3`, `app/api/internal/filing/route.ts:88`, `mcp/sjcos-mcp.mjs:438–440`: generic shared roots no longer authorize Ask uploads. The closed stdio adapter captures context once and overwrites any ordinary tool-payload context. The app validates exact run/person/thread/profile/start time, attended launch source, live status, cancellation, current permission and revocation; exact current-thread attachment association precedes byte reads. The journal fence covers reading and staging. HTTP/unbound/forged/foreign/deleted sources return fixed failures before read/store. Shared ancestor roots and symlink aliases cannot override Ask classification. Fresh cases additionally deny another chat belonging to the same person, terminal/cancelled/revoked runs and removed `ai` permission. Authorized own-chat handoff still reads real bytes and stages real SQL. This verification is of the closed adapter plus internal route, not a claim that possession of the trusted service secret and arbitrary process environment is itself unprivileged.
2. **Required virgin/restore distinction: fixed within amended A1's threat boundary.** `lib/ask-deployment-state.mjs:13–41`, `scripts/ask-deployment-bootstrap.mjs:1–6`, `lib/ask-thread-journal.mjs:75–87`, `:118–127`, `:162–166`: requests require an explicitly provisioned protected identity and never bootstrap it. Exclusive file creation plus file/directory fsync makes the ledger binding durable before local intent acceptance. Missing/corrupt/unsafe-permission/symlinked identity, overlapping directories, partial/invalid authority configuration and a bound wrong/missing/unreachable authority all pause. Re-bootstrap refuses an existing identity. The maintained test performs actual pre-latch `pg_dump`/`psql` restore into a different disposable DB, deletes the local journal, retains protected state, and proves zero callbacks for absent/partial/wrong/unreachable authority with deletion off; valid authority replays before admission. A new installation without authority still works with Delete disabled. It does not restore the superseded universal gate.
3. **Grant/reply derivatives: fixed for exercised paths.** `db/migrations/0105_ask_thread_ownership.sql:179–246`, `lib/owner-grants.ts:62–89`, `lib/owner-reply-delivery.ts:139`, `:230–271`: historical automatic prompt excerpts are redacted; private grants and replies have materialized immutable source links and FORCE RLS. Actual website owner/staff/two-staff bridge reads partition before limits/serialization, including expired checks; actual agent/worker/readonly session identities cannot read the private copies even with forged actor GUCs. Foreign reply/grant/decision selectors never send or mutate; tombstone replay redacts copies and revokes grants. Fresh run-only grants and grant-only replies inherit the private conversation; attempts to clear the source fail without changing it. Deliberately submitted business Decisions and shared business replies retain their separate policy and positive controls.
4. **Host, hydration, deletion/retry and rail findings remain fixed.** `tests/ask-panel-ssr.test.mjs` now has 52 passing actual-component SSR/controlled-lifecycle cases, including the bd4435b3 corrections: pending load/new state, the full empty sentence, unavailable-chat new-chat recovery, composer sizing and draft restoration. The 33 access, 43 recovery, 11 folder, 3 backfill and 8 real-server-boundary tests pass. Deletion capability, title-free pending/result states, stable operation UUID and foreign retry denial remain correct. This does not cure expired-cookie transport handling: required fix 1.
5. **Query-inventory limitation addressed as a regression fence.** The current inventory explicitly covers filesystem/transport sources and grant/reply/notification derivatives; maintained negative fixtures detect the literal concatenation, array-join and handed-file counterexamples from round 2. Its documented 223 function/source entries / 366 fragments / 99 files supersede the historical 119-function inventory. Five scan tests pass. A green source hash/SQL scan still cannot prove all future indirect data flows; actual denial/positive-control tests remain the authorization evidence.
6. **Role manifest and migration fixtures remain correct.** Both DB-role files and the diff scan pass; differences are explicitly withheld, including worker interaction UPDATE/message DELETE. No privilege expansion. Missing requested migrations reject; shared Phase 0 means real 0100+0105, with the unavailable combined Browser matrix explicitly deferred to 0b. Browser runtime or deployed authority-service durability is not established by these client/SQL fixtures.

## Coordinator QA: simulated intent versus accepted deletion

**The reported reopening after removing the simulated file matches A1.** The QA installation was explicitly bootstrapped and never enabled for deletion. A manually written one-line `intents.jsonl` is evidence while it exists, so the no-authority path pauses; that failed check does not itself accept deletion or set the one-way enabled latch. Removing that artificial sole evidence returns this genuinely never-enabled installation to the permitted availability exception. Fresh case 11 reproduces both directions and verifies the DB latch is false and the protected ledger binding is null.

**A real accepted deletion behaves differently.** Fresh case 31 calls actual `deleteThread`, receives `{ok:true,state:"deleted"}`, then removes only its disposable `intents.jsonl`, disables the flag and leaves authority configuration absent. Ask remains paused with zero callbacks; DB `deletion_enabled=true`, checkpoint 1, protected deployment ledger binding and independent authority sequence 1 all survive. Reconnecting the correct authority reconstructs the local intent and preserves the tombstone before the next callback. Removing a local journal file cannot undo those independent records. The actual pre-delete-dump restore test also covers losing the DB latch and whole journal together while retaining protected state.

The protection is operationally conditional, as A1 now states: the protected directory must really be outside both DB and journal backup/loss sets and retained/reconnected on restore. Path separation checks detect nesting/aliases, not whether an administrator placed sibling directories in the same backup or physical failure domain. Replacing all protected evidence or bootstrapping a restored copy as a new deployment is an administrator action outside this application threat boundary. No such operation was performed against live or coordinator QA state. This is a real boundary statement, not evidence that losing every independent record is safe.

Coordinator's normal 7-width × 2-person DOM/response/deep-link/Cmd-K, console and overflow observations are consistent with the passing privacy/host cases. I did not run a browser or independently reproduce visual behavior. The supplied expired-session and paused-probe observations are confirmed below by actual modules with controlled request seams.

## REQUIRED fixes

1. **Preserve authentication semantics through Proxy, action transport and mobile adapters.** `proxy.ts:166–179`; `components/panel/askStatusCopy.ts:14–29`; `lib/thread-access.ts:81–88`; `lib/mobile-rpc/operator-reads.ts:46–53`; `lib/mobile-rpc/dispatch.ts:53–67`.

   **Root cause/repro:** the action implementation is already wrapped by `askBoundary`; directly calling its exported actions with missing/revoked session correctly returns `SIGN_IN_AGAIN`. But the installed Next client POSTs actions to the current page URL (`node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:70`). Proxy matches that URL and redirects an expired-cookie request to `/login` before the action executes. Fresh case 28 uses a genuinely expired signed legacy JWT and actual `proxy.ts`/`NextRequest`: POST with `Next-Action` yields 307 `/login`. The installed reducer either encounters a non-Flight unexpected response (its lines 119–125) or receives a redirect error. Actual Next redirect errors have `message="NEXT_REDIRECT"` and login URL in `digest="NEXT_REDIRECT;push;/login;307;"`; the client mapper examines only `message` and converts both rejects to `ASK_PAUSED`. The server's `NEXT_REDIRECT.*login` message regex also misses that real digest. This explains the QA result without blaming a returned `SIGN_IN_AGAIN` value.

   **Exact change:** let Server Action POSTs (`method === "POST"` and a `Next-Action` header) pass the optimistic Proxy redirect prefilter via its normal stamped `next(req)` path so the invoked action's authentication boundary can return its typed result; retain normal page-navigation redirects. Do not authorize action execution merely because this header exists: all action mutations must retain their own session/role checks, and regression tests must prove signed-out action requests invoke no business/provider mutation. In the shared server/client error normalizers, parse genuine Next redirect errors using their structured digest/URL and map `/login` or `/logout` to `SIGN_IN_AGAIN`; include `ASK_SESSION_REVOKED`/`ASK_COOKIE_REQUIRED` in client legacy normalization. Leave unrelated unknown/network/recovery errors as `ASK_PAUSED`; do not reinterpret every unknown error as expired auth or match arbitrary text containing "login".

   Apply the same distinction in mobile adapters. Fresh case 32 shows `mobileOperatorRead` returns **409** for returned `SIGN_IN_AGAIN` and `CHAT_OFF`; its catch returns **403 CHAT_OFF** for a login redirect. RPC action login/logout redirects likewise become **403 CHAT_OFF**. Map typed auth/access/recovery failures consistently to **401 SIGN_IN_AGAIN / 403 CHAT_OFF / 503 ASK_PAUSED**, retaining 409 for unavailable/not-ready conflicts, and distinguish actual login/logout redirects from authorization-home redirects. Normalize caught auth failures before choosing status; the outer catch must not force all failures to 503.

   **Required tests:** expired legacy and expired/revoked sid cookies through the actual Proxy → exported action → client normalization path, after mounting a live chat and before Send, poll, upload and retry. Assert `SIGN_IN_AGAIN`, Sign in affordance, draft retained, transcript/private state cleared, and zero run/provider/mutation callbacks. Test a real Next login redirect digest, mobile read/RPC returned failures and redirected login versus permission-home cases with exact status/body. Include positive authenticated send and true recovery-pause controls. Existing component fixtures inject returned codes and miss this pre-action transport path; the coordinator should repeat the mid-chat expired-cookie check after the fix.

2. **Make voice availability a recoverable capability probe during Ask pause.** `app/api/transcribe/route.ts:44–54`; `app/api/tts/route.ts:62–73`; `lib/use-voice-available.ts:11–32`; `lib/use-tts-available.ts:11–32`; `lib/use-voice-round.ts:63–65`; `components/panel/PanelChat.tsx:148`; `components/panel/useAgentChat.ts:369–376`.

   **Repro/impact:** both hooks unconditionally probe on mount, independently of known Ask failure. Fresh case 29 confirms authenticated paused GET and POST each return deliberate **503 `{ok:false,code:"ASK_PAUSED"}`** without invoking either provider. That is fail-closed, not a privacy leak or unexpected server crash, but it explains the coordinator's failed-resource console entries. Fresh case 30 finds a functional consequence: each hook memoizes that transient failure as the module's permanent `Promise<false>`. After recovery, even a remount with a healthy fetch seam makes no new request and reports false; normal chat Retry does not invalidate either cache. Voice stays disabled until a document reload despite chat recovery.

   **Exact change:** for authenticated capability **GET** only, serialize a known recovery pause as **200 `{available:false,code:"ASK_PAUSED"}`** with `Cache-Control: no-store`, without invoking availability/provider callbacks behind the closed gate. Keep typed 401/403 for auth/access failures and keep real transcribe/speech **POST** operations fail-closed with 503 while paused. Pass an enabled/recovery generation into both availability hooks: skip requests while the panel already knows Ask is paused/signed out/chat-off, do not retain a paused/failed probe as permanent capability absence, and invalidate/re-probe mounted consumers after successful Ask Retry/re-authentication. Share in-flight requests per generation so multiple voice controls still make one request; resetting a module variable without rerunning the mounted effects is insufficient.

   **Required tests:** actual GET route tests for paused 200/unavailable/no provider, POST paused 503/no provider, and exact auth codes/status; lifecycle tests for zero requests while known paused and one successful re-probe after recovery without reload, including multiple consumers and a previously failed initial probe. Verify the subcontractor daily-log speech path retains its separate policy. Coordinator should repeat paused-page console checks and verify voice returns after Retry.

## Verification

All maintained files ran individually and sequentially with `node --test --test-reporter=tap tests/<name>.test.mjs`. **40 files, 540 tests: 539 pass, one unchanged baseline failure, zero skips.** The two legacy FIN_TEST_DATABASE_URL consumers received a URL explicitly minted by this tagged disposable harness, never ambient/live/QA connection settings.

| Test files (`tests/<name>.test.mjs`) | Tests / result |
|---|---|
| ask-thread-access-db; ask-thread-recovery-db; canvas-rollout-db | 33; 43; 3 pass |
| ask-run-admission-db; web-sessions-db; ask-backfill-db | 4; 4; 3 pass |
| ask-server-boundaries-db; ask-folder-privacy-db; ask-private-query-scan | 8; 11; 5 pass |
| ask-panel-ssr; ask-r2-server-db | 52; 11 pass |
| browser-contract; browser-network; browser-run-profile; browser-roles-db | 23; 94; 14; 3 pass; no 0b acceptance inferred |
| db-roles-manifest-db; db-roles-paths-db; agent-profile | 6; 3; 10 pass |
| panel-content-pane; canvas-content; canvas-renderer | 37; 51; 7 pass |
| run-steers-db; panel-search; mobile-rpc; panel-defects; merge-chat-regressions | 1; 6; 28; 6; 2 pass |
| access-db; agent-runtime-db; portal-telegram-db | 7; 10; 3 pass |
| panel-context; panel-run-review; panel-approval; agent-runtime-rules | 1; 1; 1; 11 pass |
| mcp-team-tools; gmail-quota-budget | 13; 9 pass |
| grant-supersede-db; unsorted-docs-db; mcp-unsorted-upload-db; grant-gate | 1; 2; 2; 9 pass |
| api-auth-coverage | 1 pass / 1 fail: same 44 mobile route-wrapper inventory false positives recorded in rounds 1–2; no new unauthenticated endpoint established |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited **0**; one typecheck only. `node scripts/db-roles-scan.mjs --diff` exited **0**, with all differences explicitly withheld/explained. `git diff --check` passed. No exit 137 or resource kill.

**32 fresh adversarial cases completed:** cases 1–27 and 31 pass the desired security/control expectations; cases 28–30 and 32 reproduce the required auth/voice defects above. They are additional experiments, not additions to the maintained 540-test count. Cases 17–26 ran as in-memory injected subtests against the actual maintained bridge fixture; that separate run also repeated all original bridge/dump-restore assertions: 21/21 TAP tests pass. No source/test file was edited to inject them. Cases 1–16/27–30 used stdin-loaded actual modules and real disposable SQL where applicable. Case 31 separately exercised actual accepted deletion and reconstruction. Case 32 characterized the current adapter outputs against the expected code/status contract; its wrong status/mapping remains a product finding, not a passing regression expectation.

One fixture correction was necessary: initial cases 12 and 16 passed an already-connected `pg.Client` where journal transactions expect a pool or query-only adapter. They failed before reaching their positive controls. The corrected query-only adapter re-ran cases 12–16: all pass, including a verified enabled-latch positive control before the missing/wrong/unreachable denials. The initial auth matrix's simultaneous calls on one fixture Client produced a pg deprecation warning; it was not a killed process or product console observation. No exposure expectation was relaxed.

Every DB process used `SJC_TEST_CLUSTER_TAG=p0r3eng-1793922222336`; its disposable cluster was stopped and removed, including after the additional business regression files. No Next dev/build/start, browser, network provider send, install, service action, live DB, `sjcos_qa_abc`, coordinator QA state or default protected deployment directory was touched. Filesystem/DB fixture writes stayed in temporary/harness locations. The only repository write and commit is this review file.

## Browser Phase 0b (excluded from scores)

- Additive 0101/0102 vault/action schema; exact role/service authority, generated grants and actual-session SQL attacks; restore the combined migration matrix when those files exist.
- Pinned gate/addon/dispatcher and reviewed target-barrier patch; resume/reconnect-path census, gate/Unbound/patch hashes and runtime/package readiness evidence.
- Strict narrow-DB startup/rendezvous; real isolated CLI config/history partition and Browser login/return-path integration.
- Runnable namespace/network containment and coordinator-owned disposable packet/SSRF tests under the approved resource caps.
- Pinned-parser response budgeting, backpressure, concurrency/slow-client/compression/unknown-length cases and bounded RSS evidence beyond helper fixtures.
- Browser UI's shared-host second fixture consumer; leave failure/one-history-exit behavior, focus/keyboard and actual device acceptance.
- Keep Browser flags/admission off until those boundaries pass. Canvas Phase 1 does not wait for 0b; shared Phase 0's typed auth/recovery UX still needs the two fixes above.

## Optional

`lib/ask-result-codes.ts:9` still says ASK_PAUSED is reachable only after deletion was enabled. Missing protected identity or invalid partial configuration also correctly pauses a never-enabled deployment under amended A1; update this comment to describe the actual closed-admission states. Maintain the independently backed protected-volume/bootstrap procedure as deployment evidence, separately from unit/fixture results.

## Fresh adversarial expectations (recorded before execution)

Actual modules/SQL with controlled transport/session/provider seams; temporary harness state only.

1. A second bootstrap refuses to replace the existing deployment UUID.
2. Bootstrap CLI without `--new-install` fails without creating identity.
3. Missing protected identity never bootstraps through an Ask request.
4. Corrupt protected identity pauses before callbacks.
5. Group-readable protected identity pauses before callbacks.
6. Symlinked protected directory pauses before callbacks.
7. Protected directory nested inside the journal is refused.
8. Journal directory nested inside protected state is refused.
9. Partial authority configuration on a new installation pauses.
10. Invalid authority URL on a new installation pauses.
11. A simulated intent with no accepted deletion blocks; removing only the simulation permits the genuinely never-enabled deployment again.
12. Verified enablement creates both protected and DB latches before the first deletion.
13. Losing the enabled installation's journal with authority absent cannot reopen Ask.
14. Wrong-ledger authority cannot reopen the enabled deployment.
15. Unreachable authority cannot reopen the enabled deployment, even with flag off.
16. Live authority restores access after replay; bootstrap still refuses existing protected state.
17. A second same-person chat cannot file an attachment from a different current chat.
18. Terminal runner cannot file previously authorized attachment.
19. Cancelled runner cannot file previously authorized attachment.
20. Revoked runner cannot file previously authorized attachment.
21. Staff permission removal denies filing before bytes/storage.
22. Additional claimed runner-context fields fail closed.
23. Transport capture denies HTTP activity even when stdio environment contains valid tags.
24. A run-only grant is bound to its private conversation by the real trigger.
25. Private grant source cannot be cleared to turn it into a shared row.
26. A grant-only owner reply inherits private source and cannot clear it.
27. Missing/revoked session returns SIGN_IN_AGAIN across actual exported Ask actions before callbacks.
28. Expired-cookie action POST is intercepted by Proxy and its transport/redirect rejection currently maps to ASK_PAUSED: reproduce the QA mapping fault.
29. Paused speech GET/POST return fixed ASK_PAUSED and invoke no provider; GET 503 reproduces QA noise.
30. Client availability hook caches a transient paused response across remounts: reproduce recovery gap.
31. After a real accepted deletion, removing `intents.jsonl` alone cannot reopen Ask without authority; the DB latch, protected binding and independent history persist and replay restores the local intent.
32. Mobile read/RPC boundaries must keep SIGN_IN_AGAIN / CHAT_OFF / ASK_PAUSED distinct and pair them with 401 / 403 / 503; test auth redirects and returned typed failures directly.
