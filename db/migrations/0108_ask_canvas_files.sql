-- Immutable derivatives and job-file snapshots; shares the 0105 maintenance lease.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE id=107) THEN RAISE EXCEPTION '0108 requires 0106 and 0107'; END IF; END $$;
ALTER TABLE files ADD COLUMN security_profile text CHECK(security_profile IS NULL OR security_profile='canvas_static_v1'), ADD COLUMN canvas_policy jsonb, ADD COLUMN canvas_version int;
ALTER TABLE files ADD CONSTRAINT canvas_file_internal CHECK(security_profile IS NULL OR (NOT client_visible AND canvas_policy IS NOT NULL AND canvas_version>0 AND mime_type='text/html'));
CREATE TABLE ask_canvas_derivatives(
 canvas_id uuid NOT NULL,version int NOT NULL,renderer_version text NOT NULL,
 svg text,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),byte_count int NOT NULL CHECK(byte_count BETWEEN 1 AND 524288),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),purged_at timestamptz,
 PRIMARY KEY(canvas_id,version,renderer_version),FOREIGN KEY(canvas_id,version) REFERENCES ask_canvas_versions(canvas_id,version) ON DELETE RESTRICT,
 CHECK((purged_at IS NULL AND svg IS NOT NULL AND octet_length(svg)=byte_count) OR (purged_at IS NOT NULL AND svg IS NULL))
);
CREATE TABLE ask_canvas_file_saves(
 canvas_id uuid NOT NULL,version int NOT NULL,project_id uuid NOT NULL REFERENCES projects(id),format text NOT NULL DEFAULT 'html' CHECK(format='html'),generation int NOT NULL CHECK(generation>0),
 reserved_file_id text NOT NULL UNIQUE,file_id text UNIQUE REFERENCES files(id) ON DELETE SET NULL,
 saver_user_id uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL,input_hash text NOT NULL,policy jsonb NOT NULL,policy_hash text NOT NULL,policy_revision text NOT NULL,
 filename text NOT NULL,storage_path text NOT NULL UNIQUE,file_hash text NOT NULL,source_hash text NOT NULL,renderer_version text NOT NULL,render_hash text NOT NULL,
 removed_areas text[] NOT NULL,ack_hash text,ack_at timestamptz,auth_epoch bigint NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','ready','failed','trashed','removed')),attempts int NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),retry_at timestamptz NOT NULL DEFAULT now(),failure_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(canvas_id,version,project_id,format,generation),FOREIGN KEY(canvas_id,version) REFERENCES ask_canvas_versions(canvas_id,version),UNIQUE(saver_user_id,request_id),
 CHECK((state='ready')=(file_id IS NOT NULL))
);
CREATE UNIQUE INDEX ask_canvas_save_live ON ask_canvas_file_saves(canvas_id,version,project_id,format) WHERE state IN ('pending','ready','failed');
ALTER TABLE ask_canvas_maintenance ADD COLUMN save_checkpoint bigint NOT NULL DEFAULT 0,ADD COLUMN orphan_checkpoint bigint NOT NULL DEFAULT 0,ADD COLUMN save_cursor text,ADD COLUMN orphan_cursor text;
CREATE FUNCTION guard_canvas_file_records() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v ask_canvas_versions; c ask_canvases; BEGIN
 IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private canvas denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(106,1);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'canvas audit retained'; END IF;
 IF TG_TABLE_NAME='ask_canvas_derivatives' AND TG_OP='UPDATE' THEN
  IF current_setting('sjcos.ask_purge',true)='yes' AND NEW.svg IS NULL AND NEW.purged_at IS NOT NULL AND (to_jsonb(NEW)-'svg'-'purged_at')=(to_jsonb(OLD)-'svg'-'purged_at') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'immutable derivative';
 END IF;
 IF TG_TABLE_NAME='ask_canvas_file_saves' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['file_id','state','attempts','retry_at','failure_code','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['file_id','state','attempts','retry_at','failure_code','updated_at']) THEN RAISE EXCEPTION 'immutable snapshot policy'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO v FROM ask_canvas_versions WHERE canvas_id=NEW.canvas_id AND version=NEW.version;
 SELECT * INTO c FROM ask_canvases WHERE id=NEW.canvas_id;
 IF c.deleted_at IS NOT NULL OR v.purged_at IS NOT NULL OR NOT (SELECT recovery_ready FROM ask_canvas_maintenance WHERE singleton) OR (SELECT deleted_at IS NOT NULL FROM ai_conversations WHERE id=c.conversation_id) THEN RAISE EXCEPTION 'ASK_PAUSED'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_canvas_file_records() FROM PUBLIC;
CREATE TRIGGER guard_canvas_derivative BEFORE INSERT OR UPDATE OR DELETE ON ask_canvas_derivatives FOR EACH ROW EXECUTE FUNCTION guard_canvas_file_records();
CREATE TRIGGER guard_canvas_save BEFORE INSERT OR UPDATE OR DELETE ON ask_canvas_file_saves FOR EACH ROW EXECUTE FUNCTION guard_canvas_file_records();
-- Derivative bytes have their own counters so 0106 source reconciliation stays exact.
CREATE TABLE ask_canvas_derivative_usage(scope_type text NOT NULL,scope_id text NOT NULL,bytes bigint NOT NULL CHECK(bytes>=0),PRIMARY KEY(scope_type,scope_id));
CREATE FUNCTION account_canvas_derivative() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v ask_canvas_versions;k text;sid text;cap bigint;used bigint;delta bigint;BEGIN
 SELECT * INTO v FROM ask_canvas_versions WHERE canvas_id=NEW.canvas_id AND version=NEW.version;
 delta=CASE WHEN TG_OP='INSERT' THEN NEW.byte_count+512 ELSE -OLD.byte_count-512 END;
 IF TG_OP='UPDATE' AND OLD.purged_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
 INSERT INTO ask_canvas_rate_windows VALUES(v.actor_user_id,'render',to_timestamp(floor(extract(epoch FROM clock_timestamp())/60)*60),1) ON CONFLICT(actor_user_id,action_bucket,window_start) DO UPDATE SET accepted_count=ask_canvas_rate_windows.accepted_count+1;
 END IF;
 FOR k,sid,cap IN SELECT * FROM (VALUES('global','global',1073741824::bigint),('owner',v.owner_user_id::text,209715200::bigint),('thread',v.conversation_id::text,20971520::bigint)) x LOOP
 INSERT INTO ask_canvas_derivative_usage VALUES(k,sid,greatest(delta,0)) ON CONFLICT(scope_type,scope_id) DO UPDATE SET bytes=ask_canvas_derivative_usage.bytes+delta RETURNING bytes INTO used;
 IF used+COALESCE((SELECT bytes FROM ask_canvas_usage WHERE scope_type=k AND scope_id=sid),0)>cap THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION account_canvas_derivative() FROM PUBLIC;
CREATE TRIGGER zz_account_canvas_derivative AFTER INSERT OR UPDATE ON ask_canvas_derivatives FOR EACH ROW EXECUTE FUNCTION account_canvas_derivative();
CREATE FUNCTION canvas_file_website() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT session_user=ask_website_login() $$;
REVOKE ALL ON FUNCTION canvas_file_website() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canvas_file_website() TO PUBLIC;
-- Even forgotten narrow-role readers partition before names/counts/pagination.
ALTER TABLE files ENABLE ROW LEVEL SECURITY;ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_files_partition ON files USING(canvas_file_website() OR security_profile IS NULL) WITH CHECK(canvas_file_website() OR security_profile IS NULL);
ALTER TABLE file_trash ENABLE ROW LEVEL SECURITY;ALTER TABLE file_trash FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_trash_partition ON file_trash USING(canvas_file_website() OR row->>'security_profile' IS NULL) WITH CHECK(canvas_file_website() OR row->>'security_profile' IS NULL);
CREATE FUNCTION guard_canvas_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s ask_canvas_file_saves;BEGIN
 IF TG_TABLE_NAME='file_trash' THEN
  IF NEW.row->>'security_profile' IS NOT NULL AND (session_user<>ask_website_login() OR current_setting('sjcos.canvas_file_command',true) IS DISTINCT FROM 'yes') THEN RAISE EXCEPTION 'canvas adapter required' USING ERRCODE='42501'; END IF;RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.security_profile IS NOT NULL AND (NEW.security_profile IS DISTINCT FROM OLD.security_profile OR NEW.canvas_policy IS DISTINCT FROM OLD.canvas_policy OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.canvas_version IS DISTINCT FROM OLD.canvas_version OR NEW.project_key IS DISTINCT FROM OLD.project_key OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.client_visible) THEN RAISE EXCEPTION 'Canvas copies stay internal.'; END IF;
 IF (TG_OP='DELETE' AND OLD.security_profile IS NOT NULL) OR (TG_OP='INSERT' AND NEW.security_profile IS NOT NULL) THEN
 IF session_user<>ask_website_login() OR current_setting('sjcos.canvas_file_command',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'canvas adapter required' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='INSERT' AND NEW.security_profile IS NOT NULL THEN
 SELECT * INTO s FROM ask_canvas_file_saves WHERE reserved_file_id=NEW.id AND state IN ('pending','trashed');
 IF s.reserved_file_id IS NULL OR NEW.canvas_policy IS DISTINCT FROM s.policy OR NEW.canvas_version<>s.version OR NEW.sha256 IS DISTINCT FROM s.file_hash OR NEW.storage_path IS DISTINCT FROM s.storage_path OR NEW.project_key IS DISTINCT FROM (SELECT slug FROM projects WHERE id=s.project_id) THEN RAISE EXCEPTION 'immutable snapshot mismatch'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_canvas_snapshot() FROM PUBLIC;
CREATE TRIGGER guard_canvas_snapshot BEFORE INSERT OR UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION guard_canvas_snapshot();
CREATE TRIGGER guard_canvas_trash BEFORE INSERT OR UPDATE ON file_trash FOR EACH ROW EXECUTE FUNCTION guard_canvas_snapshot();
-- No grants: generator output for ask_canvas_derivatives ask_canvas_file_saves ask_canvas_derivative_usage is empty (website-only).
CREATE FUNCTION purge_canvas_derivative_for_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL THEN
 UPDATE ask_canvas_derivatives SET svg=NULL,purged_at=NEW.purged_at WHERE canvas_id=NEW.canvas_id AND version=NEW.version AND purged_at IS NULL;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION purge_canvas_derivative_for_version() FROM PUBLIC;
CREATE TRIGGER purge_canvas_derivative_for_version AFTER UPDATE OF purged_at ON ask_canvas_versions FOR EACH ROW EXECUTE FUNCTION purge_canvas_derivative_for_version();
CREATE FUNCTION canvas_combined_quota() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k text;sid text;cap bigint;BEGIN
 FOR k,sid,cap IN SELECT * FROM (VALUES('global','global',1073741824::bigint),('owner',NEW.owner_user_id::text,209715200::bigint),('thread',NEW.conversation_id::text,20971520::bigint)) x LOOP
 IF COALESCE((SELECT bytes FROM ask_canvas_usage WHERE scope_type=k AND scope_id=sid),0)+COALESCE((SELECT bytes FROM ask_canvas_derivative_usage WHERE scope_type=k AND scope_id=sid),0)>cap THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION canvas_combined_quota() FROM PUBLIC;
CREATE TRIGGER canvas_combined_quota AFTER INSERT ON ask_canvas_versions FOR EACH ROW EXECUTE FUNCTION canvas_combined_quota();
CREATE TABLE ask_canvas_file_requests(
 saver_user_id uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL,input_hash text NOT NULL,
 reserved_file_id text NOT NULL REFERENCES ask_canvas_file_saves(reserved_file_id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(saver_user_id,request_id)
);
ALTER TABLE ask_canvas_events DROP CONSTRAINT ask_canvas_events_kind_check;
ALTER TABLE ask_canvas_events ADD CONSTRAINT ask_canvas_events_kind_check CHECK(kind IN ('created','updated','restored','deleted','rejected','floor_latest','saved'));
ALTER TABLE ask_canvas_events ADD COLUMN saved_file_id text, ADD COLUMN saved_project_name text, ADD COLUMN saved_policy jsonb;
-- A snapshot cannot be reattached to any ordinary delivery/signature/publication
-- carrier, including a carrier not known to the current UI. Use the private
-- reserved-ID ledger (no RLS visibility dependency for a narrow session_user).
CREATE FUNCTION guard_canvas_external_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE col text;BEGIN
 FOR col IN SELECT a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND c.confrelid='files'::regclass AND c.conrelid=TG_RELID LOOP
 IF EXISTS(SELECT 1 FROM ask_canvas_file_saves WHERE reserved_file_id=to_jsonb(NEW)->>col) THEN RAISE EXCEPTION 'Canvas copies stay internal.' USING ERRCODE='42501'; END IF;
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_canvas_external_reference() FROM PUBLIC;
DO $$ DECLARE tab regclass;BEGIN
 FOR tab IN SELECT DISTINCT conrelid::regclass FROM pg_constraint WHERE contype='f' AND confrelid='files'::regclass AND conrelid<>'ask_canvas_file_saves'::regclass LOOP
 EXECUTE format('CREATE TRIGGER guard_canvas_external_reference BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION guard_canvas_external_reference()',tab);
 END LOOP;
END $$;
