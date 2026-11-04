-- 0060 — least-privilege database logins (deploy/db-roles.md).
--
-- Today the website, the AI agents and the background worker all connect as
-- the one owner login (sjcos). After Joe's one-time bootstrap
-- (deploy/db-roles-bootstrap.sql, needs sudo) four narrow logins exist:
--   sjcos_agent     MCP server (Hermes / claude.ai / ChatGPT), business-agent
--                   runs, staff panel turns. Joe's own panel runs stay on sjcos.
--   sjcos_worker    scripts/sjcos-worker.mjs (dispatch, Square, Telnyx, e-sign,
--                   runbook wakeups).
--   sjcos_readonly  the monitor.
--   sjcos_backup    pg_dump (pg_read_all_data + BYPASSRLS, set by the bootstrap).
-- This migration (run by the normal deploy as the owner, no sudo) gives each
-- exactly what deploy/db-roles.manifest.json lists. Until the roles exist every
-- grant is a no-op with a NOTICE, so tests and fresh databases migrate as before.
--
-- It also makes the database safe to use from a narrow login:
--   • trigger functions run as their owner (SECURITY DEFINER, pinned
--     search_path) so a narrow write can still update the derived tables a
--     trigger maintains (job money ledger 0037, workflow stage 0054, measurement
--     0051, chat rooms, notifications) without granting those writes directly;
--   • sjcos_guard_narrow_writes(): agents/workers may file requests and
--     proposals but can never approve them — no decision or owner grant set to
--     approved, no skill / skill version / memory promoted;
--   • app_settings row security hides secret keys (*.token) from every login
--     but the owner;
--   • two tiny SECURITY DEFINER helpers for the only owner-table writes agent
--     tools legitimately make (measure.known_tools, a client login following a
--     lead onto its new project).

-- ── sjcos_grant(): the grant line every migration uses ──────────────────────
CREATE OR REPLACE FUNCTION sjcos_grant(p_role text, p_privs text, VARIADIC p_tables text[])
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t text;
  s text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role) THEN
    RAISE NOTICE 'sjcos_grant: role % does not exist yet (deploy/db-roles-bootstrap.sql); skipped %', p_role, p_tables;
    RETURN;
  END IF;
  IF p_privs !~* '^\s*(SELECT|INSERT|UPDATE|DELETE)(\s*\([a-z0-9_,\s]+\))?(\s*,\s*(SELECT|INSERT|UPDATE|DELETE)(\s*\([a-z0-9_,\s]+\))?)*\s*$' THEN
    RAISE EXCEPTION 'sjcos_grant: unexpected privilege list "%"', p_privs;
  END IF;
  FOREACH t IN ARRAY p_tables LOOP
    EXECUTE format('GRANT %s ON TABLE %I TO %I', p_privs, t, p_role);
    IF p_privs ~* 'INSERT' THEN
      FOR s IN
        SELECT seq.relname
          FROM pg_depend d
          JOIN pg_class seq ON seq.oid = d.objid AND seq.relkind = 'S'
         WHERE d.refobjid = t::regclass AND d.deptype IN ('a', 'i')
      LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO %I', s, p_role);
      END LOOP;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION sjcos_grant(text, text, text[]) FROM PUBLIC;

-- ── Trigger functions run as their owner ───────────────────────────────────
-- Every trigger function in public owned by the migrating (owner) role, except
-- the guard below, which must see the caller. New trigger functions need the
-- same ALTER (tests/db-roles-manifest-db.test.mjs checks).
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prorettype = 'trigger'::regtype
       AND pg_get_userbyid(p.proowner) = current_user
       AND p.proname <> 'sjcos_guard_narrow_writes'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;

-- ── Agents and workers request; only Joe approves ──────────────────────────
-- SECURITY INVOKER on purpose: current_user is the login that made the write
-- (or the owner, when the write came from a trusted owner-run trigger).
CREATE OR REPLACE FUNCTION sjcos_guard_narrow_writes()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  who text := current_user;
  bad text;
BEGIN
  IF who NOT IN ('sjcos_agent', 'sjcos_worker') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'decisions' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'pending' THEN bad := format('a new decision must start pending (got %s)', NEW.status); END IF;
      IF NEW.decided_by_user_id IS NOT NULL THEN bad := 'a new decision cannot name who decided it'; END IF;
    ELSE
      -- consumed → approved is the dispatcher handing a use back after a failed send.
      IF NEW.status = 'approved' AND OLD.status NOT IN ('approved', 'consumed') THEN bad := 'only Joe can approve a decision'; END IF;
      IF NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id THEN bad := 'only Joe''s own approval can record who decided'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'owner_grants' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'requested' THEN bad := format('a new owner grant must start requested (got %s)', NEW.status); END IF;
    ELSE
      IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN bad := 'only Joe can approve an owner grant'; END IF;
      IF OLD.status = 'approved' AND (NEW.actions, NEW.target_kind, NEW.target_id) IS DISTINCT FROM (OLD.actions, OLD.target_kind, OLD.target_id) THEN
        bad := 'an approved owner grant cannot be pointed at another action or target';
      END IF;
      IF NEW.expires_at > OLD.expires_at THEN bad := 'an owner grant cannot be extended'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'skills' THEN
    IF NEW.review_status = 'approved' AND (TG_OP = 'INSERT' OR OLD.review_status <> 'approved') THEN bad := 'only Joe can approve a skill'; END IF;
    -- A new proposal links its own first version; a live skill's version is Joe's.
    IF TG_OP = 'UPDATE' AND OLD.review_status = 'approved' AND NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
      bad := 'only Joe can switch an approved skill''s active version';
    END IF;
  ELSIF TG_TABLE_NAME = 'skill_versions' THEN
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status <> 'approved') THEN bad := 'only Joe can approve a skill version'; END IF;
  ELSIF TG_TABLE_NAME = 'agent_memories' THEN
    IF NEW.review_status = 'approved' AND (TG_OP = 'INSERT' OR OLD.review_status <> 'approved') THEN bad := 'only Joe can approve a memory'; END IF;
    IF NEW.can_use_as_instruction AND (TG_OP = 'INSERT' OR NOT OLD.can_use_as_instruction) THEN bad := 'only Joe can turn a memory into an instruction'; END IF;
  END IF;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'database login % may not do this: %', who, bad
      USING ERRCODE = 'insufficient_privilege', HINT = 'Stage it for Joe (a decision / request_owner_permission) instead.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zz_sjcos_guard ON decisions;
CREATE TRIGGER trg_zz_sjcos_guard BEFORE INSERT OR UPDATE ON decisions FOR EACH ROW EXECUTE FUNCTION sjcos_guard_narrow_writes();
DROP TRIGGER IF EXISTS trg_zz_sjcos_guard ON owner_grants;
CREATE TRIGGER trg_zz_sjcos_guard BEFORE INSERT OR UPDATE ON owner_grants FOR EACH ROW EXECUTE FUNCTION sjcos_guard_narrow_writes();
DROP TRIGGER IF EXISTS trg_zz_sjcos_guard ON skills;
CREATE TRIGGER trg_zz_sjcos_guard BEFORE INSERT OR UPDATE ON skills FOR EACH ROW EXECUTE FUNCTION sjcos_guard_narrow_writes();
DROP TRIGGER IF EXISTS trg_zz_sjcos_guard ON skill_versions;
CREATE TRIGGER trg_zz_sjcos_guard BEFORE INSERT OR UPDATE ON skill_versions FOR EACH ROW EXECUTE FUNCTION sjcos_guard_narrow_writes();
DROP TRIGGER IF EXISTS trg_zz_sjcos_guard ON agent_memories;
CREATE TRIGGER trg_zz_sjcos_guard BEFORE INSERT OR UPDATE ON agent_memories FOR EACH ROW EXECUTE FUNCTION sjcos_guard_narrow_writes();

-- ── app_settings: secret keys stay with the owner ──────────────────────────
-- The owner (the website, Joe's panel) bypasses row security as table owner;
-- every other login sees only non-secret keys. Narrow logins get SELECT only,
-- so no write policy exists (row security refuses writes without one).
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_settings_non_secret ON app_settings;
CREATE POLICY app_settings_non_secret ON app_settings FOR SELECT
  USING (key !~* '(^|[._])(token|secret|password|api_key)$');

-- ── The two owner-table writes agent tools make ─────────────────────────────
-- measurement_summary records the tool names it checked against.
CREATE OR REPLACE FUNCTION sjcos_record_known_tools(p_tools jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO app_settings (key, value) VALUES ('measure.known_tools', p_tools::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
$$;

-- create_project from a lead: the client's portal login follows the lead onto
-- the project. Only client logins, only from a lead link.
CREATE OR REPLACE FUNCTION sjcos_relink_client_login(p_from_slug text, p_to_slug text, p_from_email text, p_to_email text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  IF p_from_slug NOT LIKE 'lead:%' THEN
    RAISE EXCEPTION 'sjcos_relink_client_login: only a lead link (lead:<slug>) can move';
  END IF;
  UPDATE users
     SET link_slug = p_to_slug,
         email = CASE WHEN email = p_from_email THEN p_to_email ELSE email END
   WHERE role = 'client' AND link_slug = p_from_slug;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── Grants (deploy/db-roles.manifest.json) ──────────────────────────────────
-- Start from nothing so this file is the whole truth for each narrow login,
-- then one line per table and login (node scripts/db-roles-sql.mjs --all).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['sjcos_agent', 'sjcos_worker', 'sjcos_readonly', 'sjcos_backup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    ELSE
      RAISE NOTICE 'role % does not exist yet (deploy/db-roles-bootstrap.sql); grants below are skipped', r;
    END IF;
  END LOOP;
END $$;

SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'action_attempts');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'action_attempts');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'action_attempts');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'action_intents');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'action_intents');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'action_intents');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_executions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'agent_executions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_executions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_instruction_versions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'agent_instruction_versions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_instruction_versions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_interactions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'agent_interactions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_interactions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_memories');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'agent_memories');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_memories');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'agent_memory_source_refs');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'agent_memory_source_refs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_memory_source_refs');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'agent_pending_actions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'agent_pending_actions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_pending_actions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'agent_receipts');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'agent_receipts');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_receipts');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_runs');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'agent_runs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_runs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_triggers');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'agent_triggers');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_triggers');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'agent_usage');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'agent_usage');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_usage');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'ai_conversations');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'ai_conversations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'ai_conversations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'ai_folders');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'ai_folders');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'ai_folders');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'ai_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'ai_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'ai_messages');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'app_change_log');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, DELETE', 'app_change_log');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'app_change_log');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'app_settings');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'app_settings');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'app_settings');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'authority_grants');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'authority_grants');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'authority_grants');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'backup_runs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'backup_runs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'backup_runs');
SELECT sjcos_grant('sjcos_backup', 'INSERT, UPDATE', 'backup_runs');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'bid_invite_emails');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'bid_invite_emails');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bid_invite_emails');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'bid_invites');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'bid_invites');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bid_invites');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'bid_package_files');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'bid_package_files');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bid_package_files');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'bid_packages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'bid_packages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bid_packages');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'bid_submission_files');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'bid_submission_files');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bid_submission_files');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'bid_submission_lines');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'bid_submission_lines');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bid_submission_lines');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'bid_submissions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'bid_submissions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bid_submissions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'bills');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'bills');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'bills');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'budget_lines');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE, DELETE', 'budget_lines');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'budget_lines');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, DELETE', 'budget_parties');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, DELETE', 'budget_parties');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'budget_parties');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'buyout_obligations');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'buyout_obligations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'buyout_obligations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'call_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'call_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'call_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'calls');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'calls');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'calls');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'capability_status');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'capability_status');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'capability_status');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'cash_reservations');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'cash_reservations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'cash_reservations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'catalog_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'catalog_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'catalog_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, DELETE', 'change_order_credits');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, DELETE', 'change_order_credits');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'change_order_credits');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'change_orders');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'change_orders');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'change_orders');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'chat_ai_members');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_ai_members');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_ai_members');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'chat_channels');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_channels');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_channels');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'chat_dms');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_dms');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_dms');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'chat_members');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_members');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_members');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'chat_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_messages');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'chat_reads');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_reads');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_reads');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'chat_reads_by_user');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_reads_by_user');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_reads_by_user');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'chat_room_clients');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_room_clients');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_room_clients');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'chat_room_entities');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_room_entities');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_room_entities');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'chat_rooms');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_rooms');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_rooms');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'chat_team_members');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'chat_team_members');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'chat_team_members');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'client_activity');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'client_activity');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'client_activity');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'client_portal_invites');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'client_portal_invites');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'client_portal_invites');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'client_signoffs');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'client_signoffs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'client_signoffs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'closeout_actuals');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'closeout_actuals');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'closeout_actuals');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'closeout_checklists');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'closeout_checklists');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'closeout_checklists');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'commands');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'commands');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'commands');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'commitments');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'commitments');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'commitments');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'communication_optouts');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'communication_optouts');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'communication_optouts');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'company_funding_approvals');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'company_funding_approvals');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'company_funding_approvals');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'compliance_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'compliance_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'compliance_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'cost_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'cost_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'cost_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'cost_learning_revisions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'cost_learning_revisions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'cost_learning_revisions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'cost_observations');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'cost_observations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'cost_observations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'cron_runs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'cron_runs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'cron_runs');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'daily_logs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'daily_logs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'daily_logs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'decision_deliveries');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'decision_deliveries');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'decision_deliveries');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'decision_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'decision_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'decision_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'decisions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'decisions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'decisions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'deliveries');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'deliveries');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'deliveries');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'design_decisions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'design_decisions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'design_decisions');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'designer_activity_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'designer_activity_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'designer_activity_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'detector_state');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'detector_state');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'detector_state');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'dev_agent_runs');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'dev_agent_runs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'dev_agent_runs');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'document_drafts');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE, DELETE', 'document_drafts');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'document_drafts');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'document_revisions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'document_revisions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'document_revisions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'estimate_gaps');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'estimate_gaps');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'estimate_gaps');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'estimate_input_packages');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'estimate_input_packages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'estimate_input_packages');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'estimate_lines');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'estimate_lines');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'estimate_lines');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'estimates');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'estimates');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'estimates');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'eval_cases');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'eval_cases');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'eval_cases');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'eval_runs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'eval_runs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'eval_runs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'expenses');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE, DELETE', 'expenses');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'expenses');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'field_evidence_requests');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'field_evidence_requests');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'field_evidence_requests');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'field_incidents');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'field_incidents');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'field_incidents');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'field_reports');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'field_reports');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'field_reports');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'file_trash');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'file_trash');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'file_trash');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'files');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'files');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'files');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, DELETE', 'funding_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, DELETE', 'funding_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'funding_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'incident_reports');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'incident_reports');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'incident_reports');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'insurance_policies');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'insurance_policies');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'insurance_policies');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'intent_authority');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'intent_authority');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'intent_authority');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'invoice_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'invoice_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'invoice_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'invoice_numbers');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'invoice_numbers');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'invoice_numbers');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'invoice_payments');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'invoice_payments');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'invoice_payments');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'invoices');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'invoices');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'invoices');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'job_sites');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'job_sites');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'job_sites');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'knowledge_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'knowledge_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'knowledge_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'lane_pauses');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lane_pauses');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lane_pauses');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'lead_activity');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'lead_activity');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_activity');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'lead_estimates');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'lead_estimates');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_estimates');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'lead_facts');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lead_facts');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_facts');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'lead_first_responses');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lead_first_responses');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_first_responses');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'lead_followups');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lead_followups');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_followups');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'lead_intake');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lead_intake');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_intake');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'lead_intake_reviews');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lead_intake_reviews');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_intake_reviews');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'lead_qualification');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lead_qualification');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_qualification');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'lead_tasks');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'lead_tasks');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'lead_tasks');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'leads');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'leads');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'leads');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'location_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'location_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'location_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'mailbox_checkpoints');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'mailbox_checkpoints');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'mailbox_checkpoints');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'marketing_draft_media');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'marketing_draft_media');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'marketing_draft_media');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'marketing_drafts');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'marketing_drafts');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'marketing_drafts');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'measurement_cases');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'measurement_cases');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'measurement_cases');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, DELETE', 'metered_charges');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'metered_charges');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'metered_charges');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'milestone_confirmations');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'milestone_confirmations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'milestone_confirmations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'newsletter_assets');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'newsletter_assets');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_assets');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'newsletter_groups');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'newsletter_groups');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_groups');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'newsletter_outbox');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'newsletter_outbox');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_outbox');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'newsletter_recipient_groups');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'newsletter_recipient_groups');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_recipient_groups');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'newsletter_recipients');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'newsletter_recipients');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_recipients');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'newsletter_sequence_steps');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'newsletter_sequence_steps');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_sequence_steps');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'newsletter_sequences');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'newsletter_sequences');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_sequences');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'newsletter_subscriptions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'newsletter_subscriptions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletter_subscriptions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'newsletters');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'newsletters');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'newsletters');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'notification_reads');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'notification_reads');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'notification_reads');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'notifications');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'notifications');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'notifications');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'obligation_sources');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'obligation_sources');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'obligation_sources');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'obligations');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'obligations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'obligations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'orchestration_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'orchestration_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'orchestration_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'orchestration_tasks');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'orchestration_tasks');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'orchestration_tasks');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'overhead_subscriptions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'overhead_subscriptions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'overhead_subscriptions');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'owner_grants');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'owner_grants');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_grants');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'owner_labor_rates');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'owner_labor_rates');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_labor_rates');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'owner_replies');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'owner_replies');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_replies');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'owner_touches');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'owner_touches');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_touches');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'payee_validations');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'payee_validations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'payee_validations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'payment_attempts');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'payment_attempts');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'payment_attempts');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'payment_provider_config');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'payment_provider_config');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'payment_provider_config');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'permission_audit');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'permission_audit');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'permission_audit');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'plan_cost_rules');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'plan_cost_rules');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'plan_cost_rules');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'plan_design_comments');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'plan_design_comments');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'plan_design_comments');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'plan_design_files');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'plan_design_files');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'plan_design_files');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'plan_design_versions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'plan_design_versions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'plan_design_versions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'plan_designs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'plan_designs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'plan_designs');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'policies');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'policies');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'policies');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'portal_deliveries');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'portal_deliveries');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'portal_deliveries');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'post_project_actions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'post_project_actions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'post_project_actions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'price_observations');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'price_observations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'price_observations');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'pricing_setups');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'pricing_setups');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'pricing_setups');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'procedure_checks');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'procedure_checks');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'procedure_checks');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'procedure_versions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'procedure_versions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'procedure_versions');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'project_floorplans');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_floorplans');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_floorplans');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'project_mood');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_mood');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_mood');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'project_mood_boards');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_mood_boards');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_mood_boards');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'project_mood_feedback');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_mood_feedback');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_mood_feedback');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'project_punch');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'project_punch');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_punch');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'project_sections');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_sections');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_sections');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'project_selection_options');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_selection_options');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_selection_options');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'project_selections');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'project_selections');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_selections');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'project_subs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_subs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_subs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'project_uploads');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'project_uploads');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_uploads');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'project_workflow_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'project_workflow_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_workflow_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'project_workflows');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'project_workflows');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'project_workflows');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'projects');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'projects');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'projects');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'publication_rights');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'publication_rights');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'publication_rights');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'purchase_order_lines');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'purchase_order_lines');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'purchase_order_lines');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'purchase_orders');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'purchase_orders');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'purchase_orders');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'push_outbox');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'push_outbox');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'push_outbox');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'qbo_import_batches');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'qbo_import_batches');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'qbo_import_batches');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'qbo_mappings');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'qbo_mappings');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'qbo_mappings');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'qbo_sync_settings');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'qbo_sync_settings');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'qbo_sync_settings');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'quote_lines');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'quote_lines');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'quote_lines');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'quotes');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'quotes');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'quotes');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'refunds');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'refunds');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'refunds');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'reminder_log');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'reminder_log');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'reminder_log');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'retainers');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'retainers');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'retainers');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'run_effects');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'run_effects');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'run_effects');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'run_steers');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'run_steers');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'run_steers');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'runbook_definition_versions');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'runbook_definition_versions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'runbook_definition_versions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'runbook_instances');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'runbook_instances');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'runbook_instances');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'runbook_repairs');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'runbook_repairs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'runbook_repairs');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'runbook_steps');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'runbook_steps');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'runbook_steps');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'runbook_steps_log');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'runbook_steps_log');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'runbook_steps_log');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'runbook_wakeups');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'runbook_wakeups');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'runbook_wakeups');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'runbooks');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'runbooks');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'runbooks');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'safety_acknowledgments');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'safety_acknowledgments');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'safety_acknowledgments');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'safety_orientations');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'safety_orientations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'safety_orientations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'schedule_blocks');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'schedule_blocks');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'schedule_blocks');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'schedule_commitments');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'schedule_commitments');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'schedule_commitments');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'schedule_plans');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'schedule_plans');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'schedule_plans');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'schedule_template_phases');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'schedule_template_phases');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'schedule_template_phases');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'schedule_templates');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'schedule_templates');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'schedule_templates');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'schema_migrations');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'schema_migrations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'schema_migrations');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'scope_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'scope_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'scope_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'scope_registers');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'scope_registers');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'scope_registers');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'session_revocations');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'session_revocations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'session_revocations');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'signature_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'signature_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'signature_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'signature_requests');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'signature_requests');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'signature_requests');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'site_visit_findings');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'site_visit_findings');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'site_visit_findings');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'site_visit_plans');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'site_visit_plans');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'site_visit_plans');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'sjc_temp_lead_imports');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'sjc_temp_lead_imports');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sjc_temp_lead_imports');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'skill_versions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'skill_versions');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'skill_versions');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'skills');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'skills');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'skills');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'sms_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'sms_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sms_messages');
SELECT sjcos_grant('sjcos_agent', 'SELECT, UPDATE', 'sms_threads');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'sms_threads');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sms_threads');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'source_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'source_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'source_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'stage_rules');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'stage_rules');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'stage_rules');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'status_ledgers');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'status_ledgers');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'status_ledgers');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'sub_document_requests');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'sub_document_requests');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sub_document_requests');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'sub_documents');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'sub_documents');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sub_documents');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE, DELETE', 'sub_invoices');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE, DELETE', 'sub_invoices');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sub_invoices');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'sub_logs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'sub_logs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sub_logs');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'sub_portal_invites');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'sub_portal_invites');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'sub_portal_invites');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'subs');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'subs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'subs');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'supplier_capabilities');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'supplier_capabilities');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'supplier_capabilities');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'supplier_pricing_requests');
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'supplier_pricing_requests');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'supplier_pricing_requests');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'team_members');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'team_members');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'team_members');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'telegram_reply_targets');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'telegram_reply_targets');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'telegram_reply_targets');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'telegram_updates');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'telegram_updates');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'telegram_updates');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'thread_links');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'thread_links');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'thread_links');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'threads');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'threads');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'threads');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'time_events');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'time_events');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'time_events');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'time_intervals');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'time_intervals');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'time_intervals');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'unsorted_docs');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'unsorted_docs');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'unsorted_docs');
SELECT sjcos_grant('sjcos_agent', 'SELECT (id, email, name, role, initials, link_slug, active, permissions, created_at, portal_claimed_at, ai_scope, last_permission_change_at)', 'users');
SELECT sjcos_grant('sjcos_worker', 'SELECT (id, email, name, role, initials, link_slug, active, permissions, created_at, portal_claimed_at, ai_scope, last_permission_change_at)', 'users');
SELECT sjcos_grant('sjcos_readonly', 'SELECT (id, email, name, role, initials, link_slug, active, permissions, created_at, portal_claimed_at, ai_scope, last_permission_change_at)', 'users');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'vendor_payment_config');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'vendor_payment_config');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'vendor_payment_config');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'vendors');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'vendors');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'vendors');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'warranty_claims');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT', 'warranty_claims');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'warranty_claims');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'warranty_projects');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'warranty_projects');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'warranty_projects');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'weekly_summaries');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'weekly_summaries');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'weekly_summaries');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'weekly_summary_settings');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'weekly_summary_settings');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'weekly_summary_settings');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, DELETE', 'work_item_assignees');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'work_item_assignees');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'work_item_assignees');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'work_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'workers');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'workers');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'workers');
