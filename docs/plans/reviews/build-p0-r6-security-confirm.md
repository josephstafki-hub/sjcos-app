SCORES: design=10 completeness=10

Security judge, BUILD round 6 CONFIRM. Reviewed `git diff 0cc5287b..c42ac209` and the affected authorization, data-reader, rendering and framework paths at c42ac209 on t3/in-app-browser-agent-tools. No new exploitable or data-exposure regression established. Round-5 security conclusions remain valid within their documented Phase 0 scope and trusted-host/provider boundaries.

## Findings

- **Privacy census:** the diff adds no private transcript producer, storage carrier or unguarded Ask reader. The allowlist change updates the reviewed 0105 checksum and explains the trigger ACL restriction; it does not exempt new queries. The private-query scanner passes. Existing per-person ownership, immutable provenance, deletion/replay and reply-copy protections remain intact; boundary and real-login reply-copy tests pass.
- **Push sanitization:** both trigger-only SECURITY DEFINER functions now revoke PUBLIC execution. Actual agent, worker and readonly identities cannot attach them to forged temporary tables. Installed triggers still bind legitimate website sources and sanitize private pushes; the boolean lookup remains available without exposing the registry. Historical sends/failures, tombstone/replay, late writes and stale drain snapshots pass. This tightens capabilities without weakening the round-5 sanitizer.
- **Background actions:** loadDrafts/saveDraft still resolve getCurrentUser and inbox permission before entering mailbox scope or SQL. loadCall still resolves identity/comms before fetching call data. Real expired legacy/sid cookies, revocation, missing cookies and permission removal return typed failures without business callbacks. Foreground wrappers do not change these background paths. Session/user validation reads are not business reads.
- **Queue expiry:** both the document auth-loss subscription and refresh failure clear priorities and waiting. The subscription sets signedOut and clears both lists in the same synchronous callback; React batches those updates before the resulting render. The direct refresh failure clears lists before setting signedOut. Refresh responses and incoming initial props cannot refill the stopped provider. QueueRail gates both priorities and WaitingList behind signedOut; active TodayCards gates its rows and suppresses the count. Mounted lifecycle tests begin with populated private sentinels and confirm empty lists plus signedOut after expiry. Rendering tests confirm the sign-in line. No stale queue item is rendered alongside that line.
- **Call selection:** loadSelectedCall uses requireAccess('comms'), independently of Ask permission, then the same private module helper used by loadCall. Missing/stale users and staff without comms are rejected before call/event reads. An important scope distinction: calls are the existing shared business-number log, not person-private Ask records. getCall selects by call ID, getCallEvents by call ID, and the comms-protected Calls page already lists all business calls. A comms-authorized staff member can read a call placed by another person, just as before this diff; neither action promises placed_by isolation. This is not a newly granted cross-person private-Ask capability. The denied-area and no-ai positive controls pass.
- **Inbox foreground redirects:** scoped uses requireAccess('inbox'), then the same validated mailbox/user namespace. Missing/stale sessions redirect to fixed /login or /logout; permission denial uses the fixed role/permission route catalog. No caller-controlled destination enters these redirects. Human draft SQL remains mailbox/person scoped; a forged mailbox/user input cannot select another namespace. Sign-in return links are separately validated by validateAppReturnPath on the login page and action.
- **CSRF:** no proxy, cookie or server-action configuration change. Installed Next action-handler still rejects mismatched Origin versus Host/X-Forwarded-Host before action execution; next.config.ts has no serverActions.allowedOrigins override. Foreground authorization redirects do not bypass this check. The round-5 missing-Origin/SameSite limitation and framework-inspection evidence scope remain unchanged.

## Validation

Passed sequential single-file runs (no failures or skips):

- tests/ask-r4-server-db.test.mjs
- tests/ask-r3-auth-db.test.mjs
- tests/ask-private-query-scan.test.mjs
- tests/ask-panel-ssr.test.mjs
- tests/inbox-drafts-actions.test.mjs
- tests/calls-client-selection.test.mjs
- tests/ask-server-boundaries-db.test.mjs
- tests/ask-r3-reply-copies-db.test.mjs

Used unique SJC_TEST_CLUSTER_TAG=p0r6sec-<timestamp> disposable clusters with outbound disabled and EXIT cleanup; both clusters reported stopped. No source/test changes, subagents, browsers, Next processes, installs, deploys, live/QA databases, services or protected deployment-state directories were used. No resource kill occurred.

Coordinator-supplied QA is accepted as external evidence: zero cross-person leaks on real owner/staff pages at seven widths and correct Today/panel expiry flows. It was not independently reproduced here. The unchanged round-5 full dump/restore and attachment/filesystem investigations are carried forward by diff review, not claimed as rerun.

## Scope notes

The new sign-in gate covers the active Today queue and panel queue. TodayCards still renders its server-provided brief, and the existing Done/Snoozed recovery view owns separate previously delivered state. This is not a claim that every previously delivered business datum in the document is erased on session expiry. No new unauthorized server read or private Ask exposure follows from those unchanged surfaces. Deferred Browser runtime and production deployment remain outside this confirmation.

## REQUIRED fixes

None.
