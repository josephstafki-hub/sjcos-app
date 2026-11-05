# Phase 0 slice A — shared 0100, sessions and Ask admission

2026-11-05. Implementation only; no deploy, live DB access, services, browser,
Next server or build. All six new Browser settings default false. Browser launch
is unconditionally refused by app admission and the ordinary detached runner.
This is **slice A, not acceptance of the complete Browser/Canvas Phase 0**.

## Identity and schema

One migration: `db/migrations/0100_ask_launch_sessions_browser_core.sql`.
The additive schema snapshot is appended to `db/schema.sql`; ledger application
installs guards/grants after historical migrations. Existing runs backfill to
`legacy`; future defaults are `background`. Canonical sources are legacy,
panel_web, panel_mobile, panel_voice, telegram and background. No parallel
interaction_surface column. Run identity, source, profile, parent, task and start
are immutable; live-turn continuations must match person/thread/source/profile/task.
Narrow inserts are business/background with no principal/thread/parent/task.
Narrow updates are limited to background runtime fields; panel/session hijacks
and retained panel-run deletes are denied. Narrow-created start times are DB-set.

0100 adds web_sessions and all 0100 Browser relations: tasks, task_runs, commands,
viewers, web_commands, maintenance_jobs, read_manifests, read_uses, owner_views,
audit, audit_heads and audit_checkpoints. UUID FKs are RESTRICT, task/run/actor
association uses immutable composite FKs, live-task/device uniqueness is indexed,
and hashes, privacy/vault bindings and epochs have checks. Later vault/action FKs
remain reserved UUIDs until their owning migrations. Task/run/viewer identities
and approved manifests are guarded; audit update/delete/truncate is refused.
The model service has no SQL endpoint or table access in this slice.

Private tables have manifest notes and **zero grants** to agent/worker/readonly.
`node scripts/db-roles-sql.mjs` for all 13 tables prints empty output (recorded
explicitly in 0100); backup reads remain through pg_read_all_data. New trigger
functions are SECURITY DEFINER with `search_path=public,pg_temp`; PUBLIC EXECUTE
is revoked. Guards derive the trusted website login from the run table owner
and compare **session_user**, never definer current_user or caller GUCs.

## Session migration decision

**Compatible ordinary-login bridge, no automatic sid promotion.** Existing
sid-less signed cookies and existing native Bearer JWTs keep ordinary app access
and sliding behavior. They cannot enter Browser. Only password/portal real login
through createSession creates a random sid registry row and signed HS256 token
with issuer/audience, sid/user/authAt/generation/expiry. No force logout on deploy;
Browser will require one fresh real sign-in. Renewal retains sid/authAt/generation
and extends the live registry only after active-user/revocation checks. Cookie
sids are refused as Bearer credentials, including the mobile API. The Browser
reader reads only the cookie and additionally refuses missing/weak/development
secrets. DAL/current-user already uses readSession, which now validates sid rows;
no unrelated DAL code changed.

Logout/replacement verify signed sid independently of registry lookup, then
revoke in DB before deleting/replacing the cookie. A registry outage refuses
logout rather than silently deleting an unrevoked cookie. A DB trigger
fences that sid's model capabilities and viewers/control/stream generations.
Session-revocation epoch writes revoke all older registry rows and trigger the
same fences atomically. Pending-action staling must extend this in 0102 when
browser_actions exists; 0100 never queries future relations.

Sign-in return paths use one validator: only canonical relative
/today?browser=<uuid>[&review=<uuid>]. It parses against trusted
NEXT_PUBLIC_APP_URL (existing production fallback), never Host/forwarded headers;
rejects duplicate/extra keys, escapes, fragments, controls, foreign paths/origins
and >256 bytes. Proxy, LoginPage, LoginForm and auth action preserve/revalidate
that path with neutral notice. A legacy-cookie review tap reaches real sign-in
instead of an authenticated-home bounce loop. GET does not grant task access.

## Admission and exact caller inventory

`lib/ask-run-admission.ts` is server-only and inserts admitted rows transactionally
with current person/ai/revocation/session checks, locked thread, resume-session
match and profile derivation. **0100 alone returns ASK_THREAD_PRIVACY_REQUIRED**.
The thread owner/deleted fields in its current seam are consumed, not created.
Slice B must integrate its shared thread-access/recovery/journal gate here before
this application code deploys. A column's existence is not privacy acceptance.
Browser admission returns BROWSER_DISABLED regardless of supplied profile/options.

Callers touched (no thread ownership/tombstone/journal implementation):

- `lib/actions/ai-chat.ts`: typed Claude send selects current web/mobile source;
  typed Hermes/Qwen row uses the same admission with business profile; delegated
  voice work selects panel_voice. Autonomous follow-up does not retain attendance.
- `lib/mobile-rpc/operator.ts`: operator.send scopes shared action to panel_mobile
  using server AsyncLocalStorage, with no new JSON input.
- `lib/mobile-rpc/today.ts`: Today handoff scopes shared send to panel_mobile.
- `lib/dev-agents.ts`: startClaudeRun defaults background without request identity;
  explicit admitted calls use admitAskRun; verified Telegram uses telegram.
  Background work-item pings/retries retain subject_work_item_id and their run
  result, using fresh business context without private transcripts/owner session;
  retry grouping is by work item rather than historical chat. Background Hermes
  gets a per-run gateway session. These results no longer append to Ask history.
- `scripts/run-claude-agent.mjs`: reads canonical DB provenance, refuses Browser
  rows before ordinary profile setup, deletes optional raw Playwright MCP hook,
  emits source tag, and only resumes CLI history for matching person/profile/source.
- `lib/agent-runtime/claude-runner.mjs`: unattended MCP env fixes background/business
  tags after extraEnv and clears principal/conversation. No Browser registration.

Profile definitions in `lib/authority/run-profile.mjs` add browserEligible (active
owner or ai staff, panel_web, MCP on), exact four SJC tool names, no built-ins or
repository args, fixed 60 turns/20 minutes and safe permission mode. Staff cannot
obtain operator. Definitions are not an enabled isolated Browser launcher.

Other changed files: `lib/web-sessions.ts`, `lib/session.ts`, `lib/api-auth.ts`,
`proxy.ts`, `lib/actions/auth.ts`, `app/login/page.tsx`,
`components/auth/LoginForm.tsx`, `deploy/db-roles.manifest.json`, `db/schema.sql`,
the migration, and the test files listed below plus `tests/phase0a-fixtures.mjs`
and `tests/_harness/testdb.mjs`. Existing logout route/action inherit the new
revocation via deleteSession; neither needed a separate edit. lib/dal.ts and
lib/actions/dev-agents.ts did not require edits. No slice C/judge files staged.
Initial checked HEAD: 9ce3caaa753a7d8cb6c1bc0e5009453955a10ef4; branch
t3/in-app-browser-agent-tools. Concurrent plan/slice C commits advanced HEAD
to 365c250d6c1a2354f90d33779cd1e4a4fd63ba1a before this commit.
The user explicitly authorized the three caller adapters, login action/form,
and minimal source-helper mocks/assertions in the two existing integration tests.

## Disposable identity evidence and verification

SJC_TEST_CLUSTER_TAG=phase0a-20261105-1. No production URL loaded.
withSessionIdentity uses an exclusive harness-administrator pg.Client, checks
assertNotProduction, transfers disposable objects to a separate non-superuser
sjcos_test_website owner, uses closed fixed SET SESSION AUTHORIZATION statements,
asserts both identities, resets authorization and closes the connection in finally.
No harness-superuser whitelist, arbitrary identity interpolation or pooled reuse.

Denied panel inserts/hijacks assert session_user=current_user=sjcos_agent and
sjcos_worker. Successful background INSERT/runtime retry asserts both are
sjcos_worker (agent retains its existing read-only run grants). Trusted admitted
SQL controls assert both are sjcos_test_website. Tests include 20 direct narrow
attacks, 11 excluded Browser source/person cases, session issuer/audience/expiry/
generation/revocation/Bearer attacks, 11 hostile returns, continuation/resume and
cross-person attacks, and the real worker-login launcher with a fake child spawn.
The admission test's two future thread fields are a **test-only contract stub**,
not 0105 DDL or privacy/recovery evidence. Standalone upgrade test reconstructs
pre-0100 tables inside a separate disposable DB, then applies the exact SQL in a
transaction; no migration ledger entries are forged or skipped.

All files run singly; no test suite, browsers or model subprocesses launched.

| Test file | Final pass / fail |
|---|---:|
| tests/web-sessions-db.test.mjs | 4 / 0 |
| tests/ask-run-admission-db.test.mjs | 4 / 0 |
| tests/browser-run-profile.test.mjs | 14 / 0 |
| tests/browser-roles-db.test.mjs | 3 / 0 |
| tests/agent-profile.test.mjs | 9 / 0 |
| tests/db-roles-manifest-db.test.mjs | 6 / 0 |
| tests/db-roles-paths-db.test.mjs | 2 / 0 |
| tests/access-db.test.mjs | 7 / 0 |
| tests/agent-runtime-db.test.mjs | 10 / 0 |
| tests/portal-telegram-db.test.mjs | 3 / 0 |
| tests/merge-chat-regressions.test.mjs | 2 / 0 |
| tests/mobile-rpc.test.mjs | 26 / 0 |
| tests/api-auth-coverage.test.mjs | 1 / 1 (baseline failure) |

The two authorized integration-fixture files were each run once after their
minimal mock/source-assertion edits; no existing assertions removed or weakened.
api-auth-coverage's old static regex flags 44 unchanged mobile routes using shared
auth wrappers. A separate temporary copy of the HEAD test against the unchanged
route tree reproduces the same failure. No allowlist/auth-test weakening applied.

Final tsc: **exit 0**, using flock /tmp/sjcos-tsc.lock nice -n 19 npx
tsc --noEmit -p . (exit 0). db-roles scan --diff: exit 0, no unaccounted grants; intentional
withheld entries are printed, including private web/session imports reachable via
the worker import graph. Syntax and git diff whitespace checks pass.

## Not done / release blockers

- Slice B's 0105 thread ownership/privacy, tombstones, journal, durable high-water,
  maintenance/recovery/startup gate and full web/mobile/voice/private-read guards.
  It must update the shared admission helper before application deployment.
- Dedicated fifth service-login bootstrap/generator/resolver integration and scoped
  runtime SQL commands, real strict CLI config/env/rendezvous, history partitions,
  all actual-browser/namespace/memory gates. No runtime admission is enabled;
  browser-run-profile tests cover definitions/denials, not real CLI rendezvous.
- 0101–0104 vault/actions/files and their additional scoped commands/FKs;
  pending-action revocation staling once 0102 exists; authenticated audit writer,
  independent anchors and retention command integration.
- No Browser UI, Browser service start, feature enable, deploy, build or visual
  verification. Coordinator should check ordinary login/renew/logout and
  review/Watch sign-in return on the final combined build, after B acceptance.

Apply 0100 additively with every feature off; do not deploy this admission code
until B completes its release prerequisites. Rollback keeps additive private data
and disables runtime/flags, rather than dropping sessions/audit/provenance.
