-- Preserve the reviewed draft's authorship and accepted suggestion on every device.
-- Existing website-only write path; no agent/worker grants or provider operations.
ALTER TABLE inbox_drafts
  ADD COLUMN IF NOT EXISTS accepted_suggestion_id uuid REFERENCES inbox_drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS human_edited boolean NOT NULL DEFAULT false;

-- Retain the existing on-demand Qwen author as well as the automatic draft models.
ALTER TABLE inbox_drafts DROP CONSTRAINT IF EXISTS inbox_drafts_model_check;
ALTER TABLE inbox_drafts ADD CONSTRAINT inbox_drafts_model_check CHECK (model IN ('claude','hermes','qwen'));
