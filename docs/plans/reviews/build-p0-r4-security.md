SCORES: design=8 completeness=8

Security BUILD round 4, Phase 0. Reviewed HEAD 6efb12a39fd152c882fb1677d2ff6387324ae920, including d9675afa, 0ade4617 and reconciliation. Source unchanged. Round-3's original decision/event/intent/work-item producers are fixed, but historical private Telegram replies survive in an additional shared carrier: push_outbox. Acceptance withheld for V1.

## Inventory verdicts

| Carrier / surface | Verdict |
| --- | --- |
| ai_conversations; ai_folders | PASS: private title/folder name; person predicates before lists/search/limits, mutation ownership and deletion fences. Owner/staff fixture tests deny foreign and missing objects consistently. |
| ai_messages | PASS: transcript, page context and attachment names remain behind live-thread access; filing requires explicit owned handoff. No automatic attachment-name notification producer established. |
| dev_agent_runs | PASS for original private runs: prompt, answer, activity, spoken answer and context use person/run/thread checks and FORCE RLS. Historical contaminated hook runs are scrubbed and fenced against late writes. |
| agent_interactions; run_steers | PASS: original run/person boundary and closed adapter remain; no new shared automatic copy found. Round-2 server tests pass. |
| owner_grants | PASS: fixed Express reason, historical excerpt redaction, immutable source, real narrow-login denial, self-only lookup/list. |
| owner_replies | PASS: real owner/thread validation at recording, guarded lookup/mutation/delivery, no private fallback to an unattended route, tombstone redaction. A Telegram reply about a STAFF thread fails ownership checks; it cannot send that thread's title/body back to Joe through the private delivery path. |
| decisions | PASS at original sink: session recording supplies fixed status, including cancellation; migration/replay clear historical decision_note/hold_note. FAIL for a derivative already rendered into push_outbox (V1). |
| decision_events | PASS: session events receive fixed text; historical note/reason removed. |
| action_intents | PASS: cancelled decision/grant intents receive fixed error; historical errors scrubbed. Executed cancellation branch. |
| work_items | PASS: actual staged-draft reply pulls approval with fixed blocked_reason; historical associated text scrubbed. Explicitly filed business title/body remain shared. |
| agent_triggers | PASS for traced reply hooks: fixed new note, historical payload/error scrubbing, permanent erased-copy fence. |
| agent_executions | PASS for tested source associations: historical trigger/ref fan-out scrubbed; live private executions have FORCE RLS, immutable source, foreign/narrow denial and owned positive control. Shared execution/history/context readers exclude conversation-linked runs before limits. |
| run_effects; agent_pending_actions | PASS for live private run copies: source RLS, immutable link and deletion/recovery guards; tested narrow and foreign website denial, owned positive control and erasure. |
| orchestration_tasks; orchestration_events | PASS: task/thread and event/task/run association enforcement, private prompt/note visibility and erasure tested. |
| push_outbox | FAIL V1. This is an additional durable private-copy table missing from the claimed 18-table protected/redacted census. Both successfully sent and parked messages retain body text. |
| notifications / bell | No new automatic Ask transcript producer established. Decision notifications use explicitly staged business cards. phoneOnly avoids a bell row for the demonstrated refresh; it does NOT avoid push_outbox storage. |
| Telegram bodies, push drain, cron digests | Current session reply status is fixed, but historical rendered cards remain locally readable and failed/parked copies can be retried by drain. Joe receiving his own reply is not the vulnerability; its shared durable copy is. No additional staff-chat completion-to-Joe producer established. |
| Search indexes / model context / logs | Panel search queries private tables with actor predicates; no separate automatic shared Ask text index found. Runtime context excludes private execution summaries. Runner activity/answer storage uses protected run fields, detached Claude stdio is ignored, and shared worker logs reviewed use status/IDs. Historical push copy disproves completeness without needing a hypothetical cache/log exploit. Provider/CLI filesystem state remains within the previously documented trusted-host boundary; no claim of forensic erasure of external provider histories. |
| agent_runs / agent_receipts / knowledge_items | Reviewed writes are explicit business artifacts, not automatic transcript publication. Routing metadata alone does not publish chat text. |
| action_attempts / owner_touches / decision_deliveries / telegram_reply_targets / agent_usage | Reviewed automatic records carry business outcomes, status, IDs or usage metrics; no additional automatic private body/name copy established. |
| browser_* | Scanner includes these potential carriers; narrow privileges revoked. Runtime remains deferred. No Browser runtime certification implied. |

The 18-table census is therefore incomplete. Hash/scanner coverage does not establish transitive privacy: the maintained scanner passes despite V1. The table groupings above cover all 18 claimed carriers plus the additional consumer surfaces requested; PASS denotes the traced paths and executed controls, not proof against arbitrary future model-authored business artifacts.

## V1 — HIGH: historical private reply text survives migration in shared push_outbox bodies

Producer chain:

- Before the correction, session reply recording populated decisions.decision_note with the private Telegram note (round-3 finding).
- app/api/telegram/webhook/route.ts:129–131 reads that resolved decision and refreshes its Telegram card after delivery.
- lib/decisions/cards.ts:191 includes decision_note in the rendered status line.
- lib/decisions/notify.ts:76–83 puts that rendered card into notifyOwner.body with phoneOnly=true.
- lib/notify-owner.ts:234–237 stores the complete body in push_outbox even after successful transmission. On failure, :239–241 calls parkRow, whose INSERT at :202–205 retains the same body for retry.
- db/migrations/0105_ask_thread_ownership.sql:273–325 redacts the original and selected derivatives but never push_outbox. The same erase_ask_reply_copies helper used by tombstone/replay omits it. RLS on the original records does not protect this copied text.

Independent reproduction, no source/test file written: extended the round-3 disposable fixture in memory. With its historical private-reply decision and sentinel R3_PRIVATE_TELEGRAM_91c2, invoked the actual refreshTelegramCard → cardText → notifyOwner → transmit implementation before applying 0105. Supplied a controlled existing Telegram reference and a fake accepted provider (no external send); the rendered text and push INSERT were real code against the test database. Applied 0105. Original carrier assertions passed, yet separate actual session identities sjcos_agent, sjcos_worker and sjcos_readonly each SELECTed the sentinel from push_outbox.body. All three exposure assertions passed. The fixture's actual owner/thread records, migration and SQL privileges were used; this was not SET ROLE masquerading as session_user. The successful-send path was executed; the failure/park/drain branch and replay omission are source-confirmed, not separately dynamically exercised.

New session replies now use fixed status, so this reproduction concerns retained historical copies, not a claim that the repaired recording path still creates the original leak. Historical cleanup is explicitly part of this round's acceptance. No inspection of production data was performed or needed to establish the migration gap.

## New returnTo and availability surfaces

PASS: validateAppReturnPath is independently re-applied at login page, form action and Proxy. Its route allowlist rejects authentication/API/portal paths and login loops; recursive decoding checks control/format characters, backslashes, slash lookalikes, scheme/path confusion and encoded separators. URL reconstruction remains same-origin. Ordinary c/m/browser/review selectors are removed, including singly encoded keys and duplicates; only the exact separately validated Browser review/Watch form survives. Nested-encoded keys are not decoded again by the current consumer into pane selectors. No exploitable open redirect or parameter-smuggling bypass established.

Ran all 66 maintained login-return tests plus 88 independent in-memory assertions covering duplicate/encoded selectors, separator variants, five encoding depths, slash/backslash/scheme/control/unicode attacks and login/logout targets. A return target is not thread authorization: ordinary c is stripped, and direct/stale foreign IDs still hit the independent live-thread boundary. Real-session folder/server tests passed for owner and staff, including unchanged foreign state; these are not new browser HTTP tests.

PASS for security: availability caches are client-module promises, not server-global or cross-tab shared state. Same-document mounted consumers share a generation and can invalidate/reprobe; differing generations can cause extra requests or stale capability UI, not access to another person's transcript. GET probes are no-store, return capability/fixed failure information, and POST access checks remain independent. The 12 hook tests exercise disabled probes, recovery generations, sharing, stale completions and dictation forwarding. No credential/data leak or authorization bypass found. Optional: key by an explicit auth epoch if future soft account switching preserves the same JS document.

## Validation and QA scope

Single-file sequential tests under SJC_TEST_CLUSTER_TAG=p0r4sec-<epoch>, with EXIT traps stopping each disposable cluster:

| Test | Passed |
| --- | ---: |
| ask-r3-reply-copies-db | 6 |
| ask-r2-server-db | 11 |
| ask-folder-privacy-db | 11 |
| ask-r3-auth-db | 4 |
| web-sessions-db | 4 |
| login-return-path | 66 |
| voice-availability | 12 |
| ask-private-query-scan | 6 |
| Independent in-memory reply fixture extension | 6, including three explicit push-copy exposure assertions |

No failed/skipped tests, exit 137, browsers, Next processes, deploys, package installs, live/QA databases or services, or protected deployment/journal directories accessed. Real database login identities and signed session cookies were exercised with controlled request/provider seams. No additional typecheck was needed for this documentation-only review.

Accepted as coordinator-supplied QA facts, not independently reproduced here: zero cross-person leaks in DOM and every response at seven widths for owner/staff, direct ?c=, Cmd-K and stale Cmd-K; expired sessions navigate the window to /login; 0775 journal directory fails closed as paused. Those observations do not exercise historical push_outbox records.

## REQUIRED fixes

1. Redact historical private-reply-derived push_outbox bodies (sent and pending/failed), using decision associations such as payload.decisionId and appropriate legacy linkage; include this carrier in tombstone/recovery cleanup and prevent stale queued bodies from being resent. Extend the census and add a regression through actual card rendering/push persistence, 0105/replay, and real narrow-login reads. Preserve shared business status without the private note. V1 is the only required finding.

## Optional

Retain the documented trusted-host/operator-shell limitation and continue transitive producer/consumer review when enabling Browser runtime. No additional exploit established in returnTo or availability caching.
