-- Consult artifacts are never generic attachments, including before media commit.
ALTER TABLE files ADD COLUMN classification text NOT NULL DEFAULT 'attachment'
 CHECK(classification IN ('attachment','consult_photo','consult_initials'));
UPDATE files f SET classification=CASE WHEN m.kind='initials' THEN 'consult_initials' ELSE 'consult_photo' END
 FROM consult_media m WHERE m.file_id=f.id;
ALTER TABLE consult_uploads DROP CONSTRAINT consult_uploads_size_bytes_check;
ALTER TABLE consult_uploads ADD CHECK(size_bytes BETWEEN 1 AND 26214400);
ALTER TABLE consult_uploads ADD COLUMN instance_id uuid;
ALTER TABLE consult_uploads ADD COLUMN field_key text;
ALTER TABLE consult_uploads ADD COLUMN shot_key text;
ALTER TABLE consult_uploads ADD COLUMN generation bigint;
CREATE TABLE consult_upload_parts (
 upload_id uuid NOT NULL REFERENCES consult_uploads(id), n integer NOT NULL CHECK(n BETWEEN 0 AND 24),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 1048576),
 PRIMARY KEY(upload_id,n)
);
REVOKE ALL ON consult_upload_parts FROM PUBLIC,sjcos_agent,sjcos_worker,sjcos_readonly;
-- node scripts/db-roles-sql.mjs consult_upload_parts: (empty; website-only storage)
CREATE TABLE consult_quantity_contributions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),consult_id uuid NOT NULL REFERENCES consults(id),
 generation bigint NOT NULL,scope_key text NOT NULL,label text NOT NULL,unit text NOT NULL,
 quantity numeric(18,4) NOT NULL,manifest jsonb NOT NULL,source_hash text NOT NULL,
 finding_id uuid REFERENCES site_visit_findings(id),prior_quantities jsonb NOT NULL,
 superseded_at timestamptz,retracted_at timestamptz,
 UNIQUE(consult_id,generation,scope_key,label,unit)
);
ALTER TABLE site_visit_findings ADD COLUMN consult_id uuid REFERENCES consults(id);
ALTER TABLE site_visit_findings ADD COLUMN superseded_at timestamptz;
ALTER TABLE site_visit_findings ADD COLUMN retracted_at timestamptz;
ALTER TABLE site_visit_findings ALTER COLUMN measurement TYPE numeric(18,4);
REVOKE ALL ON consult_quantity_contributions FROM PUBLIC,sjcos_agent,sjcos_worker,sjcos_readonly;
-- node scripts/db-roles-sql.mjs consult_quantity_contributions: (empty; command-only)
CREATE TABLE consult_agent_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),consult_id uuid NOT NULL REFERENCES consults(id),
 operation_id uuid NOT NULL,actor uuid NOT NULL REFERENCES users(id),generation bigint NOT NULL,
 instance_id uuid NOT NULL,field_key text NOT NULL,base_revision bigint NOT NULL,
 answer jsonb NOT NULL,source_note text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','used','rejected','expired')),
 decided_by uuid REFERENCES users(id),decided_at timestamptz,
 UNIQUE(consult_id,operation_id,instance_id,field_key),
 FOREIGN KEY(consult_id,instance_id) REFERENCES consult_instances(consult_id,id)
);
REVOKE ALL ON consult_agent_proposals FROM PUBLIC,sjcos_agent,sjcos_worker,sjcos_readonly;
-- node scripts/db-roles-sql.mjs consult_agent_proposals: (empty; command-only)
ALTER TABLE estimate_gaps DROP CONSTRAINT estimate_gaps_kind_check;
ALTER TABLE estimate_gaps ADD CHECK(kind IN ('unknown_cost','missing_quantity','missing_unit','units_mismatch','stale_price','missing_quote','unallocated_scope','unverified_assumption','coverage_missing','competing_quotes','offer_changed','missing_freight','missing_tax','partial_choice','consult_not_complete','consult_conflict','trade_walk_pending','flag_sub_must_look','assumption_to_verify','rrp_cert_missing'));
-- Reopen immediately retracts this consult's owned contributions, preserving
-- every other source. History and original quantities remain auditable.
CREATE FUNCTION consult_retract_generation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q record;source text;
BEGIN
 IF NEW.completion_generation=OLD.completion_generation THEN RETURN NEW; END IF;
 FOR q IN SELECT * FROM consult_quantity_contributions WHERE consult_id=NEW.id AND superseded_at IS NULL AND retracted_at IS NULL ORDER BY scope_key,label FOR UPDATE LOOP
  source:='consult:'||NEW.id||':'||q.scope_key||':'||q.label||':'||q.unit;
  UPDATE scope_items SET quantities=(SELECT coalesce(jsonb_agg(v),'[]') FROM jsonb_array_elements(quantities) v WHERE v->>'source' IS DISTINCT FROM source),revision=revision+1 WHERE project_id=NEW.project_id AND key=q.scope_key;
  UPDATE site_visit_findings SET retracted_at=now() WHERE id=q.finding_id;
 END LOOP;
 UPDATE consult_quantity_contributions SET retracted_at=now() WHERE consult_id=NEW.id AND superseded_at IS NULL AND retracted_at IS NULL;
 UPDATE consult_finding_applications SET status='superseded' WHERE consult_id=NEW.id AND status='applied';
 UPDATE consult_agent_proposals SET status='expired' WHERE consult_id=NEW.id AND status='pending';
 RETURN NEW;
END $$;
CREATE TRIGGER consult_retract_generation AFTER UPDATE OF completion_generation ON consults FOR EACH ROW EXECUTE FUNCTION consult_retract_generation();
REVOKE ALL ON FUNCTION consult_retract_generation() FROM PUBLIC;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
CREATE POLICY generic_attachment_rows ON files TO sjcos_agent,sjcos_worker,sjcos_readonly USING(classification='attachment') WITH CHECK(classification='attachment');
CREATE FUNCTION consult_file_class_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.classification<>'attachment' AND (NEW.classification,NEW.storage_path,NEW.sha256) IS DISTINCT FROM (OLD.classification,OLD.storage_path,OLD.sha256) THEN RAISE EXCEPTION 'consult artifact is immutable'; END IF;
 IF NEW.classification='attachment' AND (NEW.id LIKE 'consult-%' OR regexp_replace(NEW.storage_path,'^.*/','') LIKE 'consult-%') THEN RAISE EXCEPTION 'consult artifact cannot be an attachment'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consult_file_class_guard BEFORE INSERT OR UPDATE ON files FOR EACH ROW EXECUTE FUNCTION consult_file_class_guard();
REVOKE ALL ON FUNCTION consult_file_class_guard() FROM PUBLIC;
-- Reopen plan items only when their exact finding belonged to this consult.
CREATE FUNCTION consult_reopen_plan_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.completion_generation<>OLD.completion_generation AND NEW.site_visit_plan_id IS NOT NULL THEN
  UPDATE site_visit_plans p SET items=(SELECT coalesce(jsonb_agg(CASE WHEN EXISTS(SELECT 1 FROM site_visit_findings f WHERE f.id::text=item->>'finding_id' AND f.consult_id=NEW.id AND f.retracted_at IS NOT NULL) THEN (item-'finding_id')||'{"status":"open"}'::jsonb ELSE item END),'[]') FROM jsonb_array_elements(p.items) item) WHERE p.id=NEW.site_visit_plan_id AND p.revision=NEW.site_visit_plan_revision;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER consult_retract_plan AFTER UPDATE OF completion_generation ON consults FOR EACH ROW EXECUTE FUNCTION consult_reopen_plan_evidence();
REVOKE ALL ON FUNCTION consult_reopen_plan_evidence() FROM PUBLIC;
CREATE TABLE consult_agent_requests (
 actor uuid NOT NULL REFERENCES users(id),operation_id uuid NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(actor,operation_id)
);
REVOKE ALL ON consult_agent_requests FROM PUBLIC,sjcos_agent,sjcos_worker,sjcos_readonly;
-- node scripts/db-roles-sql.mjs consult_agent_requests: (empty; website bridge only)
CREATE FUNCTION consult_photos_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.photos_ok IS TRUE AND NOT EXISTS(
  SELECT 1 FROM consult_instances i JOIN consult_form_pins p ON p.consult_id=i.consult_id AND p.key=i.module_key AND p.kind='module'
  JOIN consult_form_versions v ON v.id=p.form_id
  LEFT JOIN consult_field_heads h ON h.consult_id=i.consult_id AND h.instance_id=i.id AND h.field_key='photos_ok'
  LEFT JOIN consult_answers a ON a.id=h.current_answer_id
  WHERE i.consult_id=c.id AND i.module_key='house' AND i.removed_at IS NULL
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.definition->'fields') f WHERE f->>'key'='photos_ok')
  AND (a.status IS DISTINCT FROM 'answered' OR a.value NOT IN ('true'::jsonb,'"yes"'::jsonb,'"Yes"'::jsonb))
 ) FROM consults c WHERE c.id=target
$$;
REVOKE ALL ON FUNCTION consult_photos_allowed(uuid) FROM PUBLIC;
