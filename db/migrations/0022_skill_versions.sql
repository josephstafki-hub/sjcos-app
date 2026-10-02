-- 0022 — Skill/runbook version linkage (A24, WS-agents). Additive, idempotent.
--
-- skill_versions rows are immutable procedure texts. This adds the checksum
-- and activation stamps so an agent execution can cite the exact skill
-- version it followed, and runbooks can name the workflow stage (W01–W12)
-- they implement. Backfills checksums for existing rows.

ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS checksum text;
ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS activated_by text;
ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS retired_at timestamptz;

UPDATE skill_versions
   SET checksum = encode(sha256(convert_to(body_markdown, 'UTF8')), 'hex')
 WHERE checksum IS NULL;

-- The version a skill currently renders is the one it "activated".
UPDATE skill_versions v
   SET activated_at = COALESCE(v.activated_at, v.created_at), activated_by = COALESCE(v.activated_by, v.created_by)
  FROM skills s
 WHERE s.current_version_id = v.id;

ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS workflow_stage text;          -- W01 … W12
ALTER TABLE runbooks ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved';
DO $$ BEGIN
  ALTER TABLE runbooks ADD CONSTRAINT runbooks_review_status_check CHECK (review_status IN ('proposed','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_runbooks_stage ON runbooks(workflow_stage) WHERE workflow_stage IS NOT NULL;

-- Executions can cite the skill versions they followed.
ALTER TABLE agent_executions ADD COLUMN IF NOT EXISTS skill_versions jsonb NOT NULL DEFAULT '[]'::jsonb;
