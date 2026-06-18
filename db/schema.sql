-- SJC OS — initial schema.
-- Mirrors lib/types.ts. Idempotent: safe to re-run.
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ─── Leads ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  scope           text NOT NULL DEFAULT '',
  stage           text NOT NULL DEFAULT 'intake'
                    CHECK (stage IN ('intake','phase1_sent','precon_signed',
                                     'precon_in_flight','formal_proposal','signed_retainer')),
  triage_verdict  text CHECK (triage_verdict IN ('go','hold','pass')),
  email           text,
  phone           text,
  address         text,
  scope_city      text,                 -- short location shown in the list
  estimate_value  integer,              -- numeric midpoint, for sorting/forecast
  value_display   text,                 -- as-shown range, e.g. "$49–60k" / "?"
  source          text,
  hot             boolean NOT NULL DEFAULT false,  -- emphasis flag in the list
  flag_label      text,                 -- optional "AI take" chip, e.g. "Needs reply"
  flag_kind       text,                 -- chip kind for flag_label (flag/ai/…)
  last_contact_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Display columns added after the initial cut (idempotent for existing DBs).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS scope_city    text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS value_display text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hot           boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS flag_label    text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS flag_kind     text;

-- ─── Projects ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text UNIQUE NOT NULL,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'pre_construction'
                      CHECK (status IN ('pre_construction','active','closeout','complete')),
  client_name       text NOT NULL DEFAULT '',
  address           text,
  contract_value    integer NOT NULL DEFAULT 0,
  value_display     text,               -- as-shown value, e.g. "$28,000 (est)"
  collected_to_date integer NOT NULL DEFAULT 0,
  progress          integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  sub_label         text,               -- list subline, e.g. "Edina · day 74 of ~92"
  stage_label       text,               -- list stage chip, e.g. "Tile phase"
  start_date        date,
  target_end_date   date,
  lead_id           uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Display columns added after the initial cut (idempotent for existing DBs).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS value_display text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sub_label     text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage_label   text;

-- ─── Subcontractors ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  trade         text NOT NULL DEFAULT '',
  email         text,
  phone         text,
  rating        numeric(2,1) CHECK (rating BETWEEN 0 AND 5),
  jobs_count    integer NOT NULL DEFAULT 0,
  rate          text,
  fav           boolean NOT NULL DEFAULT false,  -- preferred sub (accent + star)
  open_jobs     integer NOT NULL DEFAULT 0,
  coi_status    text NOT NULL DEFAULT 'missing'
                  CHECK (coi_status IN ('current','expiring','expired','missing')),
  coi_expires_at date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subs ADD COLUMN IF NOT EXISTS fav       boolean NOT NULL DEFAULT false;
ALTER TABLE subs ADD COLUMN IF NOT EXISTS open_jobs integer NOT NULL DEFAULT 0;

-- ─── Communication threads (Inbox + Comms) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         text NOT NULL
                    CHECK (channel IN ('email','sms','client_portal','sub_portal','site_form')),
  subject         text NOT NULL DEFAULT '',
  from_name       text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'needs_reply'
                    CHECK (status IN ('needs_reply','awaiting_them','snoozed','done')),
  urgency         text NOT NULL DEFAULT 'normal'
                    CHECK (urgency IN ('low','normal','high')),
  ai_verdict      text,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Notifications ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL
                CHECK (kind IN ('decision','mention','job','money','compliance')),
  title       text NOT NULL,
  subline     text,
  tag         text,                      -- display label, e.g. "Decision" / "Intake"
  accent      text,                      -- chip/icon tint key (flag/accent/ai/money/ghost)
  icon        text,                      -- lucide icon key (money/mail/star/…)
  when_label  text,                      -- relative-time display, e.g. "5h 12m" / "Sat 4:12p"
  flagged     boolean NOT NULL DEFAULT false,
  read        boolean NOT NULL DEFAULT false,
  href        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tag        text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS accent     text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS icon       text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS when_label text;

-- ─── Compliance calendar ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  kind        text NOT NULL
                CHECK (kind IN ('coi','license','tax','insurance','permit')),
  due_date    date NOT NULL,
  owner       text,
  notes       text,
  who         text,                      -- timeline "who" line, e.g. "AI requesting renewal"
  step        text,                      -- timeline next-step note
  dot         text,                      -- timeline dot tone (flag/accent/ghost)
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS who  text;
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS step text;
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS dot  text;

-- ─── Warranty ───────────────────────────────────────────────────────────────
-- Closed projects under warranty + active claims against them. These are
-- historical/closeout records distinct from the live `projects` table.
CREATE TABLE IF NOT EXISTS warranty_projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project         text NOT NULL,
  client          text NOT NULL,
  closed_at       date NOT NULL,
  warranty_label  text NOT NULL,            -- "1 yr · ends May 23 2027" / "2 yr · structural"
  warranty_ends_at date,                    -- null for open-ended/structural terms
  flag            text,                     -- optional chip, e.g. "open claim"
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warranty_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project         text NOT NULL,
  client          text NOT NULL,
  issue           text NOT NULL,
  age_label       text,                     -- "4 hrs" (since opened)
  deadline_label  text,                     -- "5d ack · Fri"
  step            text,                     -- AI status line
  dot             text NOT NULL DEFAULT 'accent'
                    CHECK (dot IN ('accent','flag','ghost')),
  resolved        boolean NOT NULL DEFAULT false,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Schedule ───────────────────────────────────────────────────────────────
-- Timeblocks pinned to a real date + the daily field log. The /schedule view
-- shows the week containing CURRENT_DATE.
CREATE TABLE IF NOT EXISTS schedule_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_date  date NOT NULL,
  time_label  text NOT NULL,                -- "8:00" / "AM" / "all"
  sort_min    integer NOT NULL DEFAULT 0,   -- minutes-from-midnight for ordering
  label       text NOT NULL,
  tone        text NOT NULL DEFAULT 'ghost'
                CHECK (tone IN ('accent','ai','ghost')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date    date NOT NULL UNIQUE,
  body        text NOT NULL DEFAULT '',
  photos      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Files ──────────────────────────────────────────────────────────────────
-- Flat file index (Google-Drive mirror is deferred). project_key groups files
-- under a project folder; ai_origin tints AI-generated rows.
CREATE TABLE IF NOT EXISTS files (
  id           text PRIMARY KEY,           -- stable slug used by the preview pane
  project_key  text NOT NULL DEFAULT '',   -- "Henderson" etc.
  type         text NOT NULL DEFAULT 'doc'
                 CHECK (type IN ('doc','img','folder')),
  name         text NOT NULL,
  tag          text NOT NULL DEFAULT '',
  ai_origin    boolean NOT NULL DEFAULT false,
  modified_label text NOT NULL DEFAULT '',
  size_label   text NOT NULL DEFAULT '',
  subtitle     text,                        -- preview subtitle
  ai_tags      text[] NOT NULL DEFAULT '{}',
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── App settings ─────────────────────────────────────────────────────────
-- Single-row key/value store for the Settings screen toggles + profile fields.
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Users / auth ───────────────────────────────────────────────────────────
-- Login accounts. role gates access: owner = full app, sub = sub portal only,
-- client = client portal only. link_slug ties a sub/client account to their
-- row (subs.slug for subs, projects.slug for clients) so the portals can scope
-- to "their" data. password_hash is scrypt: "<saltHex>:<hashHex>".
CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text UNIQUE NOT NULL,
  password_hash  text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL DEFAULT 'owner'
                   CHECK (role IN ('owner','sub','client')),
  initials       text NOT NULL DEFAULT '',
  link_slug      text,                  -- subs.slug (role=sub) / projects.slug (role=client)
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Team chat ──────────────────────────────────────────────────────────────
-- Messages live here; channels/rooms/DMs are static constants in lib/chat.ts.
CREATE TABLE IF NOT EXISTS chat_messages (
  id              bigserial PRIMARY KEY,
  channel_key     text NOT NULL,
  author_kind     text NOT NULL DEFAULT 'user'
                    CHECK (author_kind IN ('owner','ai','user')),
  author_name     text NOT NULL,
  author_initials text NOT NULL DEFAULT '',
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Per-channel last-read marker (single owner for now): unread = messages after
-- last_read_at not authored by the owner.
CREATE TABLE IF NOT EXISTS chat_reads (
  channel_key   text PRIMARY KEY,
  last_read_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes for the common list queries ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_channel         ON chat_messages(channel_key, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_stage          ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_projects_status       ON projects(status);
CREATE INDEX IF NOT EXISTS idx_subs_trade            ON subs(trade);
CREATE INDEX IF NOT EXISTS idx_threads_status        ON threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_last_message  ON threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_due        ON compliance_items(due_date);

-- ─── updated_at touch trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','projects','subs','threads','daily_logs'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
