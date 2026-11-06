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
-- A1.2: recorded creators take priority; ambiguous/inactive evidence stays
-- quarantined. Null principals are not evidence. Never rewrite an existing owner.
UPDATE ai_conversations c SET owner_user_id=CASE
 WHEN evidence.principals=1 THEN (SELECT id FROM users WHERE id=evidence.creator AND active)
 WHEN evidence.principals=0 AND (SELECT count(*) FROM users WHERE role='owner' AND active)=1
 THEN (SELECT min(id::text)::uuid FROM users WHERE role='owner' AND active)
 ELSE NULL END
 FROM (SELECT c0.id,count(DISTINCT r.principal_user_id) AS principals,
       min(r.principal_user_id::text)::uuid AS creator
       FROM ai_conversations c0 LEFT JOIN dev_agent_runs r ON r.conversation_id=c0.id GROUP BY c0.id) evidence
 WHERE c.id=evidence.id AND c.owner_user_id IS NULL;
UPDATE ai_folders SET owner_user_id=(SELECT min(id::text)::uuid FROM users WHERE role='owner' AND active)
 WHERE owner_user_id IS NULL AND (SELECT count(*) FROM users WHERE role='owner' AND active)=1;
-- Shared legacy folders must not bind a staff-owned thread to Joe's folder.
UPDATE ai_conversations c SET folder_id=NULL FROM ai_folders f WHERE c.folder_id=f.id AND c.owner_user_id IS DISTINCT FROM f.owner_user_id;
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
 deletion_enabled boolean NOT NULL DEFAULT false,
 ledger_id uuid, checkpoint_sequence bigint NOT NULL DEFAULT 0 CHECK(checkpoint_sequence>=0),
 checkpoint_hash text, cursor_due_at timestamptz, cursor_id uuid,
 health_code text, blocked_since timestamptz DEFAULT now()
);
INSERT INTO ask_canvas_maintenance(singleton) VALUES(true) ON CONFLICT DO NOTHING;
-- The latch cannot be cleared by a stale flag or an ordinary UPDATE. Journal
-- and retained-shell evidence are independently rechecked by the server.
CREATE OR REPLACE FUNCTION guard_ask_deletion_latch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR (OLD.deletion_enabled AND NOT NEW.deletion_enabled) THEN
  RAISE EXCEPTION 'Ask deletion latch is permanent' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_deletion_latch() FROM PUBLIC;
CREATE TRIGGER guard_ask_deletion_latch BEFORE UPDATE OR DELETE ON ask_canvas_maintenance FOR EACH ROW EXECUTE FUNCTION guard_ask_deletion_latch();
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

-- Regenerated evidence (no privilege changes):
-- node scripts/db-roles-sql.mjs agent_interactions ai_messages ask_canvas_maintenance
-- SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_interactions');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT', 'agent_interactions');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_interactions');
-- SELECT sjcos_grant('sjcos_agent', 'SELECT', 'ai_messages');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'ai_messages');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'ai_messages');
-- ask_canvas_maintenance prints no grants: website only.
-- Worker interaction UPDATE and message DELETE remain intentionally withheld.

-- R2 derivative privacy. 0105 is not applied on live; rebuild disposable QA.
-- Remove every historical automatic prompt excerpt, even unbound legacy rows.
UPDATE owner_grants SET reason='Express permission given in the Ask window.'
 WHERE reason LIKE 'Express permission given in the Ask window for:%';
-- Materialize the source link before policies: a run-only reference is private
-- too. Mixed legacy links stay private and cannot be reattached by a caller.
UPDATE owner_grants g SET conversation_id=r.conversation_id FROM dev_agent_runs r
 WHERE r.id=g.run_id AND g.conversation_id IS NULL AND r.conversation_id IS NOT NULL;
UPDATE owner_replies o SET conversation_id=COALESCE(g.conversation_id,r.conversation_id)
 FROM owner_grants g LEFT JOIN dev_agent_runs r ON r.id=g.run_id
 WHERE g.id=o.grant_id AND o.conversation_id IS NULL;
UPDATE owner_replies o SET conversation_id=r.conversation_id FROM dev_agent_runs r
 WHERE r.id=o.run_id AND o.conversation_id IS NULL AND r.conversation_id IS NOT NULL;
UPDATE owner_replies SET body='[deleted]',answer=NULL,state='failed',error=NULL
 WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE deleted_at IS NOT NULL);
UPDATE owner_grants SET reason='Private Ask permission',scope='{}',audit='[]',status='revoked'
 WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE deleted_at IS NOT NULL);
CREATE OR REPLACE FUNCTION bind_ask_derivative() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE linked uuid; granted uuid;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR
   (TG_TABLE_NAME='owner_grants' AND NEW.run_id IS DISTINCT FROM OLD.run_id)) THEN
   RAISE EXCEPTION 'private source link immutable' USING ERRCODE='42501';
 END IF;
 SELECT conversation_id INTO linked FROM dev_agent_runs WHERE id=NEW.run_id;
 -- SECURITY DEFINER does not override our session_user-based source RLS.
 -- An invisible source must be refused, never reclassified as shared NULL.
 IF NEW.run_id IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'Ask source unavailable' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='owner_replies' THEN
  SELECT conversation_id INTO granted FROM owner_grants WHERE id=NEW.grant_id;
  IF NEW.grant_id IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'Ask source unavailable' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.decision_id IS DISTINCT FROM OLD.decision_id) THEN
   RAISE EXCEPTION 'private source link immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 IF linked IS NOT NULL AND NEW.conversation_id IS NOT NULL AND linked<>NEW.conversation_id OR
    granted IS NOT NULL AND NEW.conversation_id IS NOT NULL AND granted<>NEW.conversation_id THEN
  RAISE EXCEPTION 'private source link mismatch' USING ERRCODE='42501';
 END IF;
 NEW.conversation_id:=COALESCE(NEW.conversation_id,linked,granted);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bind_ask_derivative() FROM PUBLIC;
CREATE TRIGGER a_bind_ask_derivative BEFORE INSERT OR UPDATE ON owner_grants FOR EACH ROW EXECUTE FUNCTION bind_ask_derivative();
CREATE TRIGGER a_bind_ask_derivative BEFORE INSERT OR UPDATE ON owner_replies FOR EACH ROW EXECUTE FUNCTION bind_ask_derivative();
CREATE TRIGGER guard_ask_grant_write BEFORE INSERT OR UPDATE OR DELETE ON owner_grants FOR EACH ROW EXECUTE FUNCTION guard_ask_thread_write();
CREATE TRIGGER guard_ask_reply_write BEFORE INSERT OR UPDATE OR DELETE ON owner_replies FOR EACH ROW EXECUTE FUNCTION guard_ask_thread_write();
CREATE OR REPLACE FUNCTION ask_derivative_visible(thread uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT thread IS NULL OR (session_user=ask_website_login() AND EXISTS(
  SELECT 1 FROM ai_conversations c WHERE c.id=thread AND ask_private_visible(c.owner_user_id)
  AND (c.deleted_at IS NULL OR nullif(current_setting('sjcos.ask_actor',true),'') IS NULL)))
$$;
REVOKE ALL ON FUNCTION ask_derivative_visible(uuid) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION ask_derivative_visible(uuid) TO %I',r); END IF;
END LOOP; END $$;
ALTER TABLE owner_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE owner_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_replies FORCE ROW LEVEL SECURITY;
CREATE POLICY ask_grant_private ON owner_grants USING(ask_derivative_visible(conversation_id)) WITH CHECK(ask_derivative_visible(conversation_id));
CREATE POLICY ask_reply_private ON owner_replies USING(ask_derivative_visible(conversation_id)) WITH CHECK(ask_derivative_visible(conversation_id));
-- Matching manifest generator output (table privileges unchanged; RLS narrows rows).
-- SELECT sjcos_grant('sjcos_agent', 'SELECT', 'owner_grants');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'owner_grants');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_grants');
-- SELECT sjcos_grant('sjcos_agent', 'SELECT', 'owner_replies');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'owner_replies');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_replies');

-- R3: a reply about a business card is not permission to publish chat text.
-- Store the body/answer only in owner_replies (FORCE RLS above); shared cards,
-- events, intent errors and work items contain fixed status, not private copies.
-- This also scrubs hook payloads and any historical execution fed by those
-- payloads. Reused on tombstone replay before erasing the original reply.
-- Historical background consumers may still be in flight. Once their
-- contaminated payload is erased they are immutable audit shells, so a late
-- worker/runner completion cannot put the private text back.
ALTER TABLE agent_triggers ADD COLUMN IF NOT EXISTS ask_reply_erased boolean NOT NULL DEFAULT false;
ALTER TABLE agent_executions ADD COLUMN IF NOT EXISTS ask_reply_erased boolean NOT NULL DEFAULT false;
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS ask_reply_erased boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION guard_ask_erased_copy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (TG_OP='UPDATE' AND OLD.ask_reply_erased) OR NEW.ask_reply_erased OR
  (TG_TABLE_NAME='agent_executions' AND EXISTS(SELECT 1 FROM agent_triggers t WHERE t.id=(to_jsonb(NEW)->>'trigger_id')::uuid AND t.ask_reply_erased)) THEN
  IF session_user<>ask_website_login() OR current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' THEN
   RAISE EXCEPTION 'erased Ask copy is fenced' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_erased_copy() FROM PUBLIC;
CREATE TRIGGER guard_ask_erased_copy BEFORE INSERT OR UPDATE ON agent_triggers FOR EACH ROW EXECUTE FUNCTION guard_ask_erased_copy();
CREATE TRIGGER guard_ask_erased_copy BEFORE INSERT OR UPDATE ON agent_executions FOR EACH ROW EXECUTE FUNCTION guard_ask_erased_copy();
CREATE TRIGGER guard_ask_erased_copy BEFORE INSERT OR UPDATE ON dev_agent_runs FOR EACH ROW EXECUTE FUNCTION guard_ask_erased_copy();
-- Durable Telegram cards include historical private reply notes, even when sent.
-- Keep an immutable erased marker so late retries cannot repopulate the shell.
ALTER TABLE push_outbox ADD COLUMN ask_reply_erased boolean NOT NULL DEFAULT false;
-- Opaque associations survive source purge and are readable only through the
-- boolean definer helper. Do not depend on RLS-hidden private reply rows when
-- a narrow worker retries an old body or the website has a different actor.
CREATE TABLE private_ask_push_sources (kind text NOT NULL, ref uuid NOT NULL, PRIMARY KEY(kind,ref));
REVOKE ALL ON private_ask_push_sources FROM PUBLIC;
INSERT INTO private_ask_push_sources
 SELECT 'decision',decision_id FROM owner_replies WHERE conversation_id IS NOT NULL AND decision_id IS NOT NULL
 UNION SELECT 'work',work_item_id FROM owner_replies WHERE conversation_id IS NOT NULL AND work_item_id IS NOT NULL
 UNION SELECT 'grant',grant_id FROM owner_replies WHERE conversation_id IS NOT NULL AND grant_id IS NOT NULL
 UNION SELECT 'decision',decision_id FROM owner_grants WHERE conversation_id IS NOT NULL AND decision_id IS NOT NULL
 UNION SELECT 'grant',id FROM owner_grants WHERE conversation_id IS NOT NULL;
CREATE OR REPLACE FUNCTION bind_ask_push_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE obj jsonb;
BEGIN
 IF NEW.conversation_id IS NOT NULL THEN
  obj:=to_jsonb(NEW);
  INSERT INTO private_ask_push_sources(kind,ref)
   SELECT kind,ref::uuid FROM (VALUES ('decision',obj->>'decision_id'),('work',obj->>'work_item_id'),
    ('grant',CASE WHEN TG_TABLE_NAME='owner_grants' THEN obj->>'id' ELSE obj->>'grant_id' END)) x(kind,ref)
   WHERE ref IS NOT NULL ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bind_ask_push_source AFTER INSERT OR UPDATE ON owner_replies FOR EACH ROW EXECUTE FUNCTION bind_ask_push_source();
CREATE TRIGGER bind_ask_push_source AFTER INSERT OR UPDATE ON owner_grants FOR EACH ROW EXECUTE FUNCTION bind_ask_push_source();
CREATE OR REPLACE FUNCTION ask_push_is_private(p jsonb, link text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM private_ask_push_sources s WHERE
  strpos(COALESCE(p::text,''),s.ref::text)>0 OR strpos(COALESCE(link,''),s.ref::text)>0 OR
  (s.kind='decision' AND EXISTS(SELECT 1 FROM decision_deliveries d WHERE d.decision_id=s.ref AND d.channel='telegram'
   AND split_part(d.external_ref,':',2)=COALESCE(p->>'editMessageId',p->>'edit_message_id')))
 );
$$;
CREATE OR REPLACE FUNCTION guard_ask_push_copy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (TG_OP='UPDATE' AND OLD.ask_reply_erased) OR NEW.ask_reply_erased OR ask_push_is_private(NEW.payload,NEW.href) THEN
  NEW.ask_reply_erased:=true;
  NEW.title:='Private Ask request updated.';
  NEW.body:=NULL; NEW.payload:='{}'; NEW.href:='/today';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_ask_push_copy BEFORE INSERT OR UPDATE ON push_outbox FOR EACH ROW EXECUTE FUNCTION guard_ask_push_copy();
CREATE OR REPLACE FUNCTION erase_ask_reply_copies(thread uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE decisions_ids uuid[]; work_ids uuid[]; trigger_ids uuid[]; prior_purge text;
BEGIN
 IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private Ask repair denied' USING ERRCODE='42501'; END IF;
 prior_purge:=current_setting('sjcos.ask_purge',true);
 PERFORM set_config('sjcos.ask_purge','yes',true);
 SELECT array_agg(DISTINCT decision_id) INTO decisions_ids FROM (
  SELECT decision_id FROM owner_replies WHERE conversation_id IS NOT NULL AND (thread IS NULL OR conversation_id=thread)
  UNION SELECT decision_id FROM owner_grants WHERE conversation_id IS NOT NULL AND (thread IS NULL OR conversation_id=thread)
 ) x WHERE decision_id IS NOT NULL;
 SELECT array_agg(DISTINCT work_item_id) INTO work_ids FROM owner_replies
  WHERE conversation_id IS NOT NULL AND (thread IS NULL OR conversation_id=thread) AND work_item_id IS NOT NULL;
 SELECT array_agg(id) INTO trigger_ids FROM agent_triggers t WHERE
  t.payload->>'decision_id'=ANY(SELECT unnest(decisions_ids)::text) OR
  t.payload->>'work_item_id'=ANY(SELECT unnest(work_ids)::text) OR
  EXISTS(SELECT 1 FROM unnest(decisions_ids) d WHERE t.ref LIKE 'decision:'||d::text||':%') OR
  EXISTS(SELECT 1 FROM owner_replies r WHERE r.conversation_id IS NOT NULL AND (thread IS NULL OR r.conversation_id=thread) AND (t.id=r.trigger_id OR t.ref='owner_reply:'||r.id::text));
 -- Migration/replay scrub sent, failed and pending pushes, including legacy
 -- href/button/delivery references. Global cleanup is deliberately idempotent.
 UPDATE push_outbox SET ask_reply_erased=true WHERE ask_push_is_private(payload,href);
 UPDATE decisions SET decision_note='Private Ask reply recorded.',hold_note=NULL WHERE id=ANY(decisions_ids) AND (decision_note IS NOT NULL OR hold_note IS NOT NULL);
 UPDATE decision_events SET detail=detail-'note'-'reason' WHERE decision_id=ANY(decisions_ids);
 UPDATE action_intents SET last_error='Private Ask request updated.' WHERE last_error IS NOT NULL AND
  (decision_id=ANY(decisions_ids) OR grant_id IN (SELECT id FROM owner_grants WHERE conversation_id IS NOT NULL AND (thread IS NULL OR conversation_id=thread)));
 UPDATE work_items SET blocked_reason='Changes requested in the private Ask chat.' WHERE id=ANY(work_ids) AND blocked_reason IS NOT NULL;
 -- A historical worker may already have consumed the hook. Scrub its linked
 -- detached background run as well as the execution log, retaining identities.
 UPDATE dev_agent_runs SET ask_reply_erased=true,prompt='[deleted]',page_context=NULL,answer=NULL,activity=NULL,spoken_answer=NULL,session_id=NULL,
  cancellation_requested=true,status=CASE WHEN status IN ('pending','running') THEN 'error' ELSE status END
  WHERE conversation_id IS NULL AND id IN (SELECT dev_agent_run_id FROM agent_executions WHERE (trigger_id=ANY(trigger_ids) OR
   EXISTS(SELECT 1 FROM unnest(decisions_ids) d WHERE trigger_ref LIKE 'decision:'||d::text||':%') OR
   EXISTS(SELECT 1 FROM unnest(work_ids) w WHERE trigger_ref LIKE 'work_item:'||w::text||':%') OR
   EXISTS(SELECT 1 FROM owner_replies r WHERE r.conversation_id IS NOT NULL AND (thread IS NULL OR r.conversation_id=thread) AND trigger_ref='owner_reply:'||r.id::text)));
 -- A completed/cancelled trigger still retains its payload unless scrubbed.
 UPDATE agent_triggers SET ask_reply_erased=true,payload=payload-'note'-'owner_reply'-'owner_reply_how'-'draft_text',last_error=NULL,
  state='done',done_at=COALESCE(done_at,now()),lease_token=NULL,lease_until=NULL WHERE id=ANY(trigger_ids);
 UPDATE agent_executions SET ask_reply_erased=true,tool_trace='[]',result_summary=NULL,blocked_reason=NULL,next_trigger=NULL,error=NULL,context_refs='[]',records_touched='[]',session_id=NULL
  WHERE (trigger_id=ANY(trigger_ids) OR
   EXISTS(SELECT 1 FROM unnest(decisions_ids) d WHERE trigger_ref LIKE 'decision:'||d::text||':%') OR
   EXISTS(SELECT 1 FROM unnest(work_ids) w WHERE trigger_ref LIKE 'work_item:'||w::text||':%') OR
   EXISTS(SELECT 1 FROM owner_replies r WHERE r.conversation_id IS NOT NULL AND (thread IS NULL OR r.conversation_id=thread) AND trigger_ref='owner_reply:'||r.id::text)) OR dev_agent_run_id IN (SELECT id FROM dev_agent_runs WHERE conversation_id=thread);
 -- Thread deletion also erases the automatic run/ladder copies immediately.
 -- Migration-wide NULL only scrubs known reply fan-out; live chats keep runtime.
 IF thread IS NOT NULL THEN
  UPDATE run_effects SET detail='{}',entity_id=NULL,entity_kind='deleted',action='deleted' WHERE run_id IN (SELECT id FROM dev_agent_runs WHERE conversation_id=thread);
  UPDATE agent_pending_actions SET payload='{}',review_note=NULL,status='cancelled',entity_id=NULL,entity_kind='',kind='deleted' WHERE run_id IN (SELECT id FROM dev_agent_runs WHERE conversation_id=thread);
  UPDATE orchestration_events SET note=NULL WHERE task_id IN (SELECT id FROM orchestration_tasks WHERE conversation_id=thread);
  UPDATE orchestration_tasks SET task_prompt='[deleted]',status='cancelled' WHERE conversation_id=thread;
 END IF;
 PERFORM set_config('sjcos.ask_purge',COALESCE(prior_purge,''),true);
END $$;
REVOKE ALL ON FUNCTION erase_ask_reply_copies(uuid) FROM PUBLIC;
-- During migration the installing website owns the tables. The test harness
-- administrator represents that login until withSessionIdentity transfers them.
SELECT erase_ask_reply_copies(NULL);
DO $$ DECLARE tid uuid; BEGIN
 FOR tid IN SELECT id FROM ai_conversations WHERE deleted_at IS NOT NULL LOOP
  PERFORM erase_ask_reply_copies(tid);
 END LOOP;
END $$;

-- R3 sweep: these are automatic run/chat copies, not filed business artifacts.
-- FK joins alone do not inherit the source table's RLS for a SELECT * reader.
ALTER TABLE run_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_effects FORCE ROW LEVEL SECURITY;
CREATE POLICY ask_effect_private ON run_effects USING(EXISTS(SELECT 1 FROM dev_agent_runs r WHERE r.id=run_id AND ask_derivative_visible(r.conversation_id))) WITH CHECK(EXISTS(SELECT 1 FROM dev_agent_runs r WHERE r.id=run_id AND ask_derivative_visible(r.conversation_id)));
ALTER TABLE agent_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_pending_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY ask_pending_private ON agent_pending_actions USING(EXISTS(SELECT 1 FROM dev_agent_runs r WHERE r.id=run_id AND ask_derivative_visible(r.conversation_id))) WITH CHECK(EXISTS(SELECT 1 FROM dev_agent_runs r WHERE r.id=run_id AND ask_derivative_visible(r.conversation_id)));
ALTER TABLE orchestration_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY ask_task_private ON orchestration_tasks USING(ask_derivative_visible(conversation_id)) WITH CHECK(ask_derivative_visible(conversation_id));
ALTER TABLE orchestration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ask_event_private ON orchestration_events USING(EXISTS(SELECT 1 FROM orchestration_tasks t WHERE t.id=task_id)) WITH CHECK(EXISTS(SELECT 1 FROM orchestration_tasks t WHERE t.id=task_id));
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY ask_execution_private ON agent_executions USING(dev_agent_run_id IS NULL OR EXISTS(SELECT 1 FROM dev_agent_runs r WHERE r.id=dev_agent_run_id AND ask_derivative_visible(r.conversation_id))) WITH CHECK(dev_agent_run_id IS NULL OR EXISTS(SELECT 1 FROM dev_agent_runs r WHERE r.id=dev_agent_run_id AND ask_derivative_visible(r.conversation_id)));

CREATE OR REPLACE FUNCTION guard_ask_runtime_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE src uuid; tid uuid; oldsrc uuid; oldtid uuid;
BEGIN
 src:=COALESCE((to_jsonb(NEW)->>'run_id')::uuid,(to_jsonb(NEW)->>'dev_agent_run_id')::uuid);
 oldsrc:=COALESCE((to_jsonb(OLD)->>'run_id')::uuid,(to_jsonb(OLD)->>'dev_agent_run_id')::uuid);
 IF TG_OP='UPDATE' AND src IS DISTINCT FROM oldsrc THEN RAISE EXCEPTION 'private runtime source immutable' USING ERRCODE='42501'; END IF;
 IF src IS NOT NULL THEN
  SELECT conversation_id INTO tid FROM dev_agent_runs WHERE id=src;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ask source unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME='orchestration_events' THEN
  IF TG_OP='UPDATE' AND NEW.task_id IS DISTINCT FROM OLD.task_id THEN RAISE EXCEPTION 'private runtime source immutable' USING ERRCODE='42501'; END IF;
  SELECT conversation_id INTO oldtid FROM orchestration_tasks WHERE id=NEW.task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ask source unavailable' USING ERRCODE='42501'; END IF;
  IF tid IS NOT NULL AND tid<>oldtid THEN RAISE EXCEPTION 'Ask source mismatch' USING ERRCODE='42501'; END IF;
  tid:=oldtid;
 END IF;
 IF TG_TABLE_NAME IN ('agent_pending_actions','orchestration_tasks') THEN
  oldtid:=(to_jsonb(NEW)->>'conversation_id')::uuid;
  IF TG_OP='UPDATE' AND oldtid IS DISTINCT FROM (to_jsonb(OLD)->>'conversation_id')::uuid THEN RAISE EXCEPTION 'private runtime source immutable' USING ERRCODE='42501'; END IF;
  IF tid IS NOT NULL AND oldtid IS DISTINCT FROM tid THEN RAISE EXCEPTION 'Ask source mismatch' USING ERRCODE='42501'; END IF;
  tid:=COALESCE(tid,oldtid);
 END IF;
 IF tid IS NOT NULL AND EXISTS(SELECT 1 FROM ai_conversations WHERE id=tid AND owner_user_id IS NOT NULL) THEN
  IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private runtime write denied' USING ERRCODE='42501'; END IF;
  IF current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' AND
   (EXISTS(SELECT 1 FROM ai_conversations WHERE id=tid AND deleted_at IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM ask_canvas_maintenance WHERE recovery_ready)) THEN
   RAISE EXCEPTION 'Ask recovery/deletion fence' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_runtime_source() FROM PUBLIC;
CREATE TRIGGER guard_ask_runtime_source BEFORE INSERT OR UPDATE ON run_effects FOR EACH ROW EXECUTE FUNCTION guard_ask_runtime_source();
CREATE TRIGGER guard_ask_runtime_source BEFORE INSERT OR UPDATE ON agent_pending_actions FOR EACH ROW EXECUTE FUNCTION guard_ask_runtime_source();
CREATE TRIGGER guard_ask_runtime_source BEFORE INSERT OR UPDATE ON orchestration_tasks FOR EACH ROW EXECUTE FUNCTION guard_ask_runtime_source();
CREATE TRIGGER guard_ask_runtime_source BEFORE INSERT OR UPDATE ON orchestration_events FOR EACH ROW EXECUTE FUNCTION guard_ask_runtime_source();
CREATE TRIGGER guard_ask_runtime_source BEFORE INSERT OR UPDATE ON agent_executions FOR EACH ROW EXECUTE FUNCTION guard_ask_runtime_source();

DO $$ DECLARE tab text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_backup') THEN
  FOREACH tab IN ARRAY ARRAY['run_effects','agent_pending_actions','orchestration_tasks','orchestration_events','agent_executions'] LOOP
   EXECUTE format('CREATE POLICY ask_backup_read ON %I FOR SELECT TO sjcos_backup USING (true)',tab);
  END LOOP;
 END IF;
END $$;
-- node scripts/db-roles-sql.mjs run_effects agent_pending_actions orchestration_tasks orchestration_events agent_executions
-- Existing grants, unchanged; website-only erasure confers no narrow capability:
-- SELECT sjcos_grant('sjcos_agent', 'SELECT', 'run_effects');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT', 'run_effects');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'run_effects');
-- SELECT sjcos_grant('sjcos_agent', 'SELECT', 'agent_pending_actions');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT', 'agent_pending_actions');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_pending_actions');
-- SELECT sjcos_grant('sjcos_agent', 'SELECT', 'orchestration_tasks');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT', 'orchestration_tasks');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'orchestration_tasks');
-- SELECT sjcos_grant('sjcos_agent', 'SELECT', 'orchestration_events');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT', 'orchestration_events');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'orchestration_events');
-- SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'agent_executions');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE', 'agent_executions');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'agent_executions');
-- SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT', 'push_outbox');
-- SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'push_outbox');
-- SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'push_outbox');
