CREATE OR REPLACE FUNCTION consult_reopen(context jsonb, target uuid, expected_revision bigint, reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; c consults%ROWTYPE;
BEGIN
 actor:=consult_verify_context(context,target,'reopen');
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='owner' AND active) THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='42501'; END IF;
 IF ((context->>'payload')::jsonb)->>'mode' IS DISTINCT FROM 'person' OR length(btrim(reason))=0 OR reason IS NULL THEN RAISE EXCEPTION 'person and reason required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT c FROM consults WHERE id=target FOR UPDATE;
 IF c.revision<>expected_revision OR c.status NOT IN ('complete','captured','incomplete') THEN RAISE EXCEPTION 'revision or lifecycle conflict'; END IF;
 UPDATE consults SET status='in_progress',completion_generation=completion_generation+1,revision=revision+1,
 reopened_at=now(),reopened_by=actor,reopen_reason=reason,closed_at=NULL,closed_by=NULL,completed_at=NULL,completed_by=NULL,completeness_cache='{}',updated_at=now() WHERE id=target;
 RETURN c.completion_generation+1;
END $$;

-- Recheck completed delivery when a project start slips.
CREATE OR REPLACE FUNCTION consult_reconcile_rrp(target_project uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; due timestamptz; source text; start_day date;
BEGIN
 SELECT start_date INTO start_day FROM projects WHERE id=target_project;
 IF start_day IS NULL THEN RETURN; END IF;
 -- A completed delivery expires when the new start falls outside its 60-day window.
 UPDATE work_items SET status='queued',
 body=coalesce(body,'')||E'\nGiven before on '||to_char(completed_at AT TIME ZONE 'America/Chicago','Mon FMDD, YYYY')||'; the new start '||start_day::text||' is more than 60 days later.', completed_at=NULL,
 title='Start moved — give Renovate Right again: get the owner’s initials, or mail it with a certificate of mailing at least 7 days before work starts',
 due_at=(greatest(start_day-60,start_day-14))::timestamp AT TIME ZONE 'America/Chicago'
 WHERE project_id=target_project AND source_kind='consult'
 AND (source_id LIKE '%:rrp:redelivery' OR source_id LIKE '%:rrp:delivery')
 AND status='done' AND (completed_at AT TIME ZONE 'America/Chicago')::date < start_day-60;

 UPDATE work_items w SET due_at=(greatest(start_day-60,start_day-14))::timestamp AT TIME ZONE 'America/Chicago'
 FROM consults c WHERE c.project_id=target_project AND w.project_id=target_project AND w.source_kind='consult'
 AND w.source_id=c.id::text||':rrp:delivery' AND w.status NOT IN ('done','cancelled');
 FOR v IN SELECT c.* FROM consults c CROSS JOIN LATERAL (
 SELECT coalesce(jsonb_object_agg(i.module_key||'.'||a.field_key,a.value),'{}'::jsonb) facts
 FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id JOIN consult_instances i ON i.id=h.instance_id
 WHERE h.consult_id=c.id AND i.removed_at IS NULL AND a.status='answered' AND i.module_key IN ('era','house')
 ) f WHERE c.project_id=target_project
 AND (f.facts->'era.before_1978'='true'::jsonb OR (NOT f.facts ? 'era.before_1978' AND NOT coalesce((f.facts->>'house.year_built')::int>1977,false)))
 AND (f.facts->'era.disturbs_paint' IS DISTINCT FROM 'false'::jsonb OR f.facts->'era.window_door_replacement'='true'::jsonb)
 AND EXISTS(
 SELECT 1 FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id
 JOIN consult_instances i ON i.id=h.instance_id
 WHERE h.consult_id=c.id AND i.module_key='era' AND i.removed_at IS NULL
 AND a.field_key='pamphlet_given' AND a.status='answered' AND a.value='true'::jsonb)
 LOOP
 source=v.id::text||':rrp:redelivery';
 IF start_day-(v.scheduled_at AT TIME ZONE 'America/Chicago')::date>60 THEN
 due=(greatest(start_day-60,start_day-14))::timestamp AT TIME ZONE 'America/Chicago';
 SELECT CASE WHEN nullif(evidence->'rrp'->>'redelivery_day','')::date BETWEEN start_day-60 AND start_day-7 THEN nullif(evidence->'rrp'->>'redelivery_day','')::date::timestamp AT TIME ZONE 'America/Chicago' ELSE due END INTO due FROM consult_close_evidence WHERE consult_id=v.id;
 due=greatest((start_day-60)::timestamp AT TIME ZONE 'America/Chicago', coalesce(due,(greatest(start_day-60,start_day-14))::timestamp AT TIME ZONE 'America/Chicago'));
 UPDATE work_items SET due_at=due,status=CASE WHEN status='cancelled' THEN 'queued' ELSE status END WHERE source_kind='consult' AND source_id=source AND status<>'done';
 INSERT INTO work_items(title,project_id,assignee_key,due_at,source_kind,source_id,requires_approval,created_by)
 SELECT 'Renovate Right: give it again — work starts more than 60 days after the visit. Get the owner’s initials, or mail it with a certificate of mailing at least 7 days before work starts',target_project,
 (SELECT id FROM users WHERE role='owner' AND active ORDER BY created_at,id LIMIT 1),due,'consult',source,false,'consult'
 WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=source);
 ELSE
 UPDATE work_items SET status='cancelled' WHERE source_kind='consult' AND source_id=source AND status NOT IN ('done','cancelled');
 END IF;
 END LOOP;
 RETURN;
END;
$$;


SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'work_items');

-- Bring existing open re-delivery work into the legal window too.
SELECT consult_reconcile_rrp(p.id) FROM projects p
WHERE p.start_date IS NOT NULL AND EXISTS (SELECT 1 FROM consults c WHERE c.project_id=p.id);
