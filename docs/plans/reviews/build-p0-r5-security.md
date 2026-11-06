SCORES: design=10 completeness=10

Security judge, BUILD round 5, Phase 0. Reviewed 0cc5287b9778ff246f54a40047c86a0ca7aaee88 on t3/in-app-browser-agent-tools. Round-4 V1 is resolved. No required exploitable or data-exposure gap established. Source and maintained tests were not edited.

## Inventory verdicts

| Carrier / surface | Verdict |
| --- | --- |
| ai_conversations, ai_folders, ai_messages | PASS: private titles, folder names, prompts, answers and attachment metadata remain person/live-thread scoped. Search and stale IDs do not confer authority. |
| dev_agent_runs, agent_interactions, run_steers | PASS: original private runtime text remains behind person/run/thread checks; narrow identities cannot read private copies. Historical contaminated detached runs are erased and late writes fenced. |
| owner_grants, owner_replies | PASS: fixed Express reason, protected original replies, immutable associations, self-only access and tombstone/replay erasure. Real owner/staff and three narrow-identity tests passed. |
| decisions, decision_events, action_intents, work_items | PASS: automatic reply/status/error copies are fixed or scrubbed. Explicit staged business artifacts remain shared. Original recording, cancellation and staged-draft reply tests passed. |
| agent_triggers, agent_executions, run_effects, agent_pending_actions, orchestration_tasks/events | PASS: historical reply fan-out scrubbed; live private derivatives protected; immutable associations and late-write/deletion fences. Real-login adversarial tests passed. |
| push_outbox | PASS: historical title/body/payload/href sanitization, immutable erased marker, migration, tombstone, replay, stale retry and late-write controls verified. See below. |
| private_ask_push_sources | PASS: opaque kind/UUID associations only; all three narrow identities denied direct SELECT. Definer helper reveals a classification boolean, not private text. Registry survives deletion. |
| newsletter_outbox, bid_invite_emails, inbox_drafts, sms_messages, chat_messages | PASS for census: business communication/draft carriers; no additional automatic private Ask transcript producer established. Explicit user-directed filing/composition is not an automatic leak. Inbox draft access retains mailbox/person scope. |
| notifications, Telegram routing/delivery/dedup tables | PASS: traced private refresh uses phone-only path; current private reply text stays in protected storage/direct authorized transport. Telegram targets/deliveries retain opaque routing IDs/status. No additional historical body carrier established beyond repaired push_outbox. |
| agent_runs, agent_receipts, knowledge_items, document_drafts, marketing_drafts | PASS for census: explicit business artifacts rather than automatic transcript copies. |
| app_change_log, reminder_log, cron_runs, usage and audit records | PASS for traced producers: identifiers, table names, status/counts/usage; no additional automatic private prompt/title/reply/name sink established. |
| browser_* | No Phase 0 runtime acceptance implied. Deferred runtime remains outside this verdict. |

## Round-4 push finding verification

Inspected 0105's registry, source-binding triggers, boolean definer helper, irreversible push trigger and replay erasure; inspected every transport branch in lib/notify-owner.ts. Legacy decision references in payload, href, buttons and Telegram edit-message delivery links are recognized. The registry avoids dependence on RLS-hidden reply rows when a narrow writer retries. Cleanup clears title, body, payload and href; attempts to unset the erased marker cannot restore text.

Executed the maintained real card-rendering fixture: pre-migration successful and failed sends contain the private sentinel, then 0105 removes it. Actual session_user/current_user identities sjcos_agent, sjcos_worker and sjcos_readonly cannot retrieve it; permitted narrow inserts and worker updates cannot reintroduce it. Tombstone/replay and an already-selected stale drain snapshot remain clean.

Independent in-memory extensions (no test-file edits) additionally exercised:

- Full pg_dump/psql restoration of a pre-deletion database containing contaminated push rows into a separate disposable database; retained journal/authority then replayed deletion. Website and each of the three narrow identities read only clean push rows afterward.
- Post-fix immediate notifyOwner, controlled transport failure/parking, and sendOwnerPushesNow by row ID, with private sentinels in both title and body. Provider output and persisted rows remained clean. Quiet-hours/throttle parking uses the same database sanitizer; drain transmission additionally rechecks the row marker/association.

The first independent restore extension used --no-privileges and failed validation. Repeating with the backup's actual grants preserved passed; no product assertions were relaxed. The maintained replay test alone simulates restored row state; the additional full restore closes that evidence gap.

## Filesystem, logs and caches

PASS within the application's person boundary, not a claim of filesystem isolation from its trusted runtime account:

- Ask uploads persist under uploads/ai-chat/person UUID; filenames can retain sanitized original names. Extracted-text sidecars also persist. withOwnedAttachment checks canonical containment and live ownership before extraction/read; filing checks captured attended identity and attachment membership before bytes are copied. R2 real identity/file-reader tests passed. These bytes are not automatically published through business file rows. Generic file serving uses basename-constrained business storage paths; the reviewed nginx config has no static alias exposing the Ask tree.
- drafts contains the deletion journal and unrelated explicit business/operation artifacts. Deletion intents contain opaque thread/operation UUIDs, sequence, dates and hashes, not transcript text or attachment names. Protected deployment state contains identity/binding/latch information. Journal/deployment permission, symlink and wrong-owner rejection tests passed using disposable directories only. No protected deployment directory or QA state was inspected.
- Uploads/sidecars and provider/CLI histories are not forensically erased by this change. Backup scripts also retain file sets. Same-UID shell access, trusted host administrators and external provider retention remain the established trusted-host/provider boundary; this verdict does not promise protection from them or certify future native-reader isolation.
- Runner stdout/stderr processing feeds protected run fields; the detached runner is launched with ignored stdio. Reviewed app logging and push logging did not establish another automatic private transcript sink. Generic error logging exists; no concrete private-text producer into a shared server log was demonstrated. Existing host logs were not read.
- Model fetches use no-store; DAL React cache is request-local. Panel persisted preferences/session claims carry IDs/settings rather than transcript bodies. Mounted transcript state clears on auth loss; the deliberately retained unsent composer draft stays in the existing document. Attachment extraction caches remain subject to the same ownership reader. Business thumbnail caches are downstream of explicit business-file publication.

## Polling and CSRF

PASS: pollLiveChanges, refreshTodayQueue, getWorkbenchAction, loadDrafts, saveDraft and loadCall resolve getCurrentUser before business callbacks. Applicable area checks precede reads/writes. Authentication itself can read session/user/revocation records; this is not disclosure of business data. Invalid input may throw validation errors before authentication, but performs no business write.

Executed real signed legacy and sid-cookie expiry, registry expiry, revocation and missing-cookie tests against a disposable database. Extended the fixture in memory to include a valid saveDraft request in every rejected-session case; it returned SIGN_IN_AGAIN before reaching mailbox/database mutation dependencies. Maintained tests also exercise area denial and authenticated positive controls.

Proxy's Next-Action POST exception only forwards transport. It preserves Origin/Host headers and does not replace the action's DAL authorization. Installed Next action-handler.js:385–440 still compares Origin to Host/X-Forwarded-Host and rejects mismatches before execution; next.config.ts does not configure serverActions.allowedOrigins. allowedDevOrigins is separate. Missing Origin retains Next's existing warning/allow behavior; cookies remain SameSite=Lax. No new CSRF bypass established. This is framework/configuration inspection plus exported-action tests, not a new HTTP/browser CSRF certification.

## Validation and QA scope

Sequential single-file runs on disposable SJC_TEST_CLUSTER_TAG=p0r5sec-<timestamp> clusters, with outbound disabled and EXIT cleanup:

| Test | Passed |
| --- | ---: |
| ask-r4-server-db | 2 |
| ask-r3-auth-db | 4 |
| ask-r2-server-db | 11 |
| ask-private-query-scan | 6 |
| ask-r3-reply-copies-db | 6 |
| Independent full push dump/restore extension | 2 |
| Independent immediate/failed/row-ID push extension | 2 |
| Independent signed-cookie saveDraft extension | 4 |

All final runs passed without skips. Every cluster stopped. No resource kill, Next process, browser, install, deploy, live/QA database or service operation occurred. No subagents. Scanner coverage is supporting evidence, not proof of transitive privacy by itself.

Accepted as coordinator-supplied QA facts: zero cross-person leaks in DOM and every response for owner/staff at seven widths, deep links, Cmd-K, stale Cmd-K and expired-session flow. These facts were not independently reproduced here because browser/server execution was prohibited.

## Vulnerabilities

None established requiring correction in this Phase 0 scope.

## REQUIRED fixes

None.

## Optional

Keep these transitive-copy tests when adding new notification producers. Preserve the documented trusted-host/provider and deployment-recovery boundaries; this review is not production deployment approval or Browser runtime certification.
