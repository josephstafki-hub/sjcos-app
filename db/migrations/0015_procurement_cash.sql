-- 0015 — Procurement commitments, deliveries, bills and the project cash
-- guard (WS-procurement, A13 / WORKFLOW W05–W09). Additive and idempotent.
--
--   • commitments               — one row per approved-or-pending binding
--                                 order/award/offer, revisioned; a purchase
--                                 decision binds to exactly one revision.
--   • deliveries                — acknowledgement / receipt / review / accept
--                                 events per commitment (partial, late, wrong,
--                                 revised are all distinct rows).
--   • bills                     — a vendor/sub bill (file) that is NOT payable
--                                 until matched to a commitment + accepted
--                                 delivery; payment is its own decision.
--   • cash_reservations         — atomic project-cash holds taken at
--                                 commitment; consumed on payment, released
--                                 only for verified unused amounts.
--   • company_funding_approvals — explicit owner approval to put company
--                                 cash into a project (never implied by a
--                                 purchase tap).
--   • vendor_payment_config     — which outgoing payment rail exists (none).
--   • payee_validations         — proposed bank/contact changes for a payee;
--                                 only owner-confirmed rows ever apply.
--   • purchase_orders.commitment_id / send_intent_id — link the PO to its
--                                 commitment and dispatcher intent.

CREATE TABLE IF NOT EXISTS commitments (
  id                 bigserial PRIMARY KEY,
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('purchase_order','sub_award','supplier_offer')),
  ref                text NOT NULL,                            -- po id / bid invite id / quote id
  revision           integer NOT NULL DEFAULT 1,
  payee_kind         text NOT NULL CHECK (payee_kind IN ('vendor','sub','one_off')),
  vendor_id          uuid REFERENCES vendors(id) ON DELETE SET NULL,
  sub_slug           text REFERENCES subs(slug) ON DELETE SET NULL,
  payee_name         text NOT NULL DEFAULT '',                 -- snapshot from the trusted record
  payee_contact      text NOT NULL DEFAULT '',                 -- validated email/phone from the trusted record
  scope_summary      text NOT NULL DEFAULT '',
  items              jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{description, unit, qty, unitCents, extendedCents}]
  subtotal_cents     integer NOT NULL DEFAULT 0,
  tax_cents          integer NOT NULL DEFAULT 0,
  shipping_cents     integer NOT NULL DEFAULT 0,
  total_cents        integer NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'USD',
  terms              text NOT NULL DEFAULT '',
  pay_now_bundled    boolean NOT NULL DEFAULT false,
  content_hash       text NOT NULL DEFAULT '',
  decision_id        uuid REFERENCES decisions(id) ON DELETE SET NULL,
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','approved','committed','acknowledged','partially_delivered','delivered',
                                        'reviewed','accepted','payable','paid','void')),
  promised_date      date,
  acknowledgement    jsonb,                                    -- {at, via, note, evidenceFileId}
  send_intent_id     uuid REFERENCES action_intents(id) ON DELETE SET NULL,
  superseded_by      bigint REFERENCES commitments(id) ON DELETE SET NULL,
  created_by         text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref, revision)
);
CREATE INDEX IF NOT EXISTS idx_commitments_project ON commitments(project_id, state);

CREATE TABLE IF NOT EXISTS deliveries (
  id             bigserial PRIMARY KEY,
  commitment_id  bigint NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'receipt'
                   CHECK (kind IN ('acknowledgement','receipt','review','acceptance')),
  received_at    timestamptz NOT NULL DEFAULT now(),
  lines          jsonb NOT NULL DEFAULT '[]'::jsonb,           -- [{description, qtyReceived, unit, note}]
  late           boolean NOT NULL DEFAULT false,
  wrong          boolean NOT NULL DEFAULT false,
  revised        boolean NOT NULL DEFAULT false,
  reviewed       boolean NOT NULL DEFAULT false,
  accepted       boolean NOT NULL DEFAULT false,
  issues         jsonb NOT NULL DEFAULT '[]'::jsonb,           -- ["short 2 ea", "wrong finish", …]
  evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,           -- {fileIds:[…], note}
  recorded_by    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_commitment ON deliveries(commitment_id, id);

CREATE TABLE IF NOT EXISTS bills (
  id                   bigserial PRIMARY KEY,
  project_id           uuid REFERENCES projects(id) ON DELETE SET NULL,
  commitment_id        bigint REFERENCES commitments(id) ON DELETE SET NULL,
  payee_kind           text NOT NULL DEFAULT 'one_off' CHECK (payee_kind IN ('vendor','sub','one_off')),
  vendor_id            uuid REFERENCES vendors(id) ON DELETE SET NULL,
  sub_slug             text REFERENCES subs(slug) ON DELETE SET NULL,
  payee_name           text NOT NULL DEFAULT '',
  bill_number          text NOT NULL DEFAULT '',
  amount_cents         integer NOT NULL DEFAULT 0,
  currency             text NOT NULL DEFAULT 'USD',
  received_file_id     text REFERENCES files(id) ON DELETE SET NULL,
  received_at          timestamptz NOT NULL DEFAULT now(),
  matched_state        text NOT NULL DEFAULT 'unmatched' CHECK (matched_state IN ('unmatched','matched','disputed')),
  match_note           text NOT NULL DEFAULT '',
  payable_cents        integer,                                 -- NULL until matched + accepted; never 0 by default
  destination          jsonb,                                   -- validated payee destination snapshot at payment staging
  payment_decision_id  uuid REFERENCES decisions(id) ON DELETE SET NULL,
  payment_intent_id    uuid REFERENCES action_intents(id) ON DELETE SET NULL,
  state                text NOT NULL DEFAULT 'pending'
                         CHECK (state IN ('pending','approved','paid','manual_pending','void')),
  paid_evidence        jsonb,                                   -- {method, reference, confirmedBy, at, fileId}
  paid_at              timestamptz,
  created_by           text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bills_project ON bills(project_id, state);
CREATE INDEX IF NOT EXISTS idx_bills_commitment ON bills(commitment_id);

CREATE TABLE IF NOT EXISTS cash_reservations (
  id             bigserial PRIMARY KEY,
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commitment_id  bigint REFERENCES commitments(id) ON DELETE SET NULL,
  amount_cents   integer NOT NULL CHECK (amount_cents >= 0),
  state          text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','consumed','released')),
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_reservations_project ON cash_reservations(project_id, state);
-- One live reservation per commitment: a retried commit cannot double-reserve.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_reservations_live_commitment
  ON cash_reservations(commitment_id) WHERE commitment_id IS NOT NULL AND state = 'reserved';

CREATE TABLE IF NOT EXISTS company_funding_approvals (
  id             bigserial PRIMARY KEY,
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount_cents   integer NOT NULL CHECK (amount_cents > 0),
  purpose        text NOT NULL,
  effect         text NOT NULL DEFAULT '',
  decision_id    uuid REFERENCES decisions(id) ON DELETE SET NULL,
  state          text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','rejected','withdrawn')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_funding_project ON company_funding_approvals(project_id, state);

CREATE TABLE IF NOT EXISTS vendor_payment_config (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rail        text NOT NULL DEFAULT 'none' CHECK (rail IN ('none','manual','future')),
  provider    text,
  notes       text NOT NULL DEFAULT '',
  updated_by  text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO vendor_payment_config (id, rail, notes)
VALUES (1, 'none', 'No outgoing payment rail selected (INTEGRATIONS.md). Approved payments become manual_pending with an owner execution step.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS payee_validations (
  id               bigserial PRIMARY KEY,
  payee_kind       text NOT NULL CHECK (payee_kind IN ('vendor','sub')),
  vendor_id        uuid REFERENCES vendors(id) ON DELETE CASCADE,
  sub_slug         text REFERENCES subs(slug) ON DELETE CASCADE,
  field            text NOT NULL CHECK (field IN ('email','phone','bank','address')),
  proposed_value   text NOT NULL,
  source           text NOT NULL DEFAULT '',                    -- 'email:<message id>' / 'owner' / 'phone call' …
  source_trusted   boolean NOT NULL DEFAULT false,              -- inbound email is NEVER trusted
  state            text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','confirmed','rejected')),
  confirmed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at     timestamptz,
  note             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payee_validations_open ON payee_validations(state) WHERE state = 'proposed';

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS commitment_id bigint REFERENCES commitments(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS send_intent_id uuid REFERENCES action_intents(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_cents integer NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS terms text NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS need_by date;
