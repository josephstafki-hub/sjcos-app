-- 0026 — 'filing' agent trigger (lib/unsorted-docs-core.ts).
-- When Joe sorts an emailed document on /unsorted, a small agent run finishes
-- the job at once: a typed note is carried out, or the cost he just filed is
-- placed under the right trade / purchase order. Also applied by
-- db/apply-unsorted-docs.mjs.

ALTER TABLE agent_triggers DROP CONSTRAINT IF EXISTS agent_triggers_kind_check;
ALTER TABLE agent_triggers ADD CONSTRAINT agent_triggers_kind_check
  CHECK (kind IN ('signature','message','note','quote','selection','payment','field_report','approval','signoff','sweep','permit','filing'));
