-- SJC OS — one-time database provisioning. Run as the postgres superuser:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f db/setup.sql
-- Then apply the schema (as the sjcos role):
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- The real password lives only in .env.local (DATABASE_URL), which is
-- gitignored. Before running this script, replace the placeholder below with
-- that same password. The sjcos role + db were already provisioned on the
-- server on 2026-06-13 — you only need this again to rebuild from scratch.

SELECT 'creating role sjcos' AS step
\gset
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sjcos') THEN
    CREATE ROLE sjcos LOGIN PASSWORD 'REPLACE_WITH_PASSWORD_FROM_ENV_LOCAL';
  END IF;
END $$;

-- CREATE DATABASE can't run inside the DO block / a transaction, and has no
-- IF NOT EXISTS, so guard it with \gexec.
SELECT 'CREATE DATABASE sjcos OWNER sjcos'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sjcos')
\gexec
