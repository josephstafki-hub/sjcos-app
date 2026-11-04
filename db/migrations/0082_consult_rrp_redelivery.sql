-- Reconcile delivered pamphlets when scheduling becomes known, preserving completed work.
CREATE OR REPLACE FUNCTION consult_redate_rrp_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; due timestamptz; source text;
BEGIN
 UPDATE work_items w SET due_at=(NEW.start_date-7)::timestamp AT TIME ZONE 'America/Chicago'
 FROM consults c WHERE c.project_id=NEW.id AND w.project_id=NEW.id AND w.source_kind='consult'
 AND w.source_id=c.id::text||':rrp:delivery' AND w.status NOT IN ('done','cancelled');
 FOR v IN SELECT c.* FROM consults c CROSS JOIN LATERAL (
 SELECT coalesce(jsonb_object_agg(i.module_key||'.'||a.field_key,a.value),'{}'::jsonb) facts
 FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id JOIN consult_instances i ON i.id=h.instance_id
 WHERE h.consult_id=c.id AND i.removed_at IS NULL AND a.status='answered' AND i.module_key IN ('era','house')
 ) f WHERE c.project_id=NEW.id
 AND (f.facts->'era.before_1978'='true'::jsonb OR (NOT f.facts ? 'era.before_1978' AND NOT coalesce((f.facts->>'house.year_built')::int>1977,false)))
 AND (f.facts->'era.disturbs_paint' IS DISTINCT FROM 'false'::jsonb OR f.facts->'era.window_door_replacement'='true'::jsonb)
 AND EXISTS(
 SELECT 1 FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id
 JOIN consult_instances i ON i.id=h.instance_id
 WHERE h.consult_id=c.id AND i.module_key='era' AND i.removed_at IS NULL
 AND a.field_key='pamphlet_given' AND a.status='answered' AND a.value='true'::jsonb)
 LOOP
 source=v.id::text||':rrp:redelivery';
 IF NEW.start_date-(v.scheduled_at AT TIME ZONE 'America/Chicago')::date>60 THEN
 due=(NEW.start_date-7)::timestamp AT TIME ZONE 'America/Chicago';
 UPDATE work_items SET due_at=due,status=CASE WHEN status='cancelled' THEN 'open' ELSE status END WHERE source_kind='consult' AND source_id=source AND status<>'done';
 INSERT INTO work_items(title,project_id,assignee_key,due_at,source_kind,source_id,requires_approval,created_by)
 SELECT 'Renovate Right: give it again — work starts more than 60 days after the visit. Get the owner’s initials, or mail it with a certificate of mailing at least 7 days before work starts',NEW.id,
 (SELECT id FROM users WHERE role='owner' AND active ORDER BY created_at,id LIMIT 1),due,'consult',source,false,'consult'
 WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=source);
 ELSE
 UPDATE work_items SET status='cancelled' WHERE source_kind='consult' AND source_id=source AND status NOT IN ('done','cancelled');
 END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'work_items');
