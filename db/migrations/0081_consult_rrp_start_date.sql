-- Keep open consultation pamphlet follow-ups aligned with the actual work start.
CREATE FUNCTION consult_redate_rrp_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 UPDATE work_items w
 SET due_at = (NEW.start_date - 7)::timestamp AT TIME ZONE 'America/Chicago'
 FROM consults c
 WHERE c.project_id=NEW.id AND w.project_id=NEW.id
 AND w.source_kind='consult' AND w.source_id=c.id::text || ':rrp:delivery'
 AND w.status NOT IN ('done','cancelled');
 RETURN NEW;
END;
$$;
CREATE TRIGGER consult_rrp_start_date AFTER UPDATE OF start_date ON projects
FOR EACH ROW WHEN (OLD.start_date IS DISTINCT FROM NEW.start_date)
EXECUTE FUNCTION consult_redate_rrp_delivery();
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'work_items');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'work_items');
