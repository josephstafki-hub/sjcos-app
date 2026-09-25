# lib/commands — the shared server command layer

Built 2026-09-23 for the automation build (docs/automation-reliability, A03a /
A05-A06 / A10 / A22 base). Migration `db/migrations/0001_foundation_commands_decisions_actions.sql`.

| Module | What it owns |
|---|---|
| `principal.ts` | Trusted `Principal` (user / service / agent-on-behalf-of). Pure. |
| `core.ts` | `runCommand(tx, spec, handler)` — idempotent by `(name, request_key)`, input-hash checked, transactional, post-commit hooks. Pure. |
| `intents.ts` | `action_intents` + `action_attempts`: permanent external-action records, leases, fencing, state machine, reconciliation. Pure. |
| `decisions.ts` | Exact one-tap `decisions`: stage / resolve (first tap wins, all channels) / consume (bound to action+content+recipient+amount) / authority (owner or `authority_grants`). Pure. |
| `policies.ts` | Versioned routine `policies` (+ `policy:<key>@<v>` auth refs) and `lane_pauses` kill switches. Pure. |
| `source-events.ts` | Verified durable provider intake (`source_events`) with leases. Pure. |
| `db.ts` | Next.js-side glue: `withTransaction`, `command()`, `sessionPrincipal`, `bearerPrincipal`, `servicePrincipal`, `agentPrincipal`. server-only. |

"Pure" modules take a `run(sql, params)` function and carry no `server-only`
import, so `tests/*.test.mjs` drive them against the disposable harness
(`tests/_harness/testdb.mjs`).

## Rules every feature follows

1. Derive the principal on the server (`db.ts`). Never accept `is_owner`,
   `role` or a user id from a request body or a model.
2. One typed command per business action. UI action, MCP tool, cron route and
   worker all call the same command; the `request_key` is the business
   operation key so retries collapse.
3. Business writes, audit and `enqueueIntent()` happen inside the command's
   transaction. Provider calls happen in the dispatcher after commit.
4. Anything client-/vendor-/money-facing consumes a `decision` (or, during the
   transition, an `owner_grant`) for the exact content hash / recipient /
   amount it is about to act on. Changed content → new revision → new decision.
5. Automatic actions cite an active `policy` version as `auth_ref`; a missing
   or disabled policy holds the action.
6. Provider outcomes map to `accepted | confirmed | retryable | unknown |
   permanent`. `unknown` is held for reconciliation — never retried blindly,
   never refunded.
