# Build coordination — who owns what (2026-09-23)

Integration owner: the session on branch `t3code/build-sjc-os-plan` (worktree
`/home/joe/.t3/worktrees/sjcos-app/t3code-b015e50c`). All workstream agents
work in THIS worktree, on disjoint files, and never run `git commit`, `git
add`, `git stash`, `git checkout` or any deploy/restart. The integration owner
commits, wires shared registration points and merges STATUS entries.

## Shared foundation (already built — use it, do not fork it)

| Piece | Where | Notes |
|---|---|---|
| Disposable Postgres | `tests/_harness/testdb.mjs`, `scripts/test-db.mjs` | `withTestDb(fn)` / `cleanFoundation(client)`; DB tests skip only when the postgres binaries are missing. `node scripts/test-db.mjs reset` reloads schema + migrations. |
| Migration ledger | `db/migrate.mjs`, `db/migrations/NNNN_name.sql` | Additive, ordered, checksummed. `db/schema.sql` is the frozen historical baseline: **do not edit it**; put every schema change in your numbered migration. |
| Commands | `lib/commands/core.ts` (`runCommand`), `lib/commands/db.ts` (`command()`, `withTransaction`, principal resolvers) | One typed command per business action; request key = business operation key. |
| Principals | `lib/commands/principal.ts` | Server-derived only. Agents carry `onBehalfOf`. |
| Action intents / attempts | `lib/commands/intents.ts` | `enqueueIntent` inside the command tx; dispatcher does the provider call after commit. |
| Decisions | `lib/commands/decisions.ts` | `stageDecision` (dedupe + supersede), `resolveDecision` (first tap wins on every channel), `consumeDecision` (exact binding), `authorityFor` (owner or `authority_grants`). |
| Policies / lanes | `lib/commands/policies.ts` | `activePolicy(key)` → `policy:<key>@<v>` auth ref; `laneOpen(lane)` kill switch. |
| Source events | `lib/commands/source-events.ts` | Persist verified provider events before acknowledging. |

Read `lib/commands/README.md` before writing any command.

## Migration numbers (reserved — use exactly yours)

| Range | Owner workstream |
|---|---|
| 0002–0003 | WS-recovery (A01 obligations; A02 runbook v2 + A04 completion) |
| 0004–0005 | WS-approvals (A05/A06, A10: decision surfaces, adapters, policy seeds) |
| 0006–0008 | WS-money (A07a invoices; A20 Square payments; A14 QBO) |
| 0009 | WS-access (A08a, A08b, A22) |
| 0010–0011 | WS-estimating (A15 + W04–W07 records) |
| 0012–0014 | WS-field (A16 field/schedule/buyout; A17 closeout; A19 owner time; A21 designer) |
| 0015–0017 | WS-procurement (A13 procurement/cash; A12 sub docs; A11 leads) |
| 0018 | WS-measure (A18) |
| 0019–0020 | WS-worker (A03b intake/worker; A09a backups; A09b monitoring) |
| 0021–0022 | WS-agents (A24 runtime instructions/context/evals) |
| 0023+ | Integration owner (A23 workflow join) |

Migrations must be additive and idempotent where practical (`IF NOT EXISTS`),
must not touch another workstream's tables except via new FK columns on your
own tables, and must load cleanly on the harness (`node scripts/test-db.mjs reset`).

## File ownership

| Workstream | Owns (create/edit) | Must not touch |
|---|---|---|
| WS-recovery | `lib/obligations/*`, `lib/runbook-engine.ts`, `lib/completion/*`, `lib/reminders.ts`, `scripts/upsert-inbox-work-items.mjs`, `lib/comms-shared.ts` (work-item filing only), `lib/detectors.ts`, `lib/lead-thread-sync.ts`, `app/api/internal/runbooks/route.ts`, `mcp/obligation-tools.mjs`, `tests/obligations-*.test.mjs`, `tests/runbook-*.test.mjs` | sends, money, permissions |
| WS-approvals | `lib/owner-grants.ts`, `lib/owner-grant-types.ts`, `lib/agent-sends.ts`, `lib/send-ops.ts`, `lib/approved-draft-send.ts`, `lib/approve-work-item.ts`, `lib/notify-owner.ts`, `lib/notify.ts`, `lib/decisions/*` (surfaces: cards, telegram callbacks, push adapter), `lib/dispatch/*` (intent dispatcher + provider adapters `lib/providers/*`), `app/api/cron/dispatch/*`, `app/api/telegram/*`, `app/(os)/engine/decisions/*`, `components/engine/Decisions*.tsx`, `app/api/internal/owner-grants/route.ts`, `app/api/internal/decisions/route.ts`, `mcp/grants-tools.mjs`, `mcp/decision-tools.mjs`, `lib/bidding.ts` (send path only), `lib/newsletter-outbox.ts` (release path only), `lib/sms.ts`/`lib/voice.ts` (send/place paths only), `deploy/sjcos-dispatch.*` | invoice numbering/lifecycle (WS-money), permissions catalog |
| WS-money | `lib/billing/*`, `lib/actions/money.ts`, `lib/money.ts`, `lib/draw-schedule.ts`, `lib/actions/projects.ts` (milestone billing part), `lib/actions/esign.ts` (acceptance → billing hook), `lib/payments/*` (Square), `lib/accounting/*` (QBO), `app/api/payments/*`, `app/api/webhooks/square/*`, `app/api/webhooks/qbo/*`, `app/(os)/settings/payments/*`, `app/(os)/settings/accounting/*`, `app/client-portal/pay/*`, `components/money/Pay*.tsx`, `mcp/billing-tools.mjs`, `deploy/sjcos-payments-reconcile.*` | `lib/send-ops.ts` (call `sendInvoiceOp` through WS-approvals' intent path; coordinate by leaving `sendInvoiceOp`'s signature intact) |
| WS-access | `lib/permissions.ts`, `lib/dal.ts`, `lib/api-auth.ts`, `lib/actions/users.ts`, `lib/authority/*`, `components/settings/TeamAccess.tsx`, `components/settings/Authority*.tsx`, `docs/users-and-access.md`, `scripts/run-claude-agent.mjs` (business/coding profile split, tool restriction), `lib/dev-agents.ts` (principal + profile plumbing), `lib/dev-agents-meta.ts`, `mcp/sjcos-mcp.mjs` **auth section only** (principal header / bearer identity), `docs/automation-reliability/credentials-inventory.md` | decision internals |
| WS-estimating | `lib/estimating/*`, `lib/estimates.ts`, `lib/actions/estimates.ts`, `lib/cost-book.ts`, `lib/actions/cost-book.ts`, `lib/cost-book-units.ts`, `lib/selections.ts` (choice → estimate hook), `lib/actions/selections.ts` (same), `lib/mood.ts` (direction → selections hook), `lib/product-fetch.ts`, `lib/pricing/*`, `app/(os)/settings/pricing/*`, `app/(os)/projects/[slug]/scope/*` (scope register + site visit plan UI), `components/estimating/*`, `mcp/estimating-tools.mjs`, `mcp/estimate-tools.mjs` | invoices, sends |
| WS-field | `lib/field/*`, `lib/schedule.ts`, `lib/actions/schedule.ts`, `lib/sub-portal.ts`, `lib/actions/sub-portal.ts`, `app/sub-portal/*`, `lib/client-portal.ts` (weekly summary read), `lib/closeout.ts`, `lib/actions/closeout.ts`, `lib/warranty.ts`, `lib/marketing.ts`, `lib/actions/marketing.ts`, `lib/owner-time/*`, `app/api/mobile/time/*`, `app/(os)/time/*`, `components/time/*`, `lib/plan-designs.ts` + `lib/actions/floorplans.ts` (activity events + quantity export only), `lib/designer-contract.ts`, `docs/automation-reliability/designer-contract.md`, `docs/automation-reliability/houzz-exit.md`, `mcp/field-tools.mjs`, `deploy/sjcos-weekly-summary.*`, `app/api/cron/weekly-summary/*` | money, sends |
| WS-procurement | `lib/procurement/*`, `lib/purchase-orders.ts`, `lib/actions/purchase-orders.ts`, `lib/purchase-orders-agent.ts`, `lib/po-recompute.ts`, `lib/po-types.ts`, `lib/vendors.ts`, `lib/actions/vendors.ts`, `lib/funding/*` (cash guard + reservations), `lib/sub-docs/*`, `lib/actions/sub-docs.ts`, `lib/sub-doc-types.ts`, `lib/compliance.ts`, `lib/leads/*`, `lib/lead-first-response.ts`, `lib/lead-intake-questions.ts`, `lib/intake.ts`, `lib/leads.ts`, `lib/actions/leads.ts`, `lib/lead-tasks.ts`, `mcp/procurement-tools.mjs`, `mcp/bidding-tools.mjs` (award/compare only) | send paths, invoices |
| WS-measure | `lib/measure/*`, `app/(os)/engine/capabilities/*`, `app/(os)/engine/measure/*`, `components/engine/Capabilities*.tsx`, `lib/overhead/*`, `app/(os)/settings/overhead/*`, `docs/automation-reliability/capabilities.md`, `mcp/measure-tools.mjs` | everything else |
| WS-worker | `lib/worker/*` (supervised loop, heartbeats, source-event processing), `scripts/sjcos-worker.mjs`, `deploy/sjcos-worker.*`, `app/api/voice/webhook/route.ts` + `app/api/sms/webhook/route.ts` (persist to source_events first), `lib/backup/*`, `scripts/backup.mjs`, `scripts/restore.mjs`, `deploy/sjcos-backup.*`, `deploy/sjcos-monitor.*`, `scripts/sjcos-monitor.sh`, `app/api/health/*`, `app/api/cron/_lib/guard.ts`, `docs/automation-reliability/recovery.md`, `docs/automation-reliability/monitoring.md` | provider send adapters (WS-approvals) |
| WS-agents | `lib/agent-runtime/*` (versioned instruction blocks, context assembly, tool bindings, eval harness), `scripts/run-business-agent.mjs`, `deploy/sjcos-agent-worker.*`, `tests/agent-runtime-*.test.mjs`, `evals/*`, `mcp/context-tools.mjs`, `lib/skills.ts` + `lib/actions/skills.ts` (instruction versioning), `db/seed-*.mjs` for runbook/skill seeds | `scripts/run-claude-agent.mjs` (coordinate with WS-access: WS-agents supplies a `buildBusinessInstructions()` export; WS-access wires the profile flag) |

Anything not listed: ask the integration owner (leave a note in your status
file) rather than editing. `mcp/sjcos-mcp.mjs` registration lines,
`package.json`, `AGENTS.md`, `deploy/README.md`, `STATUS.md` are integrated by
the owner — write what you need into your status file.

## Shared conventions

- **Every external effect is an intent.** No new code calls Gmail/Telnyx/
  Telegram/Square/QBO directly; it enqueues an intent (kind + operation_key +
  payload) and WS-approvals' dispatcher owns the provider call. Provider
  adapters live in `lib/providers/<name>.ts` with a `SJC_OUTBOUND_DISABLED=1`
  fake mode that records what would have been sent.
- **Every client/vendor/money-facing action consumes a decision** (or, for
  the existing grant tools during transition, an owner grant that
  WS-approvals bridges to a decision).
- **Every automatic action cites an active policy** via `auth_ref`.
- **Money is integer cents.** Unknown cost is `NULL`, never 0.
- **due_at Today rule is untouched.** Contractual deadlines get their own
  columns.
- **Tests:** unit tests for pure logic; DB tests via `withTestDb` for every
  race/transaction claim. Name them `tests/<area>-*.test.mjs`. `npm test`
  must stay green; `npx tsc --noEmit` must stay clean; `npx eslint <your files>`.
- **No secrets, no production data** in fixtures. Synthetic `zz-*` slugs.
- **Status file:** `docs/automation-reliability/status/<TASK>.md` using the
  per-slice template in STATUS.md — what changed, callers checked, commands
  run + results, migration ids, setup/activation gaps, rollback, remaining
  acceptance items, next slice.
- **MCP tools:** new module `mcp/<area>-tools.mjs` exporting
  `register<Area>Tools(server, { rows, json, pool, appCall })`; the owner
  wires it. Tool names must not collide with existing ones.
- **UI:** new pages under the routes listed above; keep to existing
  components/ui primitives; gate with `requireAccess`/`can`.
