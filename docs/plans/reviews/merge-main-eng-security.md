SCORES engineering: design=9 completeness=8
SCORES security: design=9 completeness=8

Review of merge f141b016 at HEAD e90d8c89, comparing both `7987df57..f141b016` and `b061de03..f141b016`. Not approved until the two required fixes below are complete. Source files were not edited.

## Findings and REQUIRED fixes

1. **P2 — Historical private dedup hashes survive the upgrade.** `db/migrations/0112_ask_phone_copy_privacy.sql:74` (also line 90) selects outbox rows only through `ask_push_is_private(payload,href)`. Earlier pending migration 0105 already replaces recognized private payloads with `{}` and hrefs with `/today`, setting `ask_reply_erased=true`, but it does not know about main's `conversation_key`. Consequently 0112 cannot rediscover these rows and never invokes its new trigger to clear their text-derived hashes. Sent rows can retain the hash indefinitely, readable under the existing narrow-role outbox SELECT grants; erasure replay has the same omission. This is a derivative-retention failure, not a demonstrated plaintext APNs leak.

   Independently reproduced on a tagged disposable main-first database: apply 0110/0111; seed a conversation-bound owner reply and an outbox row with its decision UUID in the payload and a non-null conversation key; invoke the actual migrator for the pending migrations. Final row: `title='Private Ask request updated.'`, `payload={}`, `ask_reply_erased=true`, **`conversation_key='PRIVATE_TEXT_DERIVED_HASH'`**. The existing merge regression misses this because it seeds only the new reply/phone identifiers, which 0105 does not recognize.

   **Exact required change:** in `erase_ask_phone_copies`, include already-erased rows in the outbox cleanup predicate: `WHERE ask_reply_erased OR ask_push_is_private(payload,href)` (at both cleanup statements, or consolidate to an equivalent unconditional re-scrub of marked rows). Add a main-first regression at `tests/merge-phone-privacy-db.test.mjs:24` with a source association recognized by 0105 and a non-null dedup hash; assert it is NULL after migration and replay and cannot be restored by a late update. Refresh the SQL audit hash/explanation in `tests/fixtures/ask-private-query-allowlist.json` after reviewing the change. The census and merge handoff currently overstate historical hash cleanup; their claim must be supported by this regression.

2. **P2 — The required worker admission regression crashes before its security assertions.** `tests/ask-run-admission-db.test.mjs:86` dynamically imports TypeScript after the preceding test installs loader hooks. On this checkout's Node v22.23.4 the subsequent access at line 100 fails with `Cannot read properties of undefined (reading 'CommonJS')`. File result: 3 pass, 1 fail. Thus the actual worker-login test never verifies that inherited person/thread identity is discarded or that MCP stays off. This file is part of the branch delta against main even though the merge did not modify it against 7987df57.

   **Exact required change:** add a top-level `import ts from 'typescript';` before test-installed hooks and remove `const ts=(await import('typescript')).default` from line 86, matching the already-working `ask-r3-auth-db` fixture. Run the complete single test file and repair any additional fixture failures it exposes without weakening its worker identity/MCP assertions.

## Merge and security assessment

The six conflict resolutions retain main's post-commit owner action handling, channel receipts/leases/retries, app reply routing and revised-card links, while carrying forward private source/person checks, journal admission and typed Ask failures. Both foreground and background call loaders now pass the authenticated user to the line-aware `getCall` before reading events. Main's phone-line implementation, APNs builder and phone settings RPC are unchanged against b061de03. Shared line summaries remain explicit business communications, not automatic Ask transcripts.

The phone privacy approach is sound apart from the historical hash omission: persistent opaque reply/phone associations, sticky phone/outbox redaction, descendant and summary cleanup, persisted-row reload before APNs payload construction, notification override sanitization, and fail-closed legacy Telegram classification. The API refuses private phone actions before saving submitted text. Device delivery remains restricted to active owner iOS registrations with session expiry/revocation checks; staff enrollment does not make a staff device eligible. No additional plaintext cross-person phone leak was demonstrated. This assessment distinguishes explicit shared business artifacts from automatic private Ask copies, including Joe's own private copies.

0112 is unique and additive; its trigger/repair functions use SECURITY DEFINER with `search_path=public,pg_temp` and revoke PUBLIC execution. The wrapper preserves the website-login check and prior erasure function. It adds no new table or narrow grants. Manifest resolution preserves the private website-only entries and main's existing phone/approval privileges. The real main-first migration regression applies pending 0100, 0105–0109 and 0112 successfully and reaches no pending migrations; successful application alone does not establish complete erasure (finding 1).

## Verification

Executed the union of changed/new `tests/*.test.mjs` files from both parent comparisons, plus the two db-role regressions, one file at a time. Each file used `SJC_TEST_CLUSTER_TAG=mergerev-<timestamp>` and its tagged disposable cluster was stopped after the run. A separate tagged disposable cluster was used and stopped for the independent migration counterexample.

Final result: **69 of 70 files passed; one file failed, with one failed assertion/test and no skips.** All requested phone-push files, both APNs files, phone-lines-db, portal-telegram-db, comms-summaries-db and approve-work-item-db passed. Phase 0 privacy/recovery/session and Canvas checks passed apart from the admission fixture identified above. `test-db-guard` passed all 23 checks, including the complete runtime pg import census; main’s added paths do not bypass guarded-pg. Canvas rollout tests include disabled/default flag behavior.

The exact locked command `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .` passed. `git diff --check 7987df57 f141b016` passed. The private-query scan passed: 611 audit entries, 1276 fragments, 247 files, zero violations. Its passing source inventory does not prove the erasure semantics; the new phone/APNs serializers and SQL carriers are covered, but the reviewed SQL hash currently blesses finding 1.

`node scripts/db-roles-scan.mjs --diff` exited 0. It prints expected withheld/column-limited permissions, plus unannotated agent UPDATE differences for ai_conversations, dev_agent_runs and run_steers; these private writes must remain behind website admission, not be fixed by broad grants. Manifest and real-role path tests passed.

No live/QA database, protected deployment-state directory, deployment, service operation, browser, Next process or dependency installation was used. No exit 137 occurred.
