-- 0054 — A job's workflow stage keeps up with its status (2026-10-30).
--
-- project_workflows.stage only moved on certain events (signatures, payments,
-- milestones), so live jobs read W01 while under construction and agents were
-- briefed with the wrong stage. Now:
--   workflow_stage_for_status(status) maps a project status to the earliest
--     stage it implies (precon_signed W02, floor_plan/mood_board/selections
--     W04, bidding W06, construction_contract W08, construction W10, closeout
--     W12, warranty done);
--   a trigger on projects.status moves the stage FORWARD to that (never back:
--     an event may already have put it further on), recording a
--     'stage_from_status' event, and creates the row if the job had none;
--   existing open jobs are backfilled the same way. Old warranty jobs with no
--   workflow row are left alone.

CREATE OR REPLACE FUNCTION workflow_stage_for_status(p_status text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'precon_signed' THEN 'W02'
    WHEN 'floor_plan' THEN 'W04'
    WHEN 'mood_board' THEN 'W04'
    WHEN 'selections' THEN 'W04'
    WHEN 'bidding' THEN 'W06'
    WHEN 'construction_contract' THEN 'W08'
    WHEN 'construction' THEN 'W10'
    WHEN 'closeout' THEN 'W12'
    WHEN 'warranty' THEN 'done'
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION workflow_stage_rank(p_stage text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_stage = 'done' THEN 13 WHEN p_stage ~ '^W[0-9]{2}$' THEN substr(p_stage, 2)::int ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION workflow_stage_follow_status(p_project uuid, p_status text, p_ref text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE target text := workflow_stage_for_status(p_status); cur text;
BEGIN
  IF target IS NULL THEN RETURN; END IF;
  SELECT stage INTO cur FROM project_workflows WHERE project_id = p_project FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO project_workflows (project_id, stage, started_by) VALUES (p_project, target, 'status')
    ON CONFLICT (project_id) DO NOTHING;
    cur := 'W01';
  ELSIF workflow_stage_rank(target) <= workflow_stage_rank(cur) THEN
    RETURN;
  ELSE
    UPDATE project_workflows SET stage = target WHERE project_id = p_project;
  END IF;
  INSERT INTO project_workflow_events (project_id, kind, ref, stage_before, stage_after, detail, actor)
  VALUES (p_project, 'stage_from_status', p_ref, cur, target, jsonb_build_object('status', p_status), 'status')
  ON CONFLICT (project_id, kind, ref) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION trg_workflow_stage_follows_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM workflow_stage_follow_status(NEW.id, NEW.status, 'status:' || NEW.status);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_projects_workflow_stage ON projects;
CREATE TRIGGER trg_projects_workflow_stage
  AFTER UPDATE OF status ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_workflow_stage_follows_status();

-- Backfill: every job with a workflow row, plus open jobs without one.
SELECT workflow_stage_follow_status(p.id, p.status, 'status:' || p.status || ':backfill')
  FROM projects p
 WHERE EXISTS (SELECT 1 FROM project_workflows w WHERE w.project_id = p.id)
    OR p.status <> 'warranty';
