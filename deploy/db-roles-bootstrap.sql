-- deploy/db-roles-bootstrap.sql — the ONE step that needs sudo (deploy/db-roles.md).
--
--   sudo -u postgres psql -d sjcos -v ON_ERROR_STOP=1 -f deploy/db-roles-bootstrap.sql
--
-- Creates the four narrow logins (no passwords yet: set them with \password
-- right after, see the runbook) and lets them connect. Everything else — which
-- tables each may read or change — is in the normal migrations
-- (db/migrations/0060_db_roles.sql onward, owned by the app login sjcos), so
-- nothing after this needs sudo. Safe to run twice.

\set ON_ERROR_STOP 1

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_agent')    THEN CREATE ROLE sjcos_agent    LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_worker')   THEN CREATE ROLE sjcos_worker   LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_readonly') THEN CREATE ROLE sjcos_readonly LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_backup')   THEN CREATE ROLE sjcos_backup   LOGIN; END IF;
END $$;

-- Plain logins: no superuser, no creating roles or databases, no inheriting
-- anything they were not given table by table.
ALTER ROLE sjcos_agent    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 40;
ALTER ROLE sjcos_worker   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 20;
ALTER ROLE sjcos_readonly NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 5;
-- pg_dump must see every row of every table, including the app_settings rows
-- row security hides from the others; it can read, never write.
ALTER ROLE sjcos_backup   NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOREPLICATION CONNECTION LIMIT 3;
GRANT pg_read_all_data TO sjcos_backup;

-- An earlier draft (never applied) gave the others pg_read_all_data, which
-- overrides every table REVOKE. Make sure no such membership exists.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['sjcos_agent', 'sjcos_worker', 'sjcos_readonly'] LOOP
    IF pg_has_role(r, 'pg_read_all_data', 'MEMBER') THEN EXECUTE format('REVOKE pg_read_all_data FROM %I', r); END IF;
    IF pg_has_role(r, 'pg_write_all_data', 'MEMBER') THEN EXECUTE format('REVOKE pg_write_all_data FROM %I', r); END IF;
  END LOOP;
END $$;

-- Connect + see the schema. Table access comes from the migrations.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO sjcos_agent, sjcos_worker, sjcos_readonly, sjcos_backup', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO sjcos_agent, sjcos_worker, sjcos_readonly, sjcos_backup;

-- The migrations GRANT as the table owner; check nothing in public belongs to
-- someone else (that table would silently get no grants).
DO $$
DECLARE
  owner_role text;
  strays text;
BEGIN
  -- The app login runs the migrations, so it owns the migration ledger.
  SELECT pg_get_userbyid(c.relowner) INTO owner_role FROM pg_class c WHERE c.oid = 'public.schema_migrations'::regclass;
  SELECT string_agg(format('%s (owner %s)', c.relname, pg_get_userbyid(c.relowner)), ', ')
    INTO strays
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p', 'm', 'S')
     AND pg_get_userbyid(c.relowner) <> owner_role;
  IF strays IS NOT NULL THEN
    RAISE WARNING 'not owned by %: %. Run: ALTER TABLE <name> OWNER TO %;', owner_role, strays, owner_role;
  ELSE
    RAISE NOTICE 'ok: every table in public is owned by %', owner_role;
  END IF;
END $$;

SELECT rolname, rolcanlogin, rolbypassrls, rolconnlimit, rolpassword IS NOT NULL AS has_password
  FROM pg_authid WHERE rolname LIKE 'sjcos%' ORDER BY rolname;
