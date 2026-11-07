-- Browser Phase 1 A0. Additive seam; does not activate a runtime.
ALTER TABLE browser_tasks ADD COLUMN IF NOT EXISTS task_kind text NOT NULL DEFAULT 'public_research' CHECK(task_kind IN ('public_research','permit','invoice','purchase'));
ALTER TABLE browser_tasks ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE browser_tasks ADD COLUMN IF NOT EXISTS context_generation bigint NOT NULL DEFAULT 0 CHECK(context_generation>=0);
ALTER TABLE browser_tasks ADD COLUMN IF NOT EXISTS confirmed_answers jsonb NOT NULL DEFAULT '[]';
ALTER TABLE browser_tasks ADD COLUMN IF NOT EXISTS attention text NOT NULL DEFAULT 'none' CHECK(attention IN ('none','person','joe','check_result'));
ALTER TABLE browser_tasks ADD COLUMN IF NOT EXISTS listener_generation bigint NOT NULL DEFAULT 0 CHECK(listener_generation>=0);
ALTER TABLE browser_viewers ADD COLUMN IF NOT EXISTS last_frame_uuid uuid;
ALTER TABLE browser_commands ADD COLUMN IF NOT EXISTS frame_uuid uuid;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='browser_commands'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%frame_id%' LOOP
 EXECUTE format('ALTER TABLE browser_commands DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE browser_commands DROP CONSTRAINT IF EXISTS browser_commands_viewer_uuid_binding;
ALTER TABLE browser_commands ADD CONSTRAINT browser_commands_viewer_uuid_binding CHECK(
 (viewer_id IS NULL AND web_session_id IS NULL AND frame_uuid IS NULL) OR
 (viewer_id IS NOT NULL AND web_session_id IS NOT NULL AND body_digest IS NOT NULL AND stream_id IS NOT NULL AND stream_generation>0 AND frame_uuid IS NOT NULL AND document_epoch>=0 AND control_epoch>=0));
ALTER TABLE browser_web_commands DROP CONSTRAINT IF EXISTS browser_web_commands_operation_check;
ALTER TABLE browser_web_commands ADD CONSTRAINT browser_web_commands_operation_check CHECK(operation IN ('admit','join','leave','presence','takeover','release','pause','resume','close','review','watch','publish_manifest','fresh_browser','input','attach_run','capability','queue','offer','accept_offer'));
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS trust_profile text NOT NULL DEFAULT 'ordinary' CHECK(trust_profile IN ('ordinary','browser'));
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS browser_task_id uuid REFERENCES browser_tasks(id) ON DELETE RESTRICT;
ALTER TABLE ai_messages DROP CONSTRAINT IF EXISTS ai_messages_browser_provenance;
ALTER TABLE ai_messages ADD CONSTRAINT ai_messages_browser_provenance CHECK((trust_profile='browser')=(browser_task_id IS NOT NULL));
INSERT INTO app_settings(key,value) VALUES('browser.pilot_user_ids','[]'),('browser.takeover_confirm_suppressed_user_ids','[]') ON CONFLICT DO NOTHING;
-- Roster/preference and purpose keys are owner-only reads too.
DROP POLICY IF EXISTS browser_settings_private ON app_settings;
CREATE POLICY browser_settings_private ON app_settings AS RESTRICTIVE FOR SELECT USING(
 key NOT LIKE 'browser.%' OR session_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='app_settings'::regclass)));

CREATE OR REPLACE FUNCTION browser_p1_iso(ts timestamptz) RETURNS text LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
REVOKE ALL ON FUNCTION browser_p1_iso(timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION browser_p1_website() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN IF NOT browser_schema_website() THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF; END $$;
CREATE OR REPLACE FUNCTION browser_p1_service() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN IF session_user<>'sjcos_browser' THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF; END $$;
CREATE OR REPLACE FUNCTION browser_p1_safe(t browser_tasks) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',t.id,'current_run_id',t.current_run_id,'state',t.state,'private',t.private,'privacy_mode',t.privacy_mode,'vault_dependency',t.vault_dependency,'manifest_revision',t.manifest_revision,'read_manifest_revision',coalesce((SELECT max(revision) FROM browser_read_manifests WHERE task_id=t.id),0),'control_epoch',t.control_epoch,'document_epoch',t.document_epoch,'controller_boot_id',t.controller_boot_id,'context_generation',t.context_generation,'revision',t.revision,'attention',t.attention)
$$;
CREATE OR REPLACE FUNCTION browser_p1_person(t browser_tasks,sid uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE s web_sessions; u users; pilots jsonb;
BEGIN
 SELECT * INTO s FROM web_sessions WHERE id=sid;
 SELECT * INTO u FROM users WHERE id=s.user_id;
 IF s.id IS NULL OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp() OR NOT coalesce(u.active,false) OR u.role NOT IN ('owner','staff') THEN RAISE EXCEPTION 'BROWSER_AUTH_EXPIRED' USING ERRCODE='42501'; END IF;
 IF u.role='staff' AND NOT (coalesce(u.permissions,'{}') @> t.required_areas) THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='browser.enabled' AND value='true') OR
 (u.role='staff' AND NOT EXISTS(SELECT 1 FROM app_settings WHERE key='browser.staff_enabled' AND value='true')) THEN RAISE EXCEPTION 'BROWSER_DISABLED' USING ERRCODE='42501'; END IF;
 BEGIN SELECT value::jsonb INTO pilots FROM app_settings WHERE key='browser.pilot_user_ids'; EXCEPTION WHEN OTHERS THEN pilots:='[]'; END;
 IF jsonb_typeof(pilots) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(pilots) e WHERE jsonb_typeof(e)<>'string' OR e #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') OR NOT coalesce(pilots @> jsonb_build_array(u.id::text),false) THEN RAISE EXCEPTION 'BROWSER_DISABLED' USING ERRCODE='42501'; END IF;
 IF t.id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=t.conversation_id AND c.owner_user_id=t.initiator_user_id AND c.deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM ask_canvas_maintenance WHERE recovery_ready)) THEN RAISE EXCEPTION 'BROWSER_REVOKED' USING ERRCODE='42501'; END IF;
 IF u.id<>t.initiator_user_id AND u.role<>'owner' THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 RETURN u.id;
END $$;
CREATE OR REPLACE FUNCTION browser_p1_viewer(t browser_tasks,vid uuid) RETURNS browser_viewers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE v browser_viewers;
BEGIN
 SELECT * INTO v FROM browser_viewers WHERE id=vid AND task_id=t.id AND left_at IS NULL;
 IF v.id IS NULL OR v.visible_until<=clock_timestamp() THEN RAISE EXCEPTION 'BROWSER_ATTENDED_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_person(t,v.web_session_id);
 IF v.joined_role='owner_review' AND NOT EXISTS(SELECT 1 FROM browser_owner_views WHERE task_id=t.id AND viewing_owner_user_id=v.user_id AND web_session_id=v.web_session_id AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'BROWSER_REVOKED' USING ERRCODE='42501'; END IF;
 RETURN v;
END $$;
-- Proofs are persisted by the permission-checked website adapter in the SAME
-- transaction. UUIDs and client hashes alone are never proofs.
CREATE OR REPLACE FUNCTION browser_p1_proof(tid uuid,vid uuid,op text,i uuid,d bytea) RETURNS browser_web_commands LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE p browser_web_commands;
BEGIN
 SELECT * INTO p FROM browser_web_commands WHERE task_id=tid AND viewer_id IS NOT DISTINCT FROM vid AND operation=op AND idempotency_key=i FOR UPDATE;
 IF p.id IS NULL OR p.expires_at<=clock_timestamp() OR p.created_at<clock_timestamp()-interval '5 seconds' OR p.state<>'accepted' OR p.body_digest IS DISTINCT FROM d OR octet_length(d)<>32 THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 UPDATE browser_web_commands SET state='running' WHERE id=p.id;
 RETURN p;
END $$;
CREATE OR REPLACE FUNCTION guard_browser_message_provenance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.trust_profile,NEW.browser_task_id,NEW.conversation_id,NEW.run_id) IS DISTINCT FROM ROW(OLD.trust_profile,OLD.browser_task_id,OLD.conversation_id,OLD.run_id) AND (OLD.trust_profile='browser' OR NEW.trust_profile='browser') THEN RAISE EXCEPTION 'BROWSER_PROVENANCE_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF NEW.trust_profile='ordinary' AND NEW.run_id IS NOT NULL AND EXISTS(SELECT 1 FROM dev_agent_runs WHERE id=NEW.run_id AND profile='browser') THEN RAISE EXCEPTION 'BROWSER_PROVENANCE_INVALID' USING ERRCODE='42501'; END IF;
 IF NEW.trust_profile='browser' AND (NOT browser_schema_website() OR NOT EXISTS(SELECT 1 FROM browser_tasks t WHERE t.id=NEW.browser_task_id AND t.conversation_id=NEW.conversation_id AND (NEW.run_id IS NULL OR EXISTS(SELECT 1 FROM browser_task_runs r WHERE r.task_id=t.id AND r.run_id=NEW.run_id AND r.initiator_user_id=t.initiator_user_id)))) THEN RAISE EXCEPTION 'BROWSER_PROVENANCE_INVALID' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_browser_message_provenance ON ai_messages;
CREATE TRIGGER guard_browser_message_provenance BEFORE INSERT OR UPDATE ON ai_messages FOR EACH ROW EXECUTE FUNCTION guard_browser_message_provenance();
-- Patch the existing guard without dropping any existing identity/session checks.
-- Fail explicitly if applied prerequisites no longer have the reviewed body.
DO $patch$ DECLARE b text; BEGIN
 b=pg_get_functiondef('guard_browser_core_write()'::regprocedure);
 IF position('private browser write requires website login' IN b)=0 AND position('browser_p1_guard_service' IN b)=0 THEN RAISE EXCEPTION '0115: unreviewed core guard'; END IF;
 b=replace(b,'''frame_id'',''document_epoch''','''frame_id'',''frame_uuid'',''document_epoch''');
 b=replace(b,'IF session_user<>website THEN RAISE EXCEPTION ''private browser write requires website login'' USING ERRCODE=''42501''; END IF;',
 'IF session_user<>website THEN RETURN browser_p1_guard_service(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),to_jsonb(NEW),NEW); END IF;');
 -- The record-polymorphic helper cannot return a trigger record; use inline body below.
 b=replace(b,'RETURN browser_p1_guard_service(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),to_jsonb(NEW),NEW);',
 'PERFORM browser_p1_guard_service(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),to_jsonb(NEW)); RETURN NEW;');
 b=replace(b,'OR (OLD.private AND NOT NEW.private)', 'OR (OLD.private AND NOT NEW.private AND NOT browser_p1_fresh_fence(OLD,NEW))');
 EXECUTE b;
END $patch$;
CREATE OR REPLACE FUNCTION browser_p1_fresh_fence(old_task browser_tasks,new_task browser_tasks) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT old_task.state='paused' AND new_task.state='paused' AND new_task.context_generation=old_task.context_generation+1
 AND new_task.controller_boot_id IS NOT NULL AND new_task.controller_boot_id IS DISTINCT FROM old_task.controller_boot_id
 AND new_task.listener_generation>old_task.listener_generation AND new_task.control_epoch>old_task.control_epoch AND new_task.document_epoch>old_task.document_epoch
 AND new_task.current_run_id IS NULL AND new_task.controller_user_id IS NULL AND new_task.control_token_hash IS NULL
 AND EXISTS(SELECT 1 FROM browser_web_commands p WHERE p.task_id=old_task.id AND p.operation='fresh_browser' AND p.state='succeeded'
 AND p.expires_at>clock_timestamp() AND p.safe_result->>'fenced'='true' AND p.safe_result->>'old_generation'=old_task.context_generation::text
 AND p.safe_result->>'new_boot_id'=new_task.controller_boot_id::text AND p.updated_at>clock_timestamp()-interval '5 seconds')
$$;
CREATE OR REPLACE FUNCTION browser_p1_guard_service(tab text,op text,old_row jsonb,new_row jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE allowed text[];
BEGIN
 PERFORM browser_p1_service();
 IF op='DELETE' THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 allowed:=CASE tab
 WHEN 'browser_tasks' THEN ARRAY['queue_offer_expires_at','state','private','privacy_mode','revision','control_epoch','document_epoch','bridge_nonce_seq','control_expires_at','controller_user_id','controller_device_hash','control_token_hash','current_run_id','closed_at','failure_code','updated_at','attention']
 WHEN 'browser_task_runs' THEN ARRAY['capability_revoked_at','disposition','ended_at','updated_at']
 WHEN 'browser_commands' THEN ARRAY['state','safe_result','updated_at']
 WHEN 'browser_viewers' THEN ARRAY['left_at','visible_until','control_expires_at','control_epoch','stream_generation','last_frame_uuid','updated_at']
 WHEN 'browser_maintenance_jobs' THEN ARRAY['state','attempts','lease_boot','lease_until','safe_code','updated_at']
 WHEN 'browser_audit_heads' THEN ARRAY['seq','digest','updated_at']
 ELSE NULL END;
 IF op='INSERT' THEN
  IF tab NOT IN ('browser_commands','browser_read_uses','browser_audit','browser_audit_heads','browser_audit_checkpoints') THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSIF allowed IS NULL OR (old_row-allowed) IS DISTINCT FROM (new_row-allowed) THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF tab='browser_tasks' AND ((old_row->>'private'='true' AND new_row->>'private'<>'true') OR (old_row->>'state' IN ('closed','failed') AND old_row->>'state'<>new_row->>'state') OR (new_row->>'control_epoch')::bigint<(old_row->>'control_epoch')::bigint OR (new_row->>'document_epoch')::bigint<(old_row->>'document_epoch')::bigint OR new_row->>'privacy_mode'='delegated_secret') THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
END $$;
-- Also protect new task payloads against owner-adapter bugs. Confirmation rows
-- must reference owned user messages; page/model strings cannot become answers.
CREATE OR REPLACE FUNCTION guard_browser_phase1_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE a jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.task_kind<>OLD.task_kind OR NEW.context_generation<OLD.context_generation OR NEW.revision<OLD.revision) THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.context_generation<>OLD.context_generation AND NOT browser_p1_fresh_fence(OLD,NEW) THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(NEW.confirmed_answers)<>'array' OR octet_length(NEW.confirmed_answers::text)>65536 OR jsonb_array_length(NEW.confirmed_answers)>100 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 IF TG_OP='INSERT' OR NEW.confirmed_answers IS DISTINCT FROM OLD.confirmed_answers THEN
  PERFORM browser_p1_website();
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.confirmed_answers))<>jsonb_array_length(NEW.confirmed_answers) THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(NEW.confirmed_answers) LOOP
   IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR (a-ARRAY['id','revision','field_key','label','value','source_message_id','confirmed_at'])<>'{}' OR NOT a ?& ARRAY['id','revision','field_key','label','value','source_message_id','confirmed_at'] OR jsonb_typeof(a->'value') IS DISTINCT FROM 'string' OR octet_length(a->>'value')>4000 OR jsonb_typeof(a->'revision') IS DISTINCT FROM 'number' OR coalesce(a->>'revision','') !~ '^[1-9][0-9]{0,14}$' OR coalesce(a->>'id','') !~ '^[0-9a-f-]{36}$' OR coalesce(a->>'field_key','') !~ '^[A-Za-z0-9_.:-]{1,120}$' OR jsonb_typeof(a->'label') IS DISTINCT FROM 'string' OR length(a->>'label') NOT BETWEEN 1 AND 300 OR coalesce(a->>'confirmed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$' OR NOT EXISTS(SELECT 1 FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE m.id=(a->>'source_message_id')::uuid AND m.role='user' AND m.conversation_id=NEW.conversation_id AND c.owner_user_id=NEW.initiator_user_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
   IF (a->>'id')::uuid::text IS DISTINCT FROM a->>'id' OR (a->>'source_message_id')::uuid::text IS DISTINCT FROM a->>'source_message_id' THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
   PERFORM (a->>'confirmed_at')::timestamptz;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_browser_phase1_task ON browser_tasks;
CREATE TRIGGER guard_browser_phase1_task BEFORE INSERT OR UPDATE ON browser_tasks FOR EACH ROW EXECUTE FUNCTION guard_browser_phase1_task();

CREATE OR REPLACE FUNCTION browser_web_admit(conversation uuid,project uuid,kind text,manifest jsonb,session uuid,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;s web_sessions;p browser_web_commands;
BEGIN
 PERFORM browser_p1_website();

 IF kind NOT IN ('public_research','permit','invoice','purchase') OR octet_length(manifest::text)>65536 OR jsonb_typeof(manifest)<>'object' OR (manifest-ARRAY['purpose','origins','lead_slug','initial_read'])<>'{}' OR NOT manifest ?& ARRAY['purpose','origins','initial_read'] OR octet_length(d)<>32 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM web_sessions WHERE id=session;
 SELECT * INTO t FROM browser_tasks WHERE false;
 t.initiator_user_id:=s.user_id;
 t.required_areas:=ARRAY['ai']||CASE kind WHEN 'permit' THEN ARRAY['projects','compliance'] WHEN 'invoice' THEN ARRAY['invoices'] WHEN 'purchase' THEN ARRAY['purchase_orders'] ELSE '{}'::text[] END;
 IF project IS NOT NULL THEN t.required_areas:=array_append(t.required_areas,'projects'); END IF;
 IF manifest->>'lead_slug' IS NOT NULL THEN t.required_areas:=array_append(t.required_areas,'leads'); END IF;
 SELECT array_agg(DISTINCT x) INTO t.required_areas FROM unnest(t.required_areas) x;
 PERFORM browser_p1_person(t,session);
 IF NOT EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=conversation AND c.owner_user_id=s.user_id AND c.agent='claude' AND c.deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM ask_canvas_maintenance WHERE recovery_ready) THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(1150001);
 SELECT * INTO p FROM browser_web_commands WHERE session_id=session AND operation='admit' AND idempotency_key=i;
 IF p.id IS NOT NULL THEN
  IF p.body_digest<>d THEN RAISE EXCEPTION 'BROWSER_IDEMPOTENCY_CONFLICT' USING ERRCODE='42501'; END IF;
  SELECT * INTO t FROM browser_tasks WHERE id=p.task_id; RETURN browser_p1_safe(t);
 END IF;
 IF (SELECT count(*) FROM browser_tasks WHERE state='queued' AND queue_expires_at>clock_timestamp())>=8 THEN RAISE EXCEPTION 'BROWSER_QUEUE_FULL' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_origins(manifest->'origins');
 INSERT INTO browser_tasks(initiator_user_id,conversation_id,project_id,lead_slug,purpose,required_areas,origins,initiating_web_session_id,task_kind,queue_expires_at)
 VALUES(s.user_id,conversation,project,manifest->>'lead_slug',manifest->>'purpose',t.required_areas,manifest->'origins',session,kind,clock_timestamp()+interval '5 minutes') RETURNING * INTO t;
 INSERT INTO browser_web_commands(task_id,session_id,operation,idempotency_key,body_digest,state,safe_result) VALUES(t.id,session,'admit',i,d,'succeeded',browser_p1_safe(t));
 -- Initial exact read is a website-classified, server-stamped ReadManifestV1.
 PERFORM browser_p1_publish_read(t,session,manifest->'initial_read',0);
 PERFORM browser_p1_outbox(t.id,'task_admitted','BROWSER_OK');
 RETURN browser_p1_safe(t);
END $$;

CREATE OR REPLACE FUNCTION browser_web_join(tid uuid,session uuid,device_hash bytea,role text,private_view boolean,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;p browser_web_commands;uid uuid;vid uuid;existing browser_viewers;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay(tid,NULL,'join',i,d); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 uid:=browser_p1_person(t,session);
 IF role NOT IN ('initiator','owner_review') OR octet_length(device_hash)<>32 OR t.state IN ('closed','failed') THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 p:=browser_p1_proof(tid,NULL,'join',i,d);
 IF p.session_id<>session OR NOT coalesce(p.safe_result->>'device_secret_hash' ~ '^[0-9a-f]{64}$',false) THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF (role='initiator' AND uid<>t.initiator_user_id) OR (role='owner_review' AND (NOT EXISTS(SELECT 1 FROM users WHERE id=uid AND role='owner') OR NOT EXISTS(SELECT 1 FROM browser_owner_views WHERE task_id=tid AND web_session_id=session AND expires_at>clock_timestamp() AND revoked_at IS NULL))) THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM browser_viewers b WHERE b.task_id=tid AND b.web_session_id=session AND b.device_hash=browser_web_join.device_hash AND b.left_at IS NULL FOR UPDATE;
 IF existing.id IS NOT NULL THEN
  IF existing.joined_role<>role OR existing.device_secret_hash IS DISTINCT FROM decode(p.safe_result->>'device_secret_hash','hex') THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF role='owner_review' AND private_view THEN
   UPDATE browser_viewers SET owner_private_view_authorized_at=clock_timestamp(),owner_private_context_generation=t.context_generation,owner_private_authorization_revision=t.revision WHERE id=existing.id;
   PERFORM browser_p1_outbox(tid,'viewer_joined','BROWSER_OK');
  END IF;
  RETURN browser_p1_done(p.id,jsonb_build_object('viewer_id',existing.id,'expires_at',browser_p1_iso((SELECT expires_at FROM web_sessions WHERE id=session))));
 END IF;
 IF (SELECT count(*) FROM browser_viewers WHERE task_id=tid AND joined_role=role AND left_at IS NULL)>=(CASE role WHEN 'initiator' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'BROWSER_RESOURCE_LIMIT' USING ERRCODE='42501'; END IF;
 INSERT INTO browser_viewers(task_id,web_session_id,user_id,device_hash,device_secret_hash,joined_role,visible_until,owner_private_view_authorized_at,owner_private_context_generation,owner_private_authorization_revision)
 VALUES(tid,session,uid,device_hash,decode(p.safe_result->>'device_secret_hash','hex'),role,least(clock_timestamp()+interval '15 seconds',(SELECT expires_at FROM web_sessions WHERE id=session)),CASE WHEN role='owner_review' AND private_view THEN clock_timestamp() END,CASE WHEN private_view THEN t.context_generation END,CASE WHEN private_view THEN t.revision END) RETURNING id INTO vid;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 PERFORM browser_p1_outbox(tid,'viewer_joined','BROWSER_OK');
 RETURN browser_p1_done(p.id,jsonb_build_object('viewer_id',vid,'expires_at',browser_p1_iso((SELECT expires_at FROM web_sessions WHERE id=session))));
END $$;

CREATE OR REPLACE FUNCTION browser_web_leave(vid uuid,i uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay((SELECT task_id FROM browser_viewers WHERE id=vid),vid,'leave',i,NULL); IF cached IS NOT NULL THEN RETURN cached; END IF;

 SELECT * INTO v FROM browser_viewers WHERE id=vid;
 SELECT * INTO t FROM browser_tasks WHERE id=v.task_id FOR UPDATE;
 SELECT * INTO p FROM browser_web_commands WHERE task_id=t.id AND viewer_id=vid AND operation='leave' AND idempotency_key=i AND state='accepted' FOR UPDATE;
 IF p.id IS NULL OR p.session_id<>v.web_session_id THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_proof(t.id,vid,'leave',i,p.body_digest);
 UPDATE browser_viewers SET left_at=clock_timestamp(),visible_until=clock_timestamp(),stream_generation=stream_generation+1,control_expires_at=clock_timestamp() WHERE id=vid;
 IF t.controller_device_hash=v.device_hash OR (v.joined_role='initiator' AND NOT EXISTS(SELECT 1 FROM browser_viewers WHERE task_id=t.id AND joined_role='initiator' AND left_at IS NULL AND visible_until>clock_timestamp())) THEN
  UPDATE browser_tasks SET state='paused',control_epoch=control_epoch+1,controller_user_id=NULL,controller_device_hash=NULL,control_token_hash=NULL,control_expires_at=NULL,revision=revision+1 WHERE id=t.id AND state IN ('starting','active','paused');
 END IF;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 PERFORM browser_p1_outbox(t.id,'viewer_left','BROWSER_OK');
 RETURN browser_p1_done(p.id,jsonb_build_object('left',true));
END $$;

CREATE OR REPLACE FUNCTION browser_web_presence(vid uuid,visible boolean,generation bigint,i uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;until_at timestamptz;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay((SELECT task_id FROM browser_viewers WHERE id=vid),vid,'presence',i,NULL); IF cached IS NOT NULL THEN RETURN cached; END IF;

 SELECT * INTO v FROM browser_viewers WHERE id=vid AND left_at IS NULL;
 SELECT * INTO t FROM browser_tasks WHERE id=v.task_id FOR UPDATE;
 PERFORM browser_p1_person(t,v.web_session_id);
 SELECT * INTO p FROM browser_web_commands WHERE task_id=t.id AND viewer_id=vid AND operation='presence' AND idempotency_key=i;
 PERFORM browser_p1_proof(t.id,vid,'presence',i,p.body_digest);
 IF p.session_id<>v.web_session_id OR generation<>v.stream_generation OR (v.joined_role='initiator' AND p.safe_result->>'conversation_id' IS DISTINCT FROM t.conversation_id::text) OR (v.joined_role='owner_review' AND NOT EXISTS(SELECT 1 FROM browser_owner_views WHERE claim_id=(p.safe_result->>'claim_id')::uuid AND task_id=t.id AND web_session_id=v.web_session_id AND revoked_at IS NULL AND expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'BROWSER_STREAM_STALE' USING ERRCODE='42501'; END IF;
 until_at:=least(clock_timestamp()+CASE WHEN visible THEN interval '15 seconds' ELSE interval '0 seconds' END,(SELECT expires_at FROM web_sessions WHERE id=v.web_session_id));
 UPDATE browser_viewers SET visible_until=until_at,control_expires_at=CASE WHEN control_expires_at>clock_timestamp() THEN until_at ELSE control_expires_at END WHERE id=vid;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 RETURN browser_p1_done(p.id,jsonb_build_object('present_until',browser_p1_iso(until_at)));
END $$;

CREATE OR REPLACE FUNCTION browser_web_owner_view(tid uuid,aid uuid,session uuid,local_thread uuid,i uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;c browser_owner_views;p browser_web_commands;uid uuid;result jsonb;
BEGIN
 PERFORM browser_p1_website();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 uid:=browser_p1_person(t,session);
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=uid AND role='owner' AND active) OR t.current_run_id IS NULL OR (local_thread IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_conversations WHERE id=local_thread AND owner_user_id=uid AND deleted_at IS NULL)) OR (aid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_actions WHERE id=aid AND task_id=tid)) THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM browser_web_commands WHERE task_id=tid AND session_id=session AND operation='watch' AND idempotency_key=i;
 IF p.state='succeeded' THEN RETURN p.safe_result; END IF;
 PERFORM browser_p1_proof(tid,NULL,'watch',i,p.body_digest);
 INSERT INTO browser_owner_views(viewing_owner_user_id,web_session_id,local_owned_conversation_id,task_id,action_id,initiator_user_id,conversation_id,original_run_id,expires_at)
 VALUES(uid,session,local_thread,tid,aid,t.initiator_user_id,t.conversation_id,t.current_run_id,least(clock_timestamp()+interval '5 minutes',(SELECT expires_at FROM web_sessions WHERE id=session))) RETURNING * INTO c;
 result:=jsonb_build_object('kind','browser_owner_review','claim_id',c.claim_id,'viewing_user_id',uid,'viewing_session_id',session,'local_thread_id',local_thread,'task_id',tid,'action_id',aid,'original_run_id',c.original_run_id,'task_principal_user_id',t.initiator_user_id,'task_conversation_id',t.conversation_id,'revision',c.revision,'expires_at',browser_p1_iso(c.expires_at));
 UPDATE browser_web_commands SET state='succeeded',safe_result=result WHERE id=p.id; RETURN result;
END $$;

CREATE OR REPLACE FUNCTION browser_web_sites(tid uuid,vid uuid,expected_revision integer,manifest jsonb,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay(tid,vid,'publish_manifest',i,d); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;v:=browser_p1_viewer(t,vid);
 p:=browser_p1_proof(tid,vid,'publish_manifest',i,d);
 IF p.session_id<>v.web_session_id OR expected_revision<>t.manifest_revision THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_origins(manifest);
 IF NOT manifest->'entries' @> t.origins->'entries' THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 UPDATE browser_read_manifests SET revoked_at=clock_timestamp() WHERE task_id=tid AND revoked_at IS NULL;
 UPDATE browser_task_runs SET capability_revoked_at=coalesce(capability_revoked_at,clock_timestamp()) WHERE task_id=tid;
 UPDATE browser_tasks SET origins=manifest,manifest_revision=manifest_revision+1,control_epoch=control_epoch+1,document_epoch=document_epoch+1,revision=revision+1 WHERE id=tid;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 PERFORM browser_p1_outbox(tid,'manifest_published','BROWSER_OK');SELECT * INTO t FROM browser_tasks WHERE id=tid; RETURN browser_p1_done(p.id,browser_p1_safe(t));
END $$;

CREATE OR REPLACE FUNCTION browser_web_reads(tid uuid,vid uuid,expected_revision integer,proposal jsonb,decision text,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;result jsonb;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay(tid,vid,'review',i,d); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;v:=browser_p1_viewer(t,vid);
 p:=browser_p1_proof(tid,vid,'review',i,d);
 IF p.session_id<>v.web_session_id OR decision NOT IN ('approve','deny') THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF decision='deny' THEN
  IF expected_revision<>coalesce((SELECT max(revision) FROM browser_read_manifests WHERE task_id=tid),0) THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
  UPDATE browser_read_manifests SET authorization_state='denied' WHERE task_id=tid AND revision=expected_revision AND authorization_state='pending';
  result:=jsonb_build_object('revision',expected_revision,'digest',NULL,'expires_at',NULL,'blocked_entries','[]'::jsonb,'pending_action_id',NULL);
 ELSE result:=browser_p1_publish_read(t,v.web_session_id,proposal,expected_revision); END IF;
 UPDATE browser_web_commands SET state='succeeded',safe_result=result WHERE id=p.id;
 PERFORM browser_p1_outbox(tid,'manifest_published','BROWSER_OK');RETURN browser_p1_done(p.id,result);
END $$;

CREATE OR REPLACE FUNCTION browser_web_attach_run(tid uuid,rid uuid,vid uuid,expected_epoch bigint,i uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay(tid,vid,'attach_run',i,NULL); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;v:=browser_p1_viewer(t,vid);
 SELECT * INTO p FROM browser_web_commands WHERE task_id=tid AND viewer_id=vid AND operation='attach_run' AND idempotency_key=i;
 PERFORM browser_p1_proof(tid,vid,'attach_run',i,p.body_digest);
 IF p.session_id<>v.web_session_id OR v.user_id<>t.initiator_user_id OR t.private OR expected_epoch<>t.control_epoch OR t.state NOT IN ('starting','paused') OR EXISTS(SELECT 1 FROM browser_task_runs WHERE task_id=tid AND disposition='running') OR EXISTS(SELECT 1 FROM browser_actions WHERE task_id=tid AND state IN ('pending','approved','armed','executing','unknown')) OR EXISTS(SELECT 1 FROM browser_read_manifests WHERE task_id=tid AND authorization_state='pending' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'BROWSER_REVIEW_PENDING' USING ERRCODE='42501'; END IF;
 INSERT INTO browser_task_runs(task_id,run_id,initiator_user_id,conversation_id,launch_web_session_id) VALUES(tid,rid,t.initiator_user_id,t.conversation_id,v.web_session_id);
 UPDATE browser_tasks SET current_run_id=rid,state='active',control_epoch=control_epoch+1,revision=revision+1 WHERE id=tid;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 PERFORM browser_p1_outbox(tid,'run_attached','BROWSER_OK');SELECT * INTO t FROM browser_tasks WHERE id=tid; RETURN browser_p1_done(p.id,browser_p1_safe(t));
END $$;

CREATE OR REPLACE FUNCTION browser_web_capability(tid uuid,rid uuid,vid uuid,server_kind text,process_binding jsonb,i uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;k bytea;deadline timestamptz;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay(tid,vid,'capability',i,NULL); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;v:=browser_p1_viewer(t,vid);
 SELECT * INTO p FROM browser_web_commands WHERE task_id=tid AND viewer_id=vid AND operation='capability' AND idempotency_key=i;
 PERFORM browser_p1_proof(tid,vid,'capability',i,p.body_digest);
 IF p.session_id<>v.web_session_id OR v.user_id<>t.initiator_user_id OR server_kind<>'browser' OR t.current_run_id IS DISTINCT FROM rid OR t.state<>'active' OR process_binding IS DISTINCT FROM p.safe_result->'process_binding' OR (process_binding-ARRAY['pid','start_ticks','cgroup','boot_id'])<>'{}' OR NOT process_binding ?& ARRAY['pid','start_ticks','cgroup','boot_id'] OR process_binding->>'boot_id' IS DISTINCT FROM t.controller_boot_id::text THEN RAISE EXCEPTION 'BROWSER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 k:=gen_random_bytes(32);deadline:=least(clock_timestamp()+interval '20 minutes',(SELECT expires_at FROM web_sessions WHERE id=v.web_session_id));
 UPDATE browser_task_runs SET capability_hash=k,capability_expires_at=deadline WHERE task_id=tid AND run_id=rid AND capability_hash IS NULL AND capability_revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 RETURN browser_p1_done(p.id,jsonb_build_object('capability_hash',encode(k,'hex'),'expires_at',browser_p1_iso(deadline)));
END $$;

CREATE OR REPLACE FUNCTION browser_web_control(tid uuid,vid uuid,op text,epoch bigint,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay(tid,vid,CASE op WHEN 'take_over' THEN 'takeover' WHEN 'done' THEN 'release' WHEN 'stop' THEN 'close' ELSE op END,i,d); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;v:=browser_p1_viewer(t,vid);
 IF op NOT IN ('take_over','done','give_back','resume','stop','fresh_browser','pause') THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 IF op='give_back' OR (op='resume' AND t.private) THEN RAISE EXCEPTION 'BROWSER_PHASE1_READ_ONLY' USING ERRCODE='42501'; END IF;
 p:=browser_p1_proof(tid,vid,CASE op WHEN 'take_over' THEN 'takeover' WHEN 'done' THEN 'release' WHEN 'stop' THEN 'close' ELSE op END,i,d);
 IF p.session_id<>v.web_session_id OR epoch<>t.control_epoch OR (t.state NOT IN ('active','paused') AND NOT (op='stop' AND t.state IN ('queued','starting'))) THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 IF op IN ('done','pause','resume') AND t.controller_user_id IS NOT NULL AND (t.controller_user_id<>v.user_id OR t.controller_device_hash<>v.device_hash) THEN RAISE EXCEPTION 'BROWSER_CONTROL_HELD' USING ERRCODE='42501'; END IF;
 IF op IN ('take_over','fresh_browser') AND (p.safe_result->>'drained' IS DISTINCT FROM 'true' OR p.safe_result->>'context_generation' IS DISTINCT FROM t.context_generation::text OR EXISTS(SELECT 1 FROM browser_commands WHERE task_id=tid AND state IN ('running','unknown')) OR EXISTS(SELECT 1 FROM browser_actions WHERE task_id=tid AND state IN ('executing','unknown'))) THEN RAISE EXCEPTION 'BROWSER_REVIEW_PENDING' USING ERRCODE='42501'; END IF;
 IF op='take_over' THEN
  IF NOT t.private OR t.vault_dependency<>'none' OR (v.joined_role='owner_review' AND (v.owner_private_view_authorized_at IS NULL OR v.owner_private_context_generation<>t.context_generation)) OR NOT coalesce(p.safe_result->>'control_token_hash' ~ '^[0-9a-f]{64}$',false) THEN RAISE EXCEPTION 'BROWSER_PRIVATE_INPUT_REQUIRED' USING ERRCODE='42501'; END IF;
  UPDATE browser_tasks SET state='paused',controller_user_id=v.user_id,controller_device_hash=v.device_hash,control_token_hash=decode(p.safe_result->>'control_token_hash','hex'),control_expires_at=least(v.visible_until,clock_timestamp()+interval '15 seconds'),control_epoch=control_epoch+1,revision=revision+1 WHERE id=tid;
 ELSIF op='fresh_browser' THEN
  IF t.state<>'paused' OR p.safe_result->>'fenced' IS DISTINCT FROM 'true' OR p.safe_result->>'old_generation' IS DISTINCT FROM t.context_generation::text THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
  UPDATE browser_task_runs SET capability_revoked_at=coalesce(capability_revoked_at,clock_timestamp()),disposition=CASE WHEN disposition='running' THEN 'stopped' ELSE disposition END,ended_at=coalesce(ended_at,clock_timestamp()) WHERE task_id=tid;
  UPDATE browser_web_commands SET state='succeeded',updated_at=clock_timestamp() WHERE id=p.id;
  UPDATE browser_viewers SET stream_id=gen_random_uuid(),stream_generation=stream_generation+1,last_frame_uuid=NULL,control_expires_at=NULL WHERE task_id=tid;
  UPDATE browser_read_manifests SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE task_id=tid;
  UPDATE browser_tasks SET private=false,privacy_mode='public',current_run_id=NULL,controller_boot_id=(p.safe_result->>'new_boot_id')::uuid,listener_generation=listener_generation+1,context_generation=context_generation+1,document_epoch=document_epoch+1,control_epoch=control_epoch+1,controller_user_id=NULL,controller_device_hash=NULL,control_token_hash=NULL,control_expires_at=NULL,revision=revision+1 WHERE id=tid;
 ELSE
  UPDATE browser_tasks SET state=CASE op WHEN 'stop' THEN 'closed' WHEN 'resume' THEN 'active' ELSE 'paused' END,closed_at=CASE WHEN op='stop' THEN clock_timestamp() ELSE closed_at END,control_epoch=control_epoch+1,controller_user_id=NULL,controller_device_hash=NULL,control_token_hash=NULL,control_expires_at=NULL,revision=revision+1 WHERE id=tid;
 END IF;
 UPDATE browser_task_runs SET capability_revoked_at=coalesce(capability_revoked_at,clock_timestamp()) WHERE task_id=tid;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 PERFORM browser_p1_outbox(tid,'task_transition','BROWSER_OK');SELECT * INTO t FROM browser_tasks WHERE id=tid; RETURN browser_p1_done(p.id,browser_p1_safe(t));
END $$;

CREATE OR REPLACE FUNCTION browser_web_input(tid uuid,vid uuid,frame uuid,epochs jsonb,seq bigint,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;
BEGIN
 PERFORM browser_p1_website();
 cached:=browser_p1_replay(tid,vid,'input',i,d); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;v:=browser_p1_viewer(t,vid);
 p:=browser_p1_proof(tid,vid,'input',i,d);
 IF p.session_id<>v.web_session_id OR NOT t.private OR t.controller_user_id IS DISTINCT FROM v.user_id OR t.controller_device_hash IS DISTINCT FROM v.device_hash OR t.control_expires_at<=clock_timestamp() OR t.control_expires_at IS NULL OR v.last_frame_uuid IS DISTINCT FROM frame OR frame IS NULL OR seq<=v.input_seq OR (epochs-ARRAY['control_epoch','document_epoch','stream_generation','stream_id'])<>'{}' OR NOT epochs ?& ARRAY['control_epoch','document_epoch','stream_generation','stream_id'] OR (epochs->>'control_epoch')::bigint<>t.control_epoch OR (epochs->>'document_epoch')::bigint<>t.document_epoch OR (epochs->>'stream_generation')::bigint<>v.stream_generation OR epochs->>'stream_id'<>v.stream_id::text THEN RAISE EXCEPTION 'BROWSER_STREAM_STALE' USING ERRCODE='42501'; END IF;
 UPDATE browser_viewers SET input_seq=seq,input_digest=d WHERE id=vid;
 UPDATE browser_web_commands SET state='succeeded',expires_at=least(expires_at,clock_timestamp()+interval '5 seconds') WHERE id=p.id;
 PERFORM browser_p1_outbox(tid,'command_begin','BROWSER_OK');
 RETURN browser_p1_done(p.id,jsonb_build_object('proof_id',p.id,'expires_at',browser_p1_iso(clock_timestamp()+interval '5 seconds')));
END $$;

CREATE OR REPLACE FUNCTION browser_authorize(tid uuid,rid uuid,k bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;
BEGIN
 PERFORM browser_p1_service();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF octet_length(k)<>32 OR t.current_run_id IS DISTINCT FROM rid OR t.state<>'active' OR t.private OR NOT EXISTS(SELECT 1 FROM browser_task_runs WHERE task_id=tid AND run_id=rid AND capability_hash=k AND capability_revoked_at IS NULL AND capability_expires_at>clock_timestamp() AND disposition='running') THEN RAISE EXCEPTION 'BROWSER_CAPABILITY_EXPIRED' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_person(t,t.initiating_web_session_id);
 IF NOT EXISTS(SELECT 1 FROM browser_viewers WHERE task_id=tid AND user_id=t.initiator_user_id AND joined_role='initiator' AND left_at IS NULL AND visible_until>clock_timestamp()) THEN RAISE EXCEPTION 'BROWSER_ATTENDED_ONLY' USING ERRCODE='42501'; END IF;
 RETURN browser_p1_safe(t);
END $$;

CREATE OR REPLACE FUNCTION browser_read_state(tid uuid,k bytea,scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE rid uuid;result jsonb;
BEGIN
 PERFORM browser_p1_service();

 SELECT current_run_id INTO rid FROM browser_tasks WHERE id=tid;
 result:=browser_authorize(tid,rid,k);
 IF scope='task' THEN RETURN result; ELSIF scope='files' THEN RETURN '[]'; ELSIF scope='action' THEN
 RETURN coalesce((SELECT safe_result->'review' FROM browser_commands WHERE task_id=tid AND operation='prepare' ORDER BY created_at DESC LIMIT 1),'null'::jsonb);
 ELSE RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
END $$;

CREATE OR REPLACE FUNCTION browser_command_begin(tid uuid,rid uuid,k bytea,i uuid,epoch bigint,seq bigint,op text,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;c browser_commands;
BEGIN
 PERFORM browser_p1_service();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 PERFORM browser_authorize(tid,rid,k);
 SELECT * INTO c FROM browser_commands WHERE task_id=tid AND idempotency_key=i;
 IF c.id IS NOT NULL THEN IF ROW(c.run_id,c.epoch,c.seq,c.operation,c.input_digest) IS DISTINCT FROM ROW(rid,epoch,seq,op,d) THEN RAISE EXCEPTION 'BROWSER_IDEMPOTENCY_CONFLICT' USING ERRCODE='42501'; END IF; RETURN jsonb_build_object('command_id',c.id,'state',c.state); END IF;
 IF op NOT IN ('navigate','observe','click','scroll','back','forward','reload','prepare','close','pause') THEN RAISE EXCEPTION 'BROWSER_PHASE1_READ_ONLY' USING ERRCODE='42501'; END IF;
 IF epoch<>t.control_epoch OR seq<=coalesce((SELECT max(b.seq) FROM browser_commands b WHERE b.task_id=tid AND b.epoch=epoch),0) OR t.control_token_hash IS NOT NULL OR octet_length(d)<>32 THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 INSERT INTO browser_commands(task_id,run_id,initiator_user_id,epoch,seq,idempotency_key,input_digest,operation,state,safe_result) VALUES(tid,rid,t.initiator_user_id,epoch,seq,i,d,op,CASE WHEN op='prepare' THEN 'failed' ELSE 'accepted' END,CASE WHEN op='prepare' THEN jsonb_build_object('ok',false,'code','BROWSER_PHASE1_READ_ONLY') END) RETURNING * INTO c;
 IF op='prepare' THEN
  UPDATE browser_tasks SET revision=revision+1,attention='person' WHERE id=tid RETURNING * INTO t;
  UPDATE browser_commands SET safe_result=jsonb_build_object('ok',false,'code','BROWSER_PHASE1_READ_ONLY','review',jsonb_build_object('id',c.id,'task_id',tid,'original_run_id',rid,'revision',t.revision,'kind','final_blocked','state','pending','server_deadline',NULL,'result_code','BROWSER_PHASE1_READ_ONLY','read_revision',NULL)) WHERE id=c.id;
 END IF;
 PERFORM browser_p1_outbox(tid,'command_begin','BROWSER_OK');
 RETURN jsonb_build_object('command_id',c.id,'state',c.state);
END $$;

CREATE OR REPLACE FUNCTION browser_command_finish(command uuid,boot uuid,result text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE tid uuid;t browser_tasks;
BEGIN
 PERFORM browser_p1_service();

 SELECT task_id INTO tid FROM browser_commands WHERE id=command;
 SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE;
 IF t.id IS NULL OR t.controller_boot_id IS DISTINCT FROM boot OR result NOT IN ('succeeded','failed','unknown') THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 UPDATE browser_commands SET state=result,updated_at=clock_timestamp() WHERE id=command AND state IN ('accepted','running');
 IF NOT FOUND THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_outbox(tid,'command_finish','BROWSER_OK');
 RETURN jsonb_build_object('state',result);
END $$;

CREATE OR REPLACE FUNCTION browser_enter_private(tid uuid,boot uuid,expected_epoch bigint,mode text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;
BEGIN
 PERFORM browser_p1_service();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF boot IS NULL OR t.controller_boot_id IS DISTINCT FROM boot OR expected_epoch<>t.control_epoch OR mode IS DISTINCT FROM 'private' OR t.state NOT IN ('active','paused') THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 UPDATE browser_task_runs SET capability_revoked_at=coalesce(capability_revoked_at,clock_timestamp()) WHERE task_id=tid;
 UPDATE browser_viewers SET stream_generation=stream_generation+1,last_frame_uuid=NULL,control_expires_at=NULL WHERE task_id=tid AND left_at IS NULL;
 UPDATE browser_tasks SET private=true,privacy_mode='private',state='paused',control_epoch=control_epoch+1,revision=revision+1 WHERE id=tid;
SELECT * INTO t FROM browser_tasks WHERE id=tid; PERFORM browser_p1_outbox(tid,'task_transition','BROWSER_OK');
 RETURN browser_p1_safe(t);
END $$;

CREATE OR REPLACE FUNCTION browser_runtime_transition(tid uuid,boot uuid,epoch bigint,next text,code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;
BEGIN
 PERFORM browser_p1_service();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF boot IS NULL OR t.controller_boot_id IS DISTINCT FROM boot OR epoch<>t.control_epoch OR t.state IN ('closed','failed') OR next NOT IN ('paused','closed','failed') OR code NOT IN ('BROWSER_ATTENDED_ONLY','BROWSER_REVOKED','BROWSER_DISABLED','BROWSER_RESOURCE_LIMIT','BROWSER_SERVICE_UNAVAILABLE','BROWSER_LATCHED','BROWSER_AUTH_EXPIRED') THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 UPDATE browser_task_runs SET capability_revoked_at=coalesce(capability_revoked_at,clock_timestamp()) WHERE task_id=tid;
 UPDATE browser_commands SET state=CASE WHEN state='running' THEN 'unknown' ELSE 'failed' END WHERE task_id=tid AND state IN ('accepted','running');
 UPDATE browser_viewers SET visible_until=clock_timestamp(),control_expires_at=clock_timestamp(),stream_generation=stream_generation+1,last_frame_uuid=NULL WHERE task_id=tid;
 UPDATE browser_tasks SET state=next,closed_at=CASE WHEN next IN ('closed','failed') THEN clock_timestamp() ELSE NULL END,failure_code=code,control_epoch=control_epoch+1,controller_user_id=NULL,controller_device_hash=NULL,control_token_hash=NULL,control_expires_at=NULL,revision=revision+1 WHERE id=tid;
SELECT * INTO t FROM browser_tasks WHERE id=tid; PERFORM browser_p1_outbox(tid,'task_transition','BROWSER_REVOKED');
 RETURN browser_p1_safe(t);
END $$;

CREATE OR REPLACE FUNCTION browser_run_end(tid uuid,rid uuid,disposition text,boot uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;
BEGIN
 PERFORM browser_p1_service();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF boot IS NULL OR t.controller_boot_id IS DISTINCT FROM boot OR t.current_run_id IS DISTINCT FROM rid OR disposition NOT IN ('waiting','completed','crashed','stopped') THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 UPDATE browser_task_runs SET disposition=browser_run_end.disposition,ended_at=clock_timestamp(),capability_revoked_at=coalesce(capability_revoked_at,clock_timestamp()) WHERE task_id=tid AND run_id=rid AND ended_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 RETURN browser_runtime_transition(tid,boot,t.control_epoch,CASE WHEN disposition='crashed' THEN 'failed' ELSE 'paused' END,'BROWSER_SERVICE_UNAVAILABLE');
END $$;

CREATE OR REPLACE FUNCTION browser_maintenance_claim(boot uuid,lim integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE result jsonb;
BEGIN
 PERFORM browser_p1_service();

 IF boot IS NULL OR lim NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 WITH jobs AS (SELECT id FROM browser_maintenance_jobs WHERE kind IN ('cleanup','reconcile','revoke') AND due_at<=clock_timestamp() AND (state='pending' OR (state='leased' AND lease_until<=clock_timestamp())) ORDER BY due_at,id LIMIT lim FOR UPDATE SKIP LOCKED), claimed AS (
 UPDATE browser_maintenance_jobs j SET state='leased',lease_boot=boot,lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1 FROM jobs WHERE j.id=jobs.id RETURNING j.id,j.kind,j.object_id,j.expected_revision,browser_p1_iso(j.lease_until) AS lease_until)
 SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO result FROM claimed;
 RETURN jsonb_build_object('jobs',result);
END $$;

CREATE OR REPLACE FUNCTION browser_maintenance_finish(job uuid,boot uuid,result text,proof jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE unused boolean;
BEGIN
 PERFORM browser_p1_service();

 IF result NOT IN ('BROWSER_OK','BROWSER_SERVICE_UNAVAILABLE') OR proof IS DISTINCT FROM jsonb_build_object('v',1,'job_id',job,'boot_id',boot) THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 UPDATE browser_maintenance_jobs SET state=CASE WHEN result='BROWSER_OK' THEN 'done' ELSE 'failed' END,safe_code=result WHERE id=job AND lease_boot=boot AND lease_until>clock_timestamp() AND state='leased';
 IF NOT FOUND THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('done',result='BROWSER_OK');
END $$;

CREATE OR REPLACE FUNCTION browser_p1_origins(manifest jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE e jsonb;
BEGIN
 IF manifest IS NULL OR (manifest-ARRAY['v','entries'])<>'{}' OR manifest->>'v'<>'1' OR jsonb_typeof(manifest->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'entries') NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(manifest->'entries') LOOP
 IF (e-ARRAY['origin','role'])<>'{}' OR NOT e ?& ARRAY['origin','role'] OR NOT browser_schema_origin(e->>'origin') OR e->>'role' NOT IN ('document','identity','resource') THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF; END LOOP;
 IF (SELECT count(DISTINCT value->>'origin') FROM jsonb_array_elements(manifest->'entries'))<>jsonb_array_length(manifest->'entries') OR (SELECT count(*) FROM jsonb_array_elements(manifest->'entries') WHERE value->>'role' IN ('document','identity'))>8 OR (SELECT count(*) FROM jsonb_array_elements(manifest->'entries') WHERE value->>'role'='resource')>24 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
END $$;
-- Canonical JSON for the fixed ASCII-keyed signed schemas (all numbers safe
-- integers). No SQL-text/jsonb::text signature ambiguity. Values stay UTF-8.
CREATE OR REPLACE FUNCTION browser_p1_canonical(j jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE result text;
BEGIN
 CASE jsonb_typeof(j)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||browser_p1_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(j);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(browser_p1_canonical(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(j) WITH ORDINALITY a(value,ord);
 WHEN 'number' THEN IF (j::text)::numeric<>trunc((j::text)::numeric) OR abs((j::text)::numeric)>9007199254740991 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;result:=trunc((j::text)::numeric)::text;
 ELSE result:=j::text; END CASE;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION browser_p1_outbox(tid uuid,ev text,code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO browser_audit_outbox(task_id,event,result_code,revision) VALUES(tid,ev,code,(SELECT revision FROM browser_tasks WHERE id=tid));
END $$;
ALTER TABLE browser_audit_outbox DROP CONSTRAINT IF EXISTS browser_audit_outbox_event_check;
ALTER TABLE browser_audit_outbox ADD CONSTRAINT browser_audit_outbox_event_check CHECK(event IN ('action_prepared','action_approved','action_denied','action_consumed','action_result','action_stale','vault_changed','file_changed','handoff_changed','task_admitted','run_attached','run_ended','task_transition','viewer_joined','viewer_left','manifest_published','command_begin','command_finish','read_consumed','maintenance'));
CREATE OR REPLACE FUNCTION browser_p1_publish_read(t browser_tasks,sid uuid,j jsonb,expected_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE e jsonb;current_revision integer;exp timestamptz;sig bytea;
BEGIN
 PERFORM browser_p1_website();PERFORM browser_p1_person(t,sid);
 SELECT coalesce(max(revision),0) INTO current_revision FROM browser_read_manifests WHERE task_id=t.id;
 IF t.private OR current_revision<>expected_revision OR j IS NULL OR octet_length(j::text)>65536 OR (j-ARRAY['v','revision','initial_entry_id','entries','digest'])<>'{}' OR NOT j ?& ARRAY['v','revision','initial_entry_id','entries','digest'] OR j->>'v'<>'1' OR (j->>'revision')::integer<>current_revision+1 OR jsonb_typeof(j->'entries')<>'array' OR jsonb_array_length(j->'entries') NOT BETWEEN 1 AND 192 THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 exp:=least(clock_timestamp()+interval '5 minutes',(SELECT expires_at FROM web_sessions WHERE id=sid));
 FOR e IN SELECT value FROM jsonb_array_elements(j->'entries') LOOP
  IF (e-ARRAY['id','role','method','canonical_url','headers_schema_id','value_schema','provenance','approved_by','approved_session_id','approved_at','expires_at','max_uses','parent_document_epoch','release_action_id'])<>'{}' OR NOT e ?& ARRAY['id','role','method','canonical_url','headers_schema_id','value_schema','provenance','approved_by','approved_session_id','approved_at','expires_at','max_uses','parent_document_epoch','release_action_id'] OR e->>'role' NOT IN ('document','resource') OR e->>'method' NOT IN ('GET','HEAD') OR e->>'headers_schema_id'<>'anonymous_public_v1' OR e->'release_action_id'<>'null'::jsonb
   OR e->>'approved_by' IS DISTINCT FROM (SELECT user_id::text FROM web_sessions WHERE id=sid) OR e->>'approved_session_id' IS DISTINCT FROM sid::text OR (e->>'expires_at')::timestamptz>exp OR (e->>'expires_at')::timestamptz<=clock_timestamp() OR (e->>'approved_at')::timestamptz>clock_timestamp() OR (e->>'approved_at')::timestamptz<clock_timestamp()-interval '5 seconds'
   OR (e->>'max_uses')::integer NOT BETWEEN 1 AND (CASE WHEN e->>'role'='document' THEN 1 ELSE 32 END) OR (e->>'parent_document_epoch')::bigint<>t.document_epoch+1
   OR ((e->'provenance')-ARRAY['v','source','classification','source_ref'])<>'{}' OR NOT e->'provenance' ?& ARRAY['v','source','classification','source_ref'] OR e->'provenance'->>'v'<>'1' OR e->'provenance'->>'classification'<>'public_nonbusiness' OR e->'provenance'->>'source' NOT IN ('person','agent','page')
   OR ((e->'value_schema')-ARRAY['v','kind','query','static_rule_id'])<>'{}' OR NOT e->'value_schema' ?& ARRAY['v','kind','query','static_rule_id'] OR e->'value_schema'->>'v'<>'1' OR e->'value_schema'->>'kind'<>'exact_public' OR e->'value_schema'->'static_rule_id'<>'null'::jsonb
   OR octet_length(e->>'canonical_url')>2048 OR e->>'canonical_url' !~ '^https://[a-z0-9][a-z0-9.-]*/' OR e->>'canonical_url' ~ '[#@\\\x00-\x20]' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.origins->'entries') a WHERE e->>'canonical_url' LIKE (a->>'origin')||'/%' AND (e->>'role'='resource' OR a->>'role'='document')) THEN RAISE EXCEPTION 'BROWSER_READ_PROVENANCE_UNKNOWN' USING ERRCODE='42501'; END IF;
  PERFORM (e->>'id')::uuid;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j->'entries') e WHERE e->>'id'=j->>'initial_entry_id' AND e->>'role'='document') OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(j->'entries'))<>jsonb_array_length(j->'entries') OR (SELECT count(*) FROM jsonb_array_elements(j->'entries') WHERE value->>'role'='document')>64 OR (SELECT count(*) FROM jsonb_array_elements(j->'entries') WHERE value->>'role'='resource')>128 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 -- Website-only caller supplies the D-validated, server-signed manifest.
 -- Purpose keys remain outside Postgres. Service cannot call this publisher.
 IF NOT coalesce(j->>'digest' ~ '^[0-9a-f]{64}$',false) THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 sig:=decode(j->>'digest','hex');
 UPDATE browser_read_manifests SET revoked_at=clock_timestamp() WHERE task_id=t.id AND revoked_at IS NULL;
 SELECT min((value->>'expires_at')::timestamptz) INTO exp FROM jsonb_array_elements(j->'entries');
 INSERT INTO browser_read_manifests(task_id,revision,task_origins_revision,public_entries,manifest_hmac,initial_entry_id,authorization_state,approved_by_user_id,approved_by_session_id,expires_at)
 VALUES(t.id,current_revision+1,t.manifest_revision,j,sig,(j->>'initial_entry_id')::uuid,'approved',(SELECT user_id FROM web_sessions WHERE id=sid),sid,exp);
 UPDATE browser_tasks SET revision=revision+1 WHERE id=t.id;
 RETURN jsonb_build_object('revision',current_revision+1,'digest',encode(sig,'hex'),'expires_at',browser_p1_iso(exp),'blocked_entries','[]'::jsonb,'pending_action_id',NULL);
END $$;

-- Service chain inserts still pass all 0102 append/head/checkpoint checks.
DO $patch$ DECLARE b text; BEGIN
 b:=pg_get_functiondef('guard_browser_chain_schema()'::regprocedure);
 b:=replace(b,'NOT browser_schema_website() OR TG_OP<>''INSERT''','(NOT browser_schema_website() AND session_user<>''sjcos_browser'') OR TG_OP<>''INSERT''');
 EXECUTE b;
END $patch$;
ALTER TABLE browser_audit ADD COLUMN IF NOT EXISTS phase1_binding jsonb;

CREATE OR REPLACE FUNCTION browser_append_audit(tid uuid,event_id uuid,event text,object_id uuid,code text,chain jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;head browser_audit_heads;attestation jsonb;data jsonb;dg bytea;
BEGIN
 PERFORM browser_p1_service();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF event NOT IN ('task_admitted','run_attached','run_ended','task_transition','viewer_joined','viewer_left','command_begin','command_finish','manifest_published','read_consumed','maintenance') OR code NOT IN ('BROWSER_OK','BROWSER_PHASE1_READ_ONLY','BROWSER_REVOKED','BROWSER_SERVICE_UNAVAILABLE') OR (chain-ARRAY['v','previous_digest','digest','hmac','key_id','at','binding'])<>'{}' OR NOT chain ?& ARRAY['v','previous_digest','digest','hmac','key_id','at','binding'] OR chain->>'v'<>'1' OR octet_length(chain::text)>4096 THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 INSERT INTO browser_audit_heads(singleton,seq,digest) VALUES(true,0,decode(repeat('00',32),'hex')) ON CONFLICT DO NOTHING;
 SELECT * INTO head FROM browser_audit_heads WHERE singleton FOR UPDATE;
 -- A1's trusted verifier checks the installation HMAC outside Postgres and
 -- stages an exact short-lived attestation as the website, never as service.
 SELECT value::jsonb INTO attestation FROM app_settings WHERE key='browser.audit_event.'||event_id::text;
 IF attestation IS NULL OR attestation->>'verified' IS DISTINCT FROM 'true' OR coalesce((attestation->>'expires_at')::timestamptz,'-infinity')<=clock_timestamp() THEN RAISE EXCEPTION 'BROWSER_SERVICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF event='read_consumed' THEN
  IF chain->'binding' IS NULL OR ((chain->'binding')-ARRAY['boot_id','context_generation','revision','entry_id','manifest_digest','request_hmac','flow_nonce','listener_generation','document_epoch','control_epoch'])<>'{}' OR NOT chain->'binding' ?& ARRAY['boot_id','context_generation','revision','entry_id','manifest_digest','request_hmac','flow_nonce','listener_generation','document_epoch','control_epoch'] OR chain->'binding'->>'flow_nonce' IS DISTINCT FROM object_id::text THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 ELSIF chain->'binding'<>'null'::jsonb THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 data:=jsonb_build_object('v',1,'seq',head.seq+1,'event_id',event_id,'task_id',tid,'event',event,'object_id',object_id,'code',code,'at',chain->>'at','previous_digest',encode(head.digest,'hex'),'binding',chain->'binding');
 dg:=digest(convert_to(browser_p1_canonical(data),'UTF8'),'sha256');
 IF chain->>'previous_digest' IS DISTINCT FROM encode(head.digest,'hex') OR chain->>'digest' IS DISTINCT FROM encode(dg,'hex') OR attestation->>'digest' IS DISTINCT FROM encode(dg,'hex') OR attestation->>'hmac' IS DISTINCT FROM chain->>'hmac' OR attestation->>'key_id' IS DISTINCT FROM chain->>'key_id' OR NOT coalesce(chain->>'hmac' ~ '^[0-9a-f]{64}$',false) THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 INSERT INTO browser_audit(id,event_id,task_id,event,object_id,result_code,at,previous_digest,digest,key_id,hmac,phase1_binding) VALUES(head.seq+1,event_id,tid,event,object_id,code,(chain->>'at')::timestamptz,head.digest,dg,chain->>'key_id',decode(chain->>'hmac','hex'),chain->'binding');
 RETURN jsonb_build_object('seq',head.seq+1);
END $$;

CREATE OR REPLACE FUNCTION browser_checkpoint(seq bigint,d bytea,key_id text,signature bytea,external_ack text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE ack jsonb;
BEGIN
 PERFORM browser_p1_service();
 PERFORM 1 FROM browser_audit_heads WHERE singleton FOR UPDATE;

 -- Only the website can stage an independently verified sink acknowledgement.
 -- The service cannot mint this row or substitute signature-presence for proof.
 SELECT value::jsonb INTO ack FROM app_settings WHERE key='browser.checkpoint.'||external_ack FOR UPDATE;
 IF ack IS NULL OR ack->>'through_seq' IS DISTINCT FROM seq::text OR ack->>'digest' IS DISTINCT FROM encode(d,'hex') OR ack->>'key_id' IS DISTINCT FROM key_id OR ack->>'signature' IS DISTINCT FROM replace(encode(signature,'base64'),E'\n','') OR octet_length(signature)<>64 OR ack->>'verified' IS DISTINCT FROM 'true' OR coalesce((ack->>'expires_at')::timestamptz,'-infinity')<=clock_timestamp() THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 INSERT INTO browser_audit_checkpoints(through_seq,digest,key_id,signature,external_ack_id,external_ack_at,install_id,boot_id,sink_key_id,sink_signature)
 VALUES(seq,d,key_id,signature,external_ack,clock_timestamp(),(ack->>'install_id')::uuid,(ack->>'boot_id')::uuid,ack->>'sink_key_id',decode(ack->>'sink_signature','base64'));
 RETURN jsonb_build_object('recorded',true);
END $$;

CREATE OR REPLACE FUNCTION browser_read_consume(tid uuid,boot uuid,revision integer,entry uuid,manifest_d bytea,request_d bytea,flow_nonce uuid,generation bigint,epoch bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;m browser_read_manifests;e jsonb;au browser_audit;cp browser_audit_checkpoints;binding jsonb;ordinal bigint;
BEGIN
 PERFORM browser_p1_service();
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_person(t,t.initiating_web_session_id);
 IF t.private OR t.state<>'active' OR t.controller_boot_id IS DISTINCT FROM boot OR boot IS NULL OR t.control_epoch<>epoch OR t.current_run_id IS NULL OR generation<=0 OR generation<>t.listener_generation OR octet_length(request_d)<>32 OR NOT EXISTS(SELECT 1 FROM browser_task_runs WHERE task_id=tid AND run_id=t.current_run_id AND disposition='running' AND capability_revoked_at IS NULL AND capability_expires_at>clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM browser_viewers WHERE task_id=tid AND joined_role='initiator' AND left_at IS NULL AND visible_until>clock_timestamp()) THEN RAISE EXCEPTION 'BROWSER_REVOKED' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM browser_read_manifests WHERE task_id=tid AND browser_read_manifests.revision=browser_read_consume.revision FOR UPDATE;
 IF m.manifest_id IS NULL OR m.authorization_state<>'approved' OR m.revoked_at IS NOT NULL OR m.expires_at<=clock_timestamp() OR m.task_origins_revision<>t.manifest_revision OR m.manifest_hmac IS DISTINCT FROM manifest_d THEN RAISE EXCEPTION 'BROWSER_READ_EXPIRED' USING ERRCODE='42501'; END IF;
 PERFORM browser_p1_person(t,m.approved_by_session_id);
 SELECT value INTO e FROM jsonb_array_elements(m.public_entries->'entries') WHERE value->>'id'=entry::text;
 IF e IS NULL OR e->'provenance'->>'classification'<>'public_nonbusiness' OR e->'release_action_id'<>'null'::jsonb OR (e->>'expires_at')::timestamptz<=clock_timestamp() OR (e->>'parent_document_epoch')::bigint<>t.document_epoch+(CASE WHEN e->>'role'='document' THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'BROWSER_READ_PROVENANCE_UNKNOWN' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM browser_read_uses u WHERE u.task_id=tid AND u.flow_nonce=browser_read_consume.flow_nonce) OR coalesce((SELECT sum(use_count) FROM browser_read_uses u WHERE u.task_id=tid AND u.revision=browser_read_consume.revision AND u.entry_id=entry),0)>=(e->>'max_uses')::integer THEN RAISE EXCEPTION 'BROWSER_READ_EXPIRED' USING ERRCODE='42501'; END IF;
 binding:=jsonb_build_object('boot_id',boot,'context_generation',t.context_generation,'revision',revision,'entry_id',entry,'manifest_digest',encode(manifest_d,'hex'),'request_hmac',encode(request_d,'hex'),'flow_nonce',flow_nonce,'listener_generation',generation,'document_epoch',t.document_epoch,'control_epoch',epoch);
 SELECT a.* INTO au FROM browser_audit a WHERE a.task_id=tid AND a.object_id=flow_nonce AND a.event='read_consumed' AND a.phase1_binding=binding ORDER BY a.id DESC LIMIT 1;
 SELECT * INTO cp FROM browser_audit_checkpoints WHERE through_seq>=au.id AND sink_signature IS NOT NULL ORDER BY through_seq LIMIT 1;
 IF au.id IS NULL OR cp.checkpoint_id IS NULL OR au.at<clock_timestamp()-interval '60 seconds' THEN RAISE EXCEPTION 'BROWSER_SERVICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT coalesce(sum(use_count),0)+1 INTO ordinal FROM browser_read_uses u WHERE u.task_id=tid AND u.revision=browser_read_consume.revision AND u.entry_id=entry;
 INSERT INTO browser_read_uses(task_id,revision,entry_id,flow_nonce) VALUES(tid,revision,entry,flow_nonce);
 IF e->>'role'='document' THEN UPDATE browser_tasks SET document_epoch=document_epoch+1,revision=browser_tasks.revision+1 WHERE id=tid; END IF;
 RETURN jsonb_build_object('v',1,'task_id',tid,'original_run_id',t.current_run_id,'boot_id',boot,'context_generation',t.context_generation,'task_origins_revision',t.manifest_revision,'manifest_revision',revision,'manifest_digest',encode(manifest_d,'hex'),'entry_id',entry,'parent_document_epoch',(e->>'parent_document_epoch')::bigint,'request_hmac',encode(request_d,'hex'),'flow_nonce',flow_nonce,'listener_generation',generation,'use_ordinal',ordinal,'expires_at',browser_p1_iso(least(m.expires_at,clock_timestamp()+interval '60 seconds')),'consume_seq',au.id,'checkpoint_ack_id',cp.external_ack_id);
END $$;

CREATE OR REPLACE FUNCTION browser_web_queue(tid uuid,vid uuid,op text,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE cached jsonb;t browser_tasks;v browser_viewers;p browser_web_commands;
BEGIN
 PERFORM browser_p1_website();
 PERFORM pg_advisory_xact_lock(1150001);
 cached:=browser_p1_replay(tid,vid,CASE WHEN op='accept' THEN 'accept_offer' ELSE 'queue' END,i,d); IF cached IS NOT NULL THEN RETURN cached; END IF;
SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'BROWSER_NOT_FOUND' USING ERRCODE='42501'; END IF;
 v:=browser_p1_viewer(t,vid);p:=browser_p1_proof(tid,vid,CASE WHEN op='accept' THEN 'accept_offer' ELSE 'queue' END,i,d);
 PERFORM pg_advisory_xact_lock(1150001);
 IF p.session_id<>v.web_session_id OR v.user_id<>t.initiator_user_id OR t.state<>'queued' OR t.queue_expires_at<=clock_timestamp() OR op NOT IN ('request','accept') THEN RAISE EXCEPTION 'BROWSER_OFFER_EXPIRED' USING ERRCODE='42501'; END IF;
 IF op='accept' THEN
  IF t.queue_offer_expires_at IS NULL OR t.queue_offer_expires_at<=clock_timestamp() OR (SELECT count(*) FROM browser_tasks WHERE state IN ('starting','active','paused'))>=2 THEN RAISE EXCEPTION 'BROWSER_OFFER_EXPIRED' USING ERRCODE='42501'; END IF;
  UPDATE browser_tasks SET state='starting',revision=revision+1,controller_boot_id=(p.safe_result->>'boot_id')::uuid,listener_generation=listener_generation+1 WHERE id=tid;
 END IF;
 UPDATE browser_web_commands SET state='succeeded' WHERE id=p.id;
 SELECT * INTO t FROM browser_tasks WHERE id=tid;RETURN browser_p1_done(p.id,browser_p1_safe(t));
END $$;

CREATE OR REPLACE FUNCTION browser_queue_offer(boot uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE t browser_tasks;
BEGIN
 PERFORM browser_p1_service();

 IF boot IS NULL THEN RAISE EXCEPTION 'BROWSER_BAD_INPUT' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(1150001);
 UPDATE browser_tasks SET state='closed',closed_at=clock_timestamp(),failure_code='BROWSER_OFFER_EXPIRED',control_epoch=control_epoch+1,revision=revision+1 WHERE state='queued' AND (queue_expires_at<=clock_timestamp() OR queue_offer_expires_at<=clock_timestamp());
 IF (SELECT count(*) FROM browser_tasks WHERE state IN ('starting','active','paused'))+(SELECT count(*) FROM browser_tasks WHERE state='queued' AND queue_offer_expires_at>clock_timestamp())>=2 THEN RETURN jsonb_build_object('offered',false); END IF;
 SELECT * INTO t FROM browser_tasks WHERE state='queued' AND queue_expires_at>clock_timestamp() AND queue_offer_expires_at IS NULL ORDER BY queue_requested_at,id LIMIT 1 FOR UPDATE;
 IF t.id IS NULL THEN RETURN jsonb_build_object('offered',false); END IF;
 PERFORM browser_p1_person(t,t.initiating_web_session_id);
 UPDATE browser_tasks SET queue_offer_expires_at=least(queue_expires_at,clock_timestamp()+interval '30 seconds'),revision=revision+1 WHERE id=t.id;
 RETURN jsonb_build_object('offered',true,'task_id',t.id,'offer_expires_at',browser_p1_iso(least(t.queue_expires_at,clock_timestamp()+interval '30 seconds')));
END $$;

-- No PUBLIC execute on any new Phase 1 helper or API. Explicit service list
-- generated from deploy/db-roles.manifest.json; website-only APIs stay ungranted.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'browser_p1_%' OR proname='guard_browser_phase1_task' OR proname='guard_browser_message_provenance') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',p.sig);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION browser_web_admit(uuid,uuid,text,jsonb,uuid,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_admit(uuid,uuid,text,jsonb,uuid,uuid,bytea) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_join(uuid,uuid,bytea,text,boolean,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_join(uuid,uuid,bytea,text,boolean,uuid,bytea) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_leave(uuid,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_leave(uuid,uuid) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_presence(uuid,boolean,bigint,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_presence(uuid,boolean,bigint,uuid) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_owner_view(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_owner_view(uuid,uuid,uuid,uuid,uuid) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_sites(uuid,uuid,integer,jsonb,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_sites(uuid,uuid,integer,jsonb,uuid,bytea) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_reads(uuid,uuid,integer,jsonb,text,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_reads(uuid,uuid,integer,jsonb,text,uuid,bytea) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_attach_run(uuid,uuid,uuid,bigint,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_attach_run(uuid,uuid,uuid,bigint,uuid) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_capability(uuid,uuid,uuid,text,jsonb,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_capability(uuid,uuid,uuid,text,jsonb,uuid) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_control(uuid,uuid,text,bigint,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_control(uuid,uuid,text,bigint,uuid,bytea) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_input(uuid,uuid,uuid,jsonb,bigint,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_input(uuid,uuid,uuid,jsonb,bigint,uuid,bytea) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_authorize(uuid,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_authorize(uuid,uuid,bytea) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_authorize(uuid,uuid,bytea) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_read_state(uuid,bytea,text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_read_state(uuid,bytea,text) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_read_state(uuid,bytea,text) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_command_begin(uuid,uuid,bytea,uuid,bigint,bigint,text,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_command_begin(uuid,uuid,bytea,uuid,bigint,bigint,text,bytea) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_command_begin(uuid,uuid,bytea,uuid,bigint,bigint,text,bytea) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_command_finish(uuid,uuid,text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_command_finish(uuid,uuid,text) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_command_finish(uuid,uuid,text) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_enter_private(uuid,uuid,bigint,text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_enter_private(uuid,uuid,bigint,text) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_enter_private(uuid,uuid,bigint,text) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_runtime_transition(uuid,uuid,bigint,text,text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_runtime_transition(uuid,uuid,bigint,text,text) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_runtime_transition(uuid,uuid,bigint,text,text) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_run_end(uuid,uuid,text,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_run_end(uuid,uuid,text,uuid) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_run_end(uuid,uuid,text,uuid) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_maintenance_claim(uuid,integer) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_maintenance_claim(uuid,integer) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_maintenance_claim(uuid,integer) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_maintenance_finish(uuid,uuid,text,jsonb) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_maintenance_finish(uuid,uuid,text,jsonb) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_maintenance_finish(uuid,uuid,text,jsonb) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_append_audit(uuid,uuid,text,uuid,text,jsonb) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_append_audit(uuid,uuid,text,uuid,text,jsonb) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_append_audit(uuid,uuid,text,uuid,text,jsonb) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_checkpoint(bigint,bytea,text,bytea,text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_checkpoint(bigint,bytea,text,bytea,text) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_checkpoint(bigint,bytea,text,bytea,text) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_read_consume(uuid,uuid,integer,uuid,bytea,bytea,uuid,bigint,bigint) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_read_consume(uuid,uuid,integer,uuid,bytea,bytea,uuid,bigint,bigint) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_read_consume(uuid,uuid,integer,uuid,bytea,bytea,uuid,bigint,bigint) TO sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_web_queue(uuid,uuid,text,uuid,bytea) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_web_queue(uuid,uuid,text,uuid,bytea) FROM sjcos_browser; END IF; END $$;
REVOKE ALL ON FUNCTION browser_queue_offer(uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN REVOKE ALL ON FUNCTION browser_queue_offer(uuid) FROM sjcos_browser; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN GRANT EXECUTE ON FUNCTION browser_queue_offer(uuid) TO sjcos_browser; END IF; END $$;
-- Actual generator output: node scripts/db-roles-sql.mjs ai_messages app_settings
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_worker') THEN REVOKE INSERT,UPDATE ON ai_messages FROM sjcos_worker; END IF; END $$;
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'ai_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT (id, conversation_id, role, body, page_context, cost_usd, created_at, run_id), UPDATE (id, conversation_id, role, body, page_context, cost_usd, created_at, run_id)', 'ai_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'ai_messages');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'app_settings');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'app_settings');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'app_settings');
-- Actual generator output for browser_tasks browser_task_runs browser_commands
-- browser_viewers browser_web_commands browser_read_manifests browser_read_uses
-- browser_audit browser_audit_heads browser_audit_checkpoints browser_audit_outbox
-- browser_maintenance_jobs browser_owner_views: empty (no table grants).

-- Service may append only fixed runtime outbox events, never action evidence.
DO $patch$ DECLARE b text; BEGIN
 b:=pg_get_functiondef('guard_browser_action_schema()'::regprocedure);
 b:=replace(b,'IF NOT browser_schema_website() THEN RAISE EXCEPTION ''BROWSER_NOT_AUTHORIZED'' USING ERRCODE=''42501''; END IF;',
 'IF NOT browser_schema_website() THEN
 IF session_user=''sjcos_browser'' AND TG_TABLE_NAME=''browser_audit_outbox'' AND TG_OP=''INSERT'' THEN
  IF NEW.action_id IS NOT NULL OR NEW.chained_seq IS NOT NULL OR NEW.event NOT IN (''task_admitted'',''run_attached'',''run_ended'',''task_transition'',''viewer_joined'',''viewer_left'',''manifest_published'',''command_begin'',''command_finish'',''read_consumed'',''maintenance'') THEN RAISE EXCEPTION ''BROWSER_FORBIDDEN'' USING ERRCODE=''42501''; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION ''BROWSER_NOT_AUTHORIZED'' USING ERRCODE=''42501''; END IF;');
 EXECUTE b;
END $patch$;

-- No raw table rights are added. This policy permits the definer catalog to
-- recheck the bound thread lifecycle under the real service session identity.
DO $$ DECLARE website name; BEGIN
 SELECT pg_get_userbyid(relowner) INTO website FROM pg_class WHERE oid='ai_conversations'::regclass;
 DROP POLICY IF EXISTS browser_phase1_bound_thread ON ai_conversations;
 EXECUTE format('CREATE POLICY browser_phase1_bound_thread ON ai_conversations FOR SELECT TO %I USING(session_user=''sjcos_browser'' AND EXISTS(SELECT 1 FROM browser_tasks t WHERE t.conversation_id=ai_conversations.id AND t.initiator_user_id=ai_conversations.owner_user_id))',website);
END $$;
-- Retained later-phase cards may only be invalidated by Phase 1 service fences.
-- This is not approval/arming/execution authority and has no direct table grant.
DO $patch$ DECLARE b text; BEGIN
 b:=pg_get_functiondef('guard_browser_action_schema()'::regprocedure);
 b:=replace(b,'IF NOT browser_schema_website() THEN',
 'IF NOT browser_schema_website() THEN
 IF session_user=''sjcos_browser'' AND TG_TABLE_NAME=''browser_actions'' AND TG_OP=''UPDATE'' THEN
  IF OLD.state IN (''pending'',''approved'',''armed'') AND NEW.state=''stale'' AND NEW.outcome_code=''BROWSER_CONTEXT_CHANGED'' AND (to_jsonb(NEW)-ARRAY[''state'',''outcome_code'',''updated_at'']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY[''state'',''outcome_code'',''updated_at'']) THEN RETURN NEW; END IF;
  RAISE EXCEPTION ''BROWSER_FORBIDDEN'' USING ERRCODE=''42501'';
 END IF;
 IF session_user=''sjcos_browser'' AND TG_TABLE_NAME=''browser_audit_outbox'' AND TG_OP=''INSERT'' AND NEW.event=''action_stale'' AND EXISTS(SELECT 1 FROM browser_actions WHERE id=NEW.action_id AND task_id=NEW.task_id AND state=''stale'' AND outcome_code=''BROWSER_CONTEXT_CHANGED'') THEN RETURN NEW; END IF;');
 -- Apply once on SQL replay too.
 IF position('Retained card fence' IN b)=0 THEN
  b:=replace(b,'BEGIN','BEGIN -- Retained card fence'); EXECUTE b;
 END IF;
END $patch$;

CREATE OR REPLACE FUNCTION browser_p1_replay(tid uuid,vid uuid,op text,i uuid,d bytea) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p browser_web_commands;t browser_tasks;
BEGIN
 PERFORM browser_p1_website();
 SELECT * INTO t FROM browser_tasks WHERE id=tid FOR UPDATE;
 SELECT * INTO p FROM browser_web_commands WHERE task_id=tid AND viewer_id IS NOT DISTINCT FROM vid AND operation=op AND idempotency_key=i FOR UPDATE;
 IF p.id IS NULL THEN RETURN NULL; END IF;
 IF d IS NOT NULL AND p.body_digest IS DISTINCT FROM d THEN RAISE EXCEPTION 'BROWSER_IDEMPOTENCY_CONFLICT' USING ERRCODE='42501'; END IF;
 IF p.state<>'succeeded' THEN RETURN NULL; END IF;
 SELECT * INTO t FROM browser_tasks WHERE id=tid;
 PERFORM browser_p1_person(t,p.session_id);
 IF p.safe_result->'response' IS NULL THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
 RETURN p.safe_result->'response';
END $$;
CREATE OR REPLACE FUNCTION browser_p1_done(proof uuid,result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM browser_p1_website();
 UPDATE browser_web_commands SET state='succeeded',safe_result=jsonb_set(coalesce(safe_result,'{}'),'{response}',result),updated_at=clock_timestamp() WHERE id=proof;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION browser_p1_replay(uuid,uuid,text,uuid,bytea),browser_p1_done(uuid,jsonb) FROM PUBLIC;
