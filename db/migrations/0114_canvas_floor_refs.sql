-- Phase 3: immutable canonical floor snapshots; Canvas only retains references.
DO $$ BEGIN
 IF to_regclass('ask_canvas_versions') IS NULL THEN RAISE EXCEPTION '0114 requires 0106'; END IF;
END $$;
CREATE FUNCTION plan_snapshot_hash(doc jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT
 SET search_path = public, pg_temp AS $$ SELECT encode(sha256(convert_to(doc::text,'UTF8')),'hex') $$;
ALTER TABLE plan_design_versions ADD COLUMN doc_sha256 text, ADD COLUMN source_rev integer;
UPDATE plan_design_versions SET doc_sha256=plan_snapshot_hash(doc);
ALTER TABLE plan_design_versions ALTER COLUMN doc_sha256 SET NOT NULL,
 ADD CONSTRAINT plan_snapshot_hash_valid CHECK(doc_sha256=plan_snapshot_hash(doc)),
 ADD CONSTRAINT plan_snapshot_rev_valid CHECK(source_rev IS NULL OR source_rev>=0),
 ADD CONSTRAINT plan_snapshot_design_identity UNIQUE(id,design_id);
CREATE INDEX plan_snapshot_hash_lookup ON plan_design_versions(design_id,doc_sha256);
-- Every allocator, including legacy web writers, serializes on the live row.
-- The app command additionally migrates/validates and checks rev in that lock.
CREATE FUNCTION plan_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.design_id,NEW.number,NEW.doc,NEW.doc_sha256,NEW.source_rev) IS DISTINCT FROM ROW(OLD.id,OLD.design_id,OLD.number,OLD.doc,OLD.doc_sha256,OLD.source_rev) THEN
   RAISE EXCEPTION 'immutable floor snapshot' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 SELECT rev INTO STRICT r FROM plan_designs WHERE id=NEW.design_id FOR UPDATE;
 SELECT COALESCE(MAX(number),0)+1 INTO NEW.number FROM plan_design_versions WHERE design_id=NEW.design_id;
 NEW.doc_sha256=plan_snapshot_hash(NEW.doc);
 -- Legacy callers can save historical bytes; do not invent their source rev.
 IF NEW.source_rev IS NOT NULL AND NEW.source_rev<>r THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER plan_snapshot_immutable BEFORE INSERT OR UPDATE ON plan_design_versions FOR EACH ROW EXECUTE FUNCTION plan_snapshot_immutable();
ALTER TABLE ask_canvas_requests ADD COLUMN changed boolean NOT NULL DEFAULT true;
CREATE TABLE ask_canvas_floor_refs (
 canvas_id uuid NOT NULL, version integer NOT NULL, design_id bigint NOT NULL, snapshot_id bigint NOT NULL,
 PRIMARY KEY(canvas_id,version),
 FOREIGN KEY(canvas_id,version) REFERENCES ask_canvas_versions(canvas_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(snapshot_id,design_id) REFERENCES plan_design_versions(id,design_id) ON DELETE RESTRICT,
 FOREIGN KEY(design_id) REFERENCES plan_designs(id) ON DELETE RESTRICT
);
CREATE INDEX ask_canvas_floor_design ON ask_canvas_floor_refs(design_id);
CREATE FUNCTION canvas_floor_reference_guard() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c ask_canvases; d plan_designs; lid uuid;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'immutable floor reference' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM ask_canvas_versions WHERE canvas_id=OLD.canvas_id AND version=OLD.version AND purged_at IS NULL) THEN RAISE EXCEPTION 'retained floor reference' USING ERRCODE='42501'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO STRICT c FROM ask_canvases WHERE id=NEW.canvas_id;
 SELECT * INTO STRICT d FROM plan_designs WHERE id=NEW.design_id FOR UPDATE;
 IF d.lead_slug IS NOT NULL THEN SELECT id INTO lid FROM leads WHERE slug=d.lead_slug; END IF;
 IF c.kind<>'floor_plan' OR d.is_template OR (d.project_id IS NULL AND lid IS NULL)
  OR c.project_id IS DISTINCT FROM d.project_id OR c.lead_id IS DISTINCT FROM lid
  OR c.deleted_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM ask_canvas_versions WHERE canvas_id=NEW.canvas_id AND version=NEW.version AND purged_at IS NULL) THEN
  RAISE EXCEPTION 'floor reference scope mismatch' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canvas_floor_reference_guard BEFORE INSERT OR UPDATE OR DELETE ON ask_canvas_floor_refs FOR EACH ROW EXECUTE FUNCTION canvas_floor_reference_guard();
CREATE FUNCTION canvas_floor_scope_guard() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF ROW(NEW.project_id,NEW.lead_slug,NEW.is_template) IS DISTINCT FROM ROW(OLD.project_id,OLD.lead_slug,OLD.is_template)
  AND EXISTS(SELECT 1 FROM ask_canvas_floor_refs WHERE design_id=OLD.id) THEN
  RAISE EXCEPTION 'retained floor scope' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canvas_floor_scope_guard BEFORE UPDATE ON plan_designs FOR EACH ROW EXECUTE FUNCTION canvas_floor_scope_guard();
CREATE FUNCTION canvas_floor_payload_lifecycle() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NEW.purged_at IS NOT NULL THEN
  DELETE FROM ask_canvas_floor_refs WHERE canvas_id=NEW.canvas_id AND version=NEW.version;
 ELSIF (SELECT kind FROM ask_canvases WHERE id=NEW.canvas_id)='floor_plan' AND NOT EXISTS(
  SELECT 1 FROM ask_canvas_floor_refs WHERE canvas_id=NEW.canvas_id AND version=NEW.version
 ) THEN RAISE EXCEPTION 'floor snapshot reference required';
 END IF;
 IF NEW.purged_at IS NULL AND (SELECT kind FROM ask_canvases WHERE id=NEW.canvas_id)='floor_plan' AND (
  NEW.canonical_content IS NOT NULL OR NEW.source_text::jsonb IS DISTINCT FROM (
   SELECT jsonb_build_object('kind','floor_plan','design_id',design_id::text,'snapshot_id',snapshot_id::text)
   FROM ask_canvas_floor_refs WHERE canvas_id=NEW.canvas_id AND version=NEW.version
  )
 ) THEN RAISE EXCEPTION 'floor payload must contain only its saved reference'; END IF;
 RETURN NULL;
END $$;
-- Deferred: the version and its reference must commit together, while the
-- existing retention writer need not know this extension's table name.
CREATE CONSTRAINT TRIGGER canvas_floor_payload_lifecycle AFTER INSERT OR UPDATE ON ask_canvas_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION canvas_floor_payload_lifecycle();
-- Private to owner app adapters. Generator output for ask_canvas_floor_refs is
-- empty: no narrow grants, including no SELECT to learn private references.
REVOKE ALL ON ask_canvas_floor_refs FROM PUBLIC;
INSERT INTO app_settings(key,value) VALUES('canvas.floor_enabled','false') ON CONFLICT(key) DO NOTHING;

-- Remove only the old Phase-1 kind gate, preserving every privacy/provenance
-- and retention guard verbatim. Fail migration if that contract has changed.
DO $upgrade$ DECLARE body text; old_gate text := 'IF c.kind=''floor_plan'' THEN RAISE EXCEPTION ''UNSUPPORTED_KIND''; END IF;'; BEGIN
 body=pg_get_functiondef('guard_ask_canvas()'::regprocedure);
 IF position(old_gate IN body)=0 THEN RAISE EXCEPTION '0114: review changed canvas guard'; END IF;
 EXECUTE replace(body,old_gate,'-- Floor references enforced by deferred 0114 lifecycle guard.');
END $upgrade$;
