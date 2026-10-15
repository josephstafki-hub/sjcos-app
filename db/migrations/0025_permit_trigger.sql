-- 0025 — 'permit' agent trigger (lib/workflow/construction-start.ts).
-- When a job's construction agreement is signed and its initial invoice is
-- paid, the job moves to construction and the business agent is woken to work
-- out what the city needs for a permit and file a permit brief on the project.

ALTER TABLE agent_triggers DROP CONSTRAINT IF EXISTS agent_triggers_kind_check;
ALTER TABLE agent_triggers ADD CONSTRAINT agent_triggers_kind_check
  CHECK (kind IN ('signature','message','note','quote','selection','payment','field_report','approval','signoff','sweep','permit'));
