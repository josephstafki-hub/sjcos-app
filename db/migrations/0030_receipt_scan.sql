-- 0030 — Receipt scanning (lib/receipt-scan.ts).
-- A receipt photographed on a phone (/scan, or the mobile app's
-- POST /api/receipts/scan) or texted to the business number lands in
-- unsorted_docs like an emailed one, and Claude reads it: store, location,
-- date, items with quantities, totals, and any job name written on it. That
-- read is kept whole in `extracted` so /unsorted can show the key points
-- first. When Claude can tell which job it is for, the receipt is filed there
-- at once; otherwise it waits on /unsorted with Claude's guesses.
--
--   extract_state  NULL = never read (email docs), 'reading', 'done', 'failed'

ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extracted          jsonb;
ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extract_state      text
  CHECK (extract_state IN ('reading','done','failed'));
ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extract_error      text NOT NULL DEFAULT '';
ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extract_started_at timestamptz;
-- What the person who sent it said: the job they picked on /scan, their note,
-- or the text that came with the photo. Claude reads it as a hint.
ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS sender_note        text NOT NULL DEFAULT '';
ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS sender_project_id  uuid REFERENCES projects(id) ON DELETE SET NULL;
