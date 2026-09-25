-- 0006 — Invoice identity, numbering allocator, payment ledger (A07a / A07b).
-- Additive. Existing invoices are neither deleted nor renumbered; legacy
-- 'sent' / 'paid' rows keep their meaning (see the backfill at the bottom).
-- Owner: WS-money. See docs/automation-reliability/status/A07a.md.

-- ── Identity, revision, lifecycle, delivery, terms, links ────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS economic_key text;                       -- stable milestone/contract identity: estimate:<id>:initial / draw:<i>:<slug> / project:<id>:final
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS superseded_by bigint REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'none';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_error text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS send_intent_id uuid REFERENCES action_intents(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_at date;                             -- NULL = terms unknown (exception), never a guessed Net 7
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS terms text;                              -- the verified terms text the due date came from
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS estimate_id bigint REFERENCES estimates(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS change_order_id bigint REFERENCES change_orders(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contract_signature_request_id bigint REFERENCES signature_requests(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';   -- manual | draw | acceptance | progress | final
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exception_flags text[] NOT NULL DEFAULT '{}'; -- terms_unknown | hold | disputed_by_client | …
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_ref jsonb NOT NULL DEFAULT '{}'::jsonb; -- { qbo: {...}, houzz: {...} } — sync evidence, never authority
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_delivery_state_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_delivery_state_check
  CHECK (delivery_state IN ('none','queued','accepted','delivered','failed','unknown'));

-- status: 'issued' = obligation exists, not yet delivered; 'sent' keeps its
-- legacy meaning (delivered, open); 'partially_paid' / 'paid' are cash states
-- derived from invoice_payments; 'void' / 'disputed' are terminal / held.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','issued','sent','partially_paid','paid','void','disputed'));

-- One live invoice per economic milestone per project. Voided rows leave the
-- slot free so a corrected re-issue can reuse the identity (lineage via
-- superseded_by).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_economic_key
  ON invoices(project_id, economic_key) WHERE economic_key IS NOT NULL AND status <> 'void';
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_at) WHERE status IN ('issued','sent','partially_paid');

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Display-number allocator: UPDATE … RETURNING under a row lock, never
--    count(*)+1. Seeded from the highest number already issued per project so
--    nothing historical is renumbered. ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_numbers (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  next       integer NOT NULL DEFAULT 0     -- last allocated sequence; allocation returns next+1
);
INSERT INTO invoice_numbers (project_id, next)
SELECT i.project_id,
       GREATEST(count(*), COALESCE(max(NULLIF(substring(i.number from '(\d+)'), '')::int), 0))
  FROM invoices i GROUP BY i.project_id
ON CONFLICT (project_id) DO NOTHING;

-- ── Payment ledger: every cash / credit / refund / return / write-off against
--    an invoice, idempotent on the provider's reference. ──────────────────────
CREATE TABLE IF NOT EXISTS invoice_payments (
  id             bigserial PRIMARY KEY,
  invoice_id     bigint NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('payment','credit','refund','return','writeoff')),
  amount_cents   integer NOT NULL CHECK (amount_cents >= 0),
  method         text NOT NULL DEFAULT 'manual',          -- manual | check | card | ach | legacy_status | houzz | …
  provider       text,                                    -- square | qbo | houzz | NULL (manual)
  provider_ref   text,                                    -- provider payment / refund id
  received_at    timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'settled' CHECK (status IN ('pending','settled','failed','returned')),
  actor          text NOT NULL DEFAULT '',                -- principal label that recorded it
  note           text NOT NULL DEFAULT '',
  external_sync  jsonb NOT NULL DEFAULT '{}'::jsonb,      -- { qbo: { id, sync_token }, original_payment_id, … }
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payments_provider_ref
  ON invoice_payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id, id);
DROP TRIGGER IF EXISTS trg_invoice_payments_updated_at ON invoice_payments;
CREATE TRIGGER trg_invoice_payments_updated_at BEFORE UPDATE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only invoice audit (issue / send / payment / credit / void / link).
CREATE TABLE IF NOT EXISTS invoice_events (
  id          bigserial PRIMARY KEY,
  invoice_id  bigint NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  actor       text NOT NULL DEFAULT '',
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice ON invoice_events(invoice_id, id);

-- ── Backfill (meaning-preserving, no balance correction) ─────────────────────
-- sent → it was issued when it was sent and Gmail accepted it (the old code
-- only flipped 'sent' after the send call returned). paid → issued at its send
-- time if known, else creation; delivery unknown when it was never sent here.
UPDATE invoices
   SET issued_at = COALESCE(issued_at, sent_at, created_at),
       delivery_state = CASE WHEN sent_at IS NOT NULL THEN 'delivered' ELSE 'unknown' END
 WHERE status IN ('sent','paid') AND issued_at IS NULL;

-- A legacy 'paid' invoice has no ledger row: mirror its status as one settled
-- 'legacy_status' payment so invoiceBalance() reads 0 exactly as before.
INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, received_at, status, actor, note)
SELECT i.id, 'payment', i.amount, 'legacy_status', COALESCE(i.paid_at, i.created_at), 'settled', 'migration:0006',
       'Backfilled from invoices.status = paid (pre-ledger)'
  FROM invoices i
 WHERE i.status = 'paid'
   AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id);
