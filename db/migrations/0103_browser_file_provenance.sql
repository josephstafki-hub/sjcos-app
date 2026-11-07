-- File save ledger only. No reader/upload route enabled until Phase 2 census.
ALTER TABLE files ADD COLUMN IF NOT EXISTS browser_private boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS browser_source_task_id uuid REFERENCES browser_tasks(id) ON DELETE RESTRICT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS browser_cipher_envelope jsonb;
ALTER TABLE files ADD COLUMN IF NOT EXISTS browser_sha256 bytea CHECK(octet_length(browser_sha256)=32);
ALTER TABLE files DROP CONSTRAINT IF EXISTS browser_file_envelope;
ALTER TABLE files ADD CONSTRAINT browser_file_envelope CHECK((browser_private AND browser_cipher_envelope IS NOT NULL AND jsonb_typeof(browser_cipher_envelope)='object' AND browser_cipher_envelope->>'version'='1' AND browser_cipher_envelope->>'purpose'='saved_file' AND browser_source_task_id IS NOT NULL) OR (NOT browser_private AND browser_cipher_envelope IS NULL));
CREATE TABLE IF NOT EXISTS browser_file_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,artifact_id uuid NOT NULL,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 file_id text UNIQUE REFERENCES files(id) ON DELETE RESTRICT,download_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','committed','trashed','purge_pending','purged','failed')),
 reserved_file_id text NOT NULL UNIQUE,sha256 bytea NOT NULL CHECK(octet_length(sha256)=32),private boolean NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,safe_error_code varchar(80) CHECK(safe_error_code ~ '^[A-Z0-9_]{1,80}$'),
 staging_handle uuid NOT NULL UNIQUE,publish_digest bytea CHECK(octet_length(publish_digest)=32),ready_at timestamptz,tombstoned_at timestamptz,deleted_at timestamptz,
 expected_revision int NOT NULL DEFAULT 1 CHECK(expected_revision>0),display_envelope jsonb CHECK(browser_schema_envelope(display_envelope)),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(task_id,download_id),
 FOREIGN KEY(artifact_id,task_id) REFERENCES browser_artifacts(id,task_id) ON DELETE RESTRICT,
 CHECK(file_id IS NULL OR file_id=reserved_file_id),CHECK(state<>'committed' OR (file_id IS NOT NULL AND publish_digest IS NOT NULL AND ready_at IS NOT NULL)),
 CHECK(state<>'purged' OR (file_id IS NULL AND deleted_at IS NOT NULL AND tombstoned_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION guard_browser_file_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t browser_tasks%ROWTYPE;a browser_artifacts%ROWTYPE;f files%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='files' THEN
  IF TG_OP='INSERT' AND NEW.browser_source_task_id IS NULL AND NOT NEW.browser_private THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' AND OLD.browser_source_task_id IS NULL AND NOT OLD.browser_private AND (TG_OP='DELETE' OR (NEW.browser_source_task_id IS NULL AND NOT NEW.browser_private)) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF NOT browser_schema_website() THEN RAISE EXCEPTION 'BROWSER_FILE_DENIED' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM browser_file_links WHERE reserved_file_id=OLD.id AND state NOT IN ('trashed','purge_pending','purged')) THEN RAISE EXCEPTION 'BROWSER_TRASH_FIRST' USING ERRCODE='42501'; END IF; RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.browser_private,NEW.browser_source_task_id,NEW.browser_cipher_envelope,NEW.browser_sha256,NEW.sha256) IS DISTINCT FROM ROW(OLD.id,OLD.browser_private,OLD.browser_source_task_id,OLD.browser_cipher_envelope,OLD.browser_sha256,OLD.sha256) THEN RAISE EXCEPTION 'BROWSER_PROVENANCE_IMMUTABLE' USING ERRCODE='42501'; END IF;
  IF NEW.browser_private AND NOT coalesce(browser_schema_envelope(NEW.browser_cipher_envelope),false) THEN RAISE EXCEPTION 'BROWSER_ENVELOPE_BINDING' USING ERRCODE='23514'; END IF;
  IF NEW.browser_private AND (NEW.client_visible OR NEW.client_slug IS NOT NULL OR NEW.name !~ '^Private browser file [a-f0-9-]+[.](pdf|png|jpg)$' OR coalesce(NEW.subtitle,'')<>'' OR coalesce(NEW.tag,'')<>'' OR cardinality(NEW.ai_tags)>0) THEN RAISE EXCEPTION 'BROWSER_PRIVATE_METADATA' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT browser_schema_website() OR TG_OP='DELETE' THEN RAISE EXCEPTION 'BROWSER_FILE_DENIED' USING ERRCODE='42501'; END IF;
  SELECT * INTO t FROM browser_tasks WHERE id=NEW.task_id FOR UPDATE;
  SELECT * INTO a FROM browser_artifacts WHERE id=NEW.artifact_id;
  IF t.project_id IS DISTINCT FROM NEW.project_id OR a.task_id IS DISTINCT FROM NEW.task_id OR a.kind<>'quarantine_file' OR a.sanitizer_result IS DISTINCT FROM 'validated' OR a.sanitizer_build IS NULL OR a.signature_version IS NULL OR a.sanitizer_policy IS NULL OR a.download_id IS DISTINCT FROM NEW.download_id OR a.sanitized_ciphertext_hash IS DISTINCT FROM NEW.sha256 OR (a.private AND NOT NEW.private) OR (t.private AND NOT NEW.private) THEN RAISE EXCEPTION 'BROWSER_FILE_PROVENANCE' USING ERRCODE='42501'; END IF;
  IF NEW.file_id IS NOT NULL THEN
   SELECT * INTO f FROM files WHERE id=NEW.file_id;
   IF NOT FOUND OR f.browser_source_task_id IS DISTINCT FROM NEW.task_id OR f.browser_private IS DISTINCT FROM NEW.private OR f.sha256 IS DISTINCT FROM encode(NEW.sha256,'hex') THEN RAISE EXCEPTION 'BROWSER_FILE_PROVENANCE' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['file_id','state','safe_error_code','publish_digest','ready_at','tombstoned_at','deleted_at','expected_revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['file_id','state','safe_error_code','publish_digest','ready_at','tombstoned_at','deleted_at','expected_revision','updated_at']) OR NEW.expected_revision<>OLD.expected_revision+1 OR OLD.state='purged') THEN RAISE EXCEPTION 'BROWSER_PROVENANCE_IMMUTABLE' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_browser_file_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_browser_file_schema ON files;
CREATE TRIGGER guard_browser_file_schema BEFORE INSERT OR UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION guard_browser_file_schema();
DROP TRIGGER IF EXISTS guard_browser_file_schema ON browser_file_links;
CREATE TRIGGER guard_browser_file_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_file_links FOR EACH ROW EXECUTE FUNCTION guard_browser_file_schema();
-- Restrictive policy composes with Canvas 0108's permissive partition, rather
-- than an OR policy which would accidentally reopen private canvas rows.
CREATE OR REPLACE FUNCTION browser_file_website() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT browser_schema_website() $$;
REVOKE ALL ON FUNCTION browser_file_website() FROM PUBLIC;
-- Nonsecret predicate only; RLS needs EXECUTE for existing files readers.
GRANT EXECUTE ON FUNCTION browser_file_website() TO PUBLIC;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS browser_files_ordinary ON files;
CREATE POLICY browser_files_ordinary ON files USING(coalesce(to_jsonb(files)->>'security_profile','')='') WITH CHECK(coalesce(to_jsonb(files)->>'security_profile','')='');
DROP POLICY IF EXISTS browser_files_private ON files;
CREATE POLICY browser_files_private ON files AS RESTRICTIVE USING(browser_file_website() OR NOT browser_private) WITH CHECK(browser_file_website() OR NOT browser_private);

-- node scripts/db-roles-sql.mjs browser_file_links
-- Output: empty (all of these tables intentionally grant no narrow privileges).
DO $$ DECLARE tab text; r text; BEGIN
 FOREACH tab IN ARRAY ARRAY['browser_file_links'] LOOP
 EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',tab);
 FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly','sjcos_browser','sjcos_browser_reader'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',tab,r); END IF;
 END LOOP;
 END LOOP; END $$;
