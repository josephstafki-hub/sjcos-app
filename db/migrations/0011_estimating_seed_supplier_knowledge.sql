-- 0011 — Supplier-knowledge seed (WORKFLOW W05). Joe named Siweck Lumber as an
-- existing lumberyard relationship. That is:
--   • level 2 (owner-confirmed relationship) for LUMBER — Joe said "lumberyard";
--   • level 1 (inferred from the supplier category) for doors, windows, siding
--     and roofing — a lumberyard is a candidate, nothing more.
-- No price, discount, brand or inventory is asserted. Level-3 rows only ever
-- come from a dated current quote. Idempotent via the unique index.

INSERT INTO supplier_capabilities (name, category, evidence_level, source, observed_at, notes)
VALUES
  ('Siweck Lumber', 'lumber',  2, 'owner:WORKFLOW W05 (2026-09-23)', DATE '2026-09-23', 'Joe named Siweck Lumber as his lumberyard. Relationship only — no standing discount or current price.'),
  ('Siweck Lumber', 'doors',   1, 'category:lumberyard', DATE '2026-09-23', 'Category inference: a lumberyard may source doors. Not confirmed.'),
  ('Siweck Lumber', 'windows', 1, 'category:lumberyard', DATE '2026-09-23', 'Category inference: a lumberyard may source windows. Not confirmed.'),
  ('Siweck Lumber', 'siding',  1, 'category:lumberyard', DATE '2026-09-23', 'Category inference: a lumberyard may source siding. Not confirmed.'),
  ('Siweck Lumber', 'roofing', 1, 'category:lumberyard', DATE '2026-09-23', 'Category inference: a lumberyard may source roofing. Not confirmed.')
ON CONFLICT DO NOTHING;

-- Link to the vendor record when one exists under that name (trusted contact
-- identity comes from vendors, never from this seed).
UPDATE supplier_capabilities sc
   SET vendor_id = v.id
  FROM vendors v
 WHERE sc.vendor_id IS NULL AND lower(sc.name) = lower(v.name);
