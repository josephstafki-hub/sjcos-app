-- Shared 0100 is mandatory; reject before making ANY schema changes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id=100) THEN
  RAISE EXCEPTION '0105 requires shared migration 0100';
 END IF;
END $$;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS purge_after timestamptz;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS purged_at timestamptz;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS deletion_sequence bigint;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS purge_hold boolean NOT NULL DEFAULT false;
ALTER TABLE ai_folders ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
-- Only the unique active owner inherits historical shared rows. Never guess staff.
UPDATE ai_conversations SET owner_user_id=(SELECT min(id::text)::uuid FROM users WHERE role='owner' AND active)
 WHERE owner_user_id IS NULL AND (SELECT count(*) FROM users WHERE role='owner' AND active)=1;
UPDATE ai_folders SET owner_user_id=(SELECT min(id::text)::uuid FROM users WHERE role='owner' AND active)
 WHERE owner_user_id IS NULL AND (SELECT count(*) FROM users WHERE role='owner' AND active)=1;
DO $$ DECLARE n bigint; BEGIN SELECT count(*) INTO n FROM ai_conversations WHERE owner_user_id IS NULL; RAISE NOTICE '0105 quarantined legacy threads: %', n; END $$;
DROP INDEX IF EXISTS ai_folders_entity_idx;
CREATE UNIQUE INDEX ai_folders_entity_idx ON ai_folders(owner_user_id,entity_kind,entity_id) WHERE entity_id IS NOT NULL;
ALTER TABLE dev_agent_runs DROP CONSTRAINT IF EXISTS dev_agent_runs_conversation_id_fkey;
ALTER TABLE dev_agent_runs ADD CONSTRAINT dev_agent_runs_conversation_id_fkey FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE RESTRICT;
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS cancellation_requested boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS ask_canvas_maintenance (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 lease_owner uuid, lease_expires_at timestamptz, fencing_token bigint NOT NULL DEFAULT 0,
 heartbeat_at timestamptz, recovery_epoch uuid, recovery_ready boolean NOT NULL DEFAULT false,
 ledger_id uuid, checkpoint_sequence bigint NOT NULL DEFAULT 0 CHECK(checkpoint_sequence>=0),
 checkpoint_hash text, cursor_due_at timestamptz, cursor_id uuid,
 health_code text, blocked_since timestamptz DEFAULT now()
);
INSERT INTO ask_canvas_maintenance(singleton) VALUES(true) ON CONFLICT DO NOTHING;
-- No FK to 0106+; the Phase 0 capability is thread-only.
ALTER TABLE ai_conversations ADD CONSTRAINT ask_thread_retention CHECK (
 (deleted_at IS NULL AND purge_after IS NULL AND purged_at IS NULL AND deletion_sequence IS NULL) OR
 (deleted_at IS NOT NULL AND purge_after=deleted_at+interval '720 hours' AND deletion_sequence>0 AND (purged_at IS NULL OR purged_at>=purge_after)));
CREATE INDEX ask_thread_purge_idx ON ai_conversations(purge_after,id) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE OR REPLACE FUNCTION ask_website_login() RETURNS name LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.dev_agent_runs'::regclass
$$;
REVOKE ALL ON FUNCTION ask_website_login() FROM PUBLIC;
CREATE OR REPLACE FUNCTION ask_private_visible(who uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT session_user=ask_website_login() AND (
 -- No actor is the trusted runner/maintenance path, never an untrusted login.
 nullif(current_setting('sjcos.ask_actor',true),'') IS NULL OR
 (who=nullif(current_setting('sjcos.ask_actor',true),'')::uuid AND EXISTS(
 SELECT 1 FROM users u WHERE u.id=who AND u.active AND (u.role='owner' OR (u.role='staff' AND 'ai'=ANY(u.permissions))))))
$$;
REVOKE ALL ON FUNCTION ask_private_visible(uuid) FROM PUBLIC;
-- RLS calls require EXECUTE but never confer a write/admission capability.
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION ask_private_visible(uuid) TO %I',r); END IF;
END LOOP; END $$;
CREATE OR REPLACE FUNCTION guard_ask_thread_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Ask thread shells are retained' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN RAISE EXCEPTION 'thread owner is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND session_user<>ask_website_login() AND (NEW.claude_session_id IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NEW.purge_after IS NOT NULL OR NEW.deletion_sequence IS NOT NULL OR NEW.purged_at IS NOT NULL OR NEW.purge_hold) THEN RAISE EXCEPTION 'narrow thread insert must be unbound background' USING ERRCODE='42501'; END IF;
 IF session_user<>ask_website_login() AND (NEW.owner_user_id IS NOT NULL OR
   (TG_OP='UPDATE' AND (OLD.owner_user_id IS NOT NULL OR ROW(NEW.deleted_at,NEW.purge_after,NEW.claude_session_id,NEW.purge_hold) IS DISTINCT FROM ROW(OLD.deleted_at,OLD.purge_after,OLD.claude_session_id,OLD.purge_hold)))) THEN
  RAISE EXCEPTION 'narrow login cannot modify private thread' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'journaled deletion command required' USING ERRCODE='42501'; END IF;
 IF NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_folders f WHERE f.id=NEW.folder_id AND f.owner_user_id=NEW.owner_user_id) THEN RAISE EXCEPTION 'folder owner mismatch' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL AND current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
  RAISE EXCEPTION 'deleted thread is fenced' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_ask_thread_identity BEFORE INSERT OR UPDATE OR DELETE ON ai_conversations FOR EACH ROW EXECUTE FUNCTION guard_ask_thread_identity();
CREATE OR REPLACE FUNCTION guard_ask_thread_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t ai_conversations%ROWTYPE; tid uuid; ready boolean;
BEGIN
 tid:=CASE WHEN TG_OP='DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
 IF tid IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 SELECT * INTO t FROM ai_conversations WHERE id=tid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ask thread unavailable' USING ERRCODE='42501'; END IF;
 IF t.owner_user_id IS NOT NULL THEN
  SELECT recovery_ready INTO ready FROM ask_canvas_maintenance WHERE singleton FOR SHARE;
  IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private Ask write denied' USING ERRCODE='42501'; END IF;
  IF current_setting('sjcos.ask_purge',true)='yes' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF NOT ready OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Ask recovery/deletion fence' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME='dev_agent_runs' THEN
 IF TG_OP='INSERT' AND NEW.launch_source='background' AND t.owner_user_id IS NOT NULL THEN RAISE EXCEPTION 'background cannot bind private thread' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND NEW.launch_source IN ('panel_web','panel_mobile','panel_voice','telegram') AND (t.owner_user_id IS NULL OR t.owner_user_id<>NEW.principal_user_id OR t.deleted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Ask thread principal mismatch' USING ERRCODE='42501';
 END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER guard_ask_message_write BEFORE INSERT OR UPDATE OR DELETE ON ai_messages FOR EACH ROW EXECUTE FUNCTION guard_ask_thread_write();
CREATE TRIGGER guard_ask_run_thread BEFORE INSERT OR UPDATE ON dev_agent_runs FOR EACH ROW EXECUTE FUNCTION guard_ask_thread_write();
CREATE TRIGGER guard_ask_interaction_write BEFORE INSERT OR UPDATE ON agent_interactions FOR EACH ROW EXECUTE FUNCTION guard_ask_thread_write();
REVOKE ALL ON FUNCTION guard_ask_thread_identity(),guard_ask_thread_write() FROM PUBLIC;
-- FORCE also scopes the website's authenticated per-query actor. Trusted raw
-- runner/repair SQL remains the owner boundary, never a narrow-login GUC bypass.
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['ai_conversations','ai_folders','ai_messages','dev_agent_runs','agent_interactions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
END LOOP; END $$;
CREATE POLICY ask_thread_private ON ai_conversations USING (ask_private_visible(owner_user_id) AND (deleted_at IS NULL OR nullif(current_setting('sjcos.ask_actor',true),'') IS NULL)) WITH CHECK(ask_private_visible(owner_user_id));
CREATE POLICY ask_folder_private ON ai_folders USING (ask_private_visible(owner_user_id)) WITH CHECK(ask_private_visible(owner_user_id));
CREATE POLICY ask_message_private ON ai_messages USING(EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=conversation_id AND (c.deleted_at IS NULL OR (ask_private_visible(NULL) AND nullif(current_setting('sjcos.ask_actor',true),'') IS NULL)))) WITH CHECK(EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=conversation_id AND (c.deleted_at IS NULL OR (ask_private_visible(NULL) AND nullif(current_setting('sjcos.ask_actor',true),'') IS NULL))));
CREATE POLICY ask_run_private ON dev_agent_runs USING (
 (session_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.dev_agent_runs'::regclass)) AND (nullif(current_setting('sjcos.ask_actor',true),'') IS NULL OR ask_private_visible(principal_user_id))) OR
 (launch_source='background' AND principal_user_id IS NULL AND conversation_id IS NULL)) WITH CHECK (
 (session_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.dev_agent_runs'::regclass)) AND (nullif(current_setting('sjcos.ask_actor',true),'') IS NULL OR ask_private_visible(principal_user_id))) OR
 (launch_source='background' AND principal_user_id IS NULL AND conversation_id IS NULL));
CREATE POLICY ask_interaction_private ON agent_interactions USING(EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=conversation_id AND (c.deleted_at IS NULL OR (ask_private_visible(NULL) AND nullif(current_setting('sjcos.ask_actor',true),'') IS NULL)))) WITH CHECK(EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=conversation_id AND (c.deleted_at IS NULL OR (ask_private_visible(NULL) AND nullif(current_setting('sjcos.ask_actor',true),'') IS NULL))));
-- Generated manifest grants: ask_canvas_maintenance has none (website only).
-- Existing narrow table grants are constrained by session_user guards + RLS.
REVOKE ALL ON ask_canvas_maintenance FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON ask_canvas_maintenance FROM %I',r); END IF;
END LOOP; END $$;

CREATE OR REPLACE FUNCTION guard_ask_folder_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN RAISE EXCEPTION 'folder owner is immutable' USING ERRCODE='42501'; END IF;
 IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private folder write denied' USING ERRCODE='42501'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION guard_ask_folder_identity() FROM PUBLIC;
CREATE TRIGGER guard_ask_folder_identity BEFORE INSERT OR UPDATE OR DELETE ON ai_folders FOR EACH ROW EXECUTE FUNCTION guard_ask_folder_identity();

-- Steer bodies are private model inputs too; the worker cannot read panel
-- steer queues merely because it retains background runtime grants.
ALTER TABLE run_steers ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_steers FORCE ROW LEVEL SECURITY;
CREATE POLICY ask_steer_private ON run_steers USING(EXISTS(SELECT 1 FROM dev_agent_runs r JOIN ai_conversations c ON c.id=r.conversation_id WHERE r.id=run_id AND ask_private_visible(r.principal_user_id) AND (c.deleted_at IS NULL OR (current_setting('sjcos.ask_purge',true)='yes' AND ask_private_visible(NULL))))) WITH CHECK(EXISTS(SELECT 1 FROM dev_agent_runs r JOIN ai_conversations c ON c.id=r.conversation_id WHERE r.id=run_id AND ask_private_visible(r.principal_user_id) AND (c.deleted_at IS NULL OR (current_setting('sjcos.ask_purge',true)='yes' AND ask_private_visible(NULL)))));
-- pg_read_all_data does not itself bypass RLS. Preserve full encrypted backup
-- reads without granting a private payload to agent/worker/monitor.
DO $$ DECLARE tab text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_backup') THEN
  FOREACH tab IN ARRAY ARRAY['ai_conversations','ai_folders','ai_messages','dev_agent_runs','agent_interactions','run_steers'] LOOP
   EXECUTE format('CREATE POLICY ask_backup_read ON %I FOR SELECT TO sjcos_backup USING (true)',tab);
  END LOOP;
 END IF;
END $$;

CREATE POLICY ask_unowned_background_insert ON ai_conversations FOR INSERT WITH CHECK (owner_user_id IS NULL AND nullif(current_setting('sjcos.ask_actor',true),'') IS NULL);
