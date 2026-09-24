-- 0012 — Field evidence, scheduling, buyout and weekly client summaries (A16,
-- WORKFLOW W09–W11). Additive only; every table is owned by WS-field.
--
-- sub_logs stay the raw portal entries. field_reports is the evidence record:
-- who said what, when, through which channel, whether Joe verified it and
-- whether the client may see it. Nothing in a weekly client summary exists
-- without a field_reports row (and its photos) behind it.
--
-- Contractual / promised dates live in their OWN columns (schedule_commitments.
-- commitment_date, buyout_obligations.order_deadline …). work_items.due_at and
-- its Today trigger are never touched by anything in this migration.

-- ── Field reports ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sub_slug              text REFERENCES subs(slug) ON DELETE SET NULL,
  kind                  text NOT NULL CHECK (kind IN ('progress','completion','snag','weekly_compiled')),
  body                  text NOT NULL DEFAULT '',
  -- [{ file_id, sha256? }] — file ids in files(id); sha256 lets a re-upload of
  -- the same bytes under a new id be recognised as the same photo.
  photos                jsonb NOT NULL DEFAULT '[]'::jsonb,
  author                text NOT NULL DEFAULT '',
  author_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  source                text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal','sms','email','owner','agent')),
  visibility            text NOT NULL DEFAULT 'client_ok' CHECK (visibility IN ('internal','client_ok')),
  verification          text NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified','owner_confirmed')),
  verified_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at           timestamptz,
  claimed_milestone_key text,
  -- Central-time Monday of the week this report belongs to (set on insert).
  week_start            date NOT NULL,
  sub_log_id            bigint REFERENCES sub_logs(id) ON DELETE SET NULL,
  -- Caller-supplied idempotency key (portal form token / message id).
  client_event_id       text,
  reported_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_reports_event ON field_reports(project_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_reports_weekly ON field_reports(project_id, sub_slug, week_start) WHERE kind = 'weekly_compiled';
CREATE INDEX IF NOT EXISTS idx_field_reports_project_week ON field_reports(project_id, week_start, kind);
CREATE INDEX IF NOT EXISTS idx_field_reports_milestone ON field_reports(project_id, claimed_milestone_key) WHERE claimed_milestone_key IS NOT NULL;

-- Targeted evidence requests ("send the 2 missing niche photos"). One row per
-- (project, sub, what) so the same missing part is asked for exactly once.
CREATE TABLE IF NOT EXISTS field_evidence_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sub_slug      text REFERENCES subs(slug) ON DELETE SET NULL,
  request_kind  text NOT NULL,                 -- completion_photos / weekly_part
  request_ref   text NOT NULL,                 -- milestone key / week_start
  missing       jsonb NOT NULL DEFAULT '[]'::jsonb,
  work_item_id  uuid REFERENCES work_items(id) ON DELETE SET NULL,
  fulfilled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, sub_slug, request_kind, request_ref)
);

-- ── Field incidents (snags) — always Joe first ───────────────────────────────
CREATE TABLE IF NOT EXISTS field_incidents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_report_id   uuid REFERENCES field_reports(id) ON DELETE SET NULL,
  affected_scope     text NOT NULL DEFAULT '',
  -- { cost: { cents?, note }, schedule: { days?, note }, client: { note } }
  impacts            jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation     text NOT NULL DEFAULT '',
  -- What the site actually reported (crew stopped / still working / unknown).
  -- Recorded separately from the owner decision, which may still be pending.
  actual_site_status text NOT NULL DEFAULT 'unknown',
  owner_decision     text NOT NULL DEFAULT 'pending' CHECK (owner_decision IN ('pending','continue','pause','other')),
  decision_id        uuid REFERENCES decisions(id) ON DELETE SET NULL,
  instructions       text NOT NULL DEFAULT '',
  decided_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_field_incidents_open ON field_incidents(project_id) WHERE resolved_at IS NULL;

-- ── Schedule plans (W09) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision            integer NOT NULL,
  status              text NOT NULL DEFAULT 'tentative' CHECK (status IN ('tentative','awaiting_approval','approved','confirmed','superseded')),
  -- [{ key, label, start, end, duration_days, depends_on[], inspection, crew }]
  phases              jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependencies        jsonb NOT NULL DEFAULT '[]'::jsonb,
  inspections         jsonb NOT NULL DEFAULT '[]'::jsonb,
  material_lead_times jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { ok, available_cents, reason, checked_at } from the injected fundingAvailable
  funding_readiness   jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL,
  based_on_revision   integer,
  change_note         text NOT NULL DEFAULT '',
  auth_ref            text,
  confirmed_at        timestamptz,
  created_by          text NOT NULL DEFAULT 'system',
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision)
);

-- A promise made to a client, sub or supplier for a date. Confirmed only after
-- the plan is confirmed; a change to a confirmed commitment is an external
-- impact and needs Joe.
CREATE TABLE IF NOT EXISTS schedule_commitments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES schedule_plans(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  party            text NOT NULL CHECK (party IN ('client','sub','supplier')),
  party_ref        text NOT NULL DEFAULT '',      -- sub slug / vendor / 'client'
  phase_key        text NOT NULL DEFAULT '',
  commitment_date  date NOT NULL,                  -- the promised date (never work_items.due_at)
  promise          text NOT NULL DEFAULT '',
  confirmed        boolean NOT NULL DEFAULT false,
  confirmed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_commitments_project ON schedule_commitments(project_id, commitment_date);

-- Material buyout planned backward from need-on-site. Funding reservation and
-- the PO itself belong to WS-procurement; reservation_ref / commitment_ref /
-- payment_ref are opaque identities they hand back.
CREATE TABLE IF NOT EXISTS buyout_obligations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id             uuid REFERENCES schedule_plans(id) ON DELETE SET NULL,
  scope_ref           text NOT NULL DEFAULT '',      -- phase key / estimate line / item
  item_label          text NOT NULL DEFAULT '',
  need_on_site        date NOT NULL,
  lead_time_days      integer NOT NULL DEFAULT 0,
  buffer_days         integer NOT NULL DEFAULT 0,
  order_deadline      date NOT NULL,                 -- need_on_site - lead - buffer (computed on write)
  quote_valid_until   date,
  deposit_terms       text NOT NULL DEFAULT '',
  balance_terms       text NOT NULL DEFAULT '',
  delivery_window     text NOT NULL DEFAULT '',
  amount_cents        bigint,                        -- NULL = not priced yet
  commitment_ref      text,                          -- WS-procurement PO / commitment id
  reservation_ref     text,                          -- WS-procurement funding reservation id
  payment_ref         text,
  status              text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','quote_requested','approved','ordered','delivered','cancelled','late')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buyout_deadline ON buyout_obligations(order_deadline) WHERE status IN ('planned','quote_requested','approved');

-- ── Weekly client summaries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_summaries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start        date NOT NULL,                  -- Central-time Monday
  revision          integer NOT NULL DEFAULT 1,
  -- { claims: [{ text, report_id, photo_ids[] }], photos: [file ids], held: [{ reason, report_id }] }
  content           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','held','pending_decision','published')),
  held_reason       text,
  publish_intent_id uuid REFERENCES action_intents(id) ON DELETE SET NULL,
  email_intent_id   uuid REFERENCES action_intents(id) ON DELETE SET NULL,
  decision_id       uuid REFERENCES decisions(id) ON DELETE SET NULL,
  auth_ref          text,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, week_start, revision)
);

-- Per-project override of the weekly summary slot (default Friday 15:00
-- America/Chicago from the weekly.client_summary policy config).
CREATE TABLE IF NOT EXISTS weekly_summary_settings (
  project_id   uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT true,
  weekday      integer NOT NULL DEFAULT 5 CHECK (weekday BETWEEN 1 AND 7),   -- ISO: 1 = Monday … 7 = Sunday
  hour         integer NOT NULL DEFAULT 15 CHECK (hour BETWEEN 0 AND 23),
  minute       integer NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
  send_email   boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Milestone confirmations (Joe confirms physical completion) ──────────────
CREATE TABLE IF NOT EXISTS milestone_confirmations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_key  text NOT NULL,
  evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { report_ids[], photo_ids[] }
  decision_id    uuid REFERENCES decisions(id) ON DELETE SET NULL,
  confirmed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at   timestamptz NOT NULL DEFAULT now(),
  hook_fired_at  timestamptz,
  UNIQUE (project_id, milestone_key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['field_incidents','buyout_obligations'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
