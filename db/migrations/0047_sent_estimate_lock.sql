-- 0047 — A sent estimate is locked (Joe, 2026-10-30).
--
-- Once an estimate is out to the client (sent, or a signature request on it —
-- the estimate itself or a contract built on it — is out or signed), what the
-- client sees can't change underneath them. Adding, deleting or changing a
-- line's description, section, unit, quantity, price, owner price, allowance
-- or superseded state is refused. Internal cost / markup bookkeeping that
-- leaves the client's price alone is still allowed (recompute).
--
-- To revise before signing: void the signature request (the estimate goes back
-- to draft), edit, send again. After signing it stays locked for good: a change
-- before the contract is a Pre-con change, after it a change order
-- (docs/estimates-and-change-orders.md).

CREATE OR REPLACE FUNCTION estimate_out_to_client(p_id bigint) RETURNS text AS $$
  SELECT CASE
    WHEN e.status = 'approved' OR EXISTS (SELECT 1 FROM signature_requests s WHERE s.estimate_id = e.id AND s.status = 'signed')
      THEN 'signed'
    WHEN e.status = 'sent' OR EXISTS (SELECT 1 FROM signature_requests s WHERE s.estimate_id = e.id AND s.status = 'sent')
      THEN 'sent'
  END
  FROM estimates e WHERE e.id = p_id
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION estimate_lines_locked_when_sent() RETURNS trigger AS $$
DECLARE
  est bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END;
  state text;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
       OLD.description IS DISTINCT FROM NEW.description OR OLD.section IS DISTINCT FROM NEW.section
    OR OLD.unit IS DISTINCT FROM NEW.unit OR OLD.qty IS DISTINCT FROM NEW.qty
    OR OLD.extended IS DISTINCT FROM NEW.extended
    OR OLD.owner_price_override_cents IS DISTINCT FROM NEW.owner_price_override_cents
    OR OLD.is_allowance IS DISTINCT FROM NEW.is_allowance OR OLD.allowance_cents IS DISTINCT FROM NEW.allowance_cents
    OR OLD.superseded_at IS DISTINCT FROM NEW.superseded_at OR OLD.estimate_id IS DISTINCT FROM NEW.estimate_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Deleting the whole estimate cascades to its lines: let it through.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM estimates WHERE id = est) THEN
    RETURN OLD;
  END IF;
  state := estimate_out_to_client(est);
  IF state = 'signed' THEN
    RAISE EXCEPTION 'Estimate #% is signed and locked. A change before the contract is a Pre-con change; after it, a change order.', est
      USING ERRCODE = 'P0001', HINT = 'estimate_locked';
  ELSIF state = 'sent' THEN
    RAISE EXCEPTION 'Estimate #% is out to the client and locked. To change it, void its signature request (it goes back to draft), edit, then send it again.', est
      USING ERRCODE = 'P0001', HINT = 'estimate_locked';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_estimate_lines_locked_when_sent ON estimate_lines;
CREATE TRIGGER trg_estimate_lines_locked_when_sent
  BEFORE INSERT OR UPDATE OR DELETE ON estimate_lines
  FOR EACH ROW EXECUTE FUNCTION estimate_lines_locked_when_sent();
