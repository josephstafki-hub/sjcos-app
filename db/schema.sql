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
                    CHECK (stage IN ('intake','qualified','discovery_call',
                                     'rough_estimate','precon_signed')),
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
-- Referral tracking (Phase-6 P6-1): who referred this lead + when they were
-- thanked (a referral lead with a referrer email auto-sends a thank-you once).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referrer_name       text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referrer_email      text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS referrer_thanked_at timestamptz;

-- Lead pipeline migrated (round 3) to: intake → qualified → discovery_call →
-- rough_estimate → precon_signed. Re-point the CHECK on existing DBs. NOT VALID
-- skips re-checking pre-migration rows (the seed truncates + re-inserts valid
-- values anyway) while still enforcing the new set on every insert/update.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;
ALTER TABLE leads ADD CONSTRAINT leads_stage_check
  CHECK (stage IN ('intake','qualified','discovery_call','rough_estimate','precon_signed')) NOT VALID;

-- Display columns added after the initial cut (idempotent for existing DBs).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS scope_city    text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS value_display text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hot           boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS flag_label    text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS flag_kind     text;

-- Lead activity log (round 3): a real timeline of what's happened on a lead
-- (stage moves, estimate drafted/sent, contact edits, notes). Written by
-- lib/lead-activity.ts from the lead server actions.
CREATE TABLE IF NOT EXISTS lead_activity (
  id          bigserial PRIMARY KEY,
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'note',   -- created/stage/estimate/email/contact/note
  summary     text NOT NULL,
  actor       text NOT NULL DEFAULT 'Joe',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_activity_lead ON lead_activity(lead_id, created_at DESC);

-- Lead intake answers (round 3): editable Q&A captured during intake. One row
-- per question; the owner fills/edits answers on the Intake tab.
CREATE TABLE IF NOT EXISTS lead_intake (
  id          bigserial PRIMARY KEY,
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  question    text NOT NULL,
  answer      text NOT NULL DEFAULT '',
  UNIQUE (lead_id, question)
);

-- Lead rough estimate (round 3): owner notes + Qwen-drafted line items, sendable
-- via Gmail. One per lead.
CREATE TABLE IF NOT EXISTS lead_estimates (
  lead_id     uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  notes       text NOT NULL DEFAULT '',
  line_items  jsonb NOT NULL DEFAULT '[]',     -- [{ label, value }]
  total       text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
  sent_at     timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Projects ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text UNIQUE NOT NULL,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'precon_signed'
                      CHECK (status IN ('precon_signed','floor_plan','mood_board','selections',
                                        'bidding','construction_contract','construction',
                                        'closeout','warranty')),
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
-- Completion-outreach dedup marker (Phase-4): set when the warranty + review
-- emails go out on reaching the warranty stage, so re-flipping never re-sends.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closeout_outreach_at timestamptz;

-- Migrate the project lifecycle to the design's 9 stages (Review-round-3 S3).
-- Drop the old CHECK first so legacy values can be remapped, then re-add it.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
UPDATE projects SET status = CASE status
  WHEN 'pre_construction' THEN 'precon_signed'
  WHEN 'active'           THEN 'construction'
  WHEN 'complete'         THEN 'warranty'
  ELSE status END
  WHERE status IN ('pre_construction','active','complete');
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('precon_signed','floor_plan','mood_board','selections',
                    'bidding','construction_contract','construction',
                    'closeout','warranty')) NOT VALID;

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
ALTER TABLE subs ADD COLUMN IF NOT EXISTS notes     text NOT NULL DEFAULT '';  -- owner's private notes on the sub

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
-- Real warranty workflow (Phase-4 P4-3): link claims to a project, record the
-- intake channel, and track the acknowledgment (5-day) / resolution (30-day)
-- deadlines the reminder engine watches.
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS ack_deadline_at date;
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS resolve_deadline_at date;
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS acknowledged boolean NOT NULL DEFAULT false;

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

-- S6: link a block to a project so /schedule is a cross-project overview.
-- Nullable — NULL blocks are standalone meetings (not tied to a job).
ALTER TABLE schedule_blocks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

-- ─── Schedule templates (Phase-3 execution, 7-sched) ───────────────────────
-- A reusable phase template expanded into project schedule_blocks on demand.
-- offset_days/duration_days count WEEKDAYS from the chosen project start date.
CREATE TABLE IF NOT EXISTS schedule_templates (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schedule_template_phases (
  id            bigserial PRIMARY KEY,
  template_id   bigint NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
  label         text NOT NULL,
  tone          text NOT NULL DEFAULT 'ghost' CHECK (tone IN ('accent','ai','ghost')),
  offset_days   integer NOT NULL DEFAULT 0,   -- weekdays from project start
  duration_days integer NOT NULL DEFAULT 1,   -- weekdays
  sort_order    integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sched_tmpl_phases ON schedule_template_phases(template_id, sort_order);

-- Seed a default "Standard remodel" template (idempotent by unique name).
INSERT INTO schedule_templates (name) VALUES ('Standard remodel')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO schedule_template_phases (template_id, label, tone, offset_days, duration_days, sort_order)
SELECT t.id, v.label, v.tone, v.offset_days, v.duration_days, v.sort_order
  FROM schedule_templates t
  JOIN (VALUES
    ('Demolition',              'accent', 0,  3, 0),
    ('Rough framing',           'ghost',  3,  5, 1),
    ('MEP rough-in',            'ghost',  8,  5, 2),
    ('Inspections',             'ai',     13, 1, 3),
    ('Insulation & drywall',    'accent', 14, 6, 4),
    ('Finish carpentry',        'ghost',  20, 6, 5),
    ('Paint',                   'ghost',  26, 4, 6),
    ('Flooring & tile',         'accent', 30, 5, 7),
    ('Fixtures & final punch',  'ai',     35, 4, 8)
  ) AS v(label, tone, offset_days, duration_days, sort_order) ON true
 WHERE t.name = 'Standard remodel'
   AND NOT EXISTS (SELECT 1 FROM schedule_template_phases p WHERE p.template_id = t.id);

CREATE TABLE IF NOT EXISTS daily_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date    date NOT NULL UNIQUE,
  body        text NOT NULL DEFAULT '',
  photos      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Project-scoped daily logs (project Daily-log tab). project_id NULL = the
-- global log shown on the /schedule lane; non-NULL = a project's own log.
-- Drop the table-wide UNIQUE(log_date) and replace it with partial uniques so
-- each project keeps one log per date while the global log also stays unique.
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_log_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_logs_global  ON daily_logs(log_date) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_logs_project ON daily_logs(project_id, log_date) WHERE project_id IS NOT NULL;

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
  storage_path text,                        -- filename under uploads/ for real blobs (NULL = showcase/no blob)
  mime_type    text,                        -- content type of the stored blob
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Upload storage columns (idempotent for existing DBs).
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS mime_type    text;
-- Lead photo association: uploaded images attached to a lead (real, viewable).
ALTER TABLE files ADD COLUMN IF NOT EXISTS lead_slug    text;
CREATE INDEX IF NOT EXISTS idx_files_lead ON files(lead_slug);
-- Marks a file uploaded by a client through their portal (Phase-3 5-depth). The
-- client may view only files carrying their own slug here; owner project files
-- stay owner-only (served via /api/files, not the portal route).
ALTER TABLE files ADD COLUMN IF NOT EXISTS client_slug  text;
CREATE INDEX IF NOT EXISTS idx_files_client ON files(client_slug);

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

-- Channel membership: which subs (trade partners) are in a channel/room. The
-- owner and the AI are implicit members of every channel and are NOT stored.
-- DMs (dm:<slug>) are 1:1 and don't use this table.
CREATE TABLE IF NOT EXISTS chat_members (
  channel_key text NOT NULL,
  sub_slug    text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_key, sub_slug)
);

-- ─── Project punch list ─────────────────────────────────────────────────────
-- Per-project punch items; checkboxes on the project-detail Punch tab toggle
-- `done`. Owner-gated writes via lib/actions/projects.ts.
CREATE TABLE IF NOT EXISTS project_punch (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item        text NOT NULL,
  owner_name  text NOT NULL DEFAULT '',
  done        boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Material catalog ───────────────────────────────────────────────────────
-- The /catalog material library. Owner adds/removes items; category is one of
-- the filter chips (excluding "All"). Drive/supplier-scrape capture deferred.
CREATE TABLE IF NOT EXISTS catalog_items (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  supplier    text NOT NULL DEFAULT '',
  sku         text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'Cabinets',
  use_label   text NOT NULL DEFAULT '',
  price       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Optional product image (a files row id), added S5B.
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS image_file_id text;
-- Source product-page URL captured by the browser-extension clipper (Phase 2 A).
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS source_url text NOT NULL DEFAULT '';

-- ─── Money: invoices + retainers (Review-round-3 S5A) ───────────────────────
-- Native invoices (create/send/track) + a per-project retainer ledger. P&L
-- still lives in QuickBooks; these power the project Money tab. amount/collected/
-- applied are integer dollars; retainer balance = collected - applied (derived).
CREATE TABLE IF NOT EXISTS invoices (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number      text NOT NULL DEFAULT '',          -- display number, e.g. "INV-001"
  milestone   text NOT NULL DEFAULT '',          -- draw/milestone label
  amount      integer NOT NULL DEFAULT 0,        -- dollars (sum of line_items)
  line_items  jsonb NOT NULL DEFAULT '[]',       -- [{ label, amount }]
  status      text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','paid')),
  sent_at     timestamptz,
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS retainers (
  project_id  uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  collected   integer NOT NULL DEFAULT 0,        -- dollars collected up front
  applied     integer NOT NULL DEFAULT 0,        -- dollars applied to invoices
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Design tools: selection sections (Functional-audit A4) ─────────────────
-- Rooms / sections that group a project's selections and carry a budget. The
-- client sees per-section budgets roll up a running total + remaining as picks
-- are approved.
CREATE TABLE IF NOT EXISTS project_sections (
  id            bigserial PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          text NOT NULL DEFAULT '',          -- e.g. "Kitchen"
  budget        integer NOT NULL DEFAULT 0,        -- dollars
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sections_project ON project_sections(project_id, sort_order);

-- ─── Design tools: selections board (Review-round-3 S5C) ────────────────────
-- Per-project finish/product selections the owner curates and pushes to the
-- client portal for approval. Image is either an upload (image_file_id) or
-- inherited from the linked catalog item. status flows draft → pending (pushed)
-- → approved / declined (client decided). Selections optionally belong to a
-- section (room) and carry the option's price for budget roll-up (audit A4).
CREATE TABLE IF NOT EXISTS project_selections (
  id            bigserial PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area          text NOT NULL DEFAULT '',         -- e.g. "Kitchen counters"
  choice        text NOT NULL DEFAULT '',         -- the chosen product/finish
  catalog_id    bigint REFERENCES catalog_items(id) ON DELETE SET NULL,
  image_file_id text,                             -- own upload; else catalog image
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','pending','approved','declined')),
  pushed_at     timestamptz,
  decided_at    timestamptz,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Section grouping + per-option price for budget roll-up (Functional-audit A4).
ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS section_id bigint
  REFERENCES project_sections(id) ON DELETE SET NULL;
ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS price integer NOT NULL DEFAULT 0;

-- ─── Indexes for the common list queries ────────────────────────────────────
-- ─── Design tools: mood boards (Review-round-3 S5D) ─────────────────────────
-- Per-room reference-image collections for a project. Each row is one uploaded
-- image with an optional note, grouped by room in the UI.
CREATE TABLE IF NOT EXISTS project_mood (
  id            bigserial PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room          text NOT NULL DEFAULT 'General',
  image_file_id text NOT NULL,
  note          text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Design tools: floor-plan versions (Review-round-3 S5E) ─────────────────
-- Versioned floor-plan files (image or PDF) per project, each with text notes.
-- Viewer only — not a CAD editor. version increments per upload.
CREATE TABLE IF NOT EXISTS project_floorplans (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     integer NOT NULL DEFAULT 1,
  file_id     text NOT NULL,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Project ↔ sub assignments (the project Subs tab). A sub can be on many jobs;
-- a job has many subs. Slug FK keeps it readable + matches the subs portal link.
CREATE TABLE IF NOT EXISTS project_subs (
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sub_slug    text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  role_label  text NOT NULL DEFAULT '',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sub_slug)
);

CREATE INDEX IF NOT EXISTS idx_project_subs_project ON project_subs(project_id);

-- Sub scope + scheduled dates on the assignment (Phase-3 execution, 6-scope).
-- The owner sets these on the project Subs tab; the sub sees them read-only on
-- their portal.
ALTER TABLE project_subs ADD COLUMN IF NOT EXISTS scope_text text NOT NULL DEFAULT '';
ALTER TABLE project_subs ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE project_subs ADD COLUMN IF NOT EXISTS end_date   date;

-- ─── Sub portal: daily logs + submitted invoices (Functional-audit item 6) ──
-- A subcontractor logs their day (text + optional photo) and submits a final
-- invoice from the sub portal; both notify Joe and scope to the sub's current
-- project when one is assigned.
CREATE TABLE IF NOT EXISTS sub_logs (
  id            bigserial PRIMARY KEY,
  sub_slug      text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  body          text NOT NULL DEFAULT '',
  photo_file_id text,                              -- optional uploaded photo
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_logs_sub ON sub_logs(sub_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS sub_invoices (
  id          bigserial PRIMARY KEY,
  sub_slug    text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  project_id  uuid REFERENCES projects(id) ON DELETE SET NULL,
  amount      integer NOT NULL DEFAULT 0,          -- dollars
  note        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','approved','paid')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_sub ON sub_invoices(sub_slug, created_at DESC);

-- Sub compliance documents (Phase-3 execution, 6-docs). W-9 / COI / signed
-- agreement uploaded from the sub portal (or by the owner). A COI upload with an
-- expiry date also updates subs.coi_expires_at, which the reminder engine
-- (lib/reminders.ts) already watches for 30/15/5-day expiry alerts.
CREATE TABLE IF NOT EXISTS sub_documents (
  id          bigserial PRIMARY KEY,
  sub_slug    text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  doc_type    text NOT NULL DEFAULT 'other'
                CHECK (doc_type IN ('w9','coi','agreement','other')),
  file_id     text REFERENCES files(id) ON DELETE SET NULL,
  expires_at  date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_documents_sub ON sub_documents(sub_slug, created_at DESC);

-- ─── Safety: orientations + acknowledgments (Phase-4 P4-4) ─────────────────
-- AI-generated jobsite safety orientation per project/trade; subs acknowledge
-- it from their portal (logged).
CREATE TABLE IF NOT EXISTS safety_orientations (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trade       text NOT NULL DEFAULT 'General',
  body        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_safety_orient_project ON safety_orientations(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS safety_acknowledgments (
  orientation_id  bigint NOT NULL REFERENCES safety_orientations(id) ON DELETE CASCADE,
  sub_slug        text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (orientation_id, sub_slug)
);

-- Incident reports (Phase-4 P4-5): AI drafts a factual narrative from the
-- owner's notes; rendered to a PDF (with disclaimer) + logged to the project.
CREATE TABLE IF NOT EXISTS incident_reports (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  occurred_at date,
  reporter    text NOT NULL DEFAULT '',
  severity    text NOT NULL DEFAULT 'minor'
                CHECK (severity IN ('near_miss','minor','recordable','serious')),
  notes       text NOT NULL DEFAULT '',
  narrative   text NOT NULL DEFAULT '',
  file_id     text REFERENCES files(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incidents_project ON incident_reports(project_id, created_at DESC);

-- Per-policy insurance tracking (Phase-4 P4-6). Renewal reminders (60/30/14) are
-- emitted by lib/reminders.ts. coverage_amount + premium are integer dollars.
CREATE TABLE IF NOT EXISTS insurance_policies (
  id              bigserial PRIMARY KEY,
  policy_type     text NOT NULL DEFAULT 'other'
                    CHECK (policy_type IN ('gl','wc','auto','umbrella','other')),
  carrier         text NOT NULL DEFAULT '',
  policy_number   text NOT NULL DEFAULT '',
  coverage_amount integer NOT NULL DEFAULT 0,
  effective_date  date,
  expires_date    date,
  premium         integer NOT NULL DEFAULT 0,
  notes           text NOT NULL DEFAULT '',
  archived        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_expires ON insurance_policies(expires_date);

-- Marketing drafts (Phase-6 P6-2): AI-drafted social + blog posts (manual post).
-- A social draft auto-generates when a job completes (gated by app_settings
-- marketing.auto_draft_on_completion).
CREATE TABLE IF NOT EXISTS marketing_drafts (
  id          bigserial PRIMARY KEY,
  project_id  uuid REFERENCES projects(id) ON DELETE SET NULL,
  kind        text NOT NULL DEFAULT 'social' CHECK (kind IN ('social','blog')),
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_drafts ON marketing_drafts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_project     ON invoices(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_selections_project   ON project_selections(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_mood_project         ON project_mood(project_id, room, sort_order);
CREATE INDEX IF NOT EXISTS idx_floorplans_project   ON project_floorplans(project_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_category     ON catalog_items(category);
CREATE INDEX IF NOT EXISTS idx_punch_project        ON project_punch(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_chat_channel         ON chat_messages(channel_key, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_stage          ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_projects_status       ON projects(status);
CREATE INDEX IF NOT EXISTS idx_subs_trade            ON subs(trade);
CREATE INDEX IF NOT EXISTS idx_threads_status        ON threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_last_message  ON threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_due        ON compliance_items(due_date);

-- ─── E-signature (Phase-1 foundation) ───────────────────────────────────────
-- A generic signable-document model reused for design prints, estimates,
-- contracts, SOW, and change orders. A request carries either an attached file
-- blob (file_id → files) or inline body text (for generated docs). Signing
-- captures intent (consent), the typed signature, timestamp, IP, and UA for an
-- ESIGN-minded audit trail; signature_events is the append-only log.
CREATE TABLE IF NOT EXISTS signature_requests (
  id              bigserial PRIMARY KEY,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,   -- project-scoped (most)
  lead_slug       text,                                             -- or lead-scoped (pre-project estimates)
  doc_type        text NOT NULL DEFAULT 'other'
                    CHECK (doc_type IN ('design','estimate','contract','sow','change_order',
                                        'completion','lien_waiver','other')),
  title           text NOT NULL DEFAULT '',
  file_id         text REFERENCES files(id) ON DELETE SET NULL,     -- the document blob, if any
  body            text NOT NULL DEFAULT '',                         -- inline rendered document text
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','signed','declined','void')),
  signer_name     text NOT NULL DEFAULT '',
  signer_email    text NOT NULL DEFAULT '',
  -- signing capture (set when status → signed)
  signed_name       text,
  signed_at         timestamptz,
  signed_ip         text,
  signed_user_agent text,
  consent           boolean NOT NULL DEFAULT false,
  decline_reason    text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sigreq_project ON signature_requests(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sigreq_status  ON signature_requests(status);

CREATE TABLE IF NOT EXISTS signature_events (
  id            bigserial PRIMARY KEY,
  request_id    bigint NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  kind          text NOT NULL
                  CHECK (kind IN ('created','sent','viewed','signed','declined','voided')),
  actor         text NOT NULL DEFAULT '',     -- email/name/"owner"
  ip            text,
  user_agent    text,
  detail        text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sigevent_request ON signature_events(request_id, created_at);

-- ─── Cost book (Phase-2 estimating, B1) ────────────────────────────────────
-- The company's reusable unit-cost assemblies — the engine of repeatable
-- estimating, distinct from catalog_items (retail products). unit_cost is in
-- CENTS (no float money). default_markup is an optional per-item override of the
-- company-wide default (app_settings 'estimate.default_markup').
CREATE TABLE IF NOT EXISTS cost_items (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL,
  category       text NOT NULL DEFAULT 'General',
  unit           text NOT NULL DEFAULT 'ea'
                   CHECK (unit IN ('sf','lf','ea','hr','ls','cy')),
  unit_cost      integer NOT NULL DEFAULT 0,   -- cents
  default_markup numeric(5,2),                 -- optional per-item override (%)
  notes          text NOT NULL DEFAULT '',
  archived       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_items_cat ON cost_items(category, name);

-- ─── Estimates (Phase-2 estimating, B2) ────────────────────────────────────
-- A project (or lead) estimate built from cost_items + free-form lines. Money is
-- in CENTS. Estimate totals are recomputed from the lines on every line write.
CREATE TABLE IF NOT EXISTS estimates (
  id            bigserial PRIMARY KEY,
  project_id    uuid REFERENCES projects(id) ON DELETE CASCADE,
  lead_slug     text,                              -- pre-project estimates
  title         text NOT NULL DEFAULT '',
  rail          text NOT NULL DEFAULT 'plans'
                  CHECK (rail IN ('design_build','plans','merged')),
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','approved','declined')),
  subtotal      integer NOT NULL DEFAULT 0,        -- cents, Σ(qty*unit_cost)
  markup_total  integer NOT NULL DEFAULT 0,        -- cents
  total         integer NOT NULL DEFAULT 0,        -- cents, Σ(extended)
  sent_at       timestamptz,
  approved_at   timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estimates_project ON estimates(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS estimate_lines (
  id            bigserial PRIMARY KEY,
  estimate_id   bigint NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  cost_item_id  bigint REFERENCES cost_items(id) ON DELETE SET NULL,  -- or free-form
  description   text NOT NULL DEFAULT '',
  section       text NOT NULL DEFAULT 'General',
  unit          text NOT NULL DEFAULT 'ea',
  qty           numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost     integer NOT NULL DEFAULT 0,        -- cents (snapshot, editable)
  markup        numeric(5,2) NOT NULL DEFAULT 0,   -- effective % on this line
  extended      integer NOT NULL DEFAULT 0,        -- cents = round(qty*unit_cost*(1+markup/100))
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_est ON estimate_lines(estimate_id, sort_order);

-- Link an e-sign request back to the estimate it was generated from (B4), so
-- signing/declining the request flips the estimate's status. Added here (after
-- estimates exists) so the FK resolves on a fresh build.
ALTER TABLE signature_requests
  ADD COLUMN IF NOT EXISTS estimate_id bigint REFERENCES estimates(id) ON DELETE SET NULL;

-- Editable payment/draw schedule for the contract generated from an estimate
-- (Phase-2 B5). JSON array of { label, percent }; null → computed default
-- (deposit + even progress draws). Owner edits it before generating the contract.
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS draw_schedule jsonb;

-- ─── Change orders (Phase-3 execution, 7-co) ───────────────────────────────
-- A mid-project scope/price change. Signed through the same e-sign foundation
-- (signature_requests.doc_type='change_order'); the CO's own status mirrors the
-- linked request. price_cents is CENTS. Tracked separately from the project
-- contract total (owner manages that number — Phase-3 decision).
CREATE TABLE IF NOT EXISTS change_orders (
  id           bigserial PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  price_cents  integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','approved','declined')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id, created_at DESC);

-- Link an e-sign request to the change order it signs (mirrors estimate_id), so
-- signing/declining the request flips the CO's status. After change_orders CREATE.
ALTER TABLE signature_requests
  ADD COLUMN IF NOT EXISTS change_order_id bigint REFERENCES change_orders(id) ON DELETE SET NULL;

-- ─── Reminder log (scheduler idempotency) ──────────────────────────────────
-- The daily cron (app/api/cron/reminders) claims a dedup_key per (item, window)
-- before emitting a reminder, so each reminder window fires exactly once even
-- though the job runs daily. Keys: "compliance:<id>:<days>", "coi:<slug>:<days>".
CREATE TABLE IF NOT EXISTS reminder_log (
  dedup_key   text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

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
