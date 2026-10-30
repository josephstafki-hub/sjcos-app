-- 0046 — An estimate knows when its client-facing lines last changed (2026-10-30).
--
-- The "client accepted this exact revision" check (lib/billing/commands.ts)
-- read max(estimate_lines.created_at), so it noticed an ADDED line but not an
-- edited price or quantity or a deleted line: a client who signed one number
-- could be billed on another. estimates.lines_changed_at is now stamped by
-- Postgres on any line insert, delete, or edit of what the client sees
-- (description, section, unit, qty, extended price, owner price, allowance,
-- superseded). Internal cost / markup bookkeeping that leaves the client's
-- price alone doesn't count.

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS lines_changed_at timestamptz;

-- Today's figure is what the check used until now (newest line added).
UPDATE estimates e SET lines_changed_at = (SELECT max(l.created_at) FROM estimate_lines l WHERE l.estimate_id = e.id)
 WHERE lines_changed_at IS NULL;

CREATE OR REPLACE FUNCTION estimate_lines_stamp_changed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
       OLD.description IS DISTINCT FROM NEW.description OR OLD.section IS DISTINCT FROM NEW.section
    OR OLD.unit IS DISTINCT FROM NEW.unit OR OLD.qty IS DISTINCT FROM NEW.qty
    OR OLD.extended IS DISTINCT FROM NEW.extended
    OR OLD.owner_price_override_cents IS DISTINCT FROM NEW.owner_price_override_cents
    OR OLD.is_allowance IS DISTINCT FROM NEW.is_allowance OR OLD.allowance_cents IS DISTINCT FROM NEW.allowance_cents
    OR OLD.superseded_at IS DISTINCT FROM NEW.superseded_at OR OLD.estimate_id IS DISTINCT FROM NEW.estimate_id) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- A new line counts from when it was added (its created_at).
    UPDATE estimates SET lines_changed_at = GREATEST(COALESCE(lines_changed_at, NEW.created_at), NEW.created_at)
     WHERE id = NEW.estimate_id;
  ELSE
    UPDATE estimates SET lines_changed_at = clock_timestamp()
     WHERE id IN (CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END,
                  CASE WHEN TG_OP = 'UPDATE' THEN OLD.estimate_id END);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_estimate_lines_stamp_changed ON estimate_lines;
CREATE TRIGGER trg_estimate_lines_stamp_changed
  AFTER INSERT OR UPDATE OR DELETE ON estimate_lines
  FOR EACH ROW EXECUTE FUNCTION estimate_lines_stamp_changed();
