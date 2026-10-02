-- 0010 — Estimating records (A15 + WORKFLOW W02–W07 contracts). Additive only.
-- Owner: WS-estimating. Money is integer cents; an UNKNOWN cost is NULL, never 0.
-- Every table here hangs off projects/estimates by FK; nothing edits another
-- workstream's tables except the new columns on estimates / estimate_lines
-- (owned by WS-estimating per BUILD.md).

-- ── Scope register: the project's work broken into stable, keyed scope items
--    (W02/W03). `key` is the stable identity every downstream record cites. ──
CREATE TABLE IF NOT EXISTS scope_registers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  revision       integer NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','superseded')),
  prepared_from  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- lead facts snapshot the breakdown was derived from
  enrichment     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- agent enrichment hook: { requested_at, notes, applied_revision }
  reviewed_at    timestamptz,
  reviewed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scope_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key                   text NOT NULL,                    -- stable: e.g. "kitchen.cabinetry"
  title                 text NOT NULL,
  trade                 text NOT NULL DEFAULT '',
  work_package          text NOT NULL DEFAULT '',
  room                  text NOT NULL DEFAULT '',
  responsibility        text NOT NULL DEFAULT 'unassigned'
                          CHECK (responsibility IN ('joe','sub','supplier','unassigned')),
  supply_by             text NOT NULL DEFAULT 'unassigned'
                          CHECK (supply_by IN ('joe','sub','supplier','client','unassigned')),
  install_by            text NOT NULL DEFAULT 'unassigned'
                          CHECK (install_by IN ('joe','sub','none','unassigned')),
  supplier_categories   text[] NOT NULL DEFAULT '{}',
  exclusions            text[] NOT NULL DEFAULT '{}',
  assumptions           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ text, unverified, source }]
  dependencies          text[] NOT NULL DEFAULT '{}',         -- other scope keys
  required_finishes     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ label, status: 'undecided'|'chosen'|'client_supplied', ref }]
  quantities            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ label, qty, unit, basis, source }]
  status                text NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','allocated','priced','excluded','superseded')),
  revision              integer NOT NULL DEFAULT 1,
  source_refs           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ kind: 'lead_intake'|'lead_scope'|'site_finding'|'owner'|'agent', ref, at }]
  dedicated_price_cents bigint,                               -- Joe's retained-work price; NULL = none
  price_basis           text CHECK (price_basis IN ('internal_cost','client_price')),
  price_scope_note      text NOT NULL DEFAULT '',             -- what the dedicated price covers, in Joe's words
  unverified            boolean NOT NULL DEFAULT true,
  notes                 text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key),
  CHECK (dedicated_price_cents IS NULL OR price_basis IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_scope_items_project ON scope_items(project_id, status);

-- ── Site-visit plan + findings (W03). Plan items are scope-linked required
--    observations; findings are source-linked facts that update records. ──
CREATE TABLE IF NOT EXISTS site_visit_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision    integer NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','visited','superseded')),
  items       jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{ id, scope_key, kind: 'inspect'|'measure'|'photo'|'question', prompt, unit, location,
    --    status: 'open'|'answered'|'not_applicable', finding_id }]
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision)
);

CREATE TABLE IF NOT EXISTS site_visit_findings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id        uuid REFERENCES site_visit_plans(id) ON DELETE SET NULL,
  scope_key      text,                                  -- NULL = project-wide / new work
  fact_key       text NOT NULL,                         -- stable per (source, fact); repeats do not duplicate
  kind           text NOT NULL DEFAULT 'observation'
                   CHECK (kind IN ('observation','measurement','photo','client_answer','decision','issue','new_work','price_instruction')),
  statement      text NOT NULL,
  measurement    numeric(14,3),
  unit           text,
  source_note    text NOT NULL DEFAULT '',              -- note/upload reference (file id, message id)
  media_ref      text,
  impacts        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ target: 'scope'|'quantity'|'selection'|'estimate'|'plan', ref, change }]
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','applied','needs_clarification','dismissed')),
  resolution     text NOT NULL DEFAULT '',
  targets_price  boolean NOT NULL DEFAULT false,        -- explicit: this finding changes Joe's allocation/price
  applied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, fact_key)
);
CREATE INDEX IF NOT EXISTS idx_site_findings_project ON site_visit_findings(project_id, status);

-- ── Design decisions per room/scope (W04). ───────────────────────────────────
CREATE TABLE IF NOT EXISTS design_decisions (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_key                    text NOT NULL,             -- room or scope key
  room                         text NOT NULL DEFAULT '',
  direction_sufficiency        text NOT NULL DEFAULT 'undefined'
                                 CHECK (direction_sufficiency IN ('undefined','defined','exact')),
  path                         text NOT NULL
                                 CHECK (path IN ('mood_board','selections','direct_estimate')),
  board_room                   text,                      -- project_mood_boards.room
  board_revision               integer,
  selection_ids                bigint[] NOT NULL DEFAULT '{}',
  client_direction_approved_at timestamptz,
  owner_release_approved_at    timestamptz,
  feedback_log                 jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ at, author, body, kind: 'comment'|'change_request'|'approval', revision }]
  partial_choices              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { chosen: [selection ids], open: [selection ids] }
  revision                     integer NOT NULL DEFAULT 1,
  status                       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','presented','approved','superseded')),
  notes                        text NOT NULL DEFAULT '',
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, scope_key)
);

-- ── Supplier knowledge (W05): three separated evidence levels. ───────────────
CREATE TABLE IF NOT EXISTS supplier_capabilities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid REFERENCES vendors(id) ON DELETE SET NULL,
  sub_slug        text REFERENCES subs(slug) ON DELETE SET NULL,
  name            text NOT NULL,
  category        text NOT NULL,                      -- lumber / doors / windows / siding / roofing / cabinets / tile / …
  evidence_level  smallint NOT NULL CHECK (evidence_level IN (1,2,3)),
    -- 1 = inferred from supplier category; 2 = history or owner-confirmed relationship; 3 = current project/product quote
  source          text NOT NULL DEFAULT '',
  observed_at     date,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_capabilities
  ON supplier_capabilities(lower(name), lower(category), evidence_level, COALESCE(source, ''));
CREATE INDEX IF NOT EXISTS idx_supplier_capabilities_cat ON supplier_capabilities(lower(category), evidence_level);

CREATE TABLE IF NOT EXISTS price_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key      text NOT NULL,                     -- normalized brand|model|variant|finish
  product          jsonb NOT NULL DEFAULT '{}'::jsonb, -- { name, brand, model, variant, finish, sku, url }
  unit             text,                              -- NULL = unknown → gap
  unit_basis       text NOT NULL DEFAULT 'per_unit',  -- per_unit / per_pack / per_sf / lump
  pack_qty         numeric(12,3),                     -- when unit_basis = per_pack
  price_cents      bigint,                            -- NULL = price not found (never 0)
  currency         text NOT NULL DEFAULT 'USD',
  source_kind      text NOT NULL
                     CHECK (source_kind IN ('online','historical_quote','purchase','supplier_quote','owner_stated')),
  source_url       text,
  source_ref       text NOT NULL DEFAULT '',
  observed_at      timestamptz NOT NULL DEFAULT now(),
  includes_tax     boolean,                           -- NULL = unknown coverage → gap
  includes_freight boolean,
  expires_at       timestamptz,
  supplier_name    text,
  vendor_id        uuid REFERENCES vendors(id) ON DELETE SET NULL,
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  notes            text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_key, source_kind, source_ref, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_price_observations_product ON price_observations(product_key, observed_at DESC);

-- ── Quotes with coverage + competing groups (W07). ───────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  supplier_kind    text NOT NULL CHECK (supplier_kind IN ('vendor','sub')),
  vendor_id        uuid REFERENCES vendors(id) ON DELETE SET NULL,
  sub_slug         text REFERENCES subs(slug) ON DELETE SET NULL,
  supplier_name    text NOT NULL,
  quote_ref        text NOT NULL DEFAULT '',
  revision         integer NOT NULL DEFAULT 1,
  received_at      timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  includes_tax     boolean,
  tax_cents        bigint,
  freight_cents    bigint,
  includes_freight boolean,
  competing_group  text,                              -- quotes sharing a group compete; never summed
  approval_state   text NOT NULL DEFAULT 'received'
                     CHECK (approval_state IN ('received','eligible','held_competing','approved','rejected','superseded')),
  coverage         jsonb NOT NULL DEFAULT '{}'::jsonb, -- { scope_keys: [], item_keys: [], exclusions: [] }
  bid_submission_id bigint REFERENCES bid_submissions(id) ON DELETE SET NULL,
  decision_id      uuid REFERENCES decisions(id) ON DELETE SET NULL,
  source_ref       text NOT NULL DEFAULT '',
  notes            text NOT NULL DEFAULT '',
  incorporated_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, supplier_name, quote_ref, revision)
);
CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id, approval_state);

CREATE TABLE IF NOT EXISTS quote_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description      text NOT NULL,
  product          jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_key      text,
  unit             text,
  quantity         numeric(12,3),
  unit_price_cents bigint,
  extended_cents   bigint,                            -- NULL = not priced
  supply           boolean NOT NULL DEFAULT true,
  install          boolean NOT NULL DEFAULT false,
  scope_key        text,
  item_key         text,                              -- estimate item this line prices
  sort_order       integer NOT NULL DEFAULT 0,
  notes            text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id, sort_order);

-- ── Estimate item extension: stable identity, source, internal cost vs
--    offered price, allowance identity, provisional flag (W07). ──────────────
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS item_key text;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS scope_item_key text;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS source_kind text
  CHECK (source_kind IS NULL OR source_kind IN ('client_product','selection','sub_bid','supplier_quote','online_price','owner_price','cost_book','assumption','allowance','manual'));
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS source_ref jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS internal_cost_cents bigint;       -- line total cost; NULL = unknown, never 0
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS cost_basis text;                  -- 'quote:<id>' / 'online:<obs id>' / 'owner' / 'cost_book:<id>' / 'assumption'
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS cost_observed_at timestamptz;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS owner_price_override_cents bigint;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS owner_price_basis text
  CHECK (owner_price_basis IS NULL OR owner_price_basis IN ('internal_cost','client_price'));
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS is_allowance boolean NOT NULL DEFAULT false;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS allowance_cents bigint;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS allowance_scope text;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS provisional boolean NOT NULL DEFAULT false;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS superseded_by bigint REFERENCES estimate_lines(id) ON DELETE SET NULL;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE estimate_lines ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimate_lines_item_key
  ON estimate_lines(estimate_id, item_key) WHERE item_key IS NOT NULL AND superseded_by IS NULL;

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS offered_snapshot jsonb;      -- immutable client prices at send
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS offered_at timestamptz;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS offered_revision integer;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS offer_stale boolean NOT NULL DEFAULT false;  -- lines changed after the offer went out
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS pricing_version text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS readiness jsonb;             -- last estimateReadiness() result
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS assumptions_accepted_at timestamptz;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS assumptions_accepted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Gaps: what the estimate still cannot support. Deduped per (estimate, kind, ref).
CREATE TABLE IF NOT EXISTS estimate_gaps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id  bigint NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  kind         text NOT NULL
                 CHECK (kind IN ('unknown_cost','missing_quantity','missing_unit','units_mismatch','stale_price','missing_quote',
                                 'unallocated_scope','unverified_assumption','coverage_missing','competing_quotes','offer_changed',
                                 'missing_freight','missing_tax','partial_choice')),
  ref          text NOT NULL DEFAULT '',            -- item_key / scope_key / quote id
  severity     text NOT NULL DEFAULT 'hard' CHECK (severity IN ('hard','soft')),
  detail       text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  UNIQUE (estimate_id, kind, ref)
);

-- ── Supplier pricing requests: staged payloads, never sent from here. ────────
CREATE TABLE IF NOT EXISTS supplier_pricing_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  supplier_name  text NOT NULL,
  vendor_id      uuid REFERENCES vendors(id) ON DELETE SET NULL,
  recipient      text,                               -- resolved from trusted vendor record; NULL = unresolved (gap)
  revision       integer NOT NULL DEFAULT 1,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb, -- { products: [...], quantity_gaps: [...], need_dates, documents }
  content_hash   text NOT NULL,
  decision_id    uuid REFERENCES decisions(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','approved','sent','superseded','rejected')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, supplier_name, revision)
);

-- ── Pricing setup (versioned; owner activates through a decision). ──────────
CREATE TABLE IF NOT EXISTS pricing_setups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version       integer NOT NULL UNIQUE,
  state         text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','retired')),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- { labor_rates: { <category>: { cents_per_hour: int|null, reason } }, markup_pct: number|null,
    --   margin_target_pct: number|null, default_allowances: { <category>: cents|null },
    --   uncertainty_rules: { rough_range_pct, fixed_requires: [...] } }
  evidence      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- per field: { source, sample_n, observed_at }
  proposed_by   text NOT NULL DEFAULT 'system',
  decision_id   uuid REFERENCES decisions(id) ON DELETE SET NULL,
  activated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at  timestamptz,
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_setups_active ON pricing_setups(state) WHERE state = 'active';

-- ── Closeout cost learning (A15, DESIGN "Cost learning"). ───────────────────
CREATE TABLE IF NOT EXISTS cost_learning_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('auto_cost_update','proposal','rollback','markup_proposal')),
  status           text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','proposed','rolled_back','rejected')),
  summary          text NOT NULL DEFAULT '',
  changes          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ cost_item_id, field, before, after, sample_n, delta_pct }]
  sample_support   jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason           text NOT NULL DEFAULT '',
  policy_ref       text,
  decision_id      uuid REFERENCES decisions(id) ON DELETE SET NULL,
  rollback_of      uuid REFERENCES cost_learning_revisions(id) ON DELETE SET NULL,
  rolled_back_by   uuid REFERENCES cost_learning_revisions(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_observations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_key            text NOT NULL,
  cost_item_id         bigint REFERENCES cost_items(id) ON DELETE SET NULL,
  unit                 text NOT NULL,                  -- normalized (sf/lf/ea/hr/ls/cy)
  quantity             numeric(14,3) NOT NULL,
  actual_cost_cents    bigint,                         -- NULL = not verified
  actual_hours         numeric(12,2),
  unit_cost_cents      bigint,                         -- derived: actual_cost / quantity
  source               text NOT NULL DEFAULT '',
  observed_at          timestamptz NOT NULL DEFAULT now(),
  completeness         text NOT NULL DEFAULT 'complete' CHECK (completeness IN ('complete','partial')),
  classification       text NOT NULL DEFAULT 'normal'
                         CHECK (classification IN ('normal','rework','scope_change','unusual_conditions','bad_coding','inflation','geography')),
  outlier              boolean NOT NULL DEFAULT false,
  pricing_version      text,
  ingest_revision      integer NOT NULL DEFAULT 1,
  superseded_by        uuid REFERENCES cost_observations(id) ON DELETE SET NULL,
  learning_revision_id uuid REFERENCES cost_learning_revisions(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, scope_key, ingest_revision)
);
CREATE INDEX IF NOT EXISTS idx_cost_observations_item ON cost_observations(cost_item_id, observed_at DESC) WHERE superseded_by IS NULL;

-- updated_at touch
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['scope_registers','scope_items','site_visit_plans','design_decisions','quotes','estimate_lines'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
