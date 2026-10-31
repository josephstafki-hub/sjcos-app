-- Exact run/message linkage for durable work summaries. Legacy duplicates are
-- deliberately not guessed; the read layer only matches unique old answers.
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES dev_agent_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ai_messages_run_idx ON ai_messages(run_id) WHERE run_id IS NOT NULL;
