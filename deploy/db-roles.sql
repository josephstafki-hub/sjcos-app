-- deploy/db-roles.sql — least-privilege Postgres roles for SJC OS (A08b).
--
-- Joe applies this BY HAND to the live database (psql -d sjcos -f
-- deploy/db-roles.sql) after 0009_access.sql has migrated. Nothing in the
-- repo runs it. It is idempotent: roles are created only if missing and every
-- GRANT can be re-run.
--
-- Roles:
--   sjcos_app       the Next.js service (today's single owner-of-everything
--                   connection). Unchanged; listed for completeness.
--   sjcos_agent     the MCP server + business-agent worker. Reads business
--                   tables; writes only the tables the curated tools touch
--                   (knowledge, work items, receipts, drafts, agent bookkeeping).
--                   CANNOT touch users, authority_grants, session_revocations,
--                   permission_audit, owner_grants, app_settings, policies —
--                   so no prompt can grant itself anything, whatever it reads.
--   sjcos_worker    dispatch / weekly-summary / qbo-sync / payments-reconcile
--                   workers: intents + attempts + source events + their own
--                   heartbeats; reads the rest; no permission tables.
--   sjcos_readonly  monitor: SELECT only.
--   sjcos_backup    pg_dump: SELECT only (pg_read_all_data).
--
-- Wiring after apply (documented in docs/automation-reliability/
-- credentials-inventory.md):
--   .env.local  DATABASE_URL          → sjcos_app     (unchanged)
--   .env.local  DATABASE_URL_AGENT    → sjcos_agent   (mcp/sjcos-mcp.mjs + scripts/run-business-agent.mjs read this first when set)
--   .env.local  DATABASE_URL_WORKER   → sjcos_worker
--   .env.local  DATABASE_URL_READONLY → sjcos_readonly
--   backup unit DATABASE_URL_BACKUP   → sjcos_backup
-- Passwords: set them once with \password <role> in psql; never commit them.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_agent') THEN CREATE ROLE sjcos_agent LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_worker') THEN CREATE ROLE sjcos_worker LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_readonly') THEN CREATE ROLE sjcos_readonly LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sjcos_backup') THEN CREATE ROLE sjcos_backup LOGIN; END IF;
END $$;

-- Everyone may connect and see the schema.
GRANT CONNECT ON DATABASE sjcos TO sjcos_agent, sjcos_worker, sjcos_readonly, sjcos_backup;
GRANT USAGE ON SCHEMA public TO sjcos_agent, sjcos_worker, sjcos_readonly, sjcos_backup;

-- ── Read-only + backup ───────────────────────────────────────────────────────
GRANT pg_read_all_data TO sjcos_readonly, sjcos_backup;

-- ── Agent (MCP server, business-agent worker) ────────────────────────────────
-- Start from read-everything, then REVOKE the tables a prompt must never see
-- in full, then GRANT the narrow write set.
GRANT pg_read_all_data TO sjcos_agent;
-- Secrets and permission state: no read at all (the MCP server derives the
-- principal via a SECURITY DEFINER view below instead of reading users).
REVOKE ALL ON users, authority_grants, session_revocations, permission_audit, owner_grants, app_settings,
           policies, lane_pauses, commands FROM sjcos_agent;

-- What the curated tools write (mirror of mcp/sjcos-mcp.mjs gated writes).
GRANT INSERT, UPDATE ON knowledge_items, work_items, agent_runs, receipts, skills, skill_uses,
                        agent_memories, run_effects, agent_interactions, app_change_log,
                        document_drafts, newsletter_issues, newsletter_recipients, newsletter_outbox,
                        purchase_orders, purchase_order_lines, bid_packages, bid_invites, bid_files,
                        selection_items, selection_options, selection_sections, mood_boards, mood_items,
                        plan_designs, plan_versions, plan_comments, estimates, estimate_lines,
                        project_costs, sub_invoices, dev_agent_runs, agent_usage, ai_messages, ai_conversations
  TO sjcos_agent;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sjcos_agent;

-- Principal lookup without exposing users: a SECURITY DEFINER function the
-- agent role may call. Returns identity only — no password_hash, no email.
CREATE OR REPLACE FUNCTION sjcos_principal(p_user_id uuid)
RETURNS TABLE (id uuid, role text, name text, active boolean, permissions text[], revoked_before timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT u.id, u.role, u.name, u.active, u.permissions,
         (SELECT max(r.revoked_before) FROM session_revocations r WHERE r.user_id = u.id)
    FROM users u WHERE u.id = p_user_id
$$;
REVOKE ALL ON FUNCTION sjcos_principal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sjcos_principal(uuid) TO sjcos_agent, sjcos_worker;

-- Authority check without exposing authority_grants: same pattern.
CREATE OR REPLACE FUNCTION sjcos_authority(p_user_id uuid, p_action text, p_project uuid, p_amount bigint)
RETURNS TABLE (grant_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT g.id FROM authority_grants g
   WHERE g.user_id = p_user_id AND g.revoked_at IS NULL AND g.action_type = p_action
     AND (g.project_id IS NULL OR g.project_id = p_project)
     AND (g.max_amount_cents IS NULL OR p_amount IS NULL OR p_amount <= g.max_amount_cents)
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION sjcos_authority(uuid, text, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sjcos_authority(uuid, text, uuid, bigint) TO sjcos_agent, sjcos_worker;

-- ── Workers (dispatch, weekly-summary, qbo-sync, payments-reconcile) ────────
GRANT pg_read_all_data TO sjcos_worker;
REVOKE ALL ON users, authority_grants, session_revocations, permission_audit, app_settings FROM sjcos_worker;
GRANT INSERT, UPDATE ON action_intents, action_attempts, source_events, workers, decision_deliveries, decision_events,
                        push_outbox, notifications, app_change_log, agent_usage, owner_touches,
                        invoices, invoice_lines, payments, qbo_mappings, qbo_sync_log
  TO sjcos_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sjcos_worker;

-- Tables that do not exist yet in a given deployment make the matching GRANT
-- fail; run the file again after the missing migration lands, or trim the
-- list. Verify with:  \dp users   \dp authority_grants   (no sjcos_agent line)
