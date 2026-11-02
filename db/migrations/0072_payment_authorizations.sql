-- Payment authorization at portal checkout (Joe, 2026-11-02). Square's risk
-- team asked for a signed card authorization on a portal payment; from now on
-- the client types their name and agrees to a one-time charge before the pay
-- page charges anything, and this table keeps what they agreed to
-- (lib/payments/authorization.ts). One row per payment attempt, written in
-- the same transaction that creates the attempt, never edited or deleted.

CREATE TABLE IF NOT EXISTS payment_authorizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL UNIQUE REFERENCES payment_attempts(id) ON DELETE RESTRICT,
  invoice_id         bigint NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  method             text NOT NULL CHECK (method IN ('card','ach')),
  signer_name        text NOT NULL CHECK (length(btrim(signer_name)) BETWEEN 2 AND 120),
  statement          text NOT NULL CHECK (length(statement) > 0),
  statement_version  text NOT NULL,
  amount_cents       integer NOT NULL CHECK (amount_cents > 0),     -- total charged, surcharge included
  surcharge_cents    integer NOT NULL DEFAULT 0 CHECK (surcharge_cents >= 0),
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,  -- the portal login that agreed
  actor              text NOT NULL DEFAULT '',
  ip                 text NOT NULL DEFAULT '',
  user_agent         text NOT NULL DEFAULT '',
  agreed_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_authorizations_invoice ON payment_authorizations(invoice_id, agreed_at DESC);

-- A record of consent is only worth anything if nobody can change it later.
-- (user_id may still go NULL when a login is deleted: that is the FK's own
-- ON DELETE SET NULL, allowed below.)
CREATE OR REPLACE FUNCTION payment_authorizations_immutable() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
     AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payment authorizations are a permanent record and cannot be changed or deleted';
END $$;
DROP TRIGGER IF EXISTS trg_payment_authorizations_immutable ON payment_authorizations;
CREATE TRIGGER trg_payment_authorizations_immutable BEFORE UPDATE OR DELETE ON payment_authorizations
  FOR EACH ROW EXECUTE FUNCTION payment_authorizations_immutable();

-- Last 4 digits Square reports for the card (card_details.card.last_4), so
-- the printed authorization names the card without the app ever seeing it.
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');

-- Only the website writes authorizations (the portal checkout). Agents and the
-- monitor may read them; the worker's existing UPDATE on payment_attempts
-- covers card_last4.
-- node scripts/db-roles-sql.mjs payment_authorizations
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'payment_authorizations');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'payment_authorizations');
