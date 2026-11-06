-- Shared Browser/Canvas prerequisite. Additive only; 0105 owns thread privacy.
-- Trust the table-owner LOGIN (session_user), never a caller-writable GUC or
-- SECURITY DEFINER current_user. No service functions/runtime enabled by 0100.
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'business';
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS launch_source text NOT NULL DEFAULT 'legacy';
ALTER TABLE dev_agent_runs ALTER COLUMN launch_source SET DEFAULT 'background';
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS continuation_of_run_id uuid REFERENCES dev_agent_runs(id) ON DELETE RESTRICT;
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS browser_task_id uuid;
ALTER TABLE dev_agent_runs DROP CONSTRAINT IF EXISTS dev_agent_runs_launch_source_check;
ALTER TABLE dev_agent_runs ADD CONSTRAINT dev_agent_runs_launch_source_check CHECK (launch_source IN ('legacy','panel_web','panel_mobile','panel_voice','telegram','background'));
ALTER TABLE dev_agent_runs DROP CONSTRAINT IF EXISTS dev_agent_runs_profile_check;
ALTER TABLE dev_agent_runs ADD CONSTRAINT dev_agent_runs_profile_check CHECK (profile IN ('operator','business','browser'));
CREATE INDEX IF NOT EXISTS dev_agent_runs_continuation_idx ON dev_agent_runs(continuation_of_run_id);

CREATE TABLE IF NOT EXISTS web_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 auth_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>0), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>auth_at)
);
CREATE INDEX IF NOT EXISTS web_sessions_user_idx ON web_sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS browser_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), initiator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT,
 project_id uuid REFERENCES projects(id) ON DELETE RESTRICT, lead_slug text REFERENCES leads(slug) ON DELETE RESTRICT,
 purpose varchar(500) NOT NULL CHECK(length(trim(purpose))>0), required_areas text[] NOT NULL,
 origins jsonb NOT NULL CHECK(jsonb_typeof(origins)='object'), manifest_revision int NOT NULL DEFAULT 1 CHECK(manifest_revision>0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','starting','active','paused','closed','failed')),
 private boolean NOT NULL DEFAULT false, adapter_id text, adapter_version text,
 current_run_id uuid REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,
 privacy_mode text NOT NULL DEFAULT 'public' CHECK(privacy_mode IN ('public','private','delegated_secret')),
 vault_dependency text NOT NULL DEFAULT 'none' CHECK(vault_dependency IN ('none','fill','restore')),
 vault_login_id uuid, vault_revision int CHECK(vault_revision>0), vault_context_generation bigint NOT NULL DEFAULT 0 CHECK(vault_context_generation>=0),
 initiating_web_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT,
 bridge_nonce_seq bigint NOT NULL DEFAULT 0 CHECK(bridge_nonce_seq>=0), controller_boot_id uuid,
 queue_requested_at timestamptz NOT NULL DEFAULT now(), queue_offer_expires_at timestamptz, queue_expires_at timestamptz,
 admission_reservation_id uuid, document_epoch bigint NOT NULL DEFAULT 0 CHECK(document_epoch>=0),
 control_epoch bigint NOT NULL DEFAULT 0 CHECK(control_epoch>=0), controller_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 controller_device_hash bytea CHECK(octet_length(controller_device_hash)=32), control_token_hash bytea CHECK(octet_length(control_token_hash)=32),
 control_expires_at timestamptz, last_activity_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, failure_code varchar(80),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(project_id IS NULL OR lead_slug IS NULL), CHECK(private=(privacy_mode<>'public')),
 CHECK(cardinality(required_areas)>0 AND array_position(required_areas,NULL) IS NULL AND required_areas <@ ARRAY['today','inbox','comms','chat','leads','projects','subs','vendors','site','newsletter','catalog','compliance','warranty','marketing','engine','estimates','invoices','purchase_orders','change_orders','bidding','cost_book','money','ai']::text[]),
 CHECK((vault_dependency='none' AND vault_login_id IS NULL AND vault_revision IS NULL) OR (vault_dependency<>'none' AND vault_login_id IS NOT NULL AND vault_revision IS NOT NULL)),
 CHECK(state NOT IN ('closed','failed') OR closed_at IS NOT NULL), UNIQUE(id,initiator_user_id,conversation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS browser_tasks_live_user_idx ON browser_tasks(initiator_user_id) WHERE state IN ('queued','starting','active','paused');
CREATE INDEX IF NOT EXISTS browser_tasks_state_idx ON browser_tasks(state,last_activity_at);
CREATE INDEX IF NOT EXISTS browser_tasks_run_idx ON browser_tasks(current_run_id);
CREATE INDEX IF NOT EXISTS browser_tasks_thread_idx ON browser_tasks(conversation_id,created_at);
ALTER TABLE dev_agent_runs DROP CONSTRAINT IF EXISTS dev_agent_runs_browser_task_id_fkey;
ALTER TABLE dev_agent_runs ADD CONSTRAINT dev_agent_runs_browser_task_id_fkey FOREIGN KEY(browser_task_id) REFERENCES browser_tasks(id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS browser_task_runs (
 task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,
 run_id uuid NOT NULL UNIQUE REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,
 initiator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT,
 profile text NOT NULL DEFAULT 'browser' CHECK(profile='browser'), launch_source text NOT NULL DEFAULT 'panel_web' CHECK(launch_source='panel_web'),
 cli_session_id text, capability_hash bytea CHECK(octet_length(capability_hash)=32), capability_expires_at timestamptz, capability_revoked_at timestamptz,
 launch_web_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT,
 disposition text NOT NULL DEFAULT 'running' CHECK(disposition IN ('running','waiting','completed','crashed','stopped')),
 attached_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,run_id), UNIQUE(task_id,run_id,initiator_user_id),
 FOREIGN KEY(task_id,initiator_user_id,conversation_id) REFERENCES browser_tasks(id,initiator_user_id,conversation_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS browser_viewers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,
 web_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 device_hash bytea NOT NULL CHECK(octet_length(device_hash)=32), device_secret_hash bytea NOT NULL CHECK(octet_length(device_secret_hash)=32),
 joined_role text NOT NULL CHECK(joined_role IN ('initiator','owner_review')), joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
 visible_until timestamptz NOT NULL, control_expires_at timestamptz, stream_id uuid NOT NULL DEFAULT gen_random_uuid(),
 stream_generation bigint NOT NULL DEFAULT 1 CHECK(stream_generation>0), last_frame_id bigint, document_epoch bigint NOT NULL DEFAULT 0 CHECK(document_epoch>=0),
 control_epoch bigint NOT NULL DEFAULT 0 CHECK(control_epoch>=0), input_seq bigint NOT NULL DEFAULT 0 CHECK(input_seq>=0), input_digest bytea CHECK(octet_length(input_digest)=32),
 owner_private_view_authorized_at timestamptz, owner_private_context_generation bigint, owner_private_authorization_revision int,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,task_id,web_session_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS browser_viewers_live_device_idx ON browser_viewers(task_id,web_session_id,device_hash) WHERE left_at IS NULL;
CREATE TABLE IF NOT EXISTS browser_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, run_id uuid NOT NULL, initiator_user_id uuid NOT NULL,
 epoch bigint NOT NULL CHECK(epoch>=0), seq bigint NOT NULL CHECK(seq>0), idempotency_key uuid NOT NULL,
 input_digest bytea NOT NULL CHECK(octet_length(input_digest)=32),
 operation text NOT NULL CHECK(operation IN ('navigate','observe','click','scroll','back','forward','reload','prepare','close','fill_login','takeover_input','pause','resume')),
 state text NOT NULL DEFAULT 'accepted' CHECK(state IN ('accepted','running','succeeded','failed','unknown')),
 safe_result jsonb, viewer_id uuid, web_session_id uuid REFERENCES web_sessions(id) ON DELETE RESTRICT,
 body_digest bytea CHECK(octet_length(body_digest)=32), stream_id uuid, stream_generation bigint, frame_id bigint, document_epoch bigint, control_epoch bigint,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,idempotency_key), UNIQUE(task_id,epoch,seq),
 FOREIGN KEY(task_id,run_id,initiator_user_id) REFERENCES browser_task_runs(task_id,run_id,initiator_user_id) ON DELETE RESTRICT,
 FOREIGN KEY(viewer_id,task_id,web_session_id) REFERENCES browser_viewers(id,task_id,web_session_id) ON DELETE RESTRICT,
 CHECK((viewer_id IS NULL AND web_session_id IS NULL) OR (viewer_id IS NOT NULL AND web_session_id IS NOT NULL AND body_digest IS NOT NULL AND stream_id IS NOT NULL AND stream_generation IS NOT NULL AND frame_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS browser_web_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid REFERENCES browser_tasks(id) ON DELETE RESTRICT,
 session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT, viewer_id uuid REFERENCES browser_viewers(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN ('admit','join','leave','presence','takeover','release','pause','resume','close','review','watch','publish_manifest')),
 idempotency_key uuid NOT NULL, body_digest bytea NOT NULL CHECK(octet_length(body_digest)=32), safe_result jsonb,
 state text NOT NULL DEFAULT 'accepted' CHECK(state IN ('accepted','running','succeeded','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 CHECK(expires_at<=created_at+interval '30 days'), UNIQUE(session_id,operation,idempotency_key)
);
CREATE TABLE IF NOT EXISTS browser_maintenance_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('cleanup','reconcile','revoke','profile_purge','file_publish')),
 object_id uuid NOT NULL, expected_revision bigint NOT NULL CHECK(expected_revision>=0), due_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','done','failed')),
 attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0), lease_boot uuid, lease_until timestamptz, safe_code varchar(80),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,object_id,expected_revision)
);
CREATE INDEX IF NOT EXISTS browser_maintenance_due_idx ON browser_maintenance_jobs(state,due_at);
CREATE TABLE IF NOT EXISTS browser_read_manifests (
 manifest_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,
 revision int NOT NULL CHECK(revision>0), v int NOT NULL DEFAULT 1 CHECK(v=1), task_origins_revision int NOT NULL CHECK(task_origins_revision>0),
 public_entries jsonb, private_entries_ciphertext bytea, envelope jsonb, manifest_hmac bytea NOT NULL CHECK(octet_length(manifest_hmac)=32), initial_entry_id uuid NOT NULL,
 authorization_state text NOT NULL DEFAULT 'pending' CHECK(authorization_state IN ('pending','approved','denied','expired')),
 release_action_id uuid, approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT, approved_by_session_id uuid REFERENCES web_sessions(id) ON DELETE RESTRICT,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,revision), CHECK((public_entries IS NOT NULL AND private_entries_ciphertext IS NULL AND envelope IS NULL) OR (public_entries IS NULL AND private_entries_ciphertext IS NOT NULL AND envelope IS NOT NULL)),
 CHECK(authorization_state<>'approved' OR (approved_by_user_id IS NOT NULL AND approved_by_session_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS browser_read_uses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, revision int NOT NULL, entry_id uuid NOT NULL,
 flow_nonce uuid NOT NULL, use_count bigint NOT NULL DEFAULT 1 CHECK(use_count>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,revision,entry_id,flow_nonce), FOREIGN KEY(task_id,revision) REFERENCES browser_read_manifests(task_id,revision) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS browser_owner_views (
 claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), viewing_owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 web_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT,
 local_owned_conversation_id uuid REFERENCES ai_conversations(id) ON DELETE RESTRICT, task_id uuid NOT NULL, action_id uuid,
 initiator_user_id uuid NOT NULL, conversation_id uuid NOT NULL, original_run_id uuid NOT NULL,
 revision int NOT NULL DEFAULT 1 CHECK(revision>0), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,original_run_id,initiator_user_id) REFERENCES browser_task_runs(task_id,run_id,initiator_user_id) ON DELETE RESTRICT,
 FOREIGN KEY(task_id,initiator_user_id,conversation_id) REFERENCES browser_tasks(id,initiator_user_id,conversation_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS browser_audit (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, event_id uuid NOT NULL UNIQUE,
 task_id uuid REFERENCES browser_tasks(id) ON DELETE RESTRICT, run_id uuid REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,
 actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 event text NOT NULL CHECK(event IN ('task_admitted','run_attached','run_ended','task_transition','viewer_joined','viewer_left','session_revoked','command_begin','command_finish','manifest_published','read_consumed','checkpoint','maintenance')),
 canonical_origin varchar(255), object_id uuid, revision bigint, result_code varchar(80) NOT NULL, at timestamptz NOT NULL DEFAULT now(),
 previous_digest bytea NOT NULL CHECK(octet_length(previous_digest)=32), digest bytea NOT NULL CHECK(octet_length(digest)=32),
 key_id varchar(80) NOT NULL, hmac bytea NOT NULL CHECK(octet_length(hmac)=32), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS browser_audit_task_idx ON browser_audit(task_id,at);
CREATE INDEX IF NOT EXISTS browser_audit_at_idx ON browser_audit(at);
CREATE INDEX IF NOT EXISTS browser_audit_event_idx ON browser_audit(event,result_code,at);
CREATE TABLE IF NOT EXISTS browser_audit_heads (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), seq bigint NOT NULL DEFAULT 0 CHECK(seq>=0), digest bytea NOT NULL CHECK(octet_length(digest)=32),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS browser_audit_checkpoints (
 checkpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), through_seq bigint NOT NULL CHECK(through_seq>=0), digest bytea NOT NULL CHECK(octet_length(digest)=32),
 key_id varchar(80) NOT NULL, signature bytea NOT NULL CHECK(octet_length(signature)>0), external_ack_id text NOT NULL,
 external_ack_at timestamptz NOT NULL, retained_boundary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION guard_ask_run_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE website name; person users%ROWTYPE; parent dev_agent_runs%ROWTYPE;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO website FROM pg_class WHERE oid='public.dev_agent_runs'::regclass;
 IF TG_OP='DELETE' THEN
  IF OLD.launch_source IN ('panel_web','panel_mobile','panel_voice') OR session_user<>website THEN
   RAISE EXCEPTION 'run identity is retained' USING ERRCODE='42501';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.principal_user_id,NEW.conversation_id,NEW.profile,NEW.launch_source,NEW.continuation_of_run_id,NEW.browser_task_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.principal_user_id,OLD.conversation_id,OLD.profile,OLD.launch_source,OLD.continuation_of_run_id,OLD.browser_task_id,OLD.created_at) THEN
   RAISE EXCEPTION 'run identity is immutable' USING ERRCODE='42501';
  END IF;
  IF session_user<>website AND (OLD.launch_source<>'background' OR OLD.principal_user_id IS NOT NULL OR OLD.conversation_id IS NOT NULL OR OLD.profile<>'business') THEN
   RAISE EXCEPTION 'narrow login cannot alter admitted run' USING ERRCODE='42501';
  END IF;
  -- A narrow background retry cannot replace prompt, CLI session, grants or tool config.
  IF session_user<>website AND
    (to_jsonb(NEW)-ARRAY['status','activity','updated_at','answer','cost_usd','context_tokens','token_usage','pid','spoken_answer'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','activity','updated_at','answer','cost_usd','context_tokens','token_usage','pid','spoken_answer']) THEN
   RAISE EXCEPTION 'background retry may only advance runtime fields' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF session_user<>website AND (NEW.launch_source<>'background' OR NEW.principal_user_id IS NOT NULL OR NEW.conversation_id IS NOT NULL OR NEW.profile<>'business' OR NEW.continuation_of_run_id IS NOT NULL OR NEW.browser_task_id IS NOT NULL) THEN
  RAISE EXCEPTION 'narrow login may only insert unbound background runs' USING ERRCODE='42501';
 END IF;
 IF NEW.launch_source IN ('panel_web','panel_mobile','panel_voice') THEN
  SELECT * INTO person FROM users WHERE id=NEW.principal_user_id FOR SHARE;
  IF NEW.conversation_id IS NULL OR NOT FOUND OR NOT person.active OR person.role NOT IN ('owner','staff')
     OR (person.role='staff' AND (NEW.profile='operator' OR NOT 'ai'=ANY(coalesce(person.permissions,'{}')))) THEN
   RAISE EXCEPTION 'invalid Ask principal' USING ERRCODE='42501';
  END IF;
 END IF;
 IF NEW.profile='operator' AND NEW.launch_source<>'legacy' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.principal_user_id AND role='owner' AND active) THEN
  RAISE EXCEPTION 'operator requires active owner' USING ERRCODE='42501';
 END IF;
 IF NEW.profile='browser' AND (NEW.launch_source<>'panel_web' OR NEW.browser_task_id IS NULL OR NOT NEW.with_mcp) THEN
  RAISE EXCEPTION 'BROWSER_ATTENDED_ONLY' USING ERRCODE='42501';
 END IF;
 IF NEW.browser_task_id IS NOT NULL AND (NEW.profile<>'browser' OR NOT EXISTS (
  SELECT 1 FROM browser_tasks t WHERE t.id=NEW.browser_task_id AND t.initiator_user_id=NEW.principal_user_id
   AND t.conversation_id=NEW.conversation_id AND t.state IN ('queued','starting','active','paused'))) THEN
  RAISE EXCEPTION 'invalid browser run task identity' USING ERRCODE='42501';
 END IF;
 IF session_user<>website THEN NEW.created_at:=clock_timestamp(); END IF;
 IF NEW.continuation_of_run_id IS NOT NULL THEN
  SELECT * INTO parent FROM dev_agent_runs WHERE id=NEW.continuation_of_run_id FOR SHARE;
  IF NOT FOUND OR parent.status NOT IN ('pending','running') OR NEW.launch_source NOT IN ('panel_web','panel_mobile','panel_voice') OR
   ROW(parent.principal_user_id,parent.conversation_id,parent.launch_source,parent.profile,parent.browser_task_id)
   IS DISTINCT FROM ROW(NEW.principal_user_id,NEW.conversation_id,NEW.launch_source,NEW.profile,NEW.browser_task_id) THEN
   RAISE EXCEPTION 'invalid human turn continuation' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_run_identity() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_ask_run_identity ON dev_agent_runs;
CREATE TRIGGER guard_ask_run_identity BEFORE INSERT OR UPDATE OR DELETE ON dev_agent_runs FOR EACH ROW EXECUTE FUNCTION guard_ask_run_identity();

-- Defense in depth for private records even if a later broad grant drifts.
CREATE OR REPLACE FUNCTION guard_browser_core_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE website name; s web_sessions%ROWTYPE; r dev_agent_runs%ROWTYPE; identity_keys text[]; old_identity jsonb; new_identity jsonb;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO website FROM pg_class WHERE oid='public.dev_agent_runs'::regclass;
 IF session_user<>website THEN RAISE EXCEPTION 'private browser write requires website login' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME IN ('browser_audit','browser_audit_checkpoints') AND TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'browser evidence is append only' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' THEN
  identity_keys := CASE TG_TABLE_NAME
   WHEN 'browser_viewers' THEN ARRAY['id','task_id','web_session_id','user_id','device_hash','device_secret_hash','joined_role','joined_at','created_at']
   WHEN 'browser_commands' THEN ARRAY['id','task_id','run_id','initiator_user_id','epoch','seq','idempotency_key','input_digest','operation','viewer_id','web_session_id','body_digest','stream_id','stream_generation','frame_id','document_epoch','control_epoch','created_at']
   WHEN 'browser_web_commands' THEN ARRAY['id','task_id','session_id','viewer_id','operation','idempotency_key','body_digest','created_at','expires_at']
   WHEN 'browser_owner_views' THEN ARRAY['claim_id','viewing_owner_user_id','web_session_id','local_owned_conversation_id','task_id','action_id','initiator_user_id','conversation_id','original_run_id','created_at']
   WHEN 'browser_read_uses' THEN ARRAY['id','task_id','revision','entry_id','flow_nonce','created_at']
   ELSE ARRAY[]::text[] END;
  SELECT jsonb_object_agg(key,value) INTO old_identity FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(identity_keys);
  SELECT jsonb_object_agg(key,value) INTO new_identity FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(identity_keys);
  IF old_identity IS DISTINCT FROM new_identity THEN RAISE EXCEPTION 'browser identity is immutable' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='web_sessions' THEN
   IF ROW(NEW.id,NEW.user_id,NEW.auth_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.auth_at,OLD.created_at) THEN RAISE EXCEPTION 'session identity is immutable' USING ERRCODE='42501'; END IF;
   IF NEW.generation<OLD.generation OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION 'session cannot be revived' USING ERRCODE='42501'; END IF;
  ELSIF TG_TABLE_NAME='browser_tasks' THEN
   IF ROW(NEW.id,NEW.initiator_user_id,NEW.conversation_id,NEW.initiating_web_session_id,NEW.required_areas,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.initiator_user_id,OLD.conversation_id,OLD.initiating_web_session_id,OLD.required_areas,OLD.created_at)
    OR NEW.control_epoch<OLD.control_epoch OR NEW.document_epoch<OLD.document_epoch OR NEW.bridge_nonce_seq<OLD.bridge_nonce_seq
    OR (OLD.private AND NOT NEW.private) OR (OLD.state IN ('closed','failed') AND NEW.state<>OLD.state)
    OR ROW(NEW.vault_dependency,NEW.vault_login_id,NEW.vault_revision,NEW.vault_context_generation) IS DISTINCT FROM ROW(OLD.vault_dependency,OLD.vault_login_id,OLD.vault_revision,OLD.vault_context_generation) THEN
    RAISE EXCEPTION 'task binding requires fenced command' USING ERRCODE='42501';
   END IF;
  ELSIF TG_TABLE_NAME='browser_task_runs' THEN
   IF ROW(NEW.task_id,NEW.run_id,NEW.initiator_user_id,NEW.conversation_id,NEW.profile,NEW.launch_source,NEW.launch_web_session_id,NEW.attached_at)
    IS DISTINCT FROM ROW(OLD.task_id,OLD.run_id,OLD.initiator_user_id,OLD.conversation_id,OLD.profile,OLD.launch_source,OLD.launch_web_session_id,OLD.attached_at) THEN
    RAISE EXCEPTION 'task run identity is immutable' USING ERRCODE='42501'; END IF;
  ELSIF TG_TABLE_NAME='browser_read_manifests' THEN
   IF OLD.authorization_state='approved' AND
    (to_jsonb(NEW)-ARRAY['revoked_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','updated_at']) THEN
    RAISE EXCEPTION 'approved manifest is immutable' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='browser_tasks' THEN
  SELECT * INTO s FROM web_sessions WHERE id=NEW.initiating_web_session_id;
  IF s.user_id IS DISTINCT FROM NEW.initiator_user_id OR s.revoked_at IS NOT NULL OR s.expires_at<=now() THEN RAISE EXCEPTION 'invalid task session' USING ERRCODE='42501'; END IF;
  IF NEW.current_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_task_runs WHERE task_id=NEW.id AND run_id=NEW.current_run_id AND disposition='running') THEN RAISE EXCEPTION 'invalid current run pointer' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_task_runs' THEN
  SELECT * INTO r FROM dev_agent_runs WHERE id=NEW.run_id;
  SELECT * INTO s FROM web_sessions WHERE id=NEW.launch_web_session_id;
  IF ROW(r.browser_task_id,r.principal_user_id,r.conversation_id,r.profile,r.launch_source) IS DISTINCT FROM ROW(NEW.task_id,NEW.initiator_user_id,NEW.conversation_id,'browser'::text,'panel_web'::text)
    OR s.user_id IS DISTINCT FROM NEW.initiator_user_id OR (NEW.capability_revoked_at IS NULL AND (s.revoked_at IS NOT NULL OR s.expires_at<=now())) THEN RAISE EXCEPTION 'invalid attached run binding' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_viewers' THEN
  SELECT * INTO s FROM web_sessions WHERE id=NEW.web_session_id;
  IF s.user_id IS DISTINCT FROM NEW.user_id OR (NEW.left_at IS NULL AND (s.revoked_at IS NOT NULL OR s.expires_at<=now())) OR NEW.visible_until>s.expires_at OR NEW.control_expires_at>s.expires_at THEN RAISE EXCEPTION 'invalid viewer session' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_browser_core_write() FROM PUBLIC;
DO $$ DECLARE t text; role_name text; BEGIN
 FOREACH t IN ARRAY ARRAY['web_sessions','browser_tasks','browser_task_runs','browser_commands','browser_viewers','browser_web_commands','browser_maintenance_jobs','browser_read_manifests','browser_read_uses','browser_owner_views','browser_audit','browser_audit_heads','browser_audit_checkpoints'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS guard_browser_core_write ON %I',t);
  EXECUTE format('CREATE TRIGGER guard_browser_core_write BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_browser_core_write()',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  FOREACH role_name IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly','sjcos_browser'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;
-- db-roles-sql.mjs output for every 0100 private table: empty, intentionally.
-- All entries have note and no narrow privileges; backup reads via pg_read_all_data.

-- No browser activation in Phase 0; owner may enable only after runtime gates.
INSERT INTO app_settings(key,value) VALUES
 ('browser.enabled','false'),('browser.staff_enabled','false'),('browser.vault_enabled','false'),
 ('browser.files_enabled','false'),('browser.final_steps_enabled','false'),('browser.permit_handoff_enabled','false')
 ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION guard_browser_audit_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'browser evidence is append only' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION guard_browser_audit_truncate() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_browser_audit_truncate ON browser_audit;
CREATE TRIGGER guard_browser_audit_truncate BEFORE TRUNCATE ON browser_audit FOR EACH STATEMENT EXECUTE FUNCTION guard_browser_audit_truncate();
DROP TRIGGER IF EXISTS guard_browser_audit_truncate ON browser_audit_checkpoints;
CREATE TRIGGER guard_browser_audit_truncate BEFORE TRUNCATE ON browser_audit_checkpoints FOR EACH STATEMENT EXECUTE FUNCTION guard_browser_audit_truncate();

-- Revocation is fenced atomically whichever authentication path records it.
-- 0102 adds pending-action staling when that relation exists; do not reference
-- future schema or silently promote a legacy JWT in this prerequisite.
CREATE OR REPLACE FUNCTION fence_browser_web_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.revoked_at IS NOT NULL OR NEW.generation<>OLD.generation OR NEW.expires_at<=now() THEN
  UPDATE browser_task_runs SET capability_revoked_at=coalesce(capability_revoked_at,now()),updated_at=now() WHERE launch_web_session_id=NEW.id;
  UPDATE browser_viewers SET left_at=coalesce(left_at,now()),visible_until=least(visible_until,now(),NEW.expires_at),control_expires_at=least(now(),NEW.expires_at),
   control_epoch=control_epoch+1,stream_generation=stream_generation+1,updated_at=now() WHERE web_session_id=NEW.id AND left_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fence_browser_web_session() FROM PUBLIC;
DROP TRIGGER IF EXISTS fence_browser_web_session ON web_sessions;
CREATE TRIGGER fence_browser_web_session AFTER UPDATE OF revoked_at,generation,expires_at ON web_sessions FOR EACH ROW EXECUTE FUNCTION fence_browser_web_session();
CREATE OR REPLACE FUNCTION revoke_user_web_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE web_sessions SET revoked_at=coalesce(revoked_at,now()),generation=generation+1,updated_at=now()
  WHERE user_id=NEW.user_id AND auth_at<NEW.revoked_before AND revoked_at IS NULL;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION revoke_user_web_sessions() FROM PUBLIC;
DROP TRIGGER IF EXISTS revoke_user_web_sessions ON session_revocations;
CREATE TRIGGER revoke_user_web_sessions AFTER INSERT OR UPDATE OF revoked_before ON session_revocations FOR EACH ROW EXECUTE FUNCTION revoke_user_web_sessions();
