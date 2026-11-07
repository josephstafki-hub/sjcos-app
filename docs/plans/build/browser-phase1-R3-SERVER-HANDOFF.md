# R3 SERVER + QA handoff

UI integration — exact contracts:
- Import `searchBrowserProjectsAction` from `@/lib/actions/browser-projects` and pass it as JobPicker's `search` prop. Signature `(q: string) => Promise<AskResult<{jobs: {kind:'project';slug:string;name:string}[]}>>`. Projects only; current owner/staff access enforced server-side. No thread/folder search.
- Every Browser join request must include `device_id: UUID`. Generate this once per in-memory device/lifecycle and retain it through retries, duplicate/in-flight joins and owner renewals. Independent devices need independent UUIDs. Do not derive it from each request's idempotency key. Existing viewer+device credentials remain accepted for renewals, but `device_id` is required by the strict request schema. No persistence of viewer/control credentials.

Implementation is ready. UI integration is already present in the parallel builder's working tree.

## Finding → change → regression

| Item | Change | Test |
|---|---|---|
| ENG 1 server | Join requires a stable `device_id` UUID. Initial device secret is HMAC-bound to session + task + device, independent of request key. Existing supplied viewer credentials remain authoritative for renewal. Existing task-locked SQL reuses that exact session/device before slot counting; no migration or limit change. | `browser-r3-server`: actual website LOGIN routes cover double join, committed/lost response retry, concurrent retry with occupied second device, third-device 429 and cross-person refusal without retirement. Existing `phase1-bridges-db` retains secret/session/role/stale-stream tests. |
| ENG 2 | Under QA guards and seed advisory lock, lock the fixture task and verify scenario membership, QA principal, deterministic scenario thread and QA project. Fence old attendance, stream, control and consent before real guarded join/stop, finish the fixture run, retire cleanup attendance. Empty/settings states also retire previous tasks. | `qa-browser-fixture`: two still-visible devices, repeated refresh, stopped/revoked old run, retired streams/presence, replacement tasks, unrelated task preservation and refusal of missing scenario membership before mutation. |
| ENG 3 | Re-audited changed seed SQL and enclosing guard sources; refreshed only affected query/source pins in the private allowlist, including current `lib/ai-chat.ts`, `web.ts`, `web-transport.mjs` and QA seed. Scanner unchanged. | `ask-private-query-scan`. |
| SECURITY | Retain all 25 pending candidates; keep expected-revision/no-digest/no-approval checks. Accept 192; refuse 193 before storage. | `browser-outbound-data`; existing route 20-item paging tests unchanged. |
| DESIGN 4 | `searchBrowserProjects` in `lib/ai-chat.ts` uses current verified principal + Projects area. Owner sees all projects; staff with AI and Projects sees ordinary project records under the app's area-based model (no per-project ACL exists). Return only name/slug/kind, at most 20, with literal wildcard escaping and bounded input. New action exposes existing JobPicker result shape. | `browser-r3-server`: real action/DB/session for owner, Projects staff, permission removal, revocation, client refusal, field minimization, literal wildcards and bounded results/input. |
| DESIGN 7 | Normalize whitespace; truncated In use purpose ends at a word boundary plus `…`, within 60 characters. An overlong single word uses `Browser task…`. | `browser-r3-server`, updated existing `browser-routes` assertion. |
| DESIGN 12 expired/queue owner | **Seed bug, not an owner authorization/projection bug.** Creating staff's offer swept and closed the already-expired owner task. Seed both first, then expire selected deadlines; queue-expired tasks receive no offer. Fixture revision 3 refreshes old scenarios. | `qa-browser-fixture`: both owners/staff remain queued and actual website authorize + join return waiting/expired/queue_expired correctly. Queued state also passes. |

## Boundaries and coordinator checks

No factory file, schema, migration, narrow-role grant, production endpoint, live DB/service, shared QA port, dependency or runtime installation changed. All DB work uses only explicitly tagged `tests/_harness/testdb.mjs` clusters. No Next command, browser, app server, sudo/systemctl, push or deployment. No exit 137/Killed.

Root-hashed file changed (intersection with **both** `deploy/browser/runtime-lock.json` and `deploy/browser/playwright-patch/launcher-files.json`): **`lib/browser/web-transport.mjs`**. No refresh-production-sources or root inventory edits were run. Coordinator must refresh and re-attest combined bytes after builders freeze.

Coordinator still checks the real HTTPS UI with delayed identity, network retry and two devices, staff job picker, whole-word labels and owner queue/expired copy. Existing queued-event 503 fixture limitation is separate from the expired-task 403 seed bug and remains outside this change.

## Verification

Each file ran individually, sequentially with `SJC_TEST_CLUSTER_TAG=browser-p1-r3s-e78cf592`; no failed/skipped/cancelled final tests. The final harness stop returned true.

| tests/*.test.mjs | Pass / fail |
|---|---:|
| browser-r3-server | 4 / 0 |
| qa-browser-fixture | 19 / 0 |
| browser-routes | 52 / 0 |
| browser-live-view | 13 / 0 |
| browser-flags-db | 12 / 0 |
| browser-schema-db | 31 / 0 |
| browser-roles-db | 12 / 0 |
| browser-controller | 101 / 0 |
| browser-phase1-bridges | 43 / 0 |
| browser-phase1-bridges-db | 29 / 0 |
| browser-r1-server | 16 / 0 |
| browser-outbound-data | 33 / 0 |
| browser-private | 22 / 0 |
| browser-read-manifest-db | 27 / 0 |
| ask-private-query-scan | 11 / 0 |
| db-roles-manifest-db | 7 / 0 |
| db-roles-paths-db | 4 / 0 |
| ask-thread-access-db | 33 / 0 |

**469 passed, 0 failed across 18 files.** Locked `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: exit 0. `git diff --check`: exit 0.

`node scripts/db-roles-scan.mjs --diff`: exit 0, `sjcos_browser` 0 table differences. Existing agent/worker findings and intentional withholding remain (including agent `ai_conversations UPDATE`); no narrow write path or grant was added. QA-only retirement runs as the website login. No migration/manifest edit is required.

Development checks first reproduced QA resource-limit and closed-owner-task failures. Updated the existing label regression to test the new word-boundary contract. An early accidental overlapping harness run ended with a connection-terminated error; all final DB test files ran sequentially and the tagged cluster was stopped. No memory-limit exit occurred.

Commit identity is in the implementation reply; this handoff is included in that commit.
