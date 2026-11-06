SCORES: design=7 completeness=7

Security BUILD round 3. Reviewed HEAD 08f8561a3a72e05ffdbc4440f3fd4469433b0a59. Source unchanged. Round-2 grant disclosure and reply mutation are fixed at their original entry points, but conversation-linked reply confidentiality is still broken by downstream copies. Acceptance is withheld for V1 below.

## Inventory verdicts

| Surface | Verdict and evidence |
| --- | --- |
| Express permission and historical excerpts | PASS: mintRunGrant uses fixed text; 0105 redacts automatic historical reasons, including unbound rows. Executed migration and actual mint code. |
| Staff/owner MCP list/check | PASS: captured runner tuple validated against live person/run/thread; self predicates precede ordering/limit/serialization. Real website login tests exercise owner and two staff principals, expired foreign grants, forged/missing contexts and identical foreign/missing errors. |
| Raw narrow SQL grants/replies | PASS for these two tables: FORCE RLS denies all private rows to actual sjcos_agent, sjcos_worker and sjcos_readonly session identities, even with a forged actor GUC. Shared business rows remain usable. Worker mutation/source-link probes deny. |
| Reply lookup/mutation by reply/grant/decision ID | PASS: bound person/live-thread predicates, fixed denials, no foreign Telegram send. Own explicit reply and shared business fallback tested. |
| Telegram recording/delivery/sweep | PARTIAL: recording checks owner/thread; delivery checks stored association and current owner under journal; sweep excludes private rows. However recording copies private reply text into shared decision history and work-item/error fields: FAIL V1. |
| Tombstone erasure | PARTIAL: reply bodies/answers and grant reason/scope/audit are erased and grant revoked; deleted reply delivery/filing denied. Shared derivatives in V1 are not erased. |
| Filing/Unsorted and attachment handoff | PASS for tested paths: closed stdio context, exact live source ownership, shared ancestor root and symlink alias cannot bypass Ask guard; foreign/forged/HTTP/deleted requests cause zero reads/stores. Owned explicit handoff works. |
| Web rail/history/archive/folders/search and mobile rail/actions | PASS at DAL/action/serializer level: owner/staff self-only before limit; foreign operations leave state unchanged. Tested non-superuser website identity and RLS-bypassing harness identity. This is not DOM/HTTP acceptance. |
| Transcript/run/interaction/steer/TTS | Prior round's exact ownership guards remain; server-boundary tests exercise fixed denial and closed recovery behavior. No new bypass established. Not every prior test suite was rerun. |
| Bell/decisions/intent history/work items | FAIL for automatic reply copies. These cannot be classified globally as business-only merely because the originating card concerns a business send. |
| Business receipts, notifications, knowledge, digests, push, detached run outputs | No new direct automatic transcript copy established beyond V1. Explicitly submitted business artifacts are shared by design. Complete transitive provenance across all these consumers remains unverified; a green scanner is not proof. |
| Browser tables/new Phase-0 storage | Not covered by the private-query scanner's table pattern. Browser runtime remains deferred; no additional running exploit established. Separate Browser authorization tests from earlier rounds do not make this inventory exhaustive. |

## V1 — HIGH: protected conversation-linked Telegram replies are copied into shared records

- `lib/decisions/owner-replies.ts:150` calls resolveFromChannel for a pending permission card with `note: input.text` at line 157, including when the verified route is `session`.
- `lib/decisions/resolve.ts:85` constructs a note containing that entire text; `lib/commands/decisions.ts:283` saves it to `decisions.decision_note`. `lib/decisions/resolve.ts:93` independently saves the original text into `decision_events.detail`.
- `lib/decisions/resolve.ts:123` and `:130` also copy that note into matching `action_intents.last_error` on cancellation. This branch is source-confirmed; my dynamic probe had no pending intent and therefore does not claim a tested intent exposure.
- The parallel draft path copies a session-linked reply into shared `work_items.blocked_reason` at `lib/decisions/owner-replies.ts:258`–267. Source-confirmed; not dynamically exercised here.
- `lib/ask-thread-journal.mjs:67`–69 erases owner_replies/owner_grants only, leaving these copies. 0105 likewise does not redact or partition these downstream records.

Independent reproduction: extended the existing disposable R2 fixture in memory, without writing a test/source file. Invoked actual recordOwnerReply → resolveFromChannel → resolveDecision code against the non-superuser website connection with an existing real owner's principal and owned live thread. A pending grant decision received `R3_PRIVATE_TELEGRAM_BODY_91c2`; the returned route was `session`. Actual sjcos_agent, sjcos_worker and sjcos_readonly connections each SELECTed that literal sentinel from BOTH decisions.decision_note and decision_events.detail. The principal and decision implementations were real; unrelated grant-settlement and background wake hooks were stubbed, not the copying SQL or SELECT enforcement. No Telegram message was sent. This proves the narrow-login exposure without assuming arbitrary SQL is available to a staff MCP tool.

This is a continuation of round-2 V2's derivative boundary, not a failure of the newly fenced owner_replies SELECT itself. A note explicitly routed back to a private conversation is automatically published to shared history. Business card metadata may remain shared; the full private reply must not follow it implicitly.

## Deployment latch/bootstrap verdict

Requests do not call bootstrapDeployment. The CLI requires `--new-install`; existing identity creation is exclusive. Ordinary journal activity can create deletion-enabled.json monotonically, as intended, but no exposed request/tool clear operation was found. Narrow SQL identities have no filesystem capability and cannot turn this into bootstrap. Staff/business profiles lack Bash/Write/Edit and cannot select the operator profile. No staff/request exploit of the latch was established.

The executed real pg_dump restore test restored a pre-latch database, removed the journal, retained protected state, and denied callbacks for absent/partial/wrong/unreachable authority with the deletion flag off. Valid authority replayed the tombstone before admitting access. Missing identity paused. Thus the stated restore protection works **when protected evidence survives**.

It is NOT a boundary against every agent run. `lib/authority/run-profile.mjs:82` gives owner operator runs repository access and shell tools; `scripts/run-claude-agent.mjs:736` spawns without a distinct uid/mount isolation. Such a process runs as the same filesystem user. Independently demonstrated in a temporary directory: deleting deletion-enabled.json makes readDeployment report ledger=null; deleting identity.json and explicitly bootstrapping creates a fresh identity. Combined with a pre-delete database, lost journal and absent authority configuration this removes all evidence used by the virgin-state branch. Removing the marker alone does not override intact DB/journal/authority evidence. This is within the handoff's explicitly excluded filesystem-administrator trust boundary, so not a separate required vulnerability in this round; do not advertise resistance to an owner operator with shell access. If that agent is meant to be untrusted, independent OS/service ownership is necessary.

Filesystem probes (temporary paths only):

- New state directory/file modes are 0700/0600; readDeployment rejects a symlink leaf directory, symlink leaf file and group/other permission bits in its explicit checks. wx and fsync protect normal creation.
- `lib/ask-deployment-state.mjs:20`–22 writes identity **before** validating the directory: bootstrap through a leaf symlink created identity in its target, then rejected. No overwrite occurred because creation uses wx.
- Ancestor symlinks are accepted; ownership/ancestor write permissions are not checked, and lstat/readFile is not a descriptor-based no-follow read. requireSeparateDeployment resolves real paths and rejects nesting, but does not establish different physical restore volumes.
- Default ~/.local/state is preferable to a shared predictable /tmp directory and safe against other Unix users only with a trusted home/ancestor chain. I did not inspect or touch the actual protected directory. Arbitrary configured paths under writable ancestors are not certified safe. Optional hardening: validate ownership and ancestor trust before any bootstrap write and use no-follow descriptor operations. These probes alone do not demonstrate an unprivileged attack on the default protected home path.

## Static scan recheck

All five maintained scanner tests pass. The round-2 owner_grants, composed ai_messages name and private_chat_view counterexamples now produce hits, and filesystem reader/transport source hashing is present. SQL migration definitions are included.

Independent scanSource probes still return **zero hits** for simple SELECTs from decisions, decision_events, action_intents, browser_commands, browser_read_manifests and browser_audit. The first three now have a demonstrated/source-traced private-copy producer. Existing whole-file hashes incidentally cover some producers because they also mention recognized tables, but do not classify the downstream tables or detect a new reader in a new file. Add the actual derivatives and their readers to the inventory; separately inventory the new Browser tables. Unknown wrappers/ORM mappings, cross-module composition and automatic copied data remain outside any claim of exhaustive scanner proof.

## Tests and coordinator QA

Sequential single-file runs, each under SJC_TEST_CLUSTER_TAG=p0r3sec-<epoch>, with EXIT traps stopping the disposable cluster:

- ask-r2-server-db: 11 passed.
- ask-private-query-scan: 5 passed.
- ask-folder-privacy-db: 11 passed.
- ask-server-boundaries-db: 8 passed.
- web-sessions-db: 4 passed.
- Independent in-memory R2 extension with V1 probe: 12 passed, including explicit exposure assertions for all three real narrow logins. Initial data-URL loading failed resolving pg before DB startup; corrected module resolution and reran successfully.
- Independent temporary-filesystem and scanner probes passed their observed-behavior assertions; all temporary state removed.

No exit 137, browser, Next process, install, deployment, live/QA database/service or protected deployment directory access. Tests use real person rows/session_user identities with controlled session/provider seams, not a real authenticated HTTP/browser session.

Paused transcribe/TTS responses are fixed AskFailure codes, not exception text, prompts or audio; boundary tests pass with downstream callbacks suppressed. Session validation precedes private data access; session lifecycle tests pass. An expired session mapped to paused is an error-classification problem, not evidence that private data was returned. I cannot certify zero leaks in every response/DOM at seven widths, ?c= deep links or Cmd-K: browser work was expressly prohibited. Coordinator must inspect those real pages and response bodies with owner/staff and expired cookies; this report supplies no visual acceptance claim.

## REQUIRED fixes

1. Stop automatic private reply text copies into decisions/decision_events/action_intents/work_items, or partition them by immutable source ownership with equivalent read, mutation and deletion/replay enforcement. Redact historical copies. Preserve shared business status using fixed text where practical. Add real-login regression tests starting at Telegram reply recording (pending grant and draft paths), covering downstream reads and tombstone/recovery; extend the scanner/inventory to those derivative tables and consumers.

## Optional

Harden bootstrap's pre-write directory validation and filesystem traversal; explicitly document operator-shell trust and deployment ancestor/backup provisioning. Continue transitive data-flow review and inventory Browser tables before runtime activation. No source changes made; only this review is committed.
