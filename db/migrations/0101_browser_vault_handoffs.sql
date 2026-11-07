-- Browser Phase 0b; additive and disabled. No runtime admission or remote I/O.

CREATE OR REPLACE FUNCTION browser_schema_website() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT session_user=pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.dev_agent_runs'::regclass
$$;
REVOKE ALL ON FUNCTION browser_schema_website() FROM PUBLIC;
CREATE OR REPLACE FUNCTION browser_schema_person(sid uuid, person uuid, owner_only boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT browser_schema_website() AND EXISTS(SELECT 1 FROM web_sessions s JOIN users u ON u.id=s.user_id
 WHERE s.id=sid AND s.user_id=person AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
 AND s.auth_at>clock_timestamp()-interval '12 hours' AND u.active AND
 (u.role='owner' OR (NOT owner_only AND u.role='staff' AND 'ai'=ANY(u.permissions))))
$$;
REVOKE ALL ON FUNCTION browser_schema_person(uuid,uuid,boolean) FROM PUBLIC;
-- Canonical DNS HTTPS origins only; network-policy enforces routability separately.
CREATE OR REPLACE FUNCTION browser_schema_origin(origin text) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT origin ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' AND origin !~ '[.][.]' AND length(origin)<=255
$$;
REVOKE ALL ON FUNCTION browser_schema_origin(text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION browser_schema_envelope(e jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN e IS NULL THEN NULL ELSE coalesce(jsonb_typeof(e)='object' AND e->>'version'='1'
 AND e ?& ARRAY['purpose','bindings','ciphertext','nonce','tag','wrapped_key','wrap_nonce','wrap_tag','key_id','wrap_revision']
 AND length(e->>'ciphertext') BETWEEN 4 AND 100000000
 AND e->>'nonce' ~ '^[A-Za-z0-9+/]{16}$' AND e->>'tag' ~ '^[A-Za-z0-9+/]{22}==$'
 AND e->>'wrapped_key' ~ '^[A-Za-z0-9+/]{43}=$'
 AND e->>'wrap_nonce' ~ '^[A-Za-z0-9+/]{16}$' AND e->>'wrap_tag' ~ '^[A-Za-z0-9+/]{22}==$'
 AND e->>'key_id' ~ '^[a-z0-9_-]{1,80}$' AND e->>'wrap_revision' ~ '^[1-9][0-9]{0,8}$',false) END
$$;
REVOKE ALL ON FUNCTION browser_schema_envelope(jsonb) FROM PUBLIC;
CREATE TABLE IF NOT EXISTS browser_logins (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 label varchar(80) NOT NULL CHECK(length(trim(label))>0),canonical_origin varchar(255) NOT NULL CHECK(browser_schema_origin(canonical_origin)),
 tenant_binding uuid,required_areas text[] NOT NULL CHECK(cardinality(required_areas)>0 AND array_position(required_areas,NULL) IS NULL),
 field_mapping jsonb NOT NULL CHECK(jsonb_typeof(field_mapping)='object' AND octet_length(field_mapping::text)<=65536),
 secret_envelope jsonb CHECK(browser_schema_envelope(secret_envelope)),
 revision int NOT NULL DEFAULT 1 CHECK(revision>0),disabled_at timestamptz,deleted_at timestamptz,last_used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS browser_logins_origin_label ON browser_logins(owner_user_id,canonical_origin,label) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS browser_login_access (
 login_id uuid NOT NULL REFERENCES browser_logins(id) ON DELETE RESTRICT,user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 granted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,granted_by_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT,
 granted_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,revision int NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(login_id,user_id)
);
CREATE TABLE IF NOT EXISTS browser_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 login_id uuid NOT NULL REFERENCES browser_logins(id) ON DELETE RESTRICT,origin_chain_hash bytea NOT NULL CHECK(octet_length(origin_chain_hash)=32),
 state_envelope jsonb CHECK(browser_schema_envelope(state_envelope)),revision int NOT NULL CHECK(revision>0),credential_revision int NOT NULL CHECK(credential_revision>0),
 saved_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(expires_at>saved_at AND expires_at<=saved_at+interval '30 days')
);
CREATE UNIQUE INDEX IF NOT EXISTS browser_profiles_live ON browser_profiles(user_id,login_id,origin_chain_hash) WHERE revoked_at IS NULL;
ALTER TABLE browser_tasks DROP CONSTRAINT IF EXISTS browser_tasks_login_fk;
ALTER TABLE browser_tasks ADD CONSTRAINT browser_tasks_login_fk FOREIGN KEY(vault_login_id) REFERENCES browser_logins(id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS browser_vault_counters (
 purpose text NOT NULL CHECK(purpose IN ('login','profile','request_body','read_manifest','handoff_answers','review_image','quarantine_file','saved_file')),
 key_id varchar(80) NOT NULL,wrap_count bigint NOT NULL DEFAULT 0 CHECK(wrap_count BETWEEN 0 AND 16777216),
 activated_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(purpose,key_id)
);
CREATE TABLE IF NOT EXISTS browser_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_task_id uuid NOT NULL,initiating_user_id uuid NOT NULL,source_conversation_id uuid NOT NULL,
 recipient_owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
 answer_envelope jsonb CHECK(browser_schema_envelope(answer_envelope)),snapshot_revision int NOT NULL CHECK(snapshot_revision>0),source_manifest_revision int NOT NULL CHECK(source_manifest_revision>0),
 purpose varchar(500) NOT NULL,sites_snapshot jsonb NOT NULL CHECK(octet_length(sites_snapshot::text)<=65536),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','finished','not_finished')),
 destination_conversation_id uuid UNIQUE REFERENCES ai_conversations(id) ON DELETE RESTRICT,initial_attempt_id uuid UNIQUE,current_attempt_id uuid,outcome_attempt_id uuid,
 accepted_at timestamptz,outcome_at timestamptz,revision int NOT NULL DEFAULT 1 CHECK(revision>0),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_task_id,initiating_user_id,source_conversation_id) REFERENCES browser_tasks(id,initiator_user_id,conversation_id) ON DELETE RESTRICT,
 CHECK(expires_at<=created_at+interval '30 days'),
 CHECK((state='pending' AND destination_conversation_id IS NULL AND initial_attempt_id IS NULL AND current_attempt_id IS NULL AND accepted_at IS NULL)
 OR (state='not_finished' AND accepted_at IS NULL AND initial_attempt_id IS NULL AND current_attempt_id IS NULL)
 OR (state<>'pending' AND destination_conversation_id IS NOT NULL AND initial_attempt_id IS NOT NULL AND current_attempt_id IS NOT NULL AND accepted_at IS NOT NULL)),
 CHECK(state NOT IN ('finished','not_finished') OR outcome_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS browser_handoffs_open ON browser_handoffs(source_task_id) WHERE state IN ('pending','accepted');
CREATE TABLE IF NOT EXISTS browser_handoff_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handoff_id uuid NOT NULL REFERENCES browser_handoffs(id) ON DELETE RESTRICT,
 attempt_number int NOT NULL CHECK(attempt_number>0),destination_conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT,
 recipient_owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,destination_task_id_reserved uuid NOT NULL UNIQUE,
 destination_task_id uuid UNIQUE REFERENCES browser_tasks(id) ON DELETE RESTRICT,created_by_web_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT,
 admitted_at timestamptz,predecessor_attempt_id uuid,sites_draft_revision int NOT NULL DEFAULT 1 CHECK(sites_draft_revision>0),
 sites_draft_digest bytea NOT NULL CHECK(octet_length(sites_draft_digest)=32),sites_draft jsonb CHECK(octet_length(sites_draft::text)<=65536),
 creation_idempotency uuid NOT NULL UNIQUE,body_digest bytea NOT NULL CHECK(octet_length(body_digest)=32),
 launch_intent_state text NOT NULL DEFAULT 'none' CHECK(launch_intent_state IN ('none','pending','claimed','started','failed')),
 launch_run_id uuid UNIQUE REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(handoff_id,attempt_number),UNIQUE(handoff_id,id),FOREIGN KEY(handoff_id,predecessor_attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT,
 CHECK(destination_task_id IS NULL OR (destination_task_id=destination_task_id_reserved AND admitted_at IS NOT NULL)),
 CHECK((destination_task_id IS NULL AND launch_intent_state='none') OR destination_task_id IS NOT NULL)
);
ALTER TABLE browser_handoffs DROP CONSTRAINT IF EXISTS browser_handoff_initial_fk;
ALTER TABLE browser_handoffs ADD CONSTRAINT browser_handoff_initial_fk FOREIGN KEY(id,initial_attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE browser_handoffs DROP CONSTRAINT IF EXISTS browser_handoff_current_fk;
ALTER TABLE browser_handoffs ADD CONSTRAINT browser_handoff_current_fk FOREIGN KEY(id,current_attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE browser_handoffs DROP CONSTRAINT IF EXISTS browser_handoff_outcome_fk;
ALTER TABLE browser_handoffs ADD CONSTRAINT browser_handoff_outcome_fk FOREIGN KEY(id,outcome_attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE IF NOT EXISTS browser_handoff_outcomes (
 handoff_id uuid PRIMARY KEY REFERENCES browser_handoffs(id) ON DELETE RESTRICT,source_task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,
 outcome_attempt_id uuid,outcome text NOT NULL CHECK(outcome IN ('finished','not_finished')),event_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),outcome_at timestamptz NOT NULL DEFAULT now(),
 delivery_state text NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','delivered')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(handoff_id,outcome_attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION guard_browser_vault_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l browser_logins%ROWTYPE; p users%ROWTYPE; h browser_handoffs%ROWTYPE;
BEGIN
 IF NOT browser_schema_website() THEN RAISE EXCEPTION 'BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BROWSER_RETAINED_IDENTITY' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='browser_logins' THEN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner_user_id AND role='owner' AND active) THEN RAISE EXCEPTION 'BROWSER_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NEW.secret_envelope IS NOT NULL AND (NEW.secret_envelope->>'purpose' IS DISTINCT FROM 'login' OR NEW.secret_envelope->'bindings'->>'login_id' IS DISTINCT FROM NEW.id::text OR NEW.secret_envelope->'bindings'->>'owner_user_id' IS DISTINCT FROM NEW.owner_user_id::text OR NEW.secret_envelope->'bindings'->>'origin' IS DISTINCT FROM NEW.canonical_origin OR NEW.secret_envelope->'bindings'->>'credential_revision' IS DISTINCT FROM NEW.revision::text) THEN RAISE EXCEPTION 'BROWSER_ENVELOPE_BINDING' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW.id,NEW.owner_user_id,NEW.canonical_origin) IS DISTINCT FROM ROW(OLD.id,OLD.owner_user_id,OLD.canonical_origin) OR NEW.revision<OLD.revision OR (NEW.secret_envelope IS NOT NULL AND NEW.secret_envelope IS DISTINCT FROM OLD.secret_envelope AND NEW.secret_envelope->>'ciphertext' IS DISTINCT FROM OLD.secret_envelope->>'ciphertext' AND NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'BROWSER_REVISION_REQUIRED' USING ERRCODE='42501'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='browser_login_access' THEN
  SELECT * INTO l FROM browser_logins WHERE id=NEW.login_id FOR UPDATE;
  SELECT * INTO p FROM users WHERE id=NEW.user_id;
  IF l.owner_user_id IS DISTINCT FROM NEW.granted_by_user_id OR NOT browser_schema_person(NEW.granted_by_session_id,NEW.granted_by_user_id,true) OR (NEW.revoked_at IS NULL AND (p.role<>'staff' OR NOT p.active OR NOT 'ai'=ANY(p.permissions))) THEN RAISE EXCEPTION 'BROWSER_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.login_id,NEW.user_id,NEW.granted_by_user_id) IS DISTINCT FROM ROW(OLD.login_id,OLD.user_id,OLD.granted_by_user_id) OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'BROWSER_REVISION_REQUIRED' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_profiles' THEN
  IF NEW.state_envelope IS NOT NULL AND (NEW.state_envelope->>'purpose' IS DISTINCT FROM 'profile' OR NEW.state_envelope->'bindings'->>'profile_id' IS DISTINCT FROM NEW.id::text OR NEW.state_envelope->'bindings'->>'user_id' IS DISTINCT FROM NEW.user_id::text OR NEW.state_envelope->'bindings'->>'login_id' IS DISTINCT FROM NEW.login_id::text OR NEW.state_envelope->'bindings'->>'credential_revision' IS DISTINCT FROM NEW.credential_revision::text OR NEW.state_envelope->'bindings'->>'profile_revision' IS DISTINCT FROM NEW.revision::text OR NEW.state_envelope->'bindings'->>'origin_chain_digest' IS DISTINCT FROM encode(NEW.origin_chain_hash,'hex')) THEN RAISE EXCEPTION 'BROWSER_ENVELOPE_BINDING' USING ERRCODE='23514'; END IF;
  SELECT * INTO l FROM browser_logins WHERE id=NEW.login_id FOR UPDATE;
  IF NEW.revoked_at IS NULL AND (l.disabled_at IS NOT NULL OR l.deleted_at IS NOT NULL OR l.revision<>NEW.credential_revision OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.active AND (u.id=l.owner_user_id OR (u.role='staff' AND 'ai'=ANY(u.permissions) AND EXISTS(SELECT 1 FROM browser_login_access a WHERE a.login_id=l.id AND a.user_id=u.id AND a.revoked_at IS NULL))))) THEN RAISE EXCEPTION 'BROWSER_LOGIN_REVOKED' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.user_id,NEW.login_id,NEW.origin_chain_hash,NEW.credential_revision) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.login_id,OLD.origin_chain_hash,OLD.credential_revision) THEN RAISE EXCEPTION 'BROWSER_IMMUTABLE' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_handoffs' THEN
  IF TG_OP='UPDATE' AND NEW.answer_envelope IS NULL AND OLD.answer_envelope IS NOT NULL AND (OLD.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=OLD.source_conversation_id AND to_jsonb(c)->>'deleted_at' IS NOT NULL)) AND to_jsonb(NEW)-ARRAY['answer_envelope','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['answer_envelope','updated_at'] THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.current_attempt_id IS DISTINCT FROM OLD.current_attempt_id AND OLD.current_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_handoff_attempts a JOIN browser_tasks t ON t.id=a.destination_task_id WHERE a.id=OLD.current_attempt_id AND a.handoff_id=OLD.id AND t.state IN ('closed','failed')) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_RESTART_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NEW.state IN ('accepted','finished') AND NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'BROWSER_HANDOFF_EXPIRED' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','destination_conversation_id','initial_attempt_id','current_attempt_id','outcome_attempt_id','accepted_at','outcome_at','revision','answer_envelope','sites_snapshot','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','destination_conversation_id','initial_attempt_id','current_attempt_id','outcome_attempt_id','accepted_at','outcome_at','revision','answer_envelope','sites_snapshot','updated_at']) OR NEW.revision<>OLD.revision+1 OR (OLD.destination_conversation_id IS NOT NULL AND ROW(NEW.destination_conversation_id,NEW.initial_attempt_id) IS DISTINCT FROM ROW(OLD.destination_conversation_id,OLD.initial_attempt_id)) OR OLD.state IN ('finished','not_finished') OR (NEW.answer_envelope IS DISTINCT FROM OLD.answer_envelope AND NEW.answer_envelope IS NOT NULL)) THEN RAISE EXCEPTION 'BROWSER_IMMUTABLE' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_handoff_attempts' THEN
  SELECT * INTO h FROM browser_handoffs WHERE id=NEW.handoff_id FOR UPDATE;
  IF NEW.recipient_owner_id IS DISTINCT FROM h.recipient_owner_id OR NEW.destination_conversation_id IS DISTINCT FROM h.destination_conversation_id OR NOT browser_schema_person(NEW.created_by_web_session_id,NEW.recipient_owner_id,true) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_BINDING' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['destination_task_id','admitted_at','sites_draft_revision','sites_draft_digest','sites_draft','launch_intent_state','launch_run_id','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['destination_task_id','admitted_at','sites_draft_revision','sites_draft_digest','sites_draft','launch_intent_state','launch_run_id','updated_at']) OR (OLD.destination_task_id IS NOT NULL AND NEW.destination_task_id IS DISTINCT FROM OLD.destination_task_id) OR (OLD.launch_run_id IS NOT NULL AND NEW.launch_run_id IS DISTINCT FROM OLD.launch_run_id) OR (OLD.launch_intent_state IN ('started','failed') AND NEW.launch_intent_state<>OLD.launch_intent_state)) THEN RAISE EXCEPTION 'BROWSER_IMMUTABLE' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_handoff_outcomes' AND TG_OP='UPDATE' AND to_jsonb(NEW)-ARRAY['delivery_state','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['delivery_state','updated_at'] THEN RAISE EXCEPTION 'BROWSER_IMMUTABLE' USING ERRCODE='42501';
 ELSIF TG_TABLE_NAME='browser_vault_counters' THEN
  IF TG_OP='UPDATE' AND (ROW(NEW.purpose,NEW.key_id,NEW.activated_at) IS DISTINCT FROM ROW(OLD.purpose,OLD.key_id,OLD.activated_at) OR NEW.wrap_count<>OLD.wrap_count+1 OR NEW.activated_at<=clock_timestamp()-interval '90 days') THEN RAISE EXCEPTION 'BROWSER_ROTATE_KEY' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_browser_vault_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_browser_vault_schema ON browser_logins;
CREATE TRIGGER guard_browser_vault_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_logins FOR EACH ROW EXECUTE FUNCTION guard_browser_vault_schema();
DROP TRIGGER IF EXISTS guard_browser_vault_schema ON browser_login_access;
CREATE TRIGGER guard_browser_vault_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_login_access FOR EACH ROW EXECUTE FUNCTION guard_browser_vault_schema();
DROP TRIGGER IF EXISTS guard_browser_vault_schema ON browser_profiles;
CREATE TRIGGER guard_browser_vault_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_profiles FOR EACH ROW EXECUTE FUNCTION guard_browser_vault_schema();
DROP TRIGGER IF EXISTS guard_browser_vault_schema ON browser_vault_counters;
CREATE TRIGGER guard_browser_vault_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_vault_counters FOR EACH ROW EXECUTE FUNCTION guard_browser_vault_schema();
DROP TRIGGER IF EXISTS guard_browser_vault_schema ON browser_handoffs;
CREATE TRIGGER guard_browser_vault_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_handoffs FOR EACH ROW EXECUTE FUNCTION guard_browser_vault_schema();
DROP TRIGGER IF EXISTS guard_browser_vault_schema ON browser_handoff_attempts;
CREATE TRIGGER guard_browser_vault_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_handoff_attempts FOR EACH ROW EXECUTE FUNCTION guard_browser_vault_schema();
DROP TRIGGER IF EXISTS guard_browser_vault_schema ON browser_handoff_outcomes;
CREATE TRIGGER guard_browser_vault_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_handoff_outcomes FOR EACH ROW EXECUTE FUNCTION guard_browser_vault_schema();

CREATE OR REPLACE FUNCTION fence_browser_vault_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE lid uuid; uid uuid;
BEGIN
 IF TG_TABLE_NAME='browser_logins' THEN
  IF ROW(NEW.revision,NEW.disabled_at,NEW.deleted_at,NEW.field_mapping,NEW.required_areas) IS NOT DISTINCT FROM ROW(OLD.revision,OLD.disabled_at,OLD.deleted_at,OLD.field_mapping,OLD.required_areas) THEN RETURN NEW; END IF;
  lid:=NEW.id;
 ELSIF TG_TABLE_NAME='browser_login_access' THEN lid:=NEW.login_id;uid:=NEW.user_id;
 ELSE
  IF ROW(NEW.active,NEW.role,NEW.permissions) IS NOT DISTINCT FROM ROW(OLD.active,OLD.role,OLD.permissions) THEN RETURN NEW; END IF;
  uid:=NEW.id;
  IF NOT NEW.active OR NEW.role<>'owner' THEN UPDATE browser_logins SET disabled_at=coalesce(disabled_at,now()),updated_at=now() WHERE owner_user_id=NEW.id AND disabled_at IS NULL; END IF;
 END IF;
 UPDATE browser_profiles SET revoked_at=coalesce(revoked_at,now()),updated_at=now() WHERE (lid IS NULL OR login_id=lid) AND (uid IS NULL OR user_id=uid);
 UPDATE browser_tasks SET state='closed',closed_at=coalesce(closed_at,now()),current_run_id=NULL,control_epoch=control_epoch+1,document_epoch=document_epoch+1,failure_code='BROWSER_LOGIN_REVOKED'
 WHERE vault_dependency<>'none' AND (lid IS NULL OR vault_login_id=lid) AND (uid IS NULL OR initiator_user_id=uid) AND state IN ('queued','starting','active','paused');
 INSERT INTO browser_maintenance_jobs(kind,object_id,expected_revision,due_at) SELECT 'profile_purge',id,revision,now() FROM browser_profiles WHERE revoked_at IS NOT NULL AND state_envelope IS NOT NULL AND (lid IS NULL OR login_id=lid) AND (uid IS NULL OR user_id=uid) ON CONFLICT DO NOTHING;
 UPDATE browser_viewers v SET left_at=coalesce(left_at,now()),visible_until=least(visible_until,now()),control_expires_at=now(),control_epoch=v.control_epoch+1,stream_generation=v.stream_generation+1 FROM browser_tasks t WHERE t.id=v.task_id AND t.failure_code='BROWSER_LOGIN_REVOKED' AND (lid IS NULL OR t.vault_login_id=lid) AND (uid IS NULL OR t.initiator_user_id=uid);
 UPDATE browser_task_runs r SET capability_revoked_at=coalesce(capability_revoked_at,now()) FROM browser_tasks t WHERE t.id=r.task_id AND t.failure_code='BROWSER_LOGIN_REVOKED' AND (lid IS NULL OR t.vault_login_id=lid) AND (uid IS NULL OR t.initiator_user_id=uid);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fence_browser_vault_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS fence_browser_vault_schema ON browser_logins;
CREATE TRIGGER fence_browser_vault_schema AFTER UPDATE ON browser_logins FOR EACH ROW EXECUTE FUNCTION fence_browser_vault_schema();
DROP TRIGGER IF EXISTS fence_browser_vault_schema ON browser_login_access;
CREATE TRIGGER fence_browser_vault_schema AFTER UPDATE ON browser_login_access FOR EACH ROW EXECUTE FUNCTION fence_browser_vault_schema();
DROP TRIGGER IF EXISTS fence_browser_vault_schema ON users;
CREATE TRIGGER fence_browser_vault_schema AFTER UPDATE OF active,role,permissions ON users FOR EACH ROW EXECUTE FUNCTION fence_browser_vault_schema();

-- node scripts/db-roles-sql.mjs browser_logins browser_login_access browser_profiles browser_vault_counters browser_handoffs browser_handoff_attempts browser_handoff_outcomes
-- Output: empty (all of these tables intentionally grant no narrow privileges).
DO $$ DECLARE tab text; r text; BEGIN
 FOREACH tab IN ARRAY ARRAY['browser_logins','browser_login_access','browser_profiles','browser_vault_counters','browser_handoffs','browser_handoff_attempts','browser_handoff_outcomes'] LOOP
 EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',tab);
 FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly','sjcos_browser','sjcos_browser_reader'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',tab,r); END IF;
 END LOOP;
 END LOOP; END $$;

ALTER TABLE browser_logins DROP CONSTRAINT IF EXISTS browser_login_payload;
ALTER TABLE browser_logins ADD CONSTRAINT browser_login_payload CHECK(secret_envelope IS NOT NULL OR deleted_at IS NOT NULL);
ALTER TABLE browser_profiles DROP CONSTRAINT IF EXISTS browser_profile_payload;
ALTER TABLE browser_profiles ADD CONSTRAINT browser_profile_payload CHECK(state_envelope IS NOT NULL OR revoked_at IS NOT NULL);
CREATE OR REPLACE FUNCTION browser_schema_reserve_wrap(p text,k text) RETURNS TABLE(count bigint,activated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT browser_schema_website() THEN RAISE EXCEPTION 'BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE browser_vault_counters c SET wrap_count=wrap_count+1,updated_at=now()
 WHERE c.purpose=p AND c.key_id=k AND c.wrap_count<16777216 AND c.activated_at>clock_timestamp()-interval '90 days' AND c.activated_at<=clock_timestamp()
 RETURNING c.wrap_count,c.activated_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'BROWSER_ROTATE_KEY' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION browser_schema_reserve_wrap(text,text) FROM PUBLIC;
-- Deferred consistency permits one transaction to allocate the accepted thread,
-- handoff pointers and immutable attempts without temporarily weakening FKs.
CREATE OR REPLACE FUNCTION check_browser_handoff_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h browser_handoffs%ROWTYPE;a browser_handoff_attempts%ROWTYPE;prior browser_handoff_attempts%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='browser_handoffs' THEN
  SELECT * INTO h FROM browser_handoffs WHERE id=NEW.id;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=h.recipient_owner_id AND role='owner' AND active) OR NOT EXISTS(SELECT 1 FROM browser_tasks WHERE id=h.source_task_id AND project_id IS NOT DISTINCT FROM h.project_id AND manifest_revision=h.source_manifest_revision) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_BINDING' USING ERRCODE='23514'; END IF;
  IF h.state='accepted' OR h.accepted_at IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM browser_handoff_attempts WHERE id=h.initial_attempt_id AND handoff_id=h.id AND attempt_number=1 AND predecessor_attempt_id IS NULL) OR NOT EXISTS(SELECT 1 FROM browser_handoff_attempts WHERE id=h.current_attempt_id AND handoff_id=h.id AND destination_conversation_id=h.destination_conversation_id AND recipient_owner_id=h.recipient_owner_id) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_BINDING' USING ERRCODE='23514'; END IF;
  END IF;
  IF h.state IN ('finished','not_finished') AND NOT EXISTS(SELECT 1 FROM browser_handoff_outcomes o WHERE o.handoff_id=h.id AND o.source_task_id=h.source_task_id AND o.outcome=h.state AND o.outcome_attempt_id IS NOT DISTINCT FROM h.outcome_attempt_id AND (h.accepted_at IS NULL OR o.outcome_attempt_id=h.current_attempt_id)) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_OUTCOME_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO a FROM browser_handoff_attempts WHERE id=NEW.id;
  SELECT * INTO h FROM browser_handoffs WHERE id=a.handoff_id;
  IF h.expires_at<=clock_timestamp() OR h.answer_envelope IS NULL OR NOT EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=a.destination_conversation_id AND to_jsonb(c)->>'owner_user_id'=a.recipient_owner_id::text) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_BINDING' USING ERRCODE='23514'; END IF;
  IF a.attempt_number>1 THEN
   SELECT * INTO prior FROM browser_handoff_attempts WHERE id=a.predecessor_attempt_id AND handoff_id=h.id;
   IF NOT FOUND OR prior.attempt_number<>a.attempt_number-1 OR NOT EXISTS(SELECT 1 FROM browser_tasks WHERE id=prior.destination_task_id AND state IN ('closed','failed')) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_RESTART_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSIF a.predecessor_attempt_id IS NOT NULL THEN RAISE EXCEPTION 'BROWSER_HANDOFF_BINDING' USING ERRCODE='23514'; END IF;
  IF a.destination_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_tasks WHERE id=a.destination_task_id AND initiator_user_id=a.recipient_owner_id AND conversation_id=a.destination_conversation_id) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_BINDING' USING ERRCODE='23514'; END IF;
  IF a.launch_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_task_runs WHERE task_id=a.destination_task_id AND run_id=a.launch_run_id AND initiator_user_id=a.recipient_owner_id) THEN RAISE EXCEPTION 'BROWSER_HANDOFF_BINDING' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION check_browser_handoff_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS check_browser_handoff_schema ON browser_handoffs;
CREATE CONSTRAINT TRIGGER check_browser_handoff_schema AFTER INSERT OR UPDATE ON browser_handoffs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_browser_handoff_schema();
DROP TRIGGER IF EXISTS check_browser_handoff_schema ON browser_handoff_attempts;
CREATE CONSTRAINT TRIGGER check_browser_handoff_schema AFTER INSERT OR UPDATE ON browser_handoff_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_browser_handoff_schema();
-- Safe human-web metadata projection. This never returns a username, envelope,
-- password or cookie; the service/agent logins have no EXECUTE privilege.
CREATE OR REPLACE FUNCTION browser_schema_login_metadata(sid uuid) RETURNS TABLE(id uuid,label varchar,origin varchar,revision int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE person uuid;
BEGIN
 SELECT user_id INTO person FROM web_sessions WHERE web_sessions.id=sid;
 IF NOT browser_schema_person(sid,person,false) THEN RAISE EXCEPTION 'BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT l.id,l.label,l.canonical_origin,l.revision FROM browser_logins l JOIN users u ON u.id=person WHERE l.disabled_at IS NULL AND l.deleted_at IS NULL
 AND (l.owner_user_id=person OR ('ai'=ANY(u.permissions) AND l.required_areas<@u.permissions AND EXISTS(SELECT 1 FROM browser_login_access a WHERE a.login_id=l.id AND a.user_id=person AND a.revoked_at IS NULL)));
END $$;
REVOKE ALL ON FUNCTION browser_schema_login_metadata(uuid) FROM PUBLIC;
