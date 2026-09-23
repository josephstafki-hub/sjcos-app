-- 0001 — Foundation contracts (A03a, A05/A06 base, A10/A22 base, A03b intake,
-- A18 measurement). Additive only. Every entry point (UI, MCP, cron, webhook,
-- worker) runs the same typed commands over these records; see
-- lib/commands/README.md and docs/automation-reliability/DESIGN.md.

-- ── Commands: one row per (name, request_key). Same key + same input returns
--    the stored result; same key + different input is refused. ────────────────
CREATE TABLE IF NOT EXISTS commands (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  request_key       text NOT NULL,
  input_hash        text NOT NULL,
  input             jsonb NOT NULL DEFAULT '{}'::jsonb,
  principal         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- server-derived; never caller-supplied
  principal_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  auth_ref          text,                                  -- decision:<id> | grant:<id> | policy:<key>@<v> | owner
  status            text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','succeeded','failed')),
  result            jsonb,
  error             text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  UNIQUE (name, request_key)
);
CREATE INDEX IF NOT EXISTS idx_commands_started ON commands(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_principal ON commands(principal_user_id, started_at DESC);

-- ── Action intents: the permanent record of every external side effect the
--    system intends to perform. operation_key is the stable economic identity
--    (one per business operation + artifact revision), so a retry, a second
--    caller or a restored backup cannot create a second send/charge. ─────────
CREATE TABLE IF NOT EXISTS action_intents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key     text NOT NULL UNIQUE,
  kind              text NOT NULL,                          -- send_email / send_invoice / send_sms / place_call / telegram / square_charge / qbo_post / vendor_payment / …
  target_kind       text,
  target_id         text,
  recipient         text,                                   -- normalized address / phone / chat id
  project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
  lead_id           uuid REFERENCES leads(id) ON DELETE SET NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,     -- immutable once created; secrets never stored
  payload_hash      text NOT NULL,
  artifact_revision text,
  decision_id       uuid,                                   -- FK added below (decisions declared after)
  grant_id          uuid REFERENCES owner_grants(id) ON DELETE SET NULL,
  policy_ref        text,
  principal         jsonb NOT NULL DEFAULT '{}'::jsonb,
  command_id        uuid REFERENCES commands(id) ON DELETE SET NULL,
  state             text NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending','leased','accepted','confirmed','retryable_failure',
                                       'unknown','permanent_failure','cancelled','held')),
  hold_reason       text,
  provider          text,
  provider_ref      text,
  provider_state    text,
  lease_token       text,
  lease_until       timestamptz,
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 5,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_action_intents_dispatch
  ON action_intents(next_attempt_at) WHERE state IN ('pending','retryable_failure');
CREATE INDEX IF NOT EXISTS idx_action_intents_open
  ON action_intents(state, created_at) WHERE state NOT IN ('confirmed','permanent_failure','cancelled');
CREATE INDEX IF NOT EXISTS idx_action_intents_target ON action_intents(target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_action_intents_project ON action_intents(project_id, created_at DESC);

-- Append-only attempt log. A row per provider call; secrets redacted by the
-- writer. response_class maps every provider's answer onto one vocabulary.
CREATE TABLE IF NOT EXISTS action_attempts (
  id               bigserial PRIMARY KEY,
  intent_id        uuid NOT NULL REFERENCES action_intents(id) ON DELETE CASCADE,
  attempt_no       integer NOT NULL,
  lease_token      text,
  worker           text,
  request_summary  jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_class   text CHECK (response_class IN ('accepted','confirmed','retryable','unknown','permanent','skipped')),
  provider_ref     text,
  error            text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  UNIQUE (intent_id, attempt_no)
);

-- ── Decisions: one exact, immutable, cross-channel owner/delegate decision.
--    Bound to action, target, recipient, amount, content hash and artifact
--    revision; a material change supersedes it. One id is shared by SJC OS,
--    Telegram and push; the first valid resolution wins everywhere. ─────────
CREATE TABLE IF NOT EXISTS decisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL,          -- package_release / proposal / purchase / payment / refund / publication / schedule / funding / markup / change_order / design_package / grant / other
  action               text NOT NULL,          -- concrete action key the consumer must present (e.g. send_bid_package)
  target_kind          text,
  target_id            text,
  recipient            text,
  amount_cents         bigint,
  currency             text NOT NULL DEFAULT 'USD',
  content_hash         text,
  artifact_revision    text,
  project_id           uuid REFERENCES projects(id) ON DELETE SET NULL,
  lead_id              uuid REFERENCES leads(id) ON DELETE SET NULL,
  title                text NOT NULL,
  summary              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- review card: recipients, inclusions, exclusions, quantities, attachments, gaps, changes, effect
  href                 text,
  options              jsonb NOT NULL DEFAULT '["approve","reject"]'::jsonb,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected','expired','revoked','superseded','consumed')),
  requested_by         text NOT NULL DEFAULT 'system',
  requested_principal  jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_via          text,                   -- app / telegram / push / mcp
  decided_at           timestamptz,
  decision_note        text,
  expires_at           timestamptz NOT NULL DEFAULT now() + interval '7 days',
  max_uses             integer NOT NULL DEFAULT 1,
  uses                 integer NOT NULL DEFAULT 0,
  policy_version       text,
  dedupe_key           text,
  superseded_by        uuid REFERENCES decisions(id) ON DELETE SET NULL,
  work_item_id         uuid REFERENCES work_items(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_decisions_pending_dedupe
  ON decisions(dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, created_at DESC);

ALTER TABLE action_intents
  ADD CONSTRAINT action_intents_decision_fkey FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE SET NULL;

-- Where each decision was surfaced (app notification, Telegram message id,
-- push token) so a resolution can update every channel and a lost delivery
-- never loses the decision.
CREATE TABLE IF NOT EXISTS decision_deliveries (
  id            bigserial PRIMARY KEY,
  decision_id   uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('app','telegram','push','email')),
  external_ref  text,
  status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','sent','failed','updated')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_deliveries ON decision_deliveries(decision_id);

CREATE TABLE IF NOT EXISTS decision_events (
  id           bigserial PRIMARY KEY,
  decision_id  uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  kind         text NOT NULL,   -- staged / delivered / approved / rejected / expired / revoked / superseded / consumed / replay_ignored / unauthorized
  actor        text NOT NULL DEFAULT '',
  channel      text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_events ON decision_events(decision_id, id);

-- Bridge: an owner grant may be the consumable face of a decision.
ALTER TABLE owner_grants ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL;

-- ── Source events: verified, durable intake for every provider webhook /
--    poll / import (provider + account + event id unique). ────────────────
CREATE TABLE IF NOT EXISTS source_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL,             -- telnyx / gmail / square / qbo / esign / portal / mobile / telegram / …
  account          text NOT NULL DEFAULT '',
  event_id         text NOT NULL,
  event_type       text NOT NULL DEFAULT '',
  payload_hash     text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified         boolean NOT NULL DEFAULT false,
  source_at        timestamptz,
  received_at      timestamptz NOT NULL DEFAULT now(),
  state            text NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending','leased','done','failed','exhausted','ignored')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 8,
  lease_token      text,
  lease_until      timestamptz,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  processed_at     timestamptz,
  UNIQUE (provider, account, event_id)
);
CREATE INDEX IF NOT EXISTS idx_source_events_dispatch
  ON source_events(next_attempt_at) WHERE state IN ('pending','failed');

-- ── Workers: heartbeat + version per supervised loop (A03b/A09b). ────────────
CREATE TABLE IF NOT EXISTS workers (
  name          text PRIMARY KEY,
  instance_id   text NOT NULL DEFAULT '',
  version       text NOT NULL DEFAULT '',
  state         text NOT NULL DEFAULT 'idle',
  note          text NOT NULL DEFAULT '',
  started_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  last_run_at   timestamptz,
  last_result   jsonb
);

-- ── Routine policies (versioned) + lane kill switches (A10). ─────────────────
CREATE TABLE IF NOT EXISTS policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL,            -- routine.followup / weekly.client_summary / invoice.initial_on_acceptance / …
  version        integer NOT NULL,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  state          text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','disabled','retired')),
  effective_from timestamptz,
  created_by     text NOT NULL DEFAULT 'system',
  notes          text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_policies_one_active ON policies(key) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS lane_pauses (
  lane        text PRIMARY KEY,           -- e.g. 'sends', 'payments', 'square', 'qbo', 'routine_followup', 'weekly_summary', 'all'
  paused_at   timestamptz NOT NULL DEFAULT now(),
  paused_by   text NOT NULL DEFAULT '',
  reason      text NOT NULL DEFAULT ''
);

-- ── Delegated authority (A22): per user, per action type, optional project /
--    amount bounds. New accounts have no rows. Owner is implicit. ─────────────
CREATE TABLE IF NOT EXISTS authority_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type      text NOT NULL,          -- decision kind or action key; '*' never allowed
  project_id       uuid REFERENCES projects(id) ON DELETE CASCADE,   -- NULL = any project
  max_amount_cents bigint,                 -- NULL = no amount bound
  granted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  note             text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_authority_grants_user ON authority_grants(user_id) WHERE revoked_at IS NULL;

-- ── Capability status + owner touches (A18). ─────────────────────────────────
CREATE TABLE IF NOT EXISTS capability_status (
  key          text PRIMARY KEY,
  title        text NOT NULL,
  implemented  boolean NOT NULL DEFAULT false,
  deployed     boolean NOT NULL DEFAULT false,
  enabled      boolean NOT NULL DEFAULT false,
  proven       boolean NOT NULL DEFAULT false,
  evidence     jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes        text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_touches (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL,        -- approve / reject / edit / manual_send / review / correction / question_answer / …
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_id   uuid REFERENCES decisions(id) ON DELETE SET NULL,
  work_item_id  uuid REFERENCES work_items(id) ON DELETE SET NULL,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  seconds       integer,               -- measured or estimated review time; NULL = unknown
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_touches_created ON owner_touches(created_at DESC);

-- updated_at touch on the new mutable tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['action_intents','decisions','decision_deliveries'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- Production drift recorded by A00 (2026-09-23): branch
-- t3code/add-estimate-work-options applied this column to the live database
-- with a throwaway apply script that never merged. Carried here so a fresh
-- database matches production; the ADD is idempotent on the live one.
ALTER TABLE lead_estimates ADD COLUMN IF NOT EXISTS alternates jsonb NOT NULL DEFAULT '[]'::jsonb;
