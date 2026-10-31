-- 0055 — Panel runs record which instruction versions they loaded (Tier 4).
--
-- Background worker runs record instruction_versions on agent_executions; the
-- Ask-window runs (dev_agent_runs: Claude business runs, Hermes turns) loaded
-- the same versioned block but kept no trace of which version, so a bad answer
-- couldn't be tied to the rules it was given. Null = the run loaded no block
-- (Joe's operator runs, Qwen).

ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS instruction_versions jsonb;
