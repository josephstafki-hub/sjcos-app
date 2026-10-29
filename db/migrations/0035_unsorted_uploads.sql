-- 0035 — Agent uploads into the Unsorted tray (mcp/upload-tools.mjs).
--
-- Receipts an agent pulls from a vendor portal (Home Depot, Menards) have no
-- Gmail message, and base64 inside stage_unsorted_document is too big for a
-- batch. create_unsorted_upload now starts the same signed-PUT / base64-parts
-- upload as create_project_upload, aimed at a tray document instead of a
-- project: an existing doc (by id or source_ref), or a source_ref nothing is
-- staged under yet — then the committed file is held and attached when
-- stage_unsorted_document is called with that source_ref (or names the
-- upload in upload_ids).
--
-- target = 'project' rows are unchanged. An 'unsorted' row always carries the
-- source_ref (also when it was aimed by id), so it still says where it
-- belongs if the doc row goes away.

ALTER TABLE project_uploads ADD COLUMN IF NOT EXISTS target          text NOT NULL DEFAULT 'project';
ALTER TABLE project_uploads ADD COLUMN IF NOT EXISTS unsorted_doc_id bigint REFERENCES unsorted_docs(id) ON DELETE SET NULL;
ALTER TABLE project_uploads ADD COLUMN IF NOT EXISTS source_ref      text;
ALTER TABLE project_uploads ALTER COLUMN project_id   DROP NOT NULL;
ALTER TABLE project_uploads ALTER COLUMN project_slug DROP NOT NULL;
ALTER TABLE project_uploads DROP CONSTRAINT IF EXISTS project_uploads_target_check;
ALTER TABLE project_uploads ADD CONSTRAINT project_uploads_target_check CHECK (
  (target = 'project'  AND project_id IS NOT NULL AND project_slug IS NOT NULL) OR
  (target = 'unsorted' AND source_ref IS NOT NULL)
);
-- Committed files waiting for their source_ref to be staged.
CREATE INDEX IF NOT EXISTS idx_project_uploads_held ON project_uploads(source_ref)
  WHERE target = 'unsorted' AND status = 'committed' AND unsorted_doc_id IS NULL;
