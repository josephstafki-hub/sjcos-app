SCORES: design=7 completeness=7

Engineering judge, BUILD round 2, Phase 0, HEAD `1495e05242d20380cb017d70aed3de6f6a7f8025`, branch `t3/in-app-browser-agent-tools`. **Not accepted: two required privacy/recovery fixes remain.** A1 overrides the old all-Ask-before-deletion rule; Browser Phase 0b is excluded from these scores. The rail leak is fixed, but the complete private-source boundary is not.

## Round-1 items verified / not fixed

1. **A1 supersedes the old gate requirement; ordinary boundary/UI work verified, restore guarantee not fixed.** `docs/plans/_ask-pane-host.md:128`, `lib/ask-thread-journal.mjs:103`, `lib/thread-access.ts:91`, `lib/actions/ai-chat.ts:599`: never-enabled/no-authority Ask works, Delete is disabled, owner health is a warning, and the tested latched failures return fixed codes. This review does not request restoring the old universal gate. The loss/restore distinction in A1 is nevertheless insufficient: required fix 2.
2. **Hydration mismatch fixed.** `components/panel/PageAiContext.tsx:47`, `:62`, `components/panel/PanelChat.tsx:419`: subscribed route display uses a stable null server/hydration snapshot; send-time grounding remains separate. All 42 actual-component SSR/lifecycle cases pass, including populated storage. Read-only coordinator QA log has 53 entries, zero recorded console/hydration errors, zero overflow entries and zero `leakedTheirs` entries. I did not start a browser or claim to independently reproduce the coordinator's visual checks.
3. **Deletion workflow and real action/mobile retries fixed for the exercised paths.** `components/panel/ThreadList.tsx:318`, `:320`, `:329`, `:798`, `:945`; `lib/actions/ai-chat.ts:413`; `lib/thread-access.ts:56`; `lib/ask-thread-journal.mjs:125`: capability-driven disabled controls/copy, retention-accurate confirmation, stable operation UUID, title-free pending/error state, actor-authorized tombstone status and idempotent retry are implemented. Lost reply, failed replication, flag-off retry and foreign-person denial pass. These do not cure the alternate attachment reader in required fix 1.
4. **Browser hard boundaries excluded by A1.3.** Not counted against acceptance or scores. Remaining Browser Phase 0b work is listed below. Independent deletion-journal durability is not a Browser boundary and is not implicitly deferred by A1.3; no actual deployed authority-service evidence is claimed by the client fixtures.
5. **Migration-harness and component-test corrections verified; privacy/restore regression coverage still incomplete.** `tests/_harness/testdb.mjs:278`, `tests/canvas-rollout-db.test.mjs:27`, `tests/ask-panel-ssr.test.mjs:1`: missing requested migrations now reject, combined Browser coverage is honestly labelled blocked, and actual host/chat/rail components are exercised with controlled hooks. Browser's second fixture consumer is expressly Phase 0b. Required fixes 1–2 must add maintained regressions for the fresh failures below.
6. **Role-manifest discrepancy fixed.** `deploy/db-roles.manifest.json:87`, `:217`; `tests/db-roles-paths-db.test.mjs:1`: worker interaction UPDATE/message DELETE have explicit website-only withholding reasons. Scan has no unexplained diff; both role DB files pass. Generator still gives worker SELECT on interactions and SELECT/INSERT/UPDATE on messages, never the withheld operations. No privilege expansion was used to make tests pass.

## Verified-correct

- `db/migrations/0105_ask_thread_ownership.sql:16`: A1.2 creator evidence takes priority, ignores null principals, quarantines mixed/inactive evidence, falls back to the unique active owner only without creator evidence and preserves existing non-null ownership. The three real migration matrices cover zero/one/two active owners. Coordinator's Abigail 2 / Joe 291 / zero quarantine result is consistent with A1.2; the round-1 unique-owner interpretation is superseded.
- `lib/thread-folders.ts:15`, `:192`, `:197`, `:425`, `:435`: explicit self predicates precede limit/aggregation; the archive OR is properly parenthesized. Folders, entity conflicts, suggestions, busy state and settlement are per person. `:448` checks thread access before busy-state reads. Fresh Joe/staff same-entity folders have different IDs and each rail contains one self thread. Foreign getFolder returns null, foreign rename is denied and its row is unchanged.
- `lib/panel-search.ts:56`, `:65`: current-person check plus explicit thread-owner SQL applies to Joe and staff. Maintained real-SQL bypass tests pass; a forged search principal cannot substitute for the session. Recovery failure suppresses private search hits rather than selecting them.
- `lib/mobile-rpc/operator-reads.ts:42`, `:68`, `:81`: request/DAL identity matching and real action serializers preserve self-only rail/archive data. Fresh serialized payloads exclude the foreign title, folder/thread IDs and activity fields.
- `lib/thread-access.ts:9`, `:45`, `:50`, `:65`; `lib/dev-agents.ts:750`; `lib/agent-interactions.ts:119`, `:135`; `lib/orchestrator/voice.ts:90`: exact run/thread/interaction guards protect run activity, answers, spoken-answer cache and ordinary attachment extraction. Fresh tests use real SQL with the harness superuser bypassing RLS; foreign reads fail before provider/byte callbacks. Maintained privacy tests additionally use the actual non-superuser website session identity. The attachment result applies to this helper, not every filesystem reader: required fix 1.
- `lib/owner-reply-delivery.ts:139`, `:149`, `:182`, `:278`; `lib/agent-runtime/context.ts:532`: private session delivery requires current owner=self access and does not fall back to an unbound business run after denial. Unattended sweep skips private session answers without a verified person. Runtime business reply ingestion requires `conversation_id IS NULL`. Fresh foreign delivery invokes no downstream callback. Decisions explicitly submitted for owner approval remain shared business records, not a general permission to read staff transcripts.
- `lib/notifications.ts:127`, `:192`: targeted staff notification text is excluded from Joe's feed in a fresh actual SQL/feed-builder test. Audited ordinary notification/Telegram producers emit shared business events; interaction creation and detached chat activity do not add an automatic company-feed transcript/title broadcast. No new notification/Telegram leak was reproduced. This is a bounded producer/consumer audit, not proof that arbitrary future notification text can never contain a private quote.
- `db/migrations/0105_ask_thread_ownership.sql:47`; `lib/ask-thread-journal.mjs:10`, `:18`, `:29`, `:103`: direct UPDATE-clear and DELETE of the latch row fail; nonempty partial intent, durable disk latch, DB latch, checkpoint or tombstone independently block missing-authority access. Switching acceptance off after verified enabling does not undo gating. A pre-latch DB with a valid configured remote history replays before callbacks. These are useful one-way properties **within surviving evidence**, not protection against losing both local evidence stores: required fix 2.
- `lib/ask-run-admission.ts:1`, `lib/web-sessions.ts:1`, `lib/session.ts:1`: maintained SQL admission/session tests still pass for canonical launch provenance, protected principal/profile/continuation and revocable cookie identity. Browser remains disabled.

## REQUIRED fixes

1. **Close the MCP filing attachment bypass before claiming private-source isolation.** `lib/unsorted-docs.ts:93`, `:100`, `:118`, `:255`; `app/api/internal/filing/route.ts:48`, `:79`, `:92`; `mcp/filing-tools.mjs:47`; `mcp/sjcos-mcp.mjs:282`. `readHandedFiles` treats the entire `uploads/ai-chat` tree as a shared authorized root. The service credential authenticates the bridge, but carries no verified person/run/thread authorization. An unbound MCP client that knows a staff upload path can pass `file_paths` to stage it; real code reads the bytes and copies them into shared Files/Unsorted. It also works after the source thread is tombstoned and `recovery_ready=false`. This is outside the SQL scan and bypasses the otherwise-correct `withThreadAttachmentAccess` helper.

   **Exact change:** remove blanket Ask-root authorization from the generic handed-file reader. For Ask uploads, require a closed server-validated run/person/thread context (or a narrowly authorized explicit handoff) and enforce exact source ownership/live-thread status plus `withAskJournal` across reading/copying. Do not accept a claimed person/run from ordinary tool JSON, treat the shared service secret as a private-source grant, or give Joe a foreign-thread exception. Unbound/background/HTTP MCP must refuse Ask paths; deliberately shared filing roots may keep their separate business policy, but must not re-allow a nested Ask root. Return a fixed title/path-free unavailable/paused code for source denials. Add maintained real bridge tests: owner vs staff and two staff, live/deleted source, recovery closed, missing/forged context, same-person authorized handoff positive control, and no read/store callback on denial. Include this non-SQL reader in the privacy handoff/inventory.

   **Real repro (fresh case 31):** a disposable DB holds a staff-owned conversation and ai_messages attachment referring to a canary under a temporary fixture's `uploads/ai-chat/<staff-id>/...-private.txt`. Execute actual filing `POST` → `stageFromEmail` → `readHandedFiles` → actual `storeBuffer` → real `stageDoc`/`attachDocFiles` SQL, with controlled service-auth seam and temporary cwd/blob root. POST `{action:"stage", source_ref:"r2-filing-false", kind:"other", file_paths:[victimPath], agent:"unbound-external-mcp"}` returns `{ok:true,id:1,status:"pending",files:1,files_added:1,...}`. The newly linked shared `files.storage_path` contains `ABIGAIL PRIVATE ATTACHMENT CANARY`. Tombstone the source using the disposable maintenance fixture, close recovery, repeat with a new source_ref: returns id 2 and copies the same private bytes again. No source guard/session/provider stub was used to manufacture permission; the code never asks for permission. No live file, network request, server or actual MCP daemon was touched.

2. **Make the virgin-state exception distinguish a real virgin deployment from a restored/lost-latch deployment.** `docs/plans/_ask-pane-host.md:128`, `:131`; `lib/ask-thread-journal.mjs:107`, `:112`, `:114`; `lib/canvas-deletion-ledger.mjs:33`, `:61`. A1's intention is sound, but its stated DB-plus-directory absence check is not enough to prove that deletion never existed. A pre-deletion DB restore and local-volume loss remove both copies of the latch. `withLedgerLock` creates a missing directory, then **any** `journalOptions` construction error takes the permissive virgin path if DB/disk evidence is absent. Even a configured authority URL/ledger ID with missing verification/encryption credentials is treated this way. The independent authority can still have a deletion; it is never consulted. I reproduced a formerly deleted title reaching the callback with `recovery_ready=true` and `JOURNAL_NOT_CONFIGURED`. A valid configured authority does replay the same history correctly, so the missing-configuration branch is the failure.

   **Exact change:** preserve A1's no-authority availability for demonstrably never-enabled installations, but establish that mode with an explicit deployment/bootstrap identity whose monotonic deletion-enabled state is stored outside both DB and local-journal restore/loss sets. Durably leave virgin mode before enabling deletion. Restores/missing expected journal volume or missing/invalid bound-authority config for an ever-enabled deployment must pause until verified replay; they must never automatically mint a new virgin state. At minimum, stop treating partially configured/invalid authorities as genuinely absent; fixing only that case does not cover complete config loss. Amend A1 to specify this restore/bootstrap distinction and protected latch location, then implement/test it. Add an actual pre-delete dump restore + lost local directory matrix with authority intact, absent, partially configured, wrong identity, unreachable and flag off. The fixed code must prevent every callback until current authority evidence reconciles, with a separate new-install/no-authority positive control. Do not simply reintroduce the old all-Ask gate for every new installation.

   **Real repro (fresh case 7):** first reproduce with simulated restored row state, then confirm with **actual pg_dump/psql restore**. Dump the virgin 0100+0105 database containing a private staff thread. Enable deletion with a separate independent-history fixture, force one replication failure, verify another person cannot retry the pending operation, then restore replication and acknowledge deletion at sequence 1. Delete the local journal directory. Restore the pre-delete dump into a different harness database while retaining the independent sequence-1 history. Set only `SJC_CANVAS_AUTHORITY_URL=https://journal.example.test/ledger` and the correct `SJC_CANVAS_LEDGER_ID`, without key/token/public key, flag off. Actual `withAskJournal(pool, callback)` admits the callback and SELECT of the deleted title. Output: `ACTUAL_PG_DUMP_RESTORE={"independentSequence":1,"exposedTitle":"RESTORE PRIVATE TITLE","health":{"recovery_ready":true,"health_code":"JOURNAL_NOT_CONFIGURED","deletion_enabled":false}}`. A valid-authority positive control then replays the tombstone before the callback. The maintained test named “signed live authority evidence catches pre-latch restored DB” ultimately relies on a retained tombstone; it does not test losing that evidence and the authority config together.

## Query scan and leak-class audit

The inventory counts are accurate: 71 fenced + 30 trusted-background + 18 not-private = 119 function entries / 202 SQL-or-conservative fragments. Its file hashes do pin guards in files it detects. The trusted cron import restriction is useful. Neither the counts nor RLS establish completeness: the website's absent-actor policy trusts raw owner SQL, and the real web rail leak was fixed by explicit predicates.

Fresh case 29 **fails** its prewritten expectation. `tests/_harness/ask-private-query-scan.mjs:7`, `:16`, `:39` return zero hits and zero violations, with an empty allowlist, for both:

```js
const table = "ai_" + "messages";
db.query("SELECT body FROM " + table);
// Separately:
db.query("SELECT title, subline FROM notifications");
```

The first is ordinary literal concatenation, not just exotic runtime obfuscation; a new file using it evades both SQL hashes and the enclosing source hash. The second shows that derivative carriers are not automatically included. `lib/unsorted-docs.ts` likewise has no private-table SQL to trigger this scan, despite reading private source bytes. Thus the HANDOFF's disclosure that this is a regression fence is correct, but “complete caller audit” cannot be inferred from a green scan. Required fix 1 is an actual missed reader; case 29 alone is not evidence of an existing notification or new string-built SQL leak.

Optional hardening: fold constant-string concatenation, flag unevaluable SQL target expressions for explicit review, and maintain a separate reviewed inventory of private filesystem/derivative producers and outward readers, including filing/export bridges. Add negative fixtures matching these bypasses. A static scanner should not be advertised as an authorization engine; actual denial and positive-control tests remain necessary.

Run activity, interaction response, spoken-answer cache, mobile serialization and private owner-reply routes were exercised as described above; ordinary attachment helper passes but alternate filing fails. Business-only decisions/owner replies, company feed and Telegram remain intentionally different from private source transcript access. The source-only scan cannot enforce that distinction on future text copied into those tables.

## Recovery test count: 60 → 43

`git diff 10487eb4 HEAD -- tests/ask-thread-recovery-db.test.mjs` changes the two iteration labels/ID lists to one `shared_canvas_phase0 [100,105]` iteration and changes the disabled-Delete fixture to A1's fixed-code setup. It removes **no recovery assertion body**. The old “combined” and “canvas_only” loops each applied the same available files because the harness filtered absent 0101–0104. Removing that duplicate accounts for 17 tests; 43 now pass. `tests/canvas-rollout-db.test.mjs:27` explicitly rejects the missing combined matrix. This is honest de-duplication under A1.3, not lost distinct migration coverage. However, the retained correct-authority restore tests do not cover required fix 2's missing-configuration restore state, and no existing test covers required fix 1.

## Verification

Every file below ran separately, sequentially with `node --test --test-reporter=tap tests/<name>.test.mjs`; output was reduced to per-file totals/failures. No full-suite command was used. **35 files, 504 tests: 503 pass, one baseline failure, zero skips.**

| Files | Result |
|---|---|
| ask-thread-access-db; ask-thread-recovery-db; canvas-rollout-db | 33; 43; 3 pass |
| ask-run-admission-db; web-sessions-db; ask-backfill-db | 4; 4; 3 pass |
| ask-server-boundaries-db; ask-folder-privacy-db; ask-private-query-scan; ask-panel-ssr | 8; 11; 4; 42 pass |
| browser-contract; browser-network; browser-run-profile; browser-roles-db | 23; 94; 14; 3 pass; no Phase 0b acceptance inferred |
| db-roles-manifest-db; db-roles-paths-db; agent-profile | 6; 3; 10 pass |
| panel-content-pane; canvas-content; canvas-renderer | 37; 51; 7 pass |
| run-steers-db; panel-search; mobile-rpc; panel-defects; merge-chat-regressions | 1; 6; 28; 6; 2 pass |
| access-db; agent-runtime-db; portal-telegram-db | 7; 10; 3 pass |
| panel-context; panel-run-review; panel-approval; agent-runtime-rules | 1; 1; 1; 11 pass |
| mcp-team-tools; gmail-quota-budget | 13; 9 pass |
| api-auth-coverage | 1 pass / 1 fail: same 44 mobile route-wrapper inventory false negatives documented in round 1; unchanged test. No newly unauthenticated route is established by that failure. |

`flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` exited 0; only one typecheck started. `node scripts/db-roles-scan.mjs --diff` exited 0 with every difference explicitly withheld/explained. Generator evidence agrees with the manifest withholding. `git diff --check` passed before finalization.

Fresh adversarial results: **28 pass / 3 failed expectations across 31 cases**. Cases **7 and 31 are required product fixes**; **29 exposes the scan limitation** above. All other numbered expectations pass. Fixture corrections are not product findings: case 6 initially forgot the maintenance-only purge GUC, first remaining-case setup used nonexistent projects.title/stage and a slug field instead of FolderEntityRef.id, case 20 initially expected a throw instead of the correct null getFolder result, and the first extra dump-restore attempt passed an already-connected pg.Client where the journal expects a pool/query adapter. The corrected query adapter completed the actual dump/restore repro. Corrected real SQL/caller runs passed these cases, including foreign rename rejection and unchanged folder name. No expectation was changed to accept exposure.

All fresh expectations 1–30 were saved in this report before execution; expectation 31 was appended before its targeted execution. Fresh Node scripts ran through stdin with TypeScript transpilation/VM loading of actual caller modules and controlled session/provider/service-auth seams. They were not HTTP/browser end-to-end runs. No source or maintained test was edited, and no temporary test script was added to the repo. Temporary filesystem canaries were outside the worktree under /tmp.

Disposable tags: `p0r2eng-1793920308` (maintained files), its test-created `-access-suite` cluster, and `p0r2eng-1793920309`, `p0r2eng-1793920310`, `p0r2eng-1793920311`, `p0r2eng-1793920312`, `p0r2eng-1793920313` (fresh cases/corrected fixtures and actual dump/restore). Every cluster was stopped and removed, including the access-suite suffixed cluster. No live/QA DB, service, install, browser, build/start/dev server or subagent was used. Coordinator log was read as an existing file only. No exit 137 occurred.

## Browser Phase 0b still required (excluded from scores)

- Additive 0101/0102 vault/action schema, exact role/service authority, manifest/generated grants and actual-session SQL attacks; honestly restore the combined migration matrix when its files exist.
- Pinned gate/addon/dispatcher and reviewed target-barrier patch, complete resume/reconnect-path census, exact gate/Unbound/patch hashes and package/runtime readiness proof.
- Strict narrow-DB startup/rendezvous and actual isolated CLI config/history partition proof; login/return path integration.
- Runnable namespace/network containment and coordinator-owned disposable packet/SSRF tests under approved caps, with no live services touched.
- Real pinned-parser response budgeting, backpressure, concurrency/slow-client/compression/unknown-length tests and bounded RSS evidence; missing browser-response-budget test, beyond pure helper fixtures.
- Browser UI/shared-host second fixture consumer, Browser leave failure/one-history-exit behavior, relevant keyboard/focus and real-device acceptance. Existing Canvas-host SSR/layout tests do not fulfill Browser runtime acceptance.
- Keep Browser flags/admission off until those boundaries pass. Canvas Phase 1 does not wait for 0b, but its private-source/recovery prerequisite still needs required fixes 1–2 above.

## Prewritten fresh expectations and outcomes

Fresh adversarial expectations, written before execution. The implementation callers and SQL stay real; session/provider seams may be controlled. All database work uses an independently tagged disposable harness database. No live/QA database access.

1. Virgin DB/directory with no authority admits an authenticated Ask callback.
2. A nonempty partial intent blocks a virgin restored DB without authority.
3. The durable disk latch alone blocks a virgin restored DB without authority.
4. DB latch alone blocks without authority after local-directory loss.
5. DB checkpoint alone blocks without authority.
6. DB tombstone alone blocks without authority.
7. Restored pre-latch DB plus remote-only deletion evidence replays before callbacks.
8. Once verified enabled, switching the environment flag off cannot reopen Ask during authority loss.
9. Clearing the DB latch directly is refused.
10. Removing the DB latch row is refused (one-way latch cannot be reset by DELETE/reinsert).
11. New delete without acceptance returns DELETE_NOT_READY and appends nothing.
12. Invalid operation UUID cannot append an intent.
13. Failed replication returns pending, keeps one intent and blocks ordinary reads.
14. Same operation retries after failed replication without duplicating intent.
15. Foreign person cannot retry another person's pending deletion.
16. Lost successful response retries as deleted with the same operation.
17. An operation UUID cannot be reused for a second thread.
18. A second operation on an already deleted thread cannot append another intent.
19. Joe and staff sharing an entity each get an independent folder and self-only rail/counts.
20. Foreign folder inspection and rename are refused without mutation.
21. Joe's mobile rail payload cannot include staff title, folder or activity.
22. Staff's mobile archived payload cannot include Joe's archived chat.
23. Foreign run activity and spoken-answer cache access are denied before provider callbacks.
24. Foreign interaction answers/dismissals cannot read or change the question.
25. Foreign attachment extraction refuses before opening bytes.
26. Foreign private owner-reply delivery is refused before session/Telegram callbacks.
27. Paused read/mutation/poll/review/mobile/TTS boundaries return fixed codes without causes.
28. Revoked and AI-disabled principals get SIGN_IN_AGAIN and CHAT_OFF respectively.
29. A new string-built private query cannot silently evade the scan (test a split literal table name and separately a derivative-table query).
30. Notifications/Telegram/business-runtime paths do not expose private chat content to another person; inspect actual producers/consumers and execute any reachable suspected path.


31. The MCP filing bridge must not read another person's Ask upload (or a deleted chat's retained upload) merely because its path falls under uploads/ai-chat; authorization must precede byte extraction or copying to shared Files/Unsorted. This expectation was appended before the targeted real stageFromEmail/readHandedFiles execution.

Outcome mapping: 1–6 PASS; 7 FAIL (restore/config-loss exposure); 8–28 PASS; 29 FAIL (scan bypass); 30 PASS within the documented producer/consumer audit scope; 31 FAIL for both live and deleted sources. Exact observations, fixture corrections and limitations are recorded above.
