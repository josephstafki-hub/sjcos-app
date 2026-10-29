-- 0033 — Invoices are always due on receipt (Joe, 2026-10-29).
--
-- Every invoice carries terms 'Due on receipt'. Once it is issued or sent its
-- due date is the day it went out (Central); a draft has no due date yet.
-- `terms_unknown` can no longer arise. Enforced here so every code path and
-- agent (manual drafts, draw automation, MCP) follows it. A due date already
-- on the row is kept.

CREATE OR REPLACE FUNCTION invoices_due_on_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.terms := 'Due on receipt';
  NEW.exception_flags := array_remove(COALESCE(NEW.exception_flags, '{}'::text[]), 'terms_unknown');
  IF NEW.due_at IS NULL AND NEW.status NOT IN ('draft', 'void') THEN
    NEW.due_at := (COALESCE(NEW.issued_at, NEW.sent_at, NEW.created_at, now()) AT TIME ZONE 'America/Chicago')::date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoices_due_on_receipt ON invoices;
CREATE TRIGGER trg_invoices_due_on_receipt
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_due_on_receipt();

-- Backfill: existing invoices pick up the rule.
UPDATE invoices
   SET terms = 'Due on receipt'
 WHERE terms IS DISTINCT FROM 'Due on receipt'
    OR 'terms_unknown' = ANY(exception_flags)
    OR (due_at IS NULL AND status NOT IN ('draft', 'void'));
