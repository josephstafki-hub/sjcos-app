-- 0007 — Square customer payments (A20): attempts, provider config, refunds.
-- No Square account exists; the adapter runs in fake mode until
-- SQUARE_ACCESS_TOKEN + SQUARE_ENV are set. Secrets are NEVER stored here.
-- Owner: WS-money. See docs/automation-reliability/status/A20.md.

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          bigint NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  invoice_revision    integer NOT NULL,
  intent_key          text NOT NULL UNIQUE,          -- square:inv:<id>:rev<n>:<client nonce>; also the provider idempotency key
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),   -- SERVER-computed outstanding balance at creation
  currency            text NOT NULL DEFAULT 'USD',
  method              text NOT NULL CHECK (method IN ('card','ach')),
  provider            text NOT NULL DEFAULT 'square',
  provider_payment_id text,
  provider_order_id   text,
  provider_status     text,                           -- raw provider vocabulary (COMPLETED / PENDING / …)
  state               text NOT NULL DEFAULT 'created'
                        CHECK (state IN ('created','pending','completed','failed','returned','refunded','disputed','unknown')),
  source_event_ids    uuid[] NOT NULL DEFAULT '{}',   -- source_events that touched this attempt
  last_error          text,
  actor               text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON payment_attempts(invoice_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_provider_payment
  ON payment_attempts(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_open ON payment_attempts(state, updated_at) WHERE state IN ('created','pending','unknown');
DROP TRIGGER IF EXISTS trg_payment_attempts_updated_at ON payment_attempts;
CREATE TRIGGER trg_payment_attempts_updated_at BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Public/non-secret provider configuration + verified capability status. The
-- access token and webhook signature key live only in the environment
-- (SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY).
CREATE TABLE IF NOT EXISTS payment_provider_config (
  provider          text PRIMARY KEY,                  -- 'square'
  environment       text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  location_id       text NOT NULL DEFAULT '',
  application_id    text NOT NULL DEFAULT '',          -- public Web Payments SDK app id
  notification_url  text NOT NULL DEFAULT '',          -- webhook URL registered with Square (part of the signature input)
  connection_state  text NOT NULL DEFAULT 'unconfigured'
                      CHECK (connection_state IN ('unconfigured','configured','connected','error')),
  capabilities      jsonb NOT NULL DEFAULT '{}'::jsonb, -- { merchant_approved, card, ach, refunds } booleans as verified
  last_error        text,
  verified_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_payment_provider_config_updated_at ON payment_provider_config;
CREATE TRIGGER trg_payment_provider_config_updated_at BEFORE UPDATE ON payment_provider_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refunds: one-tap decision (kind 'refund') bound to amount + original payment.
CREATE TABLE IF NOT EXISTS refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id  uuid NOT NULL REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  reason              text NOT NULL DEFAULT '',
  decision_id         uuid NOT NULL REFERENCES decisions(id) ON DELETE RESTRICT,
  provider_ref        text,
  state               text NOT NULL DEFAULT 'requested'
                        CHECK (state IN ('requested','pending','completed','failed','unknown')),
  last_error          text,
  actor               text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refunds_decision ON refunds(decision_id);
CREATE INDEX IF NOT EXISTS idx_refunds_attempt ON refunds(payment_attempt_id);
DROP TRIGGER IF EXISTS trg_refunds_updated_at ON refunds;
CREATE TRIGGER trg_refunds_updated_at BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
