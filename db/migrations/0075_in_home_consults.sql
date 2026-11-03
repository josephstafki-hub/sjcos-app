-- Phase 1 consult storage. Independent of 0073/0074; audio deliberately absent.
-- Signing keys are installed/rotated by the website owner, never by a narrow role.
CREATE TABLE consult_context_keys (
 key_id text PRIMARY KEY, secret bytea NOT NULL CHECK(octet_length(secret)>=32),
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE consult_form_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('module','template')),
 key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_]*$'), version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired')),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 checksum text NOT NULL, author uuid NOT NULL REFERENCES users(id),
 published_by uuid REFERENCES users(id), published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,key,version), UNIQUE(id,kind,key,version,checksum),
 CHECK((status='draft' AND published_at IS NULL AND published_by IS NULL) OR
       (status<>'draft' AND published_at IS NOT NULL AND published_by IS NOT NULL))
);
CREATE UNIQUE INDEX consult_one_published ON consult_form_versions(kind,key) WHERE status='published';
ALTER TABLE site_visit_plans ADD CONSTRAINT consult_plan_project UNIQUE(id,project_id,revision);
CREATE TABLE consults (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
 site_visit_plan_id uuid, site_visit_plan_revision integer,
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','captured','incomplete','complete','cancelled')),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), completion_generation bigint NOT NULL DEFAULT 1 CHECK(completion_generation>0),
 conducted_by uuid NOT NULL REFERENCES users(id), scheduled_at timestamptz NOT NULL,
 scheduled_by uuid NOT NULL REFERENCES users(id), started_at timestamptz, started_by uuid REFERENCES users(id),
 closed_at timestamptz, closed_by uuid REFERENCES users(id), completed_at timestamptz, completed_by uuid REFERENCES users(id),
 reopened_at timestamptz, reopened_by uuid REFERENCES users(id), reopen_reason text,
 consent_epoch bigint NOT NULL DEFAULT 0 CHECK(consent_epoch>=0), policy_version text NOT NULL,
 photos_ok boolean, client_ack_media_id uuid, client_ack_skip jsonb, promised_date date,
 completeness_cache jsonb NOT NULL DEFAULT '{}', work_item_refs jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,project_id), FOREIGN KEY(site_visit_plan_id,project_id,site_visit_plan_revision)
 REFERENCES site_visit_plans(id,project_id,revision),
 CHECK((site_visit_plan_id IS NULL)=(site_visit_plan_revision IS NULL))
);
-- Relational pins make checksum/membership constraints enforceable, not caller JSON.
CREATE TABLE consult_form_pins (
 consult_id uuid NOT NULL REFERENCES consults(id), form_id uuid NOT NULL,
 kind text NOT NULL, key text NOT NULL, version integer NOT NULL, checksum text NOT NULL,
 PRIMARY KEY(consult_id,kind,key), UNIQUE(consult_id,kind,key,version),
 FOREIGN KEY(form_id,kind,key,version,checksum) REFERENCES consult_form_versions(id,kind,key,version,checksum)
);
CREATE TABLE consult_assignments (
 consult_id uuid NOT NULL REFERENCES consults(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL DEFAULT 'visitor' CHECK(role='visitor'), -- helpers are Phase 4
 assigned_by uuid NOT NULL REFERENCES users(id), assigned_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(consult_id,user_id)
);
CREATE UNIQUE INDEX consult_one_visitor ON consult_assignments(consult_id) WHERE revoked_at IS NULL;
CREATE TABLE consult_devices (
 consult_id uuid NOT NULL REFERENCES consults(id), device_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 epoch bigint NOT NULL CHECK(epoch>0), revoked_at timestamptz, last_ack_seq bigint NOT NULL DEFAULT 0 CHECK(last_ack_seq>=0),
 close_manifest jsonb, close_ack_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(consult_id,device_id,epoch), UNIQUE(consult_id,device_id,epoch,user_id)
);
CREATE UNIQUE INDEX consult_one_capture ON consult_devices(consult_id) WHERE revoked_at IS NULL;
CREATE TABLE consult_instances (
 id uuid PRIMARY KEY, consult_id uuid NOT NULL REFERENCES consults(id), kind text NOT NULL DEFAULT 'module' CHECK(kind='module'),
 module_key text NOT NULL, module_version integer NOT NULL, label text NOT NULL, parent_id uuid,
 sort integer NOT NULL DEFAULT 0, repeatable boolean NOT NULL, removed_at timestamptz,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(consult_id,id), FOREIGN KEY(consult_id,parent_id) REFERENCES consult_instances(consult_id,id),
 FOREIGN KEY(consult_id,kind,module_key,module_version) REFERENCES consult_form_pins(consult_id,kind,key,version)
);
CREATE UNIQUE INDEX consult_once_module ON consult_instances(consult_id,module_key) WHERE NOT repeatable AND removed_at IS NULL;
CREATE TABLE consult_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), consult_id uuid NOT NULL REFERENCES consults(id), event_id uuid NOT NULL,
 actor uuid NOT NULL REFERENCES users(id), device_id uuid, device_epoch bigint,
 source text NOT NULL CHECK(source IN ('typed','agent','office','prefill')), type text NOT NULL,
 payload jsonb NOT NULL, payload_hash text NOT NULL, server_revision bigint NOT NULL CHECK(server_revision>=0),
 generation bigint NOT NULL CHECK(generation>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(consult_id,event_id), FOREIGN KEY(consult_id,device_id,device_epoch,actor) REFERENCES consult_devices(consult_id,device_id,epoch,user_id)
);
CREATE TABLE consult_answers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), consult_id uuid NOT NULL, instance_id uuid NOT NULL, field_key text NOT NULL,
 status text NOT NULL CHECK(status IN ('answered','skipped','cleared')), value jsonb, unit text,
 skip_reason text CHECK(skip_reason IN ('Not on this job','No access','Not safe to measure','Client declined','Get on return visit','Sub/supplier will measure','Other')), skip_note text,
 source text NOT NULL CHECK(source IN ('typed','office','prefill')), actor uuid NOT NULL REFERENCES users(id),
 device_id uuid, device_epoch bigint, event_id uuid NOT NULL, base_revision bigint NOT NULL CHECK(base_revision>=0),
 server_revision bigint NOT NULL CHECK(server_revision>0), generation bigint NOT NULL CHECK(generation>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(consult_id,event_id), UNIQUE(consult_id,instance_id,field_key,id),
 FOREIGN KEY(consult_id,instance_id) REFERENCES consult_instances(consult_id,id),
 FOREIGN KEY(consult_id,event_id) REFERENCES consult_events(consult_id,event_id),
 FOREIGN KEY(consult_id,device_id,device_epoch,actor) REFERENCES consult_devices(consult_id,device_id,epoch,user_id),
 CHECK((status='answered' AND value IS NOT NULL AND skip_reason IS NULL) OR
       (status='skipped' AND value IS NULL AND skip_reason IS NOT NULL) OR
       (status='cleared' AND value IS NULL AND skip_reason IS NULL))
);
CREATE TABLE consult_field_heads (
 consult_id uuid NOT NULL, instance_id uuid NOT NULL, field_key text NOT NULL, current_answer_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), locked_generation bigint,
 PRIMARY KEY(consult_id,instance_id,field_key),
 FOREIGN KEY(consult_id,instance_id,field_key,current_answer_id) REFERENCES consult_answers(consult_id,instance_id,field_key,id)
);
CREATE TABLE consult_conflicts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), consult_id uuid NOT NULL, instance_id uuid NOT NULL, field_key text NOT NULL,
 base_answer_id uuid, current_answer_id uuid NOT NULL, proposed_answer_id uuid NOT NULL,
 resolution_event uuid, resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(consult_id,instance_id,field_key,base_answer_id) REFERENCES consult_answers(consult_id,instance_id,field_key,id),
 FOREIGN KEY(consult_id,instance_id,field_key,current_answer_id) REFERENCES consult_answers(consult_id,instance_id,field_key,id),
 FOREIGN KEY(consult_id,instance_id,field_key,proposed_answer_id) REFERENCES consult_answers(consult_id,instance_id,field_key,id),
 FOREIGN KEY(consult_id,resolution_event) REFERENCES consult_events(consult_id,event_id),
 CHECK((resolved_at IS NULL AND resolved_by IS NULL AND resolution_event IS NULL) OR
       (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_event IS NOT NULL))
);
CREATE TABLE consult_media (
 id uuid PRIMARY KEY, consult_id uuid NOT NULL, instance_id uuid NOT NULL, field_key text, shot_key text,
 kind text NOT NULL CHECK(kind IN ('photo','sketch','markup','initials')), file_id text NOT NULL UNIQUE REFERENCES files(id),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), taken_at timestamptz NOT NULL,
 actor uuid NOT NULL REFERENCES users(id), event_id uuid NOT NULL, removed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(consult_id,id), FOREIGN KEY(consult_id,instance_id) REFERENCES consult_instances(consult_id,id),
 FOREIGN KEY(consult_id,event_id) REFERENCES consult_events(consult_id,event_id)
);
ALTER TABLE consults ADD CONSTRAINT consult_ack_media FOREIGN KEY(id,client_ack_media_id) REFERENCES consult_media(consult_id,id);
CREATE TABLE consult_operation_receipts (
 consult_id uuid NOT NULL, device_id uuid NOT NULL, device_epoch bigint NOT NULL, event_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'), result_code text NOT NULL,
 result_revision bigint NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(consult_id,device_id,event_id),
 FOREIGN KEY(consult_id,device_id,device_epoch) REFERENCES consult_devices(consult_id,device_id,epoch)
);
CREATE TABLE consult_uploads (
 id uuid PRIMARY KEY, consult_id uuid NOT NULL REFERENCES consults(id), actor uuid NOT NULL REFERENCES users(id),
 device_id uuid NOT NULL, device_epoch bigint NOT NULL, event_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('photo','sketch','markup','initials')), mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 part_manifest jsonb NOT NULL DEFAULT '[]', epoch bigint NOT NULL CHECK(epoch>0), expires_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','uploading','committed','expired','failed')),
 file_id text UNIQUE REFERENCES files(id), commit_receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(consult_id,event_id), FOREIGN KEY(consult_id,device_id,device_epoch,actor) REFERENCES consult_devices(consult_id,device_id,epoch,user_id),
 CHECK((status='committed')=(file_id IS NOT NULL AND commit_receipt IS NOT NULL))
);
CREATE TABLE consult_finding_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), consult_id uuid NOT NULL, project_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0), source_revision bigint NOT NULL CHECK(source_revision>0),
 source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'), status text NOT NULL CHECK(status IN ('pending','applied','failed','superseded')),
 provenance jsonb NOT NULL, result jsonb, applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(consult_id,generation), UNIQUE(consult_id,source_revision,source_hash),
 FOREIGN KEY(consult_id,project_id) REFERENCES consults(id,project_id)
);
INSERT INTO app_settings(key,value) VALUES ('consult_capture','false'),('consult_auto_apply_findings','false') ON CONFLICT(key) DO NOTHING;

CREATE FUNCTION consult_history_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'consult history is append only'; END $$;
CREATE TRIGGER consult_events_immutable BEFORE UPDATE OR DELETE ON consult_events FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();
CREATE TRIGGER consult_answers_immutable BEFORE UPDATE OR DELETE ON consult_answers FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();
CREATE TRIGGER consult_receipts_immutable BEFORE UPDATE OR DELETE ON consult_operation_receipts FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();
CREATE TRIGGER consult_pins_immutable BEFORE UPDATE OR DELETE ON consult_form_pins FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();

CREATE FUNCTION consult_form_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'published definition is immutable'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status<>'draft' AND
   (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.checksum<>OLD.checksum OR NEW.kind<>OLD.kind OR NEW.key<>OLD.key
    OR NEW.version<>OLD.version OR NEW.author<>OLD.author OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.status<>'retired') THEN
  RAISE EXCEPTION 'published definition is immutable';
 END IF;
 NEW.checksum:=encode(digest(NEW.definition::text,'sha256'),'hex');
 IF NEW.definition->>'key' IS DISTINCT FROM NEW.key OR (NEW.definition->>'version')::integer IS DISTINCT FROM NEW.version THEN
  RAISE EXCEPTION 'definition identity mismatch';
 END IF;
 IF NEW.kind='module' AND (jsonb_typeof(NEW.definition->'fields') IS DISTINCT FROM 'array' OR
  jsonb_typeof(NEW.definition->'repeatable') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'invalid module'; END IF;
 IF NEW.kind='template' AND jsonb_typeof(NEW.definition->'modules') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid template'; END IF;
 IF NEW.status='published' THEN PERFORM consult_validate_definition(NEW.definition,NEW.kind); END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER consult_form_guard BEFORE INSERT OR UPDATE OR DELETE ON consult_form_versions FOR EACH ROW EXECUTE FUNCTION consult_form_guard();
CREATE FUNCTION consult_instance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d jsonb; s text;
BEGIN
 SELECT c.status,f.definition INTO s,d FROM consults c JOIN consult_form_pins p ON p.consult_id=c.id
 JOIN consult_form_versions f ON f.id=p.form_id WHERE c.id=NEW.consult_id AND p.kind='module' AND p.key=NEW.module_key AND p.version=NEW.module_version FOR UPDATE OF c;
 IF NOT FOUND OR s NOT IN ('scheduled','in_progress','incomplete') THEN RAISE EXCEPTION 'instance is not editable'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.consult_id<>OLD.consult_id OR NEW.module_key<>OLD.module_key OR NEW.module_version<>OLD.module_version) THEN RAISE EXCEPTION 'instance identity is immutable'; END IF;
 NEW.repeatable:=(d->>'repeatable')::boolean;
 IF EXISTS(WITH RECURSIVE ancestors AS (
 SELECT id,parent_id FROM consult_instances WHERE consult_id=NEW.consult_id AND id=NEW.parent_id
 UNION SELECT i.id,i.parent_id FROM consult_instances i JOIN ancestors a ON i.id=a.parent_id WHERE i.consult_id=NEW.consult_id
 ) SELECT 1 FROM ancestors WHERE id=NEW.id) OR NEW.parent_id=NEW.id THEN RAISE EXCEPTION 'instance parent cycle'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consult_instance_guard BEFORE INSERT OR UPDATE ON consult_instances FOR EACH ROW EXECUTE FUNCTION consult_instance_guard();

-- Envelope {key_id,payload,signature}; payload is the exact signed UTF-8 JSON string.
-- Separate minting from verification: no narrow login can read keys or execute mint.
CREATE FUNCTION consult_verify_context(context jsonb, target uuid, operation text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE claims jsonb; k bytea; u users%ROWTYPE; expires numeric;
BEGIN
 SELECT secret INTO k FROM consult_context_keys WHERE key_id=context->>'key_id' AND revoked_at IS NULL;
 IF k IS NULL OR context->>'signature' IS DISTINCT FROM encode(hmac(convert_to(context->>'payload','UTF8'),k,'sha256'),'hex') THEN RAISE EXCEPTION 'invalid consult context' USING ERRCODE='42501'; END IF;
 claims:=(context->>'payload')::jsonb; expires:=(claims->>'exp')::numeric;
 IF expires IS NULL OR expires<=extract(epoch FROM clock_timestamp()) OR expires>extract(epoch FROM clock_timestamp())+300
 OR length(coalesce(claims->>'nonce',''))<16 OR length(coalesce(claims->>'run_id',''))=0
 OR claims->>'operation' IS DISTINCT FROM operation OR (claims->>'consult_id') IS DISTINCT FROM target::text
 OR claims->>'kind' IS DISTINCT FROM 'in_home_consult' OR claims->>'mode' IS NULL OR claims->>'mode' NOT IN ('person','agent') THEN
 RAISE EXCEPTION 'expired or out of scope consult context' USING ERRCODE='42501'; END IF;
 IF (claims->>'iat')::numeric IS NULL OR (claims->>'iat')::numeric>extract(epoch FROM clock_timestamp()) OR
 EXISTS(SELECT 1 FROM session_revocations WHERE user_id=(claims->>'sub')::uuid AND extract(epoch FROM revoked_before)>=(claims->>'iat')::numeric) THEN
 RAISE EXCEPTION 'revoked consult session' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM users WHERE id=(claims->>'sub')::uuid AND active;
 IF NOT FOUND OR u.role NOT IN ('owner','staff') OR claims->>'role' IS DISTINCT FROM u.role
 OR (u.role='staff' AND (NOT ('projects'=ANY(u.permissions)) OR NOT (claims->'areas' ? 'projects')))
 OR (target IS NOT NULL AND u.role<>'owner' AND NOT EXISTS(SELECT 1 FROM consult_assignments WHERE consult_id=target AND user_id=u.id AND revoked_at IS NULL)) THEN
 RAISE EXCEPTION 'consult access denied' USING ERRCODE='42501'; END IF;
 RETURN u.id;
END $$;
CREATE FUNCTION consult_mint_context(claims jsonb, key_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE payload text:=claims::text; k bytea;
BEGIN
 SELECT secret INTO STRICT k FROM consult_context_keys WHERE key_id=key_name AND revoked_at IS NULL;
 RETURN jsonb_build_object('key_id',key_name,'payload',payload,'signature',encode(hmac(convert_to(payload,'UTF8'),k,'sha256'),'hex'));
END $$;
CREATE FUNCTION consult_read(context jsonb, target uuid, projection text DEFAULT 'capture') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; result jsonb;
BEGIN
 actor:=consult_verify_context(context,target,'read');
 IF projection<>'capture' THEN RAISE EXCEPTION 'unsupported consult projection'; END IF;
 SELECT jsonb_build_object('consult',to_jsonb(c),
 'pins',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('definition',f.definition)),'[]') FROM consult_form_pins p JOIN consult_form_versions f ON f.id=p.form_id WHERE p.consult_id=c.id),
 'instances',(SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM consult_instances i WHERE i.consult_id=c.id),
 'heads',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id WHERE h.consult_id=c.id),
 'conflicts',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM consult_conflicts x WHERE x.consult_id=c.id AND x.resolved_at IS NULL)) INTO result FROM consults c WHERE c.id=target;
 IF result IS NULL THEN RAISE EXCEPTION 'consult not found'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION consult_propose_form(context jsonb, definition jsonb, form_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; result uuid;
BEGIN
 actor:=consult_verify_context(context,NULL,'propose_form');
 INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author)
 VALUES(form_kind,definition->>'key',(definition->>'version')::integer,definition,'',actor) RETURNING id INTO result;
 RETURN result;
END $$;

-- Schedule is the only narrow command which can establish membership. An agent
-- context still needs an authenticated owner subject; the DB login is not identity.
CREATE FUNCTION consult_schedule(context jsonb, project uuid, visit_time timestamptz, visitor uuid, forms uuid[], plan uuid DEFAULT NULL, plan_revision integer DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; result uuid; f consult_form_versions%ROWTYPE;
BEGIN
 actor:=consult_verify_context(context,NULL,'schedule');
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='owner') THEN RAISE EXCEPTION 'owner required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='consult_capture' AND value='true') THEN RAISE EXCEPTION 'consult capture disabled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=visitor AND active AND (role='owner' OR (role='staff' AND 'projects'=ANY(permissions)))) THEN RAISE EXCEPTION 'invalid visitor'; END IF;
 IF coalesce(cardinality(forms),0)=0 OR cardinality(forms)<>(SELECT count(DISTINCT x) FROM unnest(forms) x) THEN RAISE EXCEPTION 'invalid form pins'; END IF;
 INSERT INTO consults(project_id,site_visit_plan_id,site_visit_plan_revision,conducted_by,scheduled_at,scheduled_by,policy_version)
 VALUES(project,plan,plan_revision,visitor,visit_time,actor,'consult-phase1-v1') RETURNING id INTO result;
 FOR f IN SELECT * FROM consult_form_versions WHERE id=ANY(forms) FOR SHARE LOOP
  IF f.status<>'published' THEN RAISE EXCEPTION 'only published forms may be pinned'; END IF;
  INSERT INTO consult_form_pins VALUES(result,f.id,f.kind,f.key,f.version,f.checksum);
 END LOOP;
 IF (SELECT count(*) FROM consult_form_pins WHERE consult_id=result)<>cardinality(forms) OR NOT EXISTS(SELECT 1 FROM consult_form_pins WHERE consult_id=result AND kind='template') THEN RAISE EXCEPTION 'missing pins'; END IF;
 IF EXISTS(SELECT 1 FROM consult_form_pins p JOIN consult_form_versions v ON v.id=p.form_id,
 jsonb_array_elements(v.definition->'modules') m WHERE p.consult_id=result AND p.kind='template' AND NOT EXISTS(
 SELECT 1 FROM consult_form_pins mp WHERE mp.consult_id=result AND mp.kind='module' AND mp.key=m->>'module')) THEN RAISE EXCEPTION 'template module not pinned'; END IF;
 INSERT INTO consult_assignments(consult_id,user_id,assigned_by) VALUES(result,visitor,actor);
 RETURN result;
END $$;

-- Publication is person/owner only. A draft cannot silently promote itself via
-- a tool argument. Retire the previous published row before publishing a version.
CREATE FUNCTION consult_publish_form(context jsonb, form uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; f consult_form_versions%ROWTYPE;
BEGIN
 actor:=consult_verify_context(context,NULL,'publish_form');
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='owner') OR ((context->>'payload')::jsonb)->>'mode'<>'person' THEN RAISE EXCEPTION 'person owner required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT f FROM consult_form_versions WHERE id=form FOR UPDATE;
 IF f.status<>'draft' THEN RAISE EXCEPTION 'draft required'; END IF;
 PERFORM consult_validate_definition(f.definition,f.kind);
 PERFORM pg_advisory_xact_lock(hashtextextended(f.kind||':'||f.key,0));
 UPDATE consult_form_versions SET status='retired' WHERE kind=f.kind AND key=f.key AND status='published';
 UPDATE consult_form_versions SET status='published',published_by=actor,published_at=now() WHERE id=form RETURNING checksum INTO f.checksum;
 RETURN f.checksum;
END $$;

-- Each operation binds the signed session to a device epoch, event UUID and a
-- server-recomputed payload digest. No caller-selected actor/source is accepted.
CREATE FUNCTION consult_capture_answer(context jsonb, target uuid, device uuid, epoch bigint, event uuid, operation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; c consults%ROWTYPE; old_receipt consult_operation_receipts%ROWTYPE;
 address uuid:=(operation->>'instance_id')::uuid; field text:=operation->>'field_key';
 f jsonb; h consult_field_heads%ROWTYPE; a uuid; proposed_revision bigint; code text; result jsonb;
 payload_hash text:=encode(digest(operation::text,'sha256'),'hex'); current_base bigint;
BEGIN
 actor:=consult_verify_context(context,target,'capture_answer');
 IF ((context->>'payload')::jsonb)->>'mode' IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'human session required; agent proposals cannot become answers' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT c FROM consults WHERE id=target FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM consult_devices WHERE consult_id=target AND device_id=device AND user_id=actor AND consult_devices.epoch=consult_capture_answer.epoch AND revoked_at IS NULL) THEN RAISE EXCEPTION 'device access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO old_receipt FROM consult_operation_receipts WHERE consult_id=target AND device_id=device AND event_id=event;
 IF FOUND THEN
  IF old_receipt.payload_hash<>payload_hash THEN RAISE EXCEPTION 'idempotency_mismatch'; END IF;
  RETURN old_receipt.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='consult_capture' AND value='true') THEN RAISE EXCEPTION 'consult capture disabled'; END IF;
 IF c.status NOT IN ('in_progress','incomplete') THEN RAISE EXCEPTION 'complete_locked or visit not started'; END IF;
 IF (operation->>'generation')::bigint IS DISTINCT FROM c.completion_generation THEN RAISE EXCEPTION 'rebase_required'; END IF;
 SELECT fd INTO f FROM consult_instances i JOIN consult_form_pins p ON p.consult_id=i.consult_id AND p.kind='module' AND p.key=i.module_key AND p.version=i.module_version
 JOIN consult_form_versions v ON v.id=p.form_id, jsonb_array_elements(v.definition->'fields') fd
 WHERE i.consult_id=target AND i.id=address AND i.removed_at IS NULL AND fd->>'key'=field;
 IF f IS NULL THEN RAISE EXCEPTION 'unknown pinned field'; END IF;
 IF operation->>'unit' IS DISTINCT FROM f->>'unit' THEN RAISE EXCEPTION 'invalid unit'; END IF;
 IF operation->>'status'='answered' THEN
  IF f->>'type'='length_pair' THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'array' OR jsonb_array_length(operation->'value')<>2 THEN RAISE EXCEPTION 'length pair required'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(operation->'value') v WHERE jsonb_typeof(v)<>'number') THEN RAISE EXCEPTION 'numeric pair required'; END IF;
   IF f ? 'range' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(operation->'value') v WHERE v::numeric<(f->'range'->>0)::numeric OR v::numeric>(f->'range'->>1)::numeric) THEN RAISE EXCEPTION 'out_of_range'; END IF;
  ELSIF f->>'type' IN ('length','count','number','year') THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'number required'; END IF;
   IF f ? 'range' AND ((operation->>'value')::numeric<(f->'range'->>0)::numeric OR (operation->>'value')::numeric>(f->'range'->>1)::numeric) THEN RAISE EXCEPTION 'out_of_range'; END IF;
   IF f->>'type' IN ('count','year') AND (operation->>'value')::numeric<>trunc((operation->>'value')::numeric) THEN RAISE EXCEPTION 'integer required'; END IF;
  ELSIF f->>'type'='yesno' THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'boolean required'; END IF;
  ELSIF f->>'type'='choice' THEN
   IF NOT (f->'options' @> jsonb_build_array(operation->'value')) THEN RAISE EXCEPTION 'invalid choice'; END IF;
  ELSIF f->>'type'='multi' THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'array' OR NOT (f->'options' @> operation->'value') THEN RAISE EXCEPTION 'invalid choices'; END IF;
  ELSIF f->>'type' IN ('text','date') THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'text required'; END IF;
   IF f->>'type'='date' THEN PERFORM (operation->>'value')::date; END IF;
  ELSE RAISE EXCEPTION 'unsupported field type; cannot accept unvalidated compound value';
  END IF;
 END IF;
 SELECT * INTO h FROM consult_field_heads WHERE consult_id=target AND instance_id=address AND field_key=field;
 current_base:=coalesce(h.revision,0);
 proposed_revision:=c.revision+1;
 code:=CASE WHEN (operation->>'base_revision')::bigint IS NOT DISTINCT FROM current_base THEN 'accepted' ELSE 'conflict' END;
 INSERT INTO consult_events(consult_id,event_id,actor,device_id,device_epoch,source,type,payload,payload_hash,server_revision,generation)
 VALUES(target,event,actor,device,epoch,'typed','answer',operation,payload_hash,proposed_revision,c.completion_generation);
 INSERT INTO consult_answers(consult_id,instance_id,field_key,status,value,unit,skip_reason,skip_note,source,actor,device_id,device_epoch,event_id,base_revision,server_revision,generation)
 VALUES(target,address,field,operation->>'status',NULLIF(operation->'value','null'),operation->>'unit',operation->>'skip_reason',operation->>'skip_note','typed',actor,device,epoch,event,(operation->>'base_revision')::bigint,proposed_revision,c.completion_generation) RETURNING id INTO a;
 IF code='accepted' THEN
  INSERT INTO consult_field_heads(consult_id,instance_id,field_key,current_answer_id,revision) VALUES(target,address,field,a,proposed_revision)
  ON CONFLICT(consult_id,instance_id,field_key) DO UPDATE SET current_answer_id=excluded.current_answer_id,revision=excluded.revision;
 ELSIF h.current_answer_id IS NOT NULL THEN
  INSERT INTO consult_conflicts(consult_id,instance_id,field_key,current_answer_id,proposed_answer_id) VALUES(target,address,field,h.current_answer_id,a);
 ELSE RAISE EXCEPTION 'invalid base revision for new field'; END IF;
 UPDATE consults SET revision=proposed_revision,updated_at=now() WHERE id=target;
 result:=jsonb_build_object('code',code,'revision',proposed_revision,'answer_id',a);
 INSERT INTO consult_operation_receipts VALUES(target,device,epoch,event,payload_hash,code,proposed_revision,result,now());
 RETURN result;
END $$;

-- Fail closed: functions default to PUBLIC EXECUTE in PostgreSQL. Revoke every
-- consult entry point, including verifier/mint/trigger functions, before grants.
DO $$ DECLARE f record; r text; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'consult_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 END LOOP;
 FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   FOR f IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'consult_%' LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',f.tablename,r);
   END LOOP;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_agent') THEN
  GRANT EXECUTE ON FUNCTION consult_read(jsonb,uuid,text), consult_schedule(jsonb,uuid,timestamptz,uuid,uuid[],uuid,integer), consult_propose_form(jsonb,jsonb,text) TO sjcos_agent;
 END IF;
END $$;

-- node scripts/db-roles-sql.mjs consult_context_keys consult_form_versions consults consult_form_pins consult_assignments consult_devices consult_instances consult_events consult_answers consult_field_heads consult_conflicts consult_media consult_operation_receipts consult_uploads consult_finding_applications
-- Output: empty (all consult tables are command-only, no raw grants).

-- Pins are only accepted from a previously published version. Published bytes
-- remain loadable after retirement for visits already using that version.
CREATE FUNCTION consult_pin_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM consult_form_versions WHERE id=NEW.form_id AND status='published') THEN RAISE EXCEPTION 'published pin required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consult_pin_guard BEFORE INSERT ON consult_form_pins FOR EACH ROW EXECUTE FUNCTION consult_pin_guard();

-- An old completed generation is protected even from accidental website writes.
CREATE FUNCTION consult_evidence_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target uuid; c consults%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN target:=OLD.consult_id; ELSE target:=NEW.consult_id; END IF;
 SELECT * INTO STRICT c FROM consults WHERE id=target FOR UPDATE;
 IF c.status IN ('complete','cancelled') THEN RAISE EXCEPTION 'complete_locked'; END IF;
 IF TG_OP='UPDATE' AND NEW.consult_id<>OLD.consult_id THEN RAISE EXCEPTION 'consult identity immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER consult_media_lock BEFORE INSERT OR UPDATE OR DELETE ON consult_media FOR EACH ROW EXECUTE FUNCTION consult_evidence_guard();
CREATE TRIGGER consult_heads_lock BEFORE INSERT OR UPDATE OR DELETE ON consult_field_heads FOR EACH ROW EXECUTE FUNCTION consult_evidence_guard();
CREATE TRIGGER consult_conflicts_lock BEFORE INSERT OR UPDATE OR DELETE ON consult_conflicts FOR EACH ROW EXECUTE FUNCTION consult_evidence_guard();

CREATE FUNCTION consult_start(context jsonb, target uuid, device uuid, expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; c consults%ROWTYPE; next_epoch bigint;
BEGIN
 actor:=consult_verify_context(context,target,'start');
 IF ((context->>'payload')::jsonb)->>'mode' IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'person required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='consult_capture' AND value='true') THEN RAISE EXCEPTION 'consult capture disabled'; END IF;
 SELECT * INTO STRICT c FROM consults WHERE id=target FOR UPDATE;
 IF c.revision<>expected_revision OR c.status<>'scheduled' THEN RAISE EXCEPTION 'revision or lifecycle conflict'; END IF;
 SELECT coalesce(max(epoch),0)+1 INTO next_epoch FROM consult_devices WHERE consult_id=target AND device_id=device;
 INSERT INTO consult_devices(consult_id,device_id,user_id,epoch) VALUES(target,device,actor,next_epoch);
 UPDATE consults SET status='in_progress',revision=revision+1,started_at=now(),started_by=actor,updated_at=now() WHERE id=target;
 RETURN next_epoch;
END $$;
CREATE FUNCTION consult_create_instance(context jsonb, target uuid, instance uuid, module text, instance_label text, parent uuid, expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; c consults%ROWTYPE; pin consult_form_pins%ROWTYPE;
BEGIN
 actor:=consult_verify_context(context,target,'create_instance');
 IF ((context->>'payload')::jsonb)->>'mode' IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'person required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT c FROM consults WHERE id=target FOR UPDATE;
 IF c.revision<>expected_revision OR c.status NOT IN ('in_progress','incomplete') THEN RAISE EXCEPTION 'revision or lifecycle conflict'; END IF;
 SELECT * INTO STRICT pin FROM consult_form_pins WHERE consult_id=target AND kind='module' AND key=module;
 INSERT INTO consult_instances(id,consult_id,module_key,module_version,label,parent_id,repeatable,revision)
 VALUES(instance,target,module,pin.version,instance_label,parent,false,c.revision+1);
 UPDATE consults SET revision=revision+1,updated_at=now() WHERE id=target;
 RETURN c.revision+1;
END $$;
CREATE FUNCTION consult_reopen(context jsonb, target uuid, expected_revision bigint, reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; c consults%ROWTYPE;
BEGIN
 actor:=consult_verify_context(context,target,'reopen');
 IF ((context->>'payload')::jsonb)->>'mode' IS DISTINCT FROM 'person' OR length(btrim(reason))=0 OR reason IS NULL THEN RAISE EXCEPTION 'person and reason required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT c FROM consults WHERE id=target FOR UPDATE;
 IF c.revision<>expected_revision OR c.status NOT IN ('complete','captured','incomplete') THEN RAISE EXCEPTION 'revision or lifecycle conflict'; END IF;
 UPDATE consults SET status='in_progress',completion_generation=completion_generation+1,revision=revision+1,
 reopened_at=now(),reopened_by=actor,reopen_reason=reason,closed_at=NULL,closed_by=NULL,completed_at=NULL,completed_by=NULL,completeness_cache='{}',updated_at=now() WHERE id=target;
 RETURN c.completion_generation+1;
END $$;
REVOKE ALL ON FUNCTION consult_pin_guard(),consult_evidence_guard(),consult_start(jsonb,uuid,uuid,bigint),consult_create_instance(jsonb,uuid,uuid,text,text,uuid,bigint),consult_reopen(jsonb,uuid,bigint,text) FROM PUBLIC;

CREATE FUNCTION consult_media_membership_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'media must be tombstoned, not deleted'; END IF;
 SELECT v.definition INTO d FROM consult_instances i JOIN consult_form_pins p ON p.consult_id=i.consult_id AND p.kind='module' AND p.key=i.module_key AND p.version=i.module_version
 JOIN consult_form_versions v ON v.id=p.form_id WHERE i.consult_id=NEW.consult_id AND i.id=NEW.instance_id AND i.removed_at IS NULL;
 IF d IS NULL THEN RAISE EXCEPTION 'unknown media instance'; END IF;
 IF NEW.field_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'fields') f WHERE f->>'key'=NEW.field_key) THEN RAISE EXCEPTION 'unknown media field'; END IF;
 IF NEW.shot_key IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(d->'shots') s WHERE s->>'key'=NEW.shot_key
 UNION ALL SELECT 1 FROM jsonb_array_elements(d->'fields') f, jsonb_array_elements(f->'shots') s WHERE s->>'key'=NEW.shot_key) THEN RAISE EXCEPTION 'unknown media shot'; END IF;
 IF NOT EXISTS(SELECT 1 FROM consult_uploads u WHERE u.consult_id=NEW.consult_id AND u.file_id=NEW.file_id
 AND u.actor=NEW.actor AND u.sha256=NEW.sha256 AND u.kind=NEW.kind AND u.status='committed') THEN RAISE EXCEPTION 'foreign or uncommitted media file'; END IF;
 IF NEW.kind='photo' AND NOT EXISTS(SELECT 1 FROM consults WHERE id=NEW.consult_id AND photos_ok) THEN RAISE EXCEPTION 'photo permission required'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'removed_at') IS DISTINCT FROM (to_jsonb(OLD)-'removed_at') THEN RAISE EXCEPTION 'media evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consult_media_membership BEFORE INSERT OR UPDATE OR DELETE ON consult_media FOR EACH ROW EXECUTE FUNCTION consult_media_membership_guard();
REVOKE ALL ON FUNCTION consult_media_membership_guard() FROM PUBLIC;
CREATE TRIGGER consult_instances_no_delete BEFORE DELETE ON consult_instances FOR EACH ROW EXECUTE FUNCTION consult_history_immutable();

-- The head must never be pointed at the proposed side of an unresolved conflict.
CREATE FUNCTION consult_head_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM consult_answers a WHERE a.id=NEW.current_answer_id AND a.consult_id=NEW.consult_id
 AND a.instance_id=NEW.instance_id AND a.field_key=NEW.field_key AND a.server_revision=NEW.revision) THEN RAISE EXCEPTION 'head revision mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM consult_conflicts c WHERE c.consult_id=NEW.consult_id AND c.proposed_answer_id=NEW.current_answer_id AND c.resolved_at IS NULL) THEN RAISE EXCEPTION 'conflicted answer cannot be head'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consult_head_guard BEFORE INSERT OR UPDATE ON consult_field_heads FOR EACH ROW EXECUTE FUNCTION consult_head_guard();
REVOKE ALL ON FUNCTION consult_head_guard() FROM PUBLIC;

CREATE FUNCTION consult_validate_condition(condition jsonb, definition jsonb, depth integer DEFAULT 0) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE child jsonb; field_name text; module_name text;
BEGIN
 IF depth>16 OR condition IS NULL THEN RAISE EXCEPTION 'invalid condition'; END IF;
 IF jsonb_typeof(condition)='boolean' THEN RETURN; END IF;
 IF jsonb_typeof(condition)<>'object' THEN RAISE EXCEPTION 'invalid condition'; END IF;
 IF condition ? 'all' OR condition ? 'any' THEN
  child:=coalesce(condition->'all',condition->'any');
  IF (SELECT count(*) FROM jsonb_object_keys(condition))<>1 OR jsonb_typeof(child)<>'array' OR jsonb_array_length(child) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'invalid compound condition'; END IF;
  FOR child IN SELECT value FROM jsonb_array_elements(child) LOOP PERFORM consult_validate_condition(child,definition,depth+1); END LOOP;
  RETURN;
 END IF;
 IF condition ? 'not' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(condition))<>1 THEN RAISE EXCEPTION 'invalid not condition'; END IF;
  PERFORM consult_validate_condition(condition->'not',definition,depth+1); RETURN;
 END IF;
 IF condition->>'op' IS NULL OR condition->>'op' NOT IN ('eq','ne','in','lt','gt','answered') OR condition->>'field' IS NULL THEN RAISE EXCEPTION 'invalid condition operator'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(condition) k WHERE k NOT IN ('op','field','value')) THEN RAISE EXCEPTION 'invalid condition keys'; END IF;
 IF condition->>'op'<>'answered' AND NOT condition ? 'value' THEN RAISE EXCEPTION 'condition value required'; END IF;
 IF condition->>'op'='in' AND jsonb_typeof(condition->'value') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'condition list required'; END IF;
 IF condition->>'op' IN ('lt','gt') AND jsonb_typeof(condition->'value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'condition number required'; END IF;
 field_name:=condition->>'field';
 IF position('.' IN field_name)=0 THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'fields') f WHERE f->>'key'=field_name) THEN RAISE EXCEPTION 'unknown condition field'; END IF;
 ELSE
  module_name:=split_part(field_name,'.',1); field_name:=split_part(field_name,'.',2);
  IF NOT EXISTS(SELECT 1 FROM consult_form_versions v,jsonb_array_elements(v.definition->'fields') f
   WHERE v.kind='module' AND v.key=module_name AND v.status='published' AND f->>'key'=field_name) THEN RAISE EXCEPTION 'unknown condition module field'; END IF;
 END IF;
END $$;
CREATE FUNCTION consult_validate_definition(definition jsonb, kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE field jsonb; shot jsonb;
BEGIN
 IF jsonb_typeof(definition->'title') IS DISTINCT FROM 'string' OR length(btrim(definition->>'title'))=0 THEN RAISE EXCEPTION 'form title required'; END IF;
 IF kind='template' THEN
  IF jsonb_typeof(definition->'modules') IS DISTINCT FROM 'array' OR jsonb_array_length(definition->'modules')=0
   OR jsonb_typeof(definition->'opening') IS DISTINCT FROM 'array' OR jsonb_typeof(definition->'closing') IS DISTINCT FROM 'array'
   OR jsonb_typeof(definition->'derived') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid template'; END IF;
  IF (SELECT count(*)<>count(DISTINCT m->>'module') FROM jsonb_array_elements(definition->'modules') m) THEN RAISE EXCEPTION 'duplicate template module'; END IF;
  FOR field IN SELECT value FROM jsonb_array_elements(definition->'modules') LOOP
   IF NOT EXISTS(SELECT 1 FROM consult_form_versions WHERE consult_form_versions.kind='module' AND key=field->>'module' AND status='published') THEN RAISE EXCEPTION 'unknown published module'; END IF;
   PERFORM consult_validate_condition(field->'required',definition);
  END LOOP;
  RETURN;
 END IF;
 IF jsonb_typeof(definition->'fields') IS DISTINCT FROM 'array' OR jsonb_typeof(definition->'shots') IS DISTINCT FROM 'array'
 OR jsonb_typeof(definition->'say') IS DISTINCT FROM 'array' OR jsonb_typeof(definition->'coverage') IS DISTINCT FROM 'array'
 OR jsonb_typeof(definition->'repeatable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid module'; END IF;
 IF (SELECT count(*)<>count(DISTINCT f->>'key') FROM jsonb_array_elements(definition->'fields') f) THEN RAISE EXCEPTION 'duplicate field'; END IF;
 FOR field IN SELECT value FROM jsonb_array_elements(definition->'fields') LOOP
  IF coalesce(field->>'key','') !~ '^[a-z][a-z0-9_]*$' OR coalesce(field->>'label','')='' OR field->>'tier' IS NULL OR field->>'tier' NOT IN ('price_critical','record')
  OR field->>'type' IS NULL OR field->>'type' NOT IN ('length','length_pair','count','number','choice','multi','yesno','text','year','date','signature') THEN RAISE EXCEPTION 'invalid field definition'; END IF;
  PERFORM consult_validate_condition(field->'required',definition);
  IF field->>'type' IN ('length','length_pair') AND field->>'unit' IS DISTINCT FROM 'in' THEN RAISE EXCEPTION 'lengths must store inches'; END IF;
  IF field->>'type' IN ('choice','multi') AND (jsonb_typeof(field->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(field->'options')=0) THEN RAISE EXCEPTION 'choices required'; END IF;
  IF field ? 'flag' THEN PERFORM consult_validate_condition(field->'flag'->'when',definition); END IF;
 END LOOP;
 FOR shot IN SELECT value FROM jsonb_array_elements(definition->'shots')
  UNION ALL SELECT s.value FROM jsonb_array_elements(definition->'fields') f CROSS JOIN LATERAL jsonb_array_elements(f->'shots') s LOOP
  IF coalesce(shot->>'key','') !~ '^[a-z][a-z0-9_]*$' OR coalesce(shot->>'label','')='' OR shot->>'tier' IS DISTINCT FROM 'price_critical' THEN RAISE EXCEPTION 'invalid price-critical shot'; END IF;
  PERFORM consult_validate_condition(shot->'required',definition);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION consult_validate_condition(jsonb,jsonb,integer),consult_validate_definition(jsonb,text) FROM PUBLIC;
