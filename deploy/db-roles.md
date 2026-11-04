# Database logins — one per job

Until this is applied, the website, the AI agents and the background worker all
log into Postgres as the one owner login (`sjcos`). After it, each has its own
login that only opens what it needs, so a tricked or buggy agent is stopped by
the database itself, not only by the app's rules.

| Login | Who uses it | `.env.local` line | What it can do |
|---|---|---|---|
| `sjcos` (unchanged) | the website, **Joe's own Ask-window runs**, migrations | `DATABASE_URL` | everything (owns every table) |
| `sjcos_agent` | MCP server (Hermes, claude.ai, ChatGPT via `sjcos-mcp.service`; any `claude mcp` stdio spawn), business-agent runs, staff panel turns, Hermes in the panel | `DATABASE_URL_AGENT` | reads everything except passwords, mailbox tokens, QuickBooks/push tokens and secret settings; writes only what MCP tools write; can file requests, never approve them |
| `sjcos_worker` | `scripts/sjcos-worker.mjs` (Square / Telnyx / e-sign events, runbook wakeups, the receipts they send) | `DATABASE_URL_WORKER` | same reads; writes what those steps write |
| `sjcos_readonly` | the monitor (`~/bin/sjcos-monitor`) | `DATABASE_URL_READONLY` | reads only |
| `sjcos_backup` | `pg_dump` in `scripts/backup.mjs` | `DATABASE_URL_BACKUP` | reads every row (incl. secrets, it's a full backup); writes only its own `backup_runs` ledger |

No narrow login can ever write `users`, `policies`, `lane_pauses`,
`authority_grants`, `app_settings`, `session_revocations`, `permission_audit`
or the payment destinations, or set a decision / owner grant to approved, or
approve a skill, skill version or memory (`sjcos_guard_narrow_writes` in
`db/migrations/0060_db_roles.sql`). `SELECT * FROM users` as `sjcos_agent`
fails; it may read only who's who (id, name, email, role, active, areas).

The timers in `deploy/*.timer` that `curl` the website (`/api/cron/…`) run
inside the website, so they use the website's login, with the website's own
checks. Joe's own panel runs keep the owner login on purpose: the Ask window
can still read anything and change anything he asks.

Every narrow line falls back to `DATABASE_URL` while it is missing, so nothing
breaks before the apply, and removing a line is the rollback.

## Apply (Joe, once)

The PR's migration (`0060_db_roles.sql`) goes out with a normal deploy first.
It is safe on its own: until the logins exist it only makes trigger functions
run as their owner, adds the approval guard and hides secret settings rows.

**1. Create the logins — the only step that needs your sudo password.**

```bash
cd ~/sjcos-app
sudo -u postgres psql -d sjcos -v ON_ERROR_STOP=1 -f deploy/db-roles-bootstrap.sql
```

It ends with `ok: every table in public is owned by sjcos` and a table of the
five `sjcos*` logins (`has_password` false for the new four, for now).

**2. Give each a password.** Make four random ones (letters and digits only,
nothing to escape in a URL):

```bash
for r in agent worker readonly backup; do echo "sjcos_$r $(openssl rand -hex 24)"; done
```

Then set them (each `\password` asks twice; paste the matching one):

```bash
sudo -u postgres psql -d sjcos
\password sjcos_agent
\password sjcos_worker
\password sjcos_readonly
\password sjcos_backup
\q
```

**3. Grant the tables** (no sudo; harmless to repeat):

```bash
node scripts/db-roles-apply.mjs
```

It must end with `grants match deploy/db-roles.manifest.json` and print
`"agent_reads_users":false,"agent_reads_passwords":false,"agent_writes_policies":false,"agent_files_todos":true`.

**4. Check each login can connect** (paste a password where it says so):

```bash
psql "postgresql://sjcos_agent:PASTE@localhost:5432/sjcos" -Atc "select current_user, count(*) from work_items"
psql "postgresql://sjcos_agent:PASTE@localhost:5432/sjcos" -Atc "select * from users limit 1"   # must say: permission denied
```

`no pg_hba.conf entry` means Postgres only lets `sjcos` in by password; add a
line for the new logins next to the `sjcos` one in
`/etc/postgresql/16/main/pg_hba.conf` and `sudo systemctl reload postgresql`.

**5. Add these lines to `~/sjcos-app/.env.local`** (keep `DATABASE_URL` as it is):

```
DATABASE_URL_AGENT=postgresql://sjcos_agent:<agent password>@localhost:5432/sjcos
DATABASE_URL_WORKER=postgresql://sjcos_worker:<worker password>@localhost:5432/sjcos
DATABASE_URL_READONLY=postgresql://sjcos_readonly:<readonly password>@localhost:5432/sjcos
DATABASE_URL_BACKUP=postgresql://sjcos_backup:<backup password>@localhost:5432/sjcos
```

**6. Install the monitor's new copy** (the timer runs a copy in `~/bin`):

```bash
cp ~/sjcos-app/scripts/sjcos-monitor.sh ~/bin/sjcos-monitor && chmod +x ~/bin/sjcos-monitor
```

**7. Restart, in this order:**

```bash
systemctl --user restart sjcos-mcp.service      # agents (Hermes, claude.ai, ChatGPT)
systemctl --user restart sjcos-worker.service   # worker
systemctl --user restart sjcos.service          # website — so the agent runs it starts carry the new line
```

The business-agent timer, the backups and the monitor read `.env.local` on
their next run; nothing to restart.

**8. Check:**

```bash
journalctl --user -u sjcos-worker.service -n 20 | grep "database login"     # → DATABASE_URL_WORKER
printf '{}' | env -i PATH="$PATH" HOME="$HOME" MCP_HTTP_PORT=0 node mcp/call-tool.mjs get_today_queue | head
psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)" -Atc "select usename, count(*) from pg_stat_activity where datname='sjcos' group by 1"
```

The last one should show `sjcos_agent` and `sjcos_worker` connections next to
`sjcos`. Then ask Hermes (or claude.ai) to read a project and file a to-do;
both work as before. The Ask window runs on your login, so it is unchanged.

## Rollback

Remove the four `DATABASE_URL_*` lines from `.env.local` and restart the same
three services (`sjcos-mcp`, `sjcos-worker`, `sjcos`). Everything is back on
`DATABASE_URL`. The logins can stay; they do nothing unused. To delete them
completely:

```bash
sudo -u postgres psql -d sjcos -c "DROP OWNED BY sjcos_agent, sjcos_worker, sjcos_readonly, sjcos_backup" \
  -c "DROP ROLE sjcos_agent" -c "DROP ROLE sjcos_worker" -c "DROP ROLE sjcos_readonly" -c "DROP ROLE sjcos_backup"
```

## Adding a table, or a tool / worker step that writes a new table

1. In the same migration, add the table to `deploy/db-roles.manifest.json`
   (agents read every non-secret table; give writes only where an MCP tool or
   the worker really writes) and paste what `node scripts/db-roles-sql.mjs <table>`
   prints. A new trigger function also needs
   `ALTER FUNCTION f() SECURITY DEFINER SET search_path = public, pg_temp;`.
2. `tests/db-roles-manifest-db.test.mjs` fails, with the exact fix, when the
   manifest, the migrations and the database disagree;
   `tests/db-roles-paths-db.test.mjs` runs real MCP tools and worker steps as
   the narrow logins and fails with `permission denied for table X` when one
   reaches a table its login can't.
3. `node scripts/db-roles-scan.mjs --diff` lists tables the agent / worker code
   writes that the manifest doesn't grant (a table with a `note` is withheld on
   purpose). If a narrow login must never write it, stage the change for Joe
   (a decision / `request_owner_permission`) or add a small SECURITY DEFINER
   function that does only that one write, as 0060 does for
   `sjcos_record_known_tools` and `sjcos_relink_client_login`.

Which login a process uses: `lib/db-login.mjs`. The panel launcher
(`scripts/run-claude-agent.mjs`) sets `SJC_DB_LOGIN=owner` only for Joe's own
operator runs; the MCP server uses the narrow login otherwise. Terminal Claude
sessions on this box (`claude mcp` stdio) get the narrow login too; add
`"env": {"SJC_DB_LOGIN": "owner"}` to that server in `~/.claude.json` only if
you want them on the owner login.
