# Credentials inventory (A08a) — names only, never values

Written 2026-09-23 by WS-access. Every secret the app, the runners and the
MCP server can reach, which process actually needs it, and what a
**business-profile** agent run can no longer reach after A08a. Key names come
from `deploy/README.md` and the `.env.local` key list (`grep -o '^[A-Z_]*='`);
no value was read or copied.

## Where secrets live

| Store | Read by | Notes |
|---|---|---|
| `~/sjcos-app/.env.local` (gitignored) | Next.js service (`sjcos.service`, loads it into `process.env`), `mcp/sjcos-mcp.mjs`, `mcp/interact-mcp.mjs`, `scripts/run-claude-agent.mjs`, `db/migrate.mjs`, the cron `.sh` wrappers | One file, one owner (Joe's user). Every process on the box running as Joe can open it. |
| `~/.hermes/.env` | Next.js (`lib/dev-agents.ts` hermesConfig) | Hermes gateway key (`API_SERVER_KEY`, `API_SERVER_HOST/PORT`). |
| `~/.claude/` | The Claude CLI (`~/.local/bin/claude`) | Joe's CLI login (OAuth). Not an API key; a consumer login. |
| systemd unit `Environment=` | `sjcos-mcp.service` (`MCP_HTTP_PORT`), `sjcos.service` (`NODE_ENV`, `PORT`) | Non-secret switches. |
| `app_settings` table | app | `clip.token`, `intake.token` (website intake), `agent.max_*` thresholds. The two tokens are secrets at rest in the DB. |

## Secrets by name

| Key | Needed by | Purpose | Business agent after A08a |
|---|---|---|---|
| `DATABASE_URL` | app, MCP server, interact MCP, runner, migrate, cron wrappers | Postgres superuser-equivalent connection (`sjcos` role owns everything) | **Not in the CLI process env** (minimal env). The MCP server reads it from the file itself. No Bash/Read into the repo → cannot read `.env.local`. Note: DB writes still happen with full rights through the MCP tools until `deploy/db-roles.sql` is applied and `DATABASE_URL_AGENT` is wired. |
| `SESSION_SECRET` | app (JWT sign/verify), proxy | Session cookies | Not in CLI env. Never needed by an agent. |
| `CRON_SECRET` | app internal routes, MCP server (internal-route calls), cron wrappers | Bearer for `/api/internal/*` and `/api/cron/*` | Not in CLI env. The MCP server still holds it (it must, to call the app) — an agent cannot read it, only exercise the curated tools that use it. |
| `MCP_HTTP_TOKEN` | `sjcos-mcp.service` (HTTP transport), nginx-side clients (claude.ai / ChatGPT connectors, Hermes) | Bearer for the remote MCP endpoint | Not in CLI env; stdio runs never touch the HTTP transport. |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_REDIRECT_URI` | app (`lib/gmail.ts`), lead-thread-sync / detectors / first-response cron | Company inbox read + send | Not in CLI env. Sends only via owner-grant tools → app route. |
| `TELNYX_API_KEY`, `SMS_API_KEY`, `SMS_PUBLIC_KEY`, `SMS_FROM_NUMBER`, `SMS_MESSAGING_PROFILE_ID`, `SMS_PROVIDER`, `VOICE_APPLICATION_ID`, `VOICE_FROM_NUMBER`, `VOICE_FORWARD_TO`, `VOICE_RECORDING*`, `VOICE_TRANSCRIPTION`, `TENDLC_*` | app (`lib/sms.ts`, `lib/voice.ts`, 10DLC registration) | SMS / voice | Not in CLI env. `TENDLC_EIN` etc. are business identity data, not credentials, but sit in the same file. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID` | app (`lib/notify-owner.ts`, push drain, Telegram webhook) | Owner push | Not in CLI env. |
| `OLLAMA_HOST`, `OLLAMA_MODEL`, `AI_PROVIDER`, `NEXT_PUBLIC_AI_PROVIDER` | app (`lib/ai.ts`) | Local Qwen | Not secrets. |
| `APP_INTERNAL_URL`, `NEXT_PUBLIC_APP_URL`, `MCP_HTTP_HOST` | MCP server, app | Addresses | Not secrets. |
| `HERMES_AGENT_URL` / `HERMES_AGENT_KEY` (or `~/.hermes/.env` `API_SERVER_KEY`) | app (`hermesChat`) | Hermes gateway bearer | Not in CLI env; the file is outside every `--add-dir`. |
| `DEV_CLAUDE_MODEL`, `DEV_CLAUDE_TIMEOUT_MS`, `CLAUDE_BIN`, `MCP_TOOL_TIMEOUT`, `SJC_ASK_*` | runner | Runner knobs | Not secrets. |
| `SJC_RUN_ID`, `SJC_CONVERSATION_ID`, `SJC_AGENT`, `SJC_RUN_PROFILE`, `SJC_PRINCIPAL_USER_ID`, `SJC_RUN_STARTED_S` | runner → MCP servers (stdio) | Run identity / acting person | Passed on purpose. Identity only; the role is looked up from the users row, never trusted from env. |

## What a business-profile run can and cannot reach (enforced, not prompted)

Enforced by `scripts/run-claude-agent.mjs` + `lib/authority/run-profile.mjs`
(tests: `tests/agent-profile.test.mjs`):

- CLI flags: `--restricted`, `--disallowedTools Bash Write Edit MultiEdit NotebookEdit WebFetch WebSearch Task Agent EnterWorktree ExitWorktree`, `--add-dir <repo>/docs/automation-reliability` only, `--strict-mcp-config`, permission mode never `bypassPermissions`/`auto`/`dontAsk`.
- cwd = `os.tmpdir()/sjcos-agent-<run>` (deleted after the run). `Read`/`Glob`/`Grep` are confined by `--restricted` to cwd + the docs dir, so `.env.local`, `~/.hermes/.env`, `~/.claude/` and the repo are out of reach by path.
- Process env = `PATH HOME USER LOGNAME LANG LC_ALL TERM TMPDIR XDG_* NODE_OPTIONS CLAUDE_BIN` + the `SJC_*` tags + MCP timeouts. None of the app's secrets.
- MCP: only `sjcos` (absolute path) + `interact`. No Playwright/browser server for business runs.
- Limits: 20-minute sliding deadline (`DEV_CLAUDE_TIMEOUT_MS` still overrides), 60 assistant-turn cap (runner-enforced; the installed CLI 2.1.278 has no `--max-turns`), `--max-budget-usd` from `app_settings.agent.max_cost_per_run_usd` when set, hourly admission cap from `agent.max_runs_per_hour`.
- Identity: `dev_agent_runs.profile='business'`, `principal_user_id` = the staff member (or NULL unattended). The MCP server refuses gated sends for a staff principal without the matching `authority_grants` row and for a disabled / signed-out principal; the runner kills the CLI within ~5 s of a revocation.

## Residual limitations (honest)

1. **The MCP server itself still runs with the full `DATABASE_URL`.** The curated tools are the only surface, but a bug in a tool is a bug with full DB rights. Fix: apply `deploy/db-roles.sql`, set `DATABASE_URL_AGENT` in `.env.local`, and point `mcp/sjcos-mcp.mjs` `databaseUrl()` at it when present (one-line change owned by the MCP owner after Joe applies the roles). Until then the agent's DB blast radius is bounded by tool code, not by Postgres.
2. **`--restricted` is a CLI feature.** It is the CLI (2.1.278) that confines file tools and strips Bash; a CLI upgrade that changes flag semantics must re-run `tests/agent-profile.test.mjs` and a live smoke (`claude -p --restricted … "run \`id\`"` must refuse).
3. **HOME is still passed** so the CLI can find its login. The CLI's own config under `~/.claude/` is therefore readable by the CLI process (not by the model's tools, which are confined). A dedicated Unix user for business runs would close this fully — needs Joe (system change), listed in A08b status.
4. **Operator runs are unchanged**: Joe's own runs keep the repo, Bash and the full env. That is by design (Joe is the owner) and is the residual exposure if Joe himself pastes a malicious email into an operator run.
5. **Prompt lines are informational.** `profilePromptLine()` and the ACTING FOR line tell the model what it is; nothing relies on the model obeying them.
6. **Hermes/Qwen paths** (`hermesChat`, Ollama) do not go through the runner. Hermes has its own toolset outside this repo; its business scope is whatever its own config allows. Not changed by A08a; recorded as a gap for WS-agents/A24.
7. **Website intake token / clip token** live in `app_settings`, readable by any full-DB process. Unchanged.
8. **Session revocation and proxy renewal**: `proxy.ts` re-signs a session JWT after 24 h and copies only `userId/role/perms`, so a renewed token gets a fresh `iat`. The dal check uses the `authAt` claim when present, else `iat`. Until `lib/session.ts` (createSession) sets `authAt` and `proxy.ts` carries it forward, a revocation older than one renewal could be masked in theory; in practice the first request after a revocation is refused (dal reads the request cookie, not the renewed one) and `/logout` clears it. Requested from the integration owner in `status/A22.md`.
