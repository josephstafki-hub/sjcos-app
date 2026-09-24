# Build status and evidence

Updated: September 23, 2026.

**September 23 build:** every task A00–A24 is IMPLEMENTED on branch
`t3code/build-sjc-os-plan` with a test suite (405 tests, 403 pass, 0 fail, 2 skipped
without the harness binaries) and per-task evidence in `status/*.md`. Nothing is
deployed, enabled or proven on the live service: no production migration was
applied, no timer installed, no policy activated, no send performed. The
operational columns below stay "not deployed" until the deploy packet in
`deploy/README.md` is executed and Joe records each state on `/engine/capabilities`.

## September 23 revision

Added WORKFLOW.md (W01–W12), OPERATING_AGENTS.md, tasks A23/A24 and checks V31–V46.
Reconciled affected decisions, feature tasks, engineering/integration contracts
and the whole-build handoff. All 28 tasks remain unverified against the current
application. The source baseline below is historical September 17 inspection;
no current repository/production audit or operating-model evaluation was performed.

Documentation verification results for this revision are recorded below. The source documents, consolidated read copy and ZIP must agree.

## Historical September 17 evidence

- Original audit source: `77522d1ba0656d0367aad5556430493900064621`.
- Refreshed origin/main source: `43e0eada71d5e34f3122ebebe71e52f26217ceef`.
- Local planning branch: `plan/consolidated-automation-2026-09-17`.
- Targeted source review covered current staff/AI permissions, action helper,
  cron error handling and integration entry points. It was not a complete repeat
  audit. The prior audit's 65 passing tests are historical, not current test results.
- No operational SJC OS MCP tools were available in this revision. Production
  version, active automations, deployed schema/settings, actual backup restoration
  and real workflow outcomes remain unverified.
- Existing full-designer development is owner-reported work by other agents.
  Its branch, feature status and device/runtime contracts require coordination;
  this planning session did not inspect or modify that separate work.
- No application build/tests, production migration, sends, payments, deployment,
  external account purchase or service cancellation were performed by this revision.
- GitHub publication remains unconfirmed. Earlier GitHub write attempts returned
  insufficient integration permission; local commits and the downloadable patch
  are not evidence that a remote branch or PR exists.

## Historical documentation verification

Executed September 17, not rerun by the current revision:

- `python3 /workspace/scratch/c95a627135df/validate_plan.py` — PASS: nine documents,
  relative links/code fences, all 26 task/status rows, acyclic task dependencies,
  all 16 audit mappings and 30 required verification cases; no stale mandatory
  timing/sample-count instructions. This is a documentation check, not app proof.
- `git diff --check` — PASS, no whitespace errors.

No test matrix item in VALIDATION.md is marked passed solely because it is written.

## September 23 documentation verification

Executed for this planning delivery:

- `python3 workflow_revision/validate_documents.py` — PASS: 11 source documents,
  relative links/fences/tables, 28 matching task/status rows, acyclic dependencies,
  16 audit mappings, 12 workflow stages and 46 verification cases.
- `git diff --check` in the isolated patch assembly — PASS.
- `git apply --cached --check` against historical base
  `43e0eada71d5e34f3122ebebe71e52f26217ceef` using a disposable index — PASS.
- Applying the patch in that disposable index produces exact source-document bytes.
- Consolidated read-copy and ZIP member equality are checked during packaging.

These checks validate documentation and packaging only. Application features,
production state and operating-model behavior remain unverified. GitHub publication
was not attempted by this revision; the supplied patch is a local handoff.

## Task ledger

"Not verified" means this session has not established implementation against the
complete task contract, not that the repository contains no relevant code.
During coding use claimed/in progress/blocked/implemented with assignee and branch;
record operational states separately as not deployed/deployed disabled/enabled for
scope/proven for scope. Each operational claim needs date, version and evidence.

| Task | Implementation against this revision | Operational proof | Required scope |
|---|---|---|---|
| A00 | Implemented (status/A00.md) | Not deployed · not enabled · not proven | Current evidence, test environment and migration discipline |
| A01 | Implemented (status/A01.md) | Not deployed · not enabled · not proven | Stable obligations and protected task state |
| A02 | Implemented (status/A02.md) | Not deployed · not enabled · not proven | Transactional runbook start, advance and repair |
| A03a | Implemented (lib/commands/*, tests/commands-core-db) | Not deployed · not enabled · not proven | Shared server commands and minimum action records |
| A03b | Implemented (status/A03b.md) | Not deployed · not enabled · not proven | Durable intake and supervised worker |
| A04 | Implemented (status/A04.md) | Not deployed · not enabled · not proven | Evidence-backed completion |
| A05/A06 | Implemented (status/A05_A06.md) | Not deployed · not enabled · not proven | Approval binding and duplicate-safe external actions |
| A07a | Implemented (status/A07a.md) | Not deployed · not enabled · not proven | Small independent invoice integrity repair |
| A07b | Implemented (status/A07b.md) | Not deployed · not enabled · not proven | Invoice lifecycle, balances and automatic contract billing |
| A08a | Implemented (status/A08a.md) | Not deployed · not enabled · not proven | Immediate business-agent access restrictions |
| A08b | Implemented (status/A08b.md) | Not deployed · not enabled · not proven | Enforced worker identities, budgets and recovery |
| A09a | Implemented (status/A09a.md) | Not deployed · not enabled · not proven | Off-host backups, basic alerts and restore proof |
| A09b | Implemented (status/A09b.md) | Not deployed · not enabled · not proven | Independent uptime and business-progress monitoring |
| A10 | Implemented (status/A10.md) | Not deployed · not enabled · not proven | Automatic routine policy and one-tap decision surfaces |
| A11 | Implemented (status/A11.md) | Not deployed · not enabled · not proven | Complete lead intake and follow-up |
| A12 | Implemented (status/A12.md) | Not deployed · not enabled · not proven | Subcontractor paperwork collection |
| A13 | Implemented (status/A13.md) | Not deployed · not enabled · not proven | Procurement, commitments and approved bill payment |
| A14 | Implemented (status/A14.md) | Not deployed · not enabled · not proven | QuickBooks Online connection and reconciliation |
| A15 | Implemented (status/A15.md) | Not deployed · not enabled · not proven | Evidence-based estimates and closeout cost learning |
| A16 | Implemented (status/A16.md) | Not deployed · not enabled · not proven | Sub portal field evidence, scheduling and weekly client summaries |
| A17 | Implemented (status/A17.md) | Not deployed · not enabled · not proven | Closeout, warranty, signed documents and approved marketing |
| A18 | Implemented (status/A18.md) | Not deployed · not enabled · not proven | Baseline, overhead, learning governance and truthful procedures |
| A19 | Implemented, phone side not built (status/A19.md) | Not deployed · not enabled · not proven | Owner site and office time capture |
| A20 | Implemented, no Square account (status/A20.md) | Not deployed · not enabled · not proven | Square card and ACH customer payments |
| A21 | Implemented; Houzz still in use (status/A21.md) | Not deployed · not enabled · not proven | Integrate existing full 3-D designer and retire Houzz dependency |
| A22 | Implemented (status/A22.md) | Not deployed · not enabled · not proven | Delegated approvals and employee accounts |
| A23 | Implemented (status/A23.md) | Not deployed · not enabled · not proven | Confirmed lead-to-closeout workflow and proactive estimate assembly |
| A24 | Implemented; model evals recorded (status/A24.md) | Not deployed · not enabled · not proven | Loaded operating-agent instructions, context and model behavior evaluations |

## September 23 build evidence

- Branch `t3code/build-sjc-os-plan` (worktree), 23 migrations `0000`–`0023` in the
  checksummed ledger (`db/migrate.mjs`); `db/schema.sql` frozen baseline.
- `npm test` (node --test, one disposable Postgres database per file):
  405 tests, 403 pass, 0 fail, 2 skipped. `npx tsc --noEmit` clean. `eslint` clean
  on every file touched by the build.
- MCP server: 228 tools (`node scripts/list-mcp-tools.mjs`), smoke-booted against
  the harness; every feature contract (estimating, procurement/cash, billing,
  field/schedule/closeout, workflow, decisions, obligations, measure, context) is
  reachable by agents through scoped tools.
- Operating-agent evaluations (`evals/`, `scripts/run-evals.mjs`): harness
  self-test 8/8 (a naughty runner fails every scenario on a mandatory check);
  real-model results in `evals/results/latest-claude.json` — see status/A24.md
  for the per-scenario reading and the harness limits found (decision staging
  through the app route is unreachable from the harness; fixed after the first run).
- Deploy packet: `deploy/README.md` "Automation build (2026-09-23)" — units to
  install, env keys, migration order, rollback. `AGENTS.md` text to apply only
  after enforcement is deployed: `docs/automation-reliability/agents-md-migration.md`.
- Owner setup still required before anything is *enabled*: Square account,
  Intuit app credentials, off-host backup target + passphrase, Telegram bot
  callback route, first policies on `/engine`, pricing setup v1, capability
  evidence (`scripts/record-capability-evidence.mjs`, implemented only).

## Remaining setup, not another planning questionnaire

DECISIONS.md records settled requirements and the exact remaining setup items:
Square onboarding; QBO connection and reviewed mappings; supported outgoing-payment
rail; approved initial pricing; actual mobile/designer interfaces; notification
identity/credentials; off-host backup target and equipment; historical record
matches and old-automation cutover. Build fixture adapters and setup screens while
those inputs are pending. Ask Joe only when a concrete next enablement step needs
his input, with a small number of questions at a time.

## Per-slice entry

```text
Date / task / slice:
Agent / branch / source version / claimed files:
Failure reproduced / changed behavior / callers checked:
Changed files / ordered migration IDs and checksums:
Exact verification commands / environment / actual results:
Sanitized evidence references / remaining untested conditions:
Setup / activation / deployed version / policy scope (or not performed):
Rollback / compatibility / unknown effects requiring reconciliation:
Remaining acceptance criteria / dependency or setup blocker:
Next precise ready slice:
```

Start the whole-build assignment in AGENT_HANDOFF.md. A00 is a shared prerequisite,
not permission to stop the complete implementation after creating a harness.
