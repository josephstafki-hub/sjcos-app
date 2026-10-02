-- 0014 — Owner site and office time capture (A19, OWNER_TIME_TRACKING.md).
-- Additive only; owned by WS-field. UTC storage; Central display is done in
-- SQL with AT TIME ZONE 'America/Chicago'. No payroll, no QBO, no client
-- charge ever derives from these rows.

-- ── Job sites for arrival prompts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_sites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  radius_m     integer NOT NULL DEFAULT 150,
  dwell_s      integer NOT NULL DEFAULT 300,     -- how long inside before a prompt counts
  cooldown_s   integer NOT NULL DEFAULT 1800,    -- no second prompt for the same job within this
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

-- ── Raw location events (enter / exit / heartbeat). Retention is
--    app_settings 'owner_time.location_retention_days' (default 30). ─────────
CREATE TABLE IF NOT EXISTS location_events (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id          text NOT NULL DEFAULT '',
  client_event_id    text NOT NULL UNIQUE,
  kind               text NOT NULL CHECK (kind IN ('enter','exit','heartbeat')),
  project_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ project_id, distance_m }]
  lat                double precision,
  lng                double precision,
  accuracy_m         double precision,
  at                 timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_location_events_user_at ON location_events(user_id, at DESC);

-- ── Designer activity events (A21 contract) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS designer_activity_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  design_id   bigint REFERENCES plan_designs(id) ON DELETE SET NULL,
  project_id  uuid REFERENCES projects(id) ON DELETE SET NULL,   -- resolved server-side from the design
  session_id  text NOT NULL,
  seq         integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('focus','heartbeat','blur','idle','end')),
  device_id   text NOT NULL DEFAULT '',
  at          timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_designer_activity_user ON designer_activity_events(user_id, at DESC);

-- ── Time intervals: the reviewable record ────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_intervals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,   -- NULL = overhead
  category           text NOT NULL DEFAULT 'site' CHECK (category IN ('site','design','estimating','admin','other')),
  start_at           timestamptz NOT NULL,
  end_at             timestamptz,                                       -- NULL = running
  source             text NOT NULL CHECK (source IN ('manual','geofence_prompt','designer_activity','timer')),
  state              text NOT NULL DEFAULT 'inferred' CHECK (state IN ('inferred','confirmed','discarded','review')),
  review_reason      text,
  device_id          text NOT NULL DEFAULT '',
  client_event_id    text,                 -- idempotency for the creating event
  session_id         text,                 -- designer session that produced it
  -- Arrival prompt with several nearby jobs: the choices offered (never auto-picked).
  choices            jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_end_at   timestamptz,          -- a departure suggested this; not applied until confirmed
  correction_history jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ at, by, before: {...}, after: {...}, note }]
  note               text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_intervals_event ON time_intervals(source, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_time_intervals_user_start ON time_intervals(user_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_intervals_project ON time_intervals(project_id, start_at) WHERE state = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_time_intervals_running ON time_intervals(user_id) WHERE end_at IS NULL AND state IN ('confirmed','inferred');

-- Replay log for clock actions (confirm / out / correct / discard): one row
-- per client_event_id so an offline retry applies once.
CREATE TABLE IF NOT EXISTS time_events (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_event_id  text NOT NULL UNIQUE,
  kind             text NOT NULL,
  interval_id      uuid REFERENCES time_intervals(id) ON DELETE SET NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  at               timestamptz NOT NULL DEFAULT now()
);

-- ── Owner labour rate assumptions (dated, approved) ──────────────────────────
CREATE TABLE IF NOT EXISTS owner_labor_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category       text NOT NULL CHECK (category IN ('site','design','estimating','admin','other')),
  rate_cents     integer NOT NULL CHECK (rate_cents > 0),
  effective_from date NOT NULL,
  decision_id    uuid REFERENCES decisions(id) ON DELETE SET NULL,   -- kind 'owner_rate' (or 'markup')
  approved_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, effective_from)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_sites','time_intervals'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
