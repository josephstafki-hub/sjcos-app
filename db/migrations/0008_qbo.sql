-- 0008 — QuickBooks Online connection + reconciliation (A14).
-- QBO stays the bookkeeping authority; SJC OS keeps mappings, versions and
-- cursors, never a second ledger. OAuth tokens are NOT stored here (env for
-- now: INTUIT_CLIENT_ID / INTUIT_CLIENT_SECRET / QBO_REALM_ID /
-- QBO_REFRESH_TOKEN / QBO_ACCESS_TOKEN). Owner: WS-money.

CREATE TABLE IF NOT EXISTS qbo_connection (
  realm_id        text PRIMARY KEY,
  environment     text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production','fake')),
  state           text NOT NULL DEFAULT 'disconnected'
                    CHECK (state IN ('disconnected','connected','expired','error')),
  company_name    text NOT NULL DEFAULT '',
  token_meta      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { access_expires_at, refresh_expires_at, scopes } — metadata only, no tokens
  cursors         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { Customer: iso, Invoice: iso, Payment: iso, Purchase: iso, Bill: iso, Deposit: iso }
  last_sync_at    timestamptz,
  last_error      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_qbo_connection_updated_at ON qbo_connection;
CREATE TRIGGER trg_qbo_connection_updated_at BEFORE UPDATE ON qbo_connection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per QBO entity we know about and/or per internal record we mirror.
-- state: unmapped (imported, proposal only) → posted (mirrored once) →
-- settled / reconciled (payment applied, deposit matched) | conflict (QBO
-- edited/voided after we posted).
CREATE TABLE IF NOT EXISTS qbo_mappings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id       text NOT NULL,
  entity_kind    text NOT NULL CHECK (entity_kind IN ('Customer','Invoice','Payment','Purchase','Bill','Deposit','Refund','Expense')),
  qbo_id         text,
  sync_token     text,
  version_hash   text,                                  -- hash of the QBO document we last saw
  qbo_voided     boolean NOT NULL DEFAULT false,
  internal_kind  text,                                  -- invoice | invoice_payment | refund | processor_fee | payout | expense | sub_invoice | project | client
  internal_id    text,
  direction      text NOT NULL DEFAULT 'import' CHECK (direction IN ('import','export')),
  state          text NOT NULL DEFAULT 'unmapped'
                   CHECK (state IN ('unmapped','posted','settled','reconciled','conflict','rejected')),
  candidates     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- proposals: [{ internal_kind, internal_id, score, why }]
  snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,    -- last QBO document (sanitized)
  amount_cents   integer,
  txn_date       date,
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbo_mappings_qbo ON qbo_mappings(realm_id, entity_kind, qbo_id) WHERE qbo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbo_mappings_internal
  ON qbo_mappings(realm_id, entity_kind, internal_kind, internal_id)
  WHERE internal_kind IS NOT NULL AND internal_id IS NOT NULL AND state <> 'rejected';
CREATE INDEX IF NOT EXISTS idx_qbo_mappings_state ON qbo_mappings(realm_id, state);
DROP TRIGGER IF EXISTS trg_qbo_mappings_updated_at ON qbo_mappings;
CREATE TRIGGER trg_qbo_mappings_updated_at BEFORE UPDATE ON qbo_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS qbo_import_batches (
  id            bigserial PRIMARY KEY,
  realm_id      text NOT NULL,
  entity_kind   text NOT NULL,
  cursor_from   text,
  cursor_to     text,
  seen          integer NOT NULL DEFAULT 0,
  created       integer NOT NULL DEFAULT 0,
  updated       integer NOT NULL DEFAULT 0,
  conflicts     integer NOT NULL DEFAULT 0,
  dry_run       boolean NOT NULL DEFAULT true,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

-- Per-direction switches. Everything defaults OFF (dry-run / read-only).
CREATE TABLE IF NOT EXISTS qbo_sync_settings (
  key         text PRIMARY KEY CHECK (key IN ('import_read','export_invoices','export_payments')),
  enabled     boolean NOT NULL DEFAULT false,
  updated_by  text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO qbo_sync_settings (key, enabled) VALUES ('import_read', false), ('export_invoices', false), ('export_payments', false)
ON CONFLICT (key) DO NOTHING;
