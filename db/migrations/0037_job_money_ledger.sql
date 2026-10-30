-- 0037 — a job's total and what has been paid come from its records, never
-- from a typed figure.
--
-- Until now projects.contract_value / collected_to_date were hand-kept numbers
-- that agents rewrote with set_project_contract_value / set_project_collected,
-- next to an "invoices" mode a few jobs had switched to. Every writer did it a
-- little differently and the projects-list bar drifted: Spaeth read
-- "$2,200, 100% billed" after the $22,043.56 deposit on its $44,087.12 estimate
-- was paid by card (2026-10-29), because its total was still the pre-con figure
-- and the job was still hand-kept.
--
-- From here on Postgres computes both, for every job, on every write:
--
--   job total = opening_total_cents            (agreed outside the app: a Houzz
--                                               contract, a pre-con fee paid
--                                               before the app billed it)
--             + the formal estimate in effect   (approved, signed, or billed
--                                               against — one per job)
--             + approved change orders, net of their credits
--             + pre-con fee invoices            (economic_key 'precon:%')
--
--   paid      = opening_collected_cents         (paid outside the app's invoices)
--             + settled payments on the job's invoices, less refunds/returns
--
-- Both opening figures are entered on Money › Overview (with a note) and
-- nowhere else. projects.total_cents / collected_cents hold the result to the
-- cent; contract_value / collected_to_date (whole dollars) and progress
-- (the "% paid" bar) are kept in step for the many readers that use them. A
-- direct write to any of those five columns is overwritten by the trigger.
-- billing_source is retired: every job now works the same way.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS opening_total_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_cents bigint NOT NULL DEFAULT 0;

-- The formal estimate that is the job's contract: approved, signed, or already
-- billed against (Spaeth's was billed and paid while still marked draft).
CREATE OR REPLACE FUNCTION project_contract_estimate_id(p_id uuid) RETURNS bigint AS $$
  SELECT e.id FROM estimates e
   WHERE e.project_id = p_id AND e.kind = 'formal' AND e.status <> 'declined'
     AND (e.status = 'approved'
          OR EXISTS (SELECT 1 FROM signature_requests s WHERE s.estimate_id = e.id AND s.status = 'signed')
          OR EXISTS (SELECT 1 FROM invoices i WHERE i.estimate_id = e.id AND i.status NOT IN ('draft', 'void')))
   ORDER BY (e.status = 'approved') DESC, e.approved_at DESC NULLS LAST, e.id DESC
   LIMIT 1
$$ LANGUAGE sql STABLE;

-- Everything but the opening figures (those live on the row being written).
CREATE OR REPLACE FUNCTION project_money_parts(p_id uuid)
RETURNS TABLE (estimate_id bigint, estimate_cents bigint, change_orders_cents bigint, precon_cents bigint, payments_cents bigint) AS $$
  WITH est AS (SELECT project_contract_estimate_id(p_id) AS id)
  SELECT est.id,
         COALESCE((SELECT e.total FROM estimates e WHERE e.id = est.id), 0)::bigint,
         (COALESCE((SELECT SUM(c.price_cents) FROM change_orders c WHERE c.project_id = p_id AND c.status = 'approved'), 0)
          - COALESCE((SELECT SUM(cc.amount_cents) FROM change_order_credits cc JOIN change_orders c ON c.id = cc.change_order_id
                       WHERE c.project_id = p_id AND c.status = 'approved'), 0))::bigint,
         COALESCE((SELECT SUM(i.amount) FROM invoices i
                    WHERE i.project_id = p_id AND i.economic_key LIKE 'precon:%' AND i.status NOT IN ('draft', 'void')), 0)::bigint,
         COALESCE((SELECT SUM(CASE WHEN ip.kind = 'payment' THEN ip.amount_cents
                                   WHEN ip.kind IN ('refund', 'return') THEN -ip.amount_cents ELSE 0 END)
                     FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                    WHERE i.project_id = p_id AND ip.status = 'settled'), 0)::bigint
    FROM est
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Carry today's figures into the opening balances, BEFORE the trigger exists.
-- Rule per job: whatever the hand-kept total / collected holds beyond what the
-- records already account for becomes the opening figure (under $1 = rounding
-- of the whole-dollar columns = 0). A hand figure BELOW the records is stale
-- and is dropped. Jobs already on invoices keep their opening collected.
-- ---------------------------------------------------------------------------
WITH x AS (
  SELECT p.id, p.billing_source, p.opening_collected_cents, mp.*,
         CASE WHEN p.billing_source = 'invoices' AND p.price_cents IS NOT NULL THEN p.price_cents::bigint
              ELSE p.contract_value::bigint * 100 END AS hand_total,
         p.collected_to_date::bigint * 100 AS hand_collected
    FROM projects p, LATERAL project_money_parts(p.id) mp
)
UPDATE projects p
   SET opening_total_cents = CASE WHEN x.hand_total - (x.estimate_cents + x.change_orders_cents + x.precon_cents) >= 100
                                  THEN x.hand_total - (x.estimate_cents + x.change_orders_cents + x.precon_cents) ELSE 0 END,
       opening_collected_cents = CASE WHEN x.billing_source = 'invoices' THEN x.opening_collected_cents
                                      WHEN x.hand_collected - x.payments_cents >= 100 THEN x.hand_collected - x.payments_cents
                                      ELSE 0 END
  FROM x WHERE x.id = p.id;

-- Jobs the rule above can't read on its own (checked by hand against the
-- estimates and invoices, 2026-10-30). Each is a no-op where the job is absent.
--
-- Spaeth: the hand figures were the $2,200 pre-con fee alone (paid before the
-- app billed anything; credited on estimate #30). Total = $2,200 + $44,087.12.
UPDATE projects SET opening_total_cents = 220000, opening_collected_cents = 220000,
       opening_note = 'Pre-con fee $2,200 paid before invoices were in the app (credited on estimate #30).'
 WHERE slug = 'spaeth-garage-addition';
-- Tierney: the 50% deposit INV-001 ($23,824.14) bills formal estimate #27
-- ($47,648.27) but was made by hand, unlinked; the $2,247 pre-con fee was paid
-- before the app (credited on #27). Link the deposit so #27 counts as the contract.
UPDATE invoices SET estimate_id = 27
 WHERE id = 15 AND estimate_id IS NULL
   AND project_id = (SELECT id FROM projects WHERE slug = 'tierney-kitchen')
   AND EXISTS (SELECT 1 FROM estimates WHERE id = 27 AND project_id = (SELECT id FROM projects WHERE slug = 'tierney-kitchen'));
UPDATE projects SET opening_total_cents = 224700, opening_collected_cents = 224700,
       opening_note = 'Pre-con fee $2,247 paid before invoices were in the app (credited on estimate #27).'
 WHERE slug = 'tierney-kitchen';
-- Louiselle: $28,295.64 contract + the $1,500 design fee (IN-10046, billed
-- before the contract, not keyed as pre-con).
UPDATE projects SET opening_total_cents = 150000,
       opening_note = 'Design fee $1,500 (IN-10046), billed before the contract.'
 WHERE slug = 'elaine-louiselle';

-- Every job works one way now. price_cents (Money › Overview's old price
-- override) is retired too: Mahowald's held the pre-con money as well as the
-- contract, so the final-invoice remainder would have billed the $17,580 a
-- second time.
UPDATE projects SET billing_source = 'invoices', price_cents = NULL;

-- ---------------------------------------------------------------------------
-- The trigger: every insert/update of a project recomputes the five columns.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_projects_billed_pct ON projects;
DROP FUNCTION IF EXISTS projects_billed_pct();

CREATE OR REPLACE FUNCTION projects_job_money() RETURNS trigger AS $$
DECLARE
  m record;
BEGIN
  SELECT * INTO m FROM project_money_parts(NEW.id);
  NEW.total_cents := GREATEST(0, COALESCE(NEW.opening_total_cents, 0) + m.estimate_cents + m.change_orders_cents + m.precon_cents);
  NEW.collected_cents := COALESCE(NEW.opening_collected_cents, 0) + m.payments_cents;
  NEW.contract_value := ROUND(NEW.total_cents / 100.0)::int;
  NEW.collected_to_date := ROUND(NEW.collected_cents / 100.0)::int;
  NEW.progress := CASE WHEN NEW.total_cents > 0
                       THEN LEAST(100, GREATEST(0, ROUND(100.0 * NEW.collected_cents / NEW.total_cents)))::int
                       ELSE 0 END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_job_money
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_job_money();

-- A write to any record the figures come from re-runs the trigger above.
CREATE OR REPLACE FUNCTION refresh_project_money(p_id uuid) RETURNS void AS $$
  UPDATE projects SET total_cents = total_cents WHERE id = p_id
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION job_money_touch() RETURNS trigger AS $$
DECLARE
  ids uuid[] := '{}';
BEGIN
  IF TG_TABLE_NAME = 'invoice_payments' THEN
    IF TG_OP <> 'INSERT' THEN ids := ids || (SELECT project_id FROM invoices WHERE id = OLD.invoice_id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := ids || (SELECT project_id FROM invoices WHERE id = NEW.invoice_id); END IF;
  ELSIF TG_TABLE_NAME = 'change_order_credits' THEN
    IF TG_OP <> 'INSERT' THEN ids := ids || (SELECT project_id FROM change_orders WHERE id = OLD.change_order_id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := ids || (SELECT project_id FROM change_orders WHERE id = NEW.change_order_id); END IF;
  ELSIF TG_TABLE_NAME = 'signature_requests' THEN
    IF TG_OP <> 'INSERT' THEN ids := ids || (SELECT project_id FROM estimates WHERE id = OLD.estimate_id); END IF;
    IF TG_OP <> 'DELETE' THEN ids := ids || (SELECT project_id FROM estimates WHERE id = NEW.estimate_id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN ids := ids || OLD.project_id; END IF;
    IF TG_OP <> 'DELETE' THEN ids := ids || NEW.project_id; END IF;
  END IF;
  PERFORM refresh_project_money(x) FROM (SELECT DISTINCT unnest(ids) AS x) d WHERE x IS NOT NULL;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_job_money ON invoices;
CREATE TRIGGER trg_invoices_job_money
  AFTER INSERT OR DELETE OR UPDATE OF project_id, status, amount, economic_key, estimate_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION job_money_touch();
DROP TRIGGER IF EXISTS trg_invoice_payments_job_money ON invoice_payments;
CREATE TRIGGER trg_invoice_payments_job_money
  AFTER INSERT OR DELETE OR UPDATE OF invoice_id, kind, amount_cents, status ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION job_money_touch();
DROP TRIGGER IF EXISTS trg_estimates_job_money ON estimates;
CREATE TRIGGER trg_estimates_job_money
  AFTER INSERT OR DELETE OR UPDATE OF project_id, kind, status, total, approved_at ON estimates
  FOR EACH ROW EXECUTE FUNCTION job_money_touch();
DROP TRIGGER IF EXISTS trg_change_orders_job_money ON change_orders;
CREATE TRIGGER trg_change_orders_job_money
  AFTER INSERT OR DELETE OR UPDATE OF project_id, status, price_cents ON change_orders
  FOR EACH ROW EXECUTE FUNCTION job_money_touch();
DROP TRIGGER IF EXISTS trg_change_order_credits_job_money ON change_order_credits;
CREATE TRIGGER trg_change_order_credits_job_money
  AFTER INSERT OR DELETE OR UPDATE OF change_order_id, amount_cents ON change_order_credits
  FOR EACH ROW EXECUTE FUNCTION job_money_touch();
DROP TRIGGER IF EXISTS trg_signature_requests_job_money ON signature_requests;
CREATE TRIGGER trg_signature_requests_job_money
  AFTER INSERT OR DELETE OR UPDATE OF status, estimate_id ON signature_requests
  FOR EACH ROW EXECUTE FUNCTION job_money_touch();

-- Fill the computed columns for every job.
UPDATE projects SET total_cents = total_cents;
