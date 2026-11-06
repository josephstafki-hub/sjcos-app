-- Canvas core; 0107 provenance, 0108 files and 0109 floor are independent extensions.
DO $$ BEGIN IF to_regclass('ask_canvas_maintenance') IS NULL OR NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id=105) THEN RAISE EXCEPTION '0106 requires shared migrations 0100 + 0105'; END IF; END $$;
CREATE TABLE ask_canvases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT,
 owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_run_id uuid NOT NULL REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('diagram','page','floor_plan')), project_id uuid REFERENCES projects(id) ON DELETE RESTRICT, lead_id uuid REFERENCES leads(id) ON DELETE RESTRICT,
 required_areas text[] NOT NULL DEFAULT '{}', classification_revision bigint NOT NULL DEFAULT 1, baseline_hash text NOT NULL CHECK(baseline_hash ~ '^[a-f0-9]{64}$'),
 latest_version int NOT NULL DEFAULT 1 CHECK(latest_version BETWEEN 1 AND 100), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deleted_at timestamptz, purge_after timestamptz, purged_at timestamptz, hold_until timestamptz, deletion_sequence bigint,
 UNIQUE(id,conversation_id,owner_user_id), CHECK(project_id IS NULL OR lead_id IS NULL),
 CHECK((deleted_at IS NULL AND purge_after IS NULL AND deletion_sequence IS NULL AND purged_at IS NULL) OR (deleted_at IS NOT NULL AND purge_after=deleted_at+interval '720 hours' AND deletion_sequence>0))
);
CREATE TABLE ask_canvas_versions (
 canvas_id uuid NOT NULL, version int NOT NULL CHECK(version BETWEEN 1 AND 100), conversation_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, run_id uuid REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,
 title text CHECK(char_length(title) BETWEEN 1 AND 80), summary text CHECK(char_length(summary) BETWEEN 1 AND 500), change_note text CHECK(char_length(change_note)<=120),
 source_text text, canonical_content jsonb, source_bytes int NOT NULL CHECK(source_bytes BETWEEN 1 AND 262144), source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 content_policy_version int NOT NULL DEFAULT 1 CHECK(content_policy_version=1), renderer_version text NOT NULL DEFAULT '1',
 provenance_revision bigint NOT NULL CHECK(provenance_revision>=0), provenance_complete boolean NOT NULL, provenance_manifest_hash text NOT NULL CHECK(provenance_manifest_hash ~ '^[a-f0-9]{64}$'), provenance_inputs jsonb NOT NULL CHECK(jsonb_typeof(provenance_inputs)='array' AND octet_length(provenance_inputs::text)<=65536),
 baseline_areas text[] NOT NULL, baseline_hash text NOT NULL CHECK(baseline_hash ~ '^[a-f0-9]{64}$'),
 restored_from_version int, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), purged_at timestamptz, accounted_bytes bigint NOT NULL DEFAULT 0 CHECK(accounted_bytes>=0),
 PRIMARY KEY(canvas_id,version), UNIQUE(canvas_id,version,conversation_id,owner_user_id),
 FOREIGN KEY(canvas_id,conversation_id,owner_user_id) REFERENCES ask_canvases(id,conversation_id,owner_user_id) ON DELETE RESTRICT,
 FOREIGN KEY(canvas_id,restored_from_version) REFERENCES ask_canvas_versions(canvas_id,version) ON DELETE RESTRICT,
 CHECK((purged_at IS NULL AND title IS NOT NULL AND summary IS NOT NULL AND change_note IS NOT NULL AND source_text IS NOT NULL AND octet_length(source_text)=source_bytes) OR (purged_at IS NOT NULL AND title IS NULL AND summary IS NULL AND change_note IS NULL AND source_text IS NULL AND canonical_content IS NULL))
);
ALTER TABLE ask_canvases ADD CONSTRAINT ask_canvas_latest_fk FOREIGN KEY(id,latest_version) REFERENCES ask_canvas_versions(canvas_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE ask_canvas_requests (
 conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT, request_id uuid NOT NULL, owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, action text NOT NULL CHECK(action IN ('show','update','restore','delete')), input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 effective_policy_hash text NOT NULL, displayed_policy_revision bigint, declassification_ack_hash text,
 canvas_id uuid NOT NULL, version int NOT NULL, run_id uuid REFERENCES dev_agent_runs(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(conversation_id,request_id), FOREIGN KEY(canvas_id,version,conversation_id,owner_user_id) REFERENCES ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id) ON DELETE RESTRICT
);
CREATE TABLE ask_canvas_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT,
 owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, canvas_id uuid, version int, run_id uuid REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, kind text NOT NULL CHECK(kind IN ('created','updated','restored','deleted','rejected','floor_latest')), reason text CHECK(reason IN ('too big','not supported','not allowed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(canvas_id,version,conversation_id,owner_user_id) REFERENCES ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id) ON DELETE RESTRICT,
 CHECK((kind='rejected' AND canvas_id IS NULL AND version IS NULL AND run_id IS NOT NULL AND reason IS NOT NULL) OR (kind<>'rejected' AND canvas_id IS NOT NULL AND version IS NOT NULL AND reason IS NULL))
);
CREATE INDEX ask_canvas_events_thread_idx ON ask_canvas_events(conversation_id,id);
CREATE INDEX ask_canvases_picker_idx ON ask_canvases(conversation_id,updated_at DESC,id DESC);
CREATE INDEX ask_canvases_purge_idx ON ask_canvases(purge_after,id) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE TABLE ask_canvas_usage(scope_type text NOT NULL CHECK(scope_type IN ('global','owner','thread','run')),scope_id text NOT NULL,bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0),canvas_count int NOT NULL DEFAULT 0 CHECK(canvas_count>=0),version_count int NOT NULL DEFAULT 0 CHECK(version_count>=0),checkpoint bigint NOT NULL DEFAULT 0,PRIMARY KEY(scope_type,scope_id));
CREATE TABLE ask_canvas_rate_windows(actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,action_bucket text NOT NULL CHECK(action_bucket IN ('content','render','save')),window_start timestamptz NOT NULL,accepted_count int NOT NULL CHECK(accepted_count BETWEEN 1 AND 10),PRIMARY KEY(actor_user_id,action_bucket,window_start));
ALTER TABLE ask_canvas_maintenance ADD COLUMN canvas_cursor uuid, ADD COLUMN canvas_checkpoint bigint NOT NULL DEFAULT 0, ADD COLUMN canvas_reconcile_required boolean NOT NULL DEFAULT false;
-- No second lease: all phases use the 0105 lease, fencing token and journal lock.
CREATE FUNCTION guard_ask_canvas() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c ask_canvases; t ai_conversations; r dev_agent_runs; areas text[]; BEGIN
 IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private canvas denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(106,1);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'canvas shells retained' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM ai_conversations WHERE id=NEW.conversation_id FOR UPDATE;
 IF t.id IS NULL OR t.owner_user_id IS DISTINCT FROM NEW.owner_user_id THEN RAISE EXCEPTION 'canvas thread mismatch' USING ERRCODE='42501'; END IF;
 IF NOT (SELECT recovery_ready FROM ask_canvas_maintenance WHERE singleton) AND current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'ASK_PAUSED'; END IF;
 IF t.deleted_at IS NOT NULL AND current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'canvas thread deleted' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='ask_canvases' THEN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.conversation_id,NEW.owner_user_id,NEW.created_run_id,NEW.kind,NEW.project_id,NEW.lead_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.conversation_id,OLD.owner_user_id,OLD.created_run_id,OLD.kind,OLD.project_id,OLD.lead_id,OLD.created_at) THEN RAISE EXCEPTION 'immutable canvas identity' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (NOT NEW.required_areas @> OLD.required_areas OR NEW.latest_version<OLD.latest_version OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)) THEN RAISE EXCEPTION 'canvas policy cannot shrink' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'journaled canvas deletion required' USING ERRCODE='42501'; END IF;
  IF TG_OP='INSERT' THEN
   SELECT * INTO r FROM dev_agent_runs WHERE id=NEW.created_run_id;
   IF r.conversation_id IS DISTINCT FROM t.id OR r.principal_user_id IS DISTINCT FROM NEW.owner_user_id OR r.launch_source NOT IN ('panel_web','panel_mobile','panel_voice') OR r.status NOT IN ('pending','running') THEN RAISE EXCEPTION 'canvas run mismatch' USING ERRCODE='42501'; END IF;
   IF (SELECT count(*) FROM ask_canvases WHERE conversation_id=t.id AND purged_at IS NULL)>=20 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME<>'ask_canvas_versions' OR current_setting('sjcos.ask_purge',true) IS DISTINCT FROM 'yes' OR OLD.purged_at IS NOT NULL OR NEW.purged_at IS NULL THEN RAISE EXCEPTION 'immutable canvas record' USING ERRCODE='42501'; END IF;
   SELECT * INTO c FROM ask_canvases WHERE id=OLD.canvas_id;
   IF c.deleted_at IS NULL OR c.purge_after>clock_timestamp() OR c.hold_until>clock_timestamp() OR t.purge_hold THEN RAISE EXCEPTION 'canvas purge not due' USING ERRCODE='42501'; END IF;
   IF (to_jsonb(NEW)-ARRAY['title','summary','change_note','source_text','canonical_content','purged_at','accounted_bytes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['title','summary','change_note','source_text','canonical_content','purged_at','accounted_bytes']) THEN RAISE EXCEPTION 'immutable canvas shell'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.actor_user_id IS DISTINCT FROM NEW.owner_user_id THEN RAISE EXCEPTION 'canvas actor mismatch' USING ERRCODE='42501'; END IF;
  IF NEW.run_id IS NOT NULL THEN
   SELECT * INTO r FROM dev_agent_runs WHERE id=NEW.run_id;
   IF r.conversation_id IS DISTINCT FROM t.id OR r.principal_user_id IS DISTINCT FROM NEW.owner_user_id OR r.status NOT IN ('pending','running') OR (r.cancellation_requested AND NOT (TG_TABLE_NAME='ask_canvas_events' AND to_jsonb(NEW)->>'kind'='rejected')) OR r.launch_source NOT IN ('panel_web','panel_mobile','panel_voice') THEN RAISE EXCEPTION 'canvas run mismatch' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_TABLE_NAME='ask_canvas_versions' THEN
   SELECT * INTO c FROM ask_canvases WHERE id=NEW.canvas_id FOR UPDATE;
   IF c.deleted_at IS NOT NULL OR NEW.version<>COALESCE((SELECT max(version)+1 FROM ask_canvas_versions WHERE canvas_id=c.id),1) THEN RAISE EXCEPTION 'invalid canvas version'; END IF;
   IF c.kind='floor_plan' THEN RAISE EXCEPTION 'UNSUPPORTED_KIND'; END IF;
   IF c.kind='diagram' AND NEW.source_bytes>32768 THEN RAISE EXCEPTION 'CONTENT_TOO_LARGE'; END IF;
   IF NEW.canonical_content IS NOT NULL AND octet_length(NEW.canonical_content::text)>262144 THEN RAISE EXCEPTION 'CONTENT_TOO_LARGE'; END IF;
   IF NOT NEW.baseline_areas @> c.required_areas THEN RAISE EXCEPTION 'canvas baseline mismatch'; END IF;
  ELSIF NEW.canvas_id IS NOT NULL THEN
   SELECT * INTO c FROM ask_canvases WHERE id=NEW.canvas_id;
   IF c.deleted_at IS NOT NULL AND NOT(((TG_TABLE_NAME='ask_canvas_events' AND to_jsonb(NEW)->>'kind'='deleted') OR (TG_TABLE_NAME='ask_canvas_requests' AND to_jsonb(NEW)->>'action'='delete')) AND current_setting('sjcos.ask_purge',true)='yes') THEN RAISE EXCEPTION 'canvas deleted'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='ask_canvases' THEN areas=NEW.required_areas; ELSIF TG_TABLE_NAME='ask_canvas_versions' THEN areas=NEW.baseline_areas; ELSE RETURN NEW; END IF;
 IF NOT areas <@ ARRAY['today','inbox','comms','chat','leads','subs','vendors','site','newsletter','catalog','compliance','warranty','marketing','engine','estimates','invoices','purchase_orders','change_orders','bidding','cost_book','money']::text[] OR cardinality(areas)<>(SELECT count(DISTINCT x) FROM unnest(areas) x) THEN RAISE EXCEPTION 'invalid canvas areas'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_canvas() FROM PUBLIC;
CREATE TRIGGER guard_ask_canvas BEFORE INSERT OR UPDATE OR DELETE ON ask_canvases FOR EACH ROW EXECUTE FUNCTION guard_ask_canvas();
CREATE TRIGGER guard_ask_canvas_version BEFORE INSERT OR UPDATE OR DELETE ON ask_canvas_versions FOR EACH ROW EXECUTE FUNCTION guard_ask_canvas();
CREATE TRIGGER guard_ask_canvas_request BEFORE INSERT OR UPDATE OR DELETE ON ask_canvas_requests FOR EACH ROW EXECUTE FUNCTION guard_ask_canvas();
CREATE TRIGGER guard_ask_canvas_event BEFORE INSERT OR UPDATE OR DELETE ON ask_canvas_events FOR EACH ROW EXECUTE FUNCTION guard_ask_canvas();
CREATE FUNCTION account_ask_canvas_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE delta bigint; k text; sid text; cap bigint; used bigint; accepted int; run_count int; BEGIN
 PERFORM pg_advisory_xact_lock(106,1);
 IF TG_OP='INSERT' THEN
  IF COALESCE((SELECT bytes FROM ask_canvas_usage WHERE scope_type='global' AND scope_id='global'),0) IS DISTINCT FROM (SELECT COALESCE(sum(accounted_bytes),0) FROM ask_canvas_versions WHERE purged_at IS NULL) THEN RAISE EXCEPTION 'ASK_PAUSED'; END IF;
  IF (SELECT canvas_reconcile_required FROM ask_canvas_maintenance WHERE singleton) THEN RAISE EXCEPTION 'ASK_PAUSED'; END IF;
  -- Includes canonical content, provenance, metadata + conservative request/event/index overhead.
  NEW.accounted_bytes=octet_length(to_jsonb(NEW)::text)+4096;
  delta=NEW.accounted_bytes;
  INSERT INTO ask_canvas_rate_windows VALUES(NEW.actor_user_id,'content',to_timestamp(floor(extract(epoch FROM clock_timestamp())/60)*60),1) ON CONFLICT(actor_user_id,action_bucket,window_start) DO UPDATE SET accepted_count=ask_canvas_rate_windows.accepted_count+1 RETURNING accepted_count INTO accepted;
 ELSE delta=-OLD.accounted_bytes; NEW.accounted_bytes=0; END IF;
 FOR k,sid,cap IN SELECT * FROM (VALUES('global','global',1073741824::bigint),('owner',NEW.owner_user_id::text,209715200::bigint),('thread',NEW.conversation_id::text,20971520::bigint),('run',COALESCE(NEW.run_id::text,'human'),1073741824::bigint)) a LOOP
  IF k='run' AND NEW.run_id IS NULL THEN CONTINUE; END IF;
  INSERT INTO ask_canvas_usage(scope_type,scope_id,bytes,version_count) VALUES(k,sid,greatest(delta,0),CASE WHEN TG_OP='INSERT' THEN 1 ELSE 0 END) ON CONFLICT(scope_type,scope_id) DO UPDATE SET bytes=ask_canvas_usage.bytes+delta,version_count=ask_canvas_usage.version_count+CASE WHEN TG_OP='INSERT' THEN 1 ELSE 0 END,checkpoint=ask_canvas_usage.checkpoint+1 RETURNING bytes,version_count INTO used,run_count;
  IF used>cap OR (k='run' AND run_count>100) THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 END LOOP;
 RETURN NEW;
EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END $$;
REVOKE ALL ON FUNCTION account_ask_canvas_version() FROM PUBLIC;
CREATE TRIGGER zz_account_ask_canvas_version BEFORE INSERT OR UPDATE ON ask_canvas_versions FOR EACH ROW EXECUTE FUNCTION account_ask_canvas_version();
-- Extends existing thread replay/purge transactions, including old checkpoints:
-- a restored thread tombstone always fences source via the explicit thread predicate.
CREATE FUNCTION sync_ask_canvas_retention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NEW.deleted_at IS NOT NULL THEN
  UPDATE ask_canvases SET deleted_at=NEW.deleted_at,purge_after=NEW.purge_after,deletion_sequence=NEW.deletion_sequence WHERE conversation_id=NEW.id AND deleted_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sync_ask_canvas_retention() FROM PUBLIC;
CREATE TRIGGER sync_ask_canvas_retention AFTER UPDATE OF deleted_at,purged_at ON ai_conversations FOR EACH ROW EXECUTE FUNCTION sync_ask_canvas_retention();
-- No narrow grants generated; access is through the app adapter.
-- node scripts/db-roles-sql.mjs ask_canvases ask_canvas_versions ask_canvas_requests ask_canvas_events ask_canvas_usage ask_canvas_rate_windows ask_canvas_maintenance

-- Latest always names the complete last snapshot, even for direct website writes.
CREATE FUNCTION check_ask_canvas_latest() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cid uuid; BEGIN
 IF TG_TABLE_NAME='ask_canvases' THEN cid=NEW.id; ELSE cid=NEW.canvas_id; END IF;
 IF (SELECT latest_version FROM ask_canvases WHERE id=cid) IS DISTINCT FROM (SELECT max(version) FROM ask_canvas_versions WHERE canvas_id=cid) THEN RAISE EXCEPTION 'canvas latest mismatch'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION check_ask_canvas_latest() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER check_ask_canvas_latest AFTER INSERT OR UPDATE ON ask_canvases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ask_canvas_latest();
CREATE CONSTRAINT TRIGGER check_ask_canvas_version_latest AFTER INSERT ON ask_canvas_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ask_canvas_latest();

ALTER TABLE ask_canvas_maintenance ADD COLUMN canvas_reconcile_canvas uuid, ADD COLUMN canvas_reconcile_version int;
CREATE FUNCTION reconcile_ask_canvas_usage(lease uuid, token bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE state ask_canvas_maintenance; item record; k text; sid text; n int=0; BEGIN
 IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private maintenance denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(106,1);
 SELECT * INTO state FROM ask_canvas_maintenance WHERE singleton AND lease_owner=lease AND fencing_token=token AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ASK_STALE_LEASE'; END IF;
 IF NOT state.canvas_reconcile_required THEN
  IF NOT EXISTS(
   WITH actual AS (SELECT 'global'::text AS scope_type,'global'::text AS scope_id,COALESCE(sum(accounted_bytes),0) AS bytes FROM ask_canvas_versions
    UNION ALL SELECT 'owner',owner_user_id::text,sum(accounted_bytes) FROM ask_canvas_versions GROUP BY owner_user_id
    UNION ALL SELECT 'thread',conversation_id::text,sum(accounted_bytes) FROM ask_canvas_versions GROUP BY conversation_id
    UNION ALL SELECT 'run',run_id::text,sum(accounted_bytes) FROM ask_canvas_versions WHERE run_id IS NOT NULL GROUP BY run_id)
   SELECT 1 FROM actual FULL JOIN ask_canvas_usage u USING(scope_type,scope_id) WHERE COALESCE(actual.bytes,0)<>COALESCE(u.bytes,0)
  ) THEN RETURN true; END IF;
  INSERT INTO work_items(title,body,status,source_kind,source_id) SELECT 'Check canvas storage','Canvas storage counters needed repair. No source content is included.','waiting_on_human','maintenance','canvas-accounting-drift' WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='maintenance' AND source_id='canvas-accounting-drift');
  UPDATE ask_canvas_maintenance SET canvas_reconcile_required=true,canvas_reconcile_canvas=NULL,canvas_reconcile_version=NULL,health_code='CANVAS_ACCOUNTING_DRIFT' WHERE singleton;
  UPDATE ask_canvas_usage SET bytes=0,version_count=0,canvas_count=0,checkpoint=checkpoint+1;
  state.canvas_reconcile_canvas=NULL;state.canvas_reconcile_version=NULL;
 END IF;
 FOR item IN SELECT canvas_id,version,owner_user_id,conversation_id,run_id,accounted_bytes FROM ask_canvas_versions
  WHERE state.canvas_reconcile_canvas IS NULL OR (canvas_id,version)>(state.canvas_reconcile_canvas,state.canvas_reconcile_version) ORDER BY canvas_id,version LIMIT 40 LOOP
  FOR k,sid IN SELECT * FROM (VALUES('global','global'),('owner',item.owner_user_id::text),('thread',item.conversation_id::text),('run',item.run_id::text)) a LOOP
   IF sid IS NULL THEN CONTINUE; END IF;
   INSERT INTO ask_canvas_usage(scope_type,scope_id,bytes,version_count) VALUES(k,sid,item.accounted_bytes,1) ON CONFLICT(scope_type,scope_id) DO UPDATE SET bytes=ask_canvas_usage.bytes+excluded.bytes,version_count=ask_canvas_usage.version_count+1;
  END LOOP;
  UPDATE ask_canvas_maintenance SET canvas_reconcile_canvas=item.canvas_id,canvas_reconcile_version=item.version,canvas_checkpoint=canvas_checkpoint+1 WHERE singleton;n=n+1;
 END LOOP;
 IF n<40 THEN
 UPDATE ask_canvas_usage u SET canvas_count=(SELECT count(*) FROM ask_canvases c WHERE c.purged_at IS NULL AND (u.scope_type='global' OR (u.scope_type='owner' AND c.owner_user_id::text=u.scope_id) OR (u.scope_type='thread' AND c.conversation_id::text=u.scope_id)));
 UPDATE ask_canvas_maintenance SET canvas_reconcile_required=false,health_code=NULL WHERE singleton;RETURN n=0; END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION reconcile_ask_canvas_usage(uuid,bigint) FROM PUBLIC;

CREATE FUNCTION account_ask_canvas_parent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE delta int; k text; sid text; BEGIN
 delta=CASE WHEN TG_OP='INSERT' THEN 1 WHEN OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL THEN -1 ELSE 0 END;
 IF delta=0 THEN RETURN NEW; END IF;
 FOR k,sid IN SELECT * FROM (VALUES('global','global'),('owner',NEW.owner_user_id::text),('thread',NEW.conversation_id::text)) a LOOP
  INSERT INTO ask_canvas_usage(scope_type,scope_id,canvas_count) VALUES(k,sid,greatest(delta,0)) ON CONFLICT(scope_type,scope_id) DO UPDATE SET canvas_count=ask_canvas_usage.canvas_count+delta,checkpoint=ask_canvas_usage.checkpoint+1;
 END LOOP; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION account_ask_canvas_parent() FROM PUBLIC;
CREATE TRIGGER account_ask_canvas_parent AFTER INSERT OR UPDATE OF purged_at ON ask_canvases FOR EACH ROW EXECUTE FUNCTION account_ask_canvas_parent();
-- One bounded source-free refusal per admitted run; successful writes clear it.
CREATE TABLE ask_canvas_attempts (
 run_id uuid PRIMARY KEY REFERENCES dev_agent_runs(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(reason IN ('too big','not supported','not allowed'))
);
REVOKE ALL ON ask_canvas_attempts FROM PUBLIC;
CREATE UNIQUE INDEX ask_canvas_rejected_once ON ask_canvas_events(run_id) WHERE kind='rejected';
CREATE FUNCTION finalize_ask_canvas_rejection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE why text; fallback text; t ai_conversations; u users; BEGIN
 IF NEW.status NOT IN ('done','error') OR OLD.status NOT IN ('pending','running') THEN RETURN NEW; END IF;
 SELECT reason INTO why FROM ask_canvas_attempts WHERE run_id=NEW.id;
 IF why IS NULL THEN RETURN NEW; END IF;
 IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'canvas rejection denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(106,1);
 SELECT * INTO t FROM ai_conversations WHERE id=NEW.conversation_id FOR UPDATE;
 SELECT * INTO u FROM users WHERE id=NEW.principal_user_id;
 IF t.deleted_at IS NOT NULL OR t.owner_user_id IS DISTINCT FROM u.id OR NOT u.active OR
 NOT (u.role='owner' OR (u.role='staff' AND 'ai'=ANY(u.permissions))) OR NEW.launch_source NOT IN ('panel_web','panel_mobile','panel_voice') OR
 EXISTS(SELECT 1 FROM session_revocations WHERE user_id=u.id AND revoked_before>NEW.created_at) THEN RETURN NEW; END IF;
 PERFORM set_config('sjcos.ask_actor',u.id::text,true);
 INSERT INTO ask_canvas_events(conversation_id,owner_user_id,run_id,actor_user_id,kind,reason)
 VALUES(t.id,u.id,NEW.id,u.id,'rejected',why) ON CONFLICT(run_id) WHERE kind='rejected' DO NOTHING;
 fallback='Canvas could not be created ('||why||'). Continue with a plain-text explanation in this chat.';
 NEW.answer=concat_ws(E'\n\n',nullif(NEW.answer,''),fallback);
 DELETE FROM ask_canvas_attempts WHERE run_id=NEW.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finalize_ask_canvas_rejection() FROM PUBLIC;
CREATE TRIGGER finalize_ask_canvas_rejection BEFORE UPDATE OF status ON dev_agent_runs FOR EACH ROW EXECUTE FUNCTION finalize_ask_canvas_rejection();
-- node scripts/db-roles-sql.mjs ask_canvas_attempts
-- No narrow grants generated; website-only admitted command and terminal trigger.

-- Acquire event/quota serialization BEFORE UPDATE takes any run row lock.
-- The row trigger then takes the owned thread and allocates the event ID.
CREATE FUNCTION lock_ask_canvas_terminal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM pg_advisory_xact_lock(106,1); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION lock_ask_canvas_terminal() FROM PUBLIC;
CREATE TRIGGER lock_ask_canvas_terminal BEFORE UPDATE OF status ON dev_agent_runs FOR EACH STATEMENT EXECUTE FUNCTION lock_ask_canvas_terminal();
