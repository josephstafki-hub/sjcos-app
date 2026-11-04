-- Signature state ('sent' means OPEN) is distinct from email delivery.
-- Unknown preserves honest wording for existing requests with no delivery proof.
ALTER TABLE signature_requests
  ADD COLUMN IF NOT EXISTS email_delivery_status text NOT NULL DEFAULT 'unknown'
    CHECK (email_delivery_status IN ('unknown','pending','sent','failed','in_person')),
  ADD COLUMN IF NOT EXISTS email_delivery_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

-- Close stale links left by the old void path, retaining the legal/audit record.
WITH revoked AS (
  UPDATE signature_requests sr SET status = 'void'
   WHERE sr.status IN ('draft','sent')
     AND EXISTS (SELECT 1 FROM document_drafts d
                  WHERE d.signature_request_id = sr.id AND d.status = 'void')
  RETURNING sr.id
)
INSERT INTO signature_events (request_id, kind, actor, detail)
SELECT id, 'voided', 'System', 'Signature request revoked — document was already voided'
  FROM revoked;

UPDATE document_drafts SET client_visible = false, updated_at = now()
 WHERE status = 'void' AND client_visible;
