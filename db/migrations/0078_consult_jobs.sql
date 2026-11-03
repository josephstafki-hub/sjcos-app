-- Owner-side cron executes these jobs; narrow logins cannot forge/fence jobs.
CREATE TABLE consult_findings_jobs (
 consult_id uuid NOT NULL REFERENCES consults(id), generation bigint NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','done','failed','obsolete')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, last_error text, result jsonb,
 PRIMARY KEY(consult_id,generation)
);
REVOKE ALL ON consult_findings_jobs FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON consult_findings_jobs FROM %I',r); END IF; END LOOP; END $$;
-- node scripts/db-roles-sql.mjs consult_findings_jobs: empty (website-only).
CREATE INDEX consult_findings_jobs_pending ON consult_findings_jobs(available_at) WHERE status IN ('queued','leased');

-- Reopen/cancel retract just this visit and rebuild the shared quantity from
-- remaining active visits. Ambiguous/manual sources and locked estimates survive.
CREATE OR REPLACE FUNCTION consult_retract_generation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q record; total numeric; source text; oldsource text;
BEGIN
 IF NEW.completion_generation=OLD.completion_generation AND NEW.status<>'cancelled' THEN RETURN NEW; END IF;
 UPDATE consult_quantity_contributions SET retracted_at=now() WHERE consult_id=NEW.id AND superseded_at IS NULL AND retracted_at IS NULL;
 UPDATE site_visit_findings SET retracted_at=now() WHERE consult_id=NEW.id AND retracted_at IS NULL;
 FOR q IN SELECT DISTINCT scope_key,label,unit FROM consult_quantity_contributions WHERE consult_id=NEW.id ORDER BY scope_key,label,unit LOOP
  source:='consult-aggregate:'||q.scope_key||':'||q.label||':'||q.unit;
  oldsource:='consult:'||NEW.id||':'||q.scope_key||':'||q.label||':'||q.unit;
  SELECT sum(c.quantity) INTO total FROM consult_quantity_contributions c JOIN consults v ON v.id=c.consult_id
   WHERE v.project_id=NEW.project_id AND c.scope_key=q.scope_key AND c.label=q.label AND c.unit=q.unit AND c.retracted_at IS NULL AND c.superseded_at IS NULL;
  IF NOT EXISTS(SELECT 1 FROM estimates WHERE project_id=NEW.project_id AND kind='formal' AND estimate_out_to_client(id) IS NOT NULL) THEN
   UPDATE scope_items SET quantities=(SELECT coalesce(jsonb_agg(CASE WHEN v->>'source' IN (source,oldsource) THEN jsonb_set(v,'{qty}',to_jsonb(total)) ELSE v END),'[]') FROM jsonb_array_elements(quantities) v WHERE total IS NOT NULL OR v->>'source' IS NULL OR v->>'source' NOT IN (source,oldsource)),revision=revision+1 WHERE project_id=NEW.project_id AND key=q.scope_key;
  ELSE
   INSERT INTO site_visit_findings(project_id,scope_key,fact_key,kind,statement,source_note,consult_id,status)
   VALUES(NEW.project_id,q.scope_key,'consult:'||NEW.id||':'||NEW.completion_generation||':locked-retraction:'||q.scope_key||':'||q.label,'decision','Consultation source withdrawn — resolve locked estimate using revision, Pre-con change or change order','consult:'||NEW.id,NEW.id,'needs_clarification') ON CONFLICT(project_id,fact_key) DO NOTHING;
   INSERT INTO work_items(title,project_id,assignee_key,source_kind,source_id,created_by)
   SELECT 'Consultation source changed — resolve locked estimate',NEW.project_id,(SELECT id::text FROM users WHERE role='owner' AND active ORDER BY created_at LIMIT 1),'consult',NEW.id||':locked-retraction:'||NEW.completion_generation,'consult'
   WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=NEW.id||':locked-retraction:'||NEW.completion_generation);
  END IF;
 END LOOP;
 UPDATE consult_finding_applications SET status='superseded' WHERE consult_id=NEW.id AND status='applied';
 UPDATE consult_agent_proposals SET status='expired' WHERE consult_id=NEW.id AND status='pending';
 UPDATE consult_findings_jobs SET status='obsolete',lease_token=NULL,lease_until=NULL WHERE consult_id=NEW.id AND status<>'done';
 RETURN NEW;
END $$;
DROP TRIGGER consult_retract_generation ON consults;
CREATE TRIGGER consult_retract_generation AFTER UPDATE OF completion_generation,status ON consults FOR EACH ROW WHEN (NEW.completion_generation<>OLD.completion_generation OR NEW.status='cancelled' AND OLD.status<>'cancelled') EXECUTE FUNCTION consult_retract_generation();
DROP TRIGGER consult_retract_plan ON consults;
CREATE OR REPLACE FUNCTION consult_reopen_plan_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.site_visit_plan_id IS NOT NULL THEN
  UPDATE site_visit_plans p SET items=(SELECT coalesce(jsonb_agg(CASE WHEN EXISTS(SELECT 1 FROM site_visit_findings f WHERE f.id::text=item->>'finding_id' AND f.consult_id=NEW.id AND f.retracted_at IS NOT NULL) THEN (item-'finding_id')||'{"status":"open"}'::jsonb ELSE item END),'[]') FROM jsonb_array_elements(p.items) item) WHERE p.id=NEW.site_visit_plan_id AND p.revision=NEW.site_visit_plan_revision;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER consult_retract_plan AFTER UPDATE OF completion_generation,status ON consults FOR EACH ROW WHEN (NEW.completion_generation<>OLD.completion_generation OR NEW.status='cancelled' AND OLD.status<>'cancelled') EXECUTE FUNCTION consult_reopen_plan_evidence();

-- New work carries explicit human-selected origin, never guessed from prose.
CREATE OR REPLACE FUNCTION consult_capture_answer(context jsonb, target uuid, device uuid, epoch bigint, event uuid, operation jsonb) RETURNS jsonb
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
  IF f->'maps_to'->>'kind'='new_work' THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'object' OR operation->'value'->>'origin' IS NULL OR operation->'value'->>'origin' NOT IN ('client_requested_optional','found_condition_required') OR jsonb_typeof(operation->'value'->'text') IS DISTINCT FROM 'string' OR length(btrim(operation->'value'->>'text')) NOT BETWEEN 1 AND 8000 OR ((operation->'value') - 'origin' - 'text') <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid new work'; END IF;
  ELSIF f->>'type'='length_pair' THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'array' OR jsonb_array_length(operation->'value')<>2 THEN RAISE EXCEPTION 'length pair required'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(operation->'value') v WHERE jsonb_typeof(v)<>'number') THEN RAISE EXCEPTION 'numeric pair required'; END IF;
   IF f ? 'component_ranges' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(operation->'value') WITH ORDINALITY a(v,n) WHERE v::numeric<(f->'component_ranges'->((n-1)::int)->>0)::numeric OR v::numeric>(f->'component_ranges'->((n-1)::int)->>1)::numeric) THEN RAISE EXCEPTION 'out_of_range'; END IF;
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
