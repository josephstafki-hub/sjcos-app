-- 0038 — 'financials' agent trigger (lib/workflow/financials-fill.ts).
-- Joe, 2026-10-30: the fill-project-financials skill only ran when somebody
-- happened to ask — seven "Fill in the financials" to-dos sat queued for five
-- weeks. Now construction start wakes the background agent to fill the job's
-- budget and costs, and the agent worker catches every construction job whose
-- budget isn't finished and has never had a run (one run per job).

ALTER TABLE agent_triggers DROP CONSTRAINT IF EXISTS agent_triggers_kind_check;
ALTER TABLE agent_triggers ADD CONSTRAINT agent_triggers_kind_check
  CHECK (kind IN ('signature','message','note','quote','selection','payment','field_report','approval','signoff','sweep','permit','filing','financials'));
