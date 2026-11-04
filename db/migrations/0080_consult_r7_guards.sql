ALTER TABLE consult_answers DROP CONSTRAINT consult_answers_skip_reason_check;
ALTER TABLE consult_answers ADD CONSTRAINT consult_answers_skip_reason_check CHECK(skip_reason IN ('Not on this job','No access','Not safe to measure','Client absent','Joe sets the date','Client declined','Get on return visit','Sub/supplier will measure','Other'));
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
 IF f ? 'derive_cases' OR f ? 'derive' THEN RAISE EXCEPTION 'derived field protected'; END IF;
 IF EXISTS(SELECT 1 FROM consult_instances WHERE id=address AND module_key='visit') THEN RAISE EXCEPTION 'context protected'; END IF;
 IF field='summary' AND EXISTS(SELECT 1 FROM consult_instances WHERE id=address AND module_key='closing') THEN RAISE EXCEPTION 'summary_read_only'; END IF;
 IF f IS NULL THEN RAISE EXCEPTION 'unknown pinned field'; END IF;
 IF operation->>'unit' IS DISTINCT FROM f->>'unit' THEN RAISE EXCEPTION 'invalid unit'; END IF;
 IF operation->>'status'='answered' THEN
  IF f->'maps_to'->>'kind'='new_work' THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'object' OR operation->'value'->>'origin' IS NULL OR operation->'value'->>'origin' NOT IN ('client_requested_optional','found_condition_required') OR jsonb_typeof(operation->'value'->'text') IS DISTINCT FROM 'string' OR length(btrim(operation->'value'->>'text')) NOT BETWEEN 1 AND 8000 OR ((operation->'value') - 'origin' - 'text') <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid new work'; END IF;
  ELSIF f->>'type'='length_pair' THEN
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
  ELSIF f->>'type'='instance_reference' THEN
   IF jsonb_typeof(operation->'value') IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM consult_instances WHERE consult_id=target AND id=(operation->>'value')::uuid AND removed_at IS NULL) THEN RAISE EXCEPTION 'invalid instance reference'; END IF;
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
