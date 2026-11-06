# Main into Phase 0 + Canvas Phase 1 merge (2026-11-06)

Implementation sub-agent, no delegation. Merge parents: branch `7987df57023b6ee9e2fd3fd6251fbe35686dcafb` and fetched main `b061de03`. This is a real merge, pushed only as `HEAD:t3/canvas-phase1` for PR #120. No install, live/QA DB, deployment-state directory, service, browser or Next process was used. `node_modules` remains the live dependency symlink, untouched. All database evidence below comes from tagged disposable harness clusters; cleanup is recorded after every run. No exit 137 occurred.

## Conflicts and resolution

- `app/api/telegram/webhook/route.ts`: retain main's shared post-commit `finishOwnerAction`, owner/target locks and no transport inside transactions. Carry Phase 0 typed Ask failures through the extracted implementation and webhook response.
- `deploy/db-roles.manifest.json`: union main's phone lines, push devices/history/receipts and frozen approval/dispatch entries with all Phase 0/Canvas website-only entries. No private source/session/Canvas grant expanded. Keep main's added push-outbox UPDATE privilege for the agent and column-limited dispatch worker privileges; private-copy write guards apply to both senders.
- `lib/actions/calls.ts`: retain typed nonredirecting `loadCall` and redirecting foreground `loadSelectedCall`; both pass their verified user to main's line-aware `getCall` before reading events.
- `lib/decisions/owner-replies.ts`: retain principal and live owning-thread checks, journal/recovery admission and fixed shared status; add main's app channel/push IDs and revised-card threading. Never publish the private note in decision/work-item/hook status fields.
- `lib/notify-owner.ts`: retain main's APNs/Telegram channels, independent delivery receipts, leases, channel snapshots, conversational jobs, summary retries and hold reminders. Apply Phase 0 sanitization at every actual channel send and folded-summary creation; emit overrides cannot restore private text.
- `lib/owner-reply-delivery.ts`: retain journal, exact person/thread read/mutation/delivery guards, no private background fallback and typed errors. Retain main's app history, threaded conversational outbox and accurate sent/queued reporting. Shared routing metadata reads exclude conversation-bound replies. Legacy direct Telegram fallback rechecks associations and refuses private or unclassifiable content.

Auto-merges were also reviewed: owner grants retain private source checks and add phone parent IDs; mobile recording/media routes retain authenticated line visibility; CallsClient retains foreground selection. Cookie sid/SIGN_IN_AGAIN paths and guarded pg factory remain intact.

## New copy paths and privacy treatment

`0112_ask_phone_copy_privacy.sql` is additive; neither main's migrations nor existing Phase 0/Canvas SQL was rewritten.

| Carrier | Protection |
|---|---|
| `owner_push_messages.title/body/href/outcome/thread_key/agent_name`, reply descendants and phone history API | SQL trigger irreversibly replaces private Ask-associated content with fixed status. Opaque reply/phone IDs join the existing website-only persistent registry, including historical Telegram/source mappings. Association via private outbox rows is covered. No private phone reply buttons; domain/API refusal happens before input text persistence. |
| APNs alert title/body/href and stale in-memory AppAlert | `deliverAppMessage` reloads the persisted sanitized row. Device selection remains active owner iOS registration with session/revocation checks. Real fake-provider regression confirms the private sentinel never appears in APNs or Telegram output. |
| Conversational `push_outbox.payload.appText`, owner reply IDs, existing-message IDs, title/body/href and text-derived `conversation_key` | Existing immutable outbox sanitation now recognizes reply and phone IDs through the persistent registry. Immediate, leased and retry delivery recheck the marker; private conversational content cannot bypass the check. Historical text-derived dedup keys are cleared; new hashing happens after sanitization. |
| Folded summary bodies and their phone history | Sanitize constituent snapshots again before composing a summary. Migration/replay follows `summary_id` to scrub historical summaries, then phone descendants to a fixed point, even when the summary itself retained no source UUID. |
| `push_actions.text/evidence/result` | SQL source guard erases historical private copies and keeps late writes fixed; narrow logins retain no table privilege. Private phone requests are refused before insert. Business retry generations/approval evidence remain unchanged. |
| Notification title/subline overrides | Private source classification also replaces `emit` overrides with fixed status, so an override cannot republish a sanitized title/body. Main's reply/answer producers otherwise use phone-only delivery. |
| Failed history persistence → direct Telegram fallback | Source/legacy Telegram mapping classification must succeed and be nonprivate before the fallback can transmit. Regression proves private and unavailable classification never call the provider; the business fallback still works. |
| `phone_lines`, SMS threads/messages and shared call/text summaries | These are explicit business communication records, not automatic Ask transcripts. Producers are inbound provider events, owner-granted outbound communications and summaries of those SMS rows. No new Ask prompt/reply/title/attachment-name producer found; main's company/own-line visibility and shared record summaries are retained. Included in scanner to require review of future changes. |
| `push_device_deliveries`, push device registration | Opaque receipt/session/device metadata; no Ask text. Main's delivery and enrollment/session checks remain. |

The erasure wrapper calls both phone cleanup and the existing source/runtime cleanup, preserving the website-login check, tombstone/replay behavior and pinned definer search paths. New trigger/repair functions revoke PUBLIC execution. Private copy status is deliberately stronger than the owner-channel audience: Joe's automatic private Ask text is redacted too. Business/portal cards, replies and approved artifacts preserve main's behavior. Provider histories already sent by older binaries are outside local erasure.

The private-query inventory now covers phone history/actions/devices, SMS/lines, and non-SQL APNs builders/phone serializers. Existing per-function audit entries retain their classifications unless the reviewed function now participates in guarded phone transport; moved/changed queries have explicit new hashes. No runtime pg import from main bypasses `guarded-pg.mjs`; the complete import-census regression passes.

## Migrations and grants

The real live-shaped fixture applies 0110/0111 first with real checksummed ledger rows, seeds historical phone copies, then runs the actual migrator over pending 0100, 0105–0109 and 0112 in numeric order. It reaches zero pending migrations with no checksum mismatch. Migration numbers are unique. 0105–0109 have no dependency on preceding phone-line application order; 0112 requires 0092's phone tables and 0105's privacy registry/functions and runs last. The normal fresh-database path also passes across the full test matrix.

The exact generated existing grants for phone history and delivery receipts remain those pasted in main's 0092. `push_actions` and `private_ask_push_sources` generate no narrow grants. 0112 creates no table and adds no grants. The merged manifest preserves all main and private branch entries.

Role scan exit **0**. Every printed missing permission is explicitly annotated as withheld: owner controls/settings/policies/users/authority, private Ask recovery/session/messages/interactions/Canvas, payment/QBO/mailbox credentials, phone-line website-only writes, secret device registry columns and website portal posting. Raw scanner table access is conservative; column grants and the approved-portal one-purpose helper remain main's intended boundary. No unexplained grant mismatch.

## Verification

All test files run separately and sequentially with `SJC_TEST_CLUSTER_TAG=merge-<timestamp>` and outbound fake/stub providers. Each runner uses an EXIT trap to stop its own tagged cluster. Tsc uses only `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`.

Initial integration failures were resolved without relaxing production privacy: main's cascading TRUNCATE fixture hit Phase 0 append-only Browser evidence, so isolated per-file fixtures stopped truncating users and per-case fixtures delete business records after resetting only safe delivery tables. Controlled VM fixtures gained the actual new Canvas/phone dependency seams; the TypeScript dynamic-import fixture was normalized. Main's old parity case expected an unattributed Ask conversation to accept a reply: it now explicitly proves quarantine refusal on both channels and no reply persistence; normal business/portal parity remains positive. No assertion was skipped. The new regression also proves the historical main-first ordering, real narrow-role denial, business positive control, irreversible late writes and fallback failure behavior.

| Test file (`tests/<name>.test.mjs`) | Passed | Failed / skipped |
|---|---:|---:|
| ask-thread-access-db | 33 | 0 / 0 |
| ask-folder-privacy-db | 11 | 0 / 0 |
| ask-r2-server-db | 11 | 0 / 0 |
| ask-r3-reply-copies-db | 6 | 0 / 0 |
| ask-r3-auth-db | 4 | 0 / 0 |
| ask-r4-server-db | 3 | 0 / 0 |
| ask-server-boundaries-db | 8 | 0 / 0 |
| ask-thread-recovery-db | 43 | 0 / 0 |
| web-sessions-db | 4 | 0 / 0 |
| test-db-guard | 23 | 0 / 0 |
| db-roles-manifest-db | 6 | 0 / 0 |
| db-roles-paths-db | 3 | 0 / 0 |
| mobile-rpc | 28 | 0 / 0 |
| canvas-rollout-db | 7 | 0 / 0 |
| canvas-commands-db | 21 | 0 / 0 |
| canvas-mcp | 40 | 0 / 0 |
| canvas-integration | 33 | 0 / 0 |
| ask-panel-ssr | 95 | 0 / 0 |
| canvas-ui | 38 | 0 / 0 |
| apns-transport | 9 | 0 / 0 |
| apns | 4 | 0 / 0 |
| approve-work-item-db | 1 | 0 / 0 |
| comms-summaries-db | 1 | 0 / 0 |
| phone-lines-db | 1 | 0 / 0 |
| phone-push-db | 19 | 0 / 0 |
| phone-push-delivery-db | 12 | 0 / 0 |
| phone-push-parity-db | 16 | 0 / 0 |
| phone-push-r10-db | 15 | 0 / 0 |
| phone-push-r2-db | 26 | 0 / 0 |
| phone-push-r3-db | 25 | 0 / 0 |
| phone-push-r4-db | 18 | 0 / 0 |
| phone-push-r5-db | 23 | 0 / 0 |
| phone-push-r6-ui | 5 | 0 / 0 |
| phone-push-r7-db | 13 | 0 / 0 |
| phone-push-r8-db | 12 | 0 / 0 |
| phone-push-r9-db | 10 | 0 / 0 |
| phone-push-sweep-db | 3 | 0 / 0 |
| portal-telegram-db | 3 | 0 / 0 |
| merge-phone-privacy-db | 1 | 0 / 0 |
| merge-phone-delivery-db | 1 | 0 / 0 |
| ask-private-query-scan | 11 | 0 / 0 |
| calls-client-selection | 4 | 0 / 0 |
| inbox-drafts-actions | 11 | 0 / 0 |

**661 passed across 43 files; zero final failures/skips.**

Final locked niced tsc: **exit 0**. Role scan: **exit 0**, all differences explained above. Private-query scan: **611 per-function/source entries, 1276 fragments, 247 source files** (195 fenced, 156 trusted-background, 260 not-private), zero violations. `git diff --cached --check` passes; one blank EOF line from main’s engineering review was normalized. All tagged disposable clusters stopped. No visual verification was requested/performed.
