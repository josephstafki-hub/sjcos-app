-- 0018 — Baseline, overhead, learning governance and truthful procedures (A18).
-- Additive only. Measurement records are the honest denominator for every
-- automation claim: a case is opened when work becomes eligible and closed
-- with an outcome — failures, corrections and missed commitments STAY in the
-- denominator. Overhead keeps fixed subscriptions and metered charges apart
-- (a subscription never implies API credits). Procedure versions + checks
-- record what the agents were actually told and flag references to tools or
-- fields that no longer exist. Nothing here promotes anything.
-- See docs/automation-reliability/VALIDATION.md "Measurement" and
-- docs/automation-reliability/capabilities.md.

-- ── Measurement cases ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS measurement_cases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL,       -- lead_followup / package_release / invoice / purchase / weekly_summary / sub_docs / closeout / estimate / other
  ref_kind       text,                -- lead / project / work_item / decision / intent / …
  ref_id         text,
  work_item_id   uuid REFERENCES work_items(id) ON DELETE SET NULL,
  decision_id    uuid REFERENCES decisions(id) ON DELETE SET NULL,
  project_id     uuid REFERENCES projects(id) ON DELETE SET NULL,
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  eligible       boolean NOT NULL DEFAULT true,   -- false = excluded from the denominator on purpose, with a note
  outcome        text NOT NULL DEFAULT 'pending'
                   CHECK (outcome IN ('pending','verified_success','corrected','failed','unknown_effect','missed_commitment')),
  mode           text NOT NULL DEFAULT 'unknown'
                   CHECK (mode IN ('unattended','one_tap','assisted','manual','unknown')), -- one-tap work is assisted, never "unattended"
  owner_seconds  integer,             -- NULL = unknown; derived from owner_touches when linked
  agent_seconds  integer,
  latency_ms     bigint,              -- opened → closed, computed at close unless supplied
  cost_usd       numeric(12,6),       -- NULL = unknown
  auth_ref       text,                -- policy:<key>@<v> / decision:<id> / grant:<id>
  opened_by      text NOT NULL DEFAULT 'system',
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  notes          text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_measurement_cases_kind_created ON measurement_cases(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurement_cases_open ON measurement_cases(created_at) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_measurement_cases_ref ON measurement_cases(kind, ref_kind, ref_id) WHERE ref_id IS NOT NULL;

-- ── Overhead: fixed subscriptions vs metered charges ────────────────────────
CREATE TABLE IF NOT EXISTS overhead_subscriptions (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  vendor        text NOT NULL,
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  cadence       text NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('monthly','yearly')),
  source        text NOT NULL DEFAULT 'owner_reported' CHECK (source IN ('owner_reported','bill','qbo')),
  started_on    date NOT NULL DEFAULT CURRENT_DATE,
  ended_on      date,
  external_ref  text,                 -- bill / QBO id; the ONLY key reconciliation dedupes on
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_overhead_subscriptions_external_ref ON overhead_subscriptions(external_ref) WHERE external_ref IS NOT NULL;
-- Same subscription reported twice by hand (same name + vendor + start) is a duplicate, not a second line.
CREATE UNIQUE INDEX IF NOT EXISTS uq_overhead_subscriptions_identity ON overhead_subscriptions(lower(name), lower(vendor), started_on);

CREATE TABLE IF NOT EXISTS metered_charges (
  id            bigserial PRIMARY KEY,
  provider      text NOT NULL,        -- anthropic / openai / telnyx / …
  period        text NOT NULL,        -- 'YYYY-MM'
  amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
  source        text NOT NULL DEFAULT 'owner_reported' CHECK (source IN ('owner_reported','bill','qbo','provider_usage','estimate')),
  external_ref  text,
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metered_charges_external_ref ON metered_charges(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_metered_charges_period ON metered_charges(period, provider);

-- Owner-reported recurring overhead (DECISIONS.md "Overhead"). Reconciliation
-- to bills / QBO is pending; these rows carry no external_ref until then. A
-- subscription fee does NOT imply API credits — metered usage is separate.
INSERT INTO overhead_subscriptions (name, vendor, amount_cents, cadence, source, started_on, notes)
SELECT 'Anthropic subscription', 'Anthropic', 20000, 'monthly', 'owner_reported', DATE '2026-09-01',
       'Owner-reported 2026-09-23. Reconciliation to bill/QBO pending. Subscription does not include API credits; metered API usage is tracked separately in metered_charges.'
WHERE NOT EXISTS (SELECT 1 FROM overhead_subscriptions WHERE lower(name) = 'anthropic subscription' AND lower(vendor) = 'anthropic');
INSERT INTO overhead_subscriptions (name, vendor, amount_cents, cadence, source, started_on, notes)
SELECT 'OpenAI subscription', 'OpenAI', 1000, 'monthly', 'owner_reported', DATE '2026-09-01',
       'Owner-reported 2026-09-23. Reconciliation to bill/QBO pending. Subscription does not include API credits; metered API usage is tracked separately in metered_charges.'
WHERE NOT EXISTS (SELECT 1 FROM overhead_subscriptions WHERE lower(name) = 'openai subscription' AND lower(vendor) = 'openai');

-- ── Procedure versions + truthfulness checks ────────────────────────────────
CREATE TABLE IF NOT EXISTS procedure_versions (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('skill','runbook','policy','instruction_block')),
  key          text NOT NULL,         -- skill slug / runbook slug / policy key / block key
  version      text NOT NULL,         -- source version number as text
  checksum     text NOT NULL,         -- sha256 of the body / canonical config
  tool_refs    text[] NOT NULL DEFAULT '{}',
  field_refs   text[] NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'unknown',   -- source status at snapshot time (approved/proposed/active/…)
  snapshot_id  uuid NOT NULL,         -- one id per snapshotProcedures() call
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key, version, checksum)
);
CREATE INDEX IF NOT EXISTS idx_procedure_versions_snapshot ON procedure_versions(snapshot_id);

CREATE TABLE IF NOT EXISTS procedure_checks (
  id             bigserial PRIMARY KEY,
  procedure_kind text NOT NULL,
  procedure_key  text NOT NULL,
  version        text NOT NULL DEFAULT '',
  check_kind     text NOT NULL CHECK (check_kind IN ('missing_tool','retired_field','contradiction','unapproved_authority_change')),
  detail         text NOT NULL DEFAULT '',
  fingerprint    text NOT NULL,       -- kind|key|check|subject — one open row per finding
  detected_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_procedure_checks_open ON procedure_checks(fingerprint) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_procedure_checks_open ON procedure_checks(detected_at DESC) WHERE resolved_at IS NULL;

-- ── Capability catalogue seed (all 28 tasks; nothing implemented yet) ───────
-- capability_status exists from 0001. Rows are created unclaimed; the
-- integration owner flips states with evidence via setCapabilityState().
INSERT INTO capability_status (key, title) VALUES
  ('A00',     'Current evidence, test environment and migration discipline'),
  ('A01',     'Stable obligations and protected task state'),
  ('A02',     'Transactional runbook start, advance and repair'),
  ('A03a',    'Shared server commands and minimum action records'),
  ('A03b',    'Durable intake and supervised worker'),
  ('A04',     'Evidence-backed completion'),
  ('A05_A06', 'Approval binding and duplicate-safe external actions'),
  ('A07a',    'Small independent invoice integrity repair'),
  ('A07b',    'Invoice lifecycle, balances and automatic contract billing'),
  ('A08a',    'Immediate business-agent access restrictions'),
  ('A08b',    'Enforced worker identities, budgets and recovery'),
  ('A09a',    'Off-host backups, basic alerts and restore proof'),
  ('A09b',    'Independent uptime and business-progress monitoring'),
  ('A10',     'Automatic routine policy and one-tap decision surfaces'),
  ('A11',     'Complete lead intake and follow-up'),
  ('A12',     'Subcontractor paperwork collection'),
  ('A13',     'Procurement, commitments and approved bill payment'),
  ('A14',     'QuickBooks Online connection and reconciliation'),
  ('A15',     'Evidence-based estimates and closeout cost learning'),
  ('A16',     'Sub portal field evidence, scheduling and weekly client summaries'),
  ('A17',     'Closeout, warranty, signed documents and approved marketing'),
  ('A18',     'Baseline, overhead, learning governance and truthful procedures'),
  ('A19',     'Owner site and office time capture'),
  ('A20',     'Square card and ACH customer payments'),
  ('A21',     'Integrate existing full 3-D designer and retire Houzz dependency'),
  ('A22',     'Delegated approvals and employee accounts'),
  ('A23',     'Confirmed lead-to-closeout workflow and proactive estimate assembly'),
  ('A24',     'Operating-agent instructions, context and behavior evaluations'),
  ('feature.decisions',      'One-tap decisions (stage / resolve / consume)'),
  ('feature.dispatcher',     'Intent dispatcher and provider adapters'),
  ('feature.square',         'Square payments'),
  ('feature.qbo',            'QuickBooks Online sync'),
  ('feature.weekly_summary', 'Weekly client summary'),
  ('feature.owner_time',     'Owner time capture'),
  ('feature.measurement',    'Measurement cases and baseline'),
  ('feature.overhead',       'Overhead subscriptions and metered charges'),
  ('feature.procedure_checks','Procedure versioning and truthfulness checks')
ON CONFLICT (key) DO NOTHING;
