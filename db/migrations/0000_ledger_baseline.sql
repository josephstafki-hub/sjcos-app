-- Ledger baseline marker. Every database that reaches this ledger already has
-- db/schema.sql applied (fresh: loaded by the harness/first install; live: the
-- historical apply-*.mjs scripts through 2026-09-23, source b19772a). This
-- file intentionally changes nothing; its row proves the ledger was started.
SELECT 1;
