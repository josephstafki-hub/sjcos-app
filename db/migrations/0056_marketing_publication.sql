-- 0056 — Marketing posts an agent puts up for Joe (2026-10-30).
--
-- Joe approves a /marketing draft for ONE platform (Facebook page, Instagram,
-- Google Business Profile) on the existing publish_marketing card. The
-- approval queues a `publication` intent; the dispatcher hands it to the
-- posting agent (a memory-capped browser run, scripts/run-publication.mjs),
-- and the outcome lands back on the draft:
--
--   draft → pending_decision → queued → posting → posted   (posted_url, posted_at)
--                                              ↘ failed   (post_error; Joe can try again)
--
-- Only additive: two statuses, three columns. Safe ahead of the code.

ALTER TABLE marketing_drafts ADD COLUMN IF NOT EXISTS posted_url text;
ALTER TABLE marketing_drafts ADD COLUMN IF NOT EXISTS posted_at timestamptz;
ALTER TABLE marketing_drafts ADD COLUMN IF NOT EXISTS post_error text;

ALTER TABLE marketing_drafts DROP CONSTRAINT IF EXISTS marketing_drafts_status_check;
ALTER TABLE marketing_drafts ADD CONSTRAINT marketing_drafts_status_check
  CHECK (status IN ('draft','pending_decision','queued','posting','posted','failed','cancelled')) NOT VALID;
