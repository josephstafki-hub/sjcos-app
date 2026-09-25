-- 0016 — Subcontractor paperwork collection (WS-procurement, A12).
-- Additive and idempotent. sub_documents grows a version/status/metadata
-- lifecycle; sub_document_requests tracks each open ask with its cadence and
-- stop reason. Receipt of a file is NOT acceptance: status moves to accepted
-- only after a reviewer records validated metadata.

ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS version            integer NOT NULL DEFAULT 1;
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'received';
ALTER TABLE sub_documents DROP CONSTRAINT IF EXISTS sub_documents_status_check;
ALTER TABLE sub_documents ADD CONSTRAINT sub_documents_status_check
  CHECK (status IN ('received','under_review','accepted','rejected','expired','superseded'));
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS validated_metadata jsonb;          -- {insurer, policyNumber, limits, effectiveDate, expiryDate, w9TinPresent}
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS reviewed_at        timestamptz;
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS review_note        text NOT NULL DEFAULT '';
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS project_id         uuid REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS restricted         boolean NOT NULL DEFAULT true;
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS checksum           text;
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS exception          jsonb;          -- {reason: unreadable|wrong_job|expired|duplicate|other, detail}
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT '';
ALTER TABLE sub_documents ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_sub_documents_sub_type ON sub_documents(sub_slug, doc_type, version DESC);

CREATE TABLE IF NOT EXISTS sub_document_requests (
  id              bigserial PRIMARY KEY,
  sub_slug        text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  doc_type        text NOT NULL CHECK (doc_type IN ('w9','coi','agreement','other')),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  reason          text NOT NULL DEFAULT '',                    -- missing / expiring / expired / job_requirement
  requested_at    timestamptz,
  contact_used    text NOT NULL DEFAULT '',                    -- validated address from the sub record
  channel         text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  policy_ref      text,                                        -- policy:<key>@<v> when sent automatically
  decision_id     uuid REFERENCES decisions(id) ON DELETE SET NULL,
  last_intent_id  uuid REFERENCES action_intents(id) ON DELETE SET NULL,
  attempts        integer NOT NULL DEFAULT 0,
  next_at         timestamptz,
  stop_reason     text,
  state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open','satisfied','escalated','cancelled')),
  satisfied_by    bigint REFERENCES sub_documents(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- One open request per (sub, doc type, job); NULL project = company-level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_document_requests_open
  ON sub_document_requests(sub_slug, doc_type, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE state = 'open';
