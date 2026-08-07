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
                                     'rough_estimate','precon_signed','lost')),
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
-- rough_estimate → precon_signed, plus a terminal `lost` stage (dead/declined/
-- archived leads — off-pipeline, set explicitly). Re-point the CHECK on existing
-- DBs. NOT VALID skips re-checking pre-migration rows (the seed truncates +
-- re-inserts valid values anyway) while still enforcing the new set on insert.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;
ALTER TABLE leads ADD CONSTRAINT leads_stage_check
  CHECK (stage IN ('intake','qualified','discovery_call','rough_estimate','precon_signed','lost')) NOT VALID;

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

-- Lead qualification (Phase-7 lead-intake epic): the AI's assessment of the
-- 5-question intake answers — a verdict + rationale the owner can act on. One
-- per lead; re-running overwrites. Reuses the go/hold/pass verdict vocabulary.
CREATE TABLE IF NOT EXISTS lead_qualification (
  lead_id     uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  verdict     text NOT NULL CHECK (verdict IN ('go','hold','pass')),
  confidence  numeric,                          -- 0–1
  rationale   text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Lead tasks (Phase-7 lead-intake epic): a real follow-up checklist per lead —
-- "call back", "send measurements request", etc. Written from the Tasks tab.
CREATE TABLE IF NOT EXISTS lead_tasks (
  id          bigserial PRIMARY KEY,
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title       text NOT NULL,
  done        boolean NOT NULL DEFAULT false,
  due_date    date,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead ON lead_tasks(lead_id, done, sort_order, id);

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

-- The client's email — projects had a name (client_name) but nowhere to put
-- an address. Discovered missing when the newsletter's "import from projects"
-- came up empty: none of the 49 existing projects have lead_id set (that link
-- is only populated by the lead→project conversion flow), so there was no
-- structured path to a client's email at all. Backfilled once from the
-- original Houzz/Gmail import staging data (sjc_temp_lead_imports.raw) for
-- the projects that came from it; blank for the rest until entered.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_email text NOT NULL DEFAULT '';

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
-- Messages live here. Bare channels are owner-managed rows in chat_channels
-- (P1-D1); project rooms (room:<slug>) and DMs (dm:<slug>) stay key-convention
-- only (rooms derive from projects, DMs from subs) and are NOT stored here.
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
-- owner is an implicit member of every channel and is NOT stored. AI models are
-- per-channel members via chat_ai_members (below), not implicit. DMs (dm:<slug>)
-- are 1:1 and don't use this table.
CREATE TABLE IF NOT EXISTS chat_members (
  channel_key text NOT NULL,
  sub_slug    text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_key, sub_slug)
);

-- Bare team-chat channels (P1-D1). Replaces the old hardcoded CHANNELS const in
-- lib/chat.ts so the owner can create/remove channels at runtime. Remove is a
-- soft archive (archived_at set) so a channel's transcript is never destroyed;
-- recreating an archived name un-archives it. Project/entity rooms live in
-- chat_rooms (P1-D2), DMs stay key-convention only — neither is stored here.
CREATE TABLE IF NOT EXISTS chat_channels (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order  integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Independent per-channel AI membership (P1-D1). An AI model only responds to an
-- @model_name mention in a bare channel if it is a member here. Rooms and DMs
-- keep AI implicit (all models invocable) and do NOT use this table.
CREATE TABLE IF NOT EXISTS chat_ai_members (
  channel_key text NOT NULL,
  agent       text NOT NULL CHECK (agent IN ('claude','qwen','hermes')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_key, agent)
);

-- Bootstrap the five channels that used to be hardcoded (idempotent so this is
-- safe to re-run against the live DB), each seeded with all three AI models to
-- preserve the prior "@claude · @qwen · @hermes are in this channel" behavior.
INSERT INTO chat_channels (key, name, description, sort_order) VALUES
  ('field-daily',     'field-daily',     'Daily check-ins from active sites · AI pins what''s blocking', 10),
  ('selections',      'selections',      'Client selections + approvals · AI logs each decision',        20),
  ('bookkeeping',     'bookkeeping',     'Receipts, invoices, and money questions',                      30),
  ('safety',          'safety',          'Site safety notes and incident reports',                       40),
  ('marketing-queue', 'marketing-queue', 'AI-drafted posts waiting on your approval',                    50)
ON CONFLICT (key) DO NOTHING;

-- Only seed a channel's default AI set if it has NO members yet, so re-applying
-- this file never silently re-adds a model the owner deliberately removed.
INSERT INTO chat_ai_members (channel_key, agent)
SELECT c.key, a.agent
  FROM (VALUES ('field-daily'),('selections'),('bookkeeping'),('safety'),('marketing-queue')) AS c(key)
 CROSS JOIN (VALUES ('claude'),('qwen'),('hermes')) AS a(agent)
 WHERE NOT EXISTS (SELECT 1 FROM chat_ai_members x WHERE x.channel_key = c.key)
ON CONFLICT DO NOTHING;

-- Internal-team roster (P1-D1): SJC's own staff, who are neither subs nor
-- clients. Display-only, no login — team chat stays owner-operated, exactly like
-- the sub roster (chat_members). slug PK mirrors subs.slug so both rosters key
-- the same way everywhere. Deactivate (active=false) rather than delete so past
-- message attribution stays stable. If staff ever get their own logins that's a
-- users.role change, not this table. A team member who posts is author_kind
-- 'user' (renders gray), already covered by the chat_messages CHECK.
CREATE TABLE IF NOT EXISTS team_members (
  slug       text PRIMARY KEY,
  name       text NOT NULL,
  role_label text NOT NULL DEFAULT '',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Independent per-channel team membership (P1-D1), symmetric with chat_members
-- (subs) and chat_ai_members (AI): team members are added to a channel/room on
-- their own. The owner is an implicit member of every channel and is NOT stored.
-- DMs (dm:<slug>) are 1:1 and don't use this table.
CREATE TABLE IF NOT EXISTS chat_team_members (
  channel_key text NOT NULL,
  member_slug text NOT NULL REFERENCES team_members(slug) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_key, member_slug)
);

-- Persistent entity chat rooms (P1-D2). One room per open lead/project/warranty
-- case, auto-created when the entity is created and closed (closed_at set —
-- never deleted, so the transcript under the key survives in chat_messages) when
-- the entity goes lost/completed/closed. Replaces the old derived project-room
-- query in lib/chat.ts (which only surfaced construction/closeout projects).
-- No FK on entity_ref: it's a text slug and the room deliberately outlives the
-- entity on delete so history is kept.
CREATE TABLE IF NOT EXISTS chat_rooms (
  key         text PRIMARY KEY,           -- room:<slug> | room:lead:<slug> | room:wty:<slug>
  entity_type text NOT NULL CHECK (entity_type IN ('lead','project','warranty')),
  entity_ref  text NOT NULL,              -- leads.slug or projects.slug
  name        text NOT NULL,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_open_ref ON chat_rooms(entity_ref) WHERE closed_at IS NULL;

-- Manually-added client participants of an entity room (P1-D2 — "clients can be
-- added but manually only"). Display-only membership: there is NO outward
-- delivery here. Portal delivery of chat is gated separately (P1-D4). Clients
-- aren't subs and there is no clients table, so this is a create-only roster
-- scoped to the room (no shared client pool to pick from).
CREATE TABLE IF NOT EXISTS chat_room_clients (
  id       bigserial PRIMARY KEY,
  room_key text NOT NULL REFERENCES chat_rooms(key) ON DELETE CASCADE,
  name     text NOT NULL,
  email    text NOT NULL DEFAULT '',
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_key, name)
);

-- Idempotent backfill from live entities so existing leads/projects/warranties
-- get their rooms without a data migration. Safe to re-run: ON CONFLICT DO
-- NOTHING means a room the app later closed never silently reopens on re-apply.
-- Non-warranty projects → project rooms (room:<slug>, preserving any transcript
-- from the old derived era); warranty-stage projects → warranty rooms; leads
-- that are neither lost nor already converted (a converted lead's room is closed
-- at convert, its conversation moved to the project) → lead rooms.
INSERT INTO chat_rooms (key, entity_type, entity_ref, name)
SELECT 'room:' || slug, 'project', slug, name FROM projects WHERE status <> 'warranty'
ON CONFLICT (key) DO NOTHING;

INSERT INTO chat_rooms (key, entity_type, entity_ref, name)
SELECT 'room:wty:' || slug, 'warranty', slug, name FROM projects WHERE status = 'warranty'
ON CONFLICT (key) DO NOTHING;

INSERT INTO chat_rooms (key, entity_type, entity_ref, name)
SELECT 'room:lead:' || l.slug, 'lead', l.slug, l.name
  FROM leads l
 WHERE l.stage <> 'lost'
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id)
ON CONFLICT (key) DO NOTHING;

-- Owner-opened direct messages (P1-D3). The Direct rail = the derived
-- top-of-roster sub DMs plus every row here, created by the "New message"
-- person-lookup so a DM to ANY sub, team member, or client survives reload
-- before a first message exists. Display fields are denormalized because a
-- client DM has no backing table to re-resolve from (there is no clients table),
-- and so the rail entry keeps rendering after a sub is deleted or a teammate
-- deactivated. Keys: dm:<sub-slug> | dm:team:<slug> | dm:client:<slug> — all
-- contain ':' (AI stays implicit) and start with 'dm:' (no membership UI), and
-- the bare dm:<slug> form stays reserved for subs (backward-compatible with
-- existing transcripts and the sub portal). Membership/display ONLY — no outward
-- delivery ever happens from this table (portal delivery is gated, P1-D4).
CREATE TABLE IF NOT EXISTS chat_dms (
  key        text PRIMARY KEY,
  party_type text NOT NULL CHECK (party_type IN ('sub','team','client')),
  party_slug text NOT NULL,
  name       text NOT NULL,              -- full display name, e.g. "Dana Whitfield"
  subtitle   text NOT NULL DEFAULT '',   -- trade / role label / "Client"
  opened_at  timestamptz NOT NULL DEFAULT now()
);

-- Portal-delivery outbox (P1-D4). Team-chat messages posted in entity rooms
-- (room:*) and client DMs (dm:client:*) are WIRED for delivery to the sub/client
-- portals, but every delivery is PARKED here until the owner releases it —
-- release copies the source message into the target portal thread (dm:<sub-slug>
-- or portal:<project-slug>); NOTHING is ever pushed to a real client/sub
-- automatically (guardrail: "portal push" is an outbound send). Bare channels
-- and team DMs are deliberately excluded (internal-only surfaces). Sub DMs
-- (dm:<sub-slug>) are already the sub-portal thread, so they self-deliver and
-- are not queued here. UNIQUE(message_id, portal_channel) dedups a re-fired
-- enqueue; the row is kept after release/skip as the delivery audit trail.
CREATE TABLE IF NOT EXISTS portal_deliveries (
  id              bigserial PRIMARY KEY,
  message_id      bigint NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  source_key      text NOT NULL,             -- room:* | dm:client:* the message was posted in
  source_label    text NOT NULL DEFAULT '',  -- snapshot of the room/DM display name at enqueue time
  recipient_type  text NOT NULL CHECK (recipient_type IN ('sub','client')),
  recipient_label text NOT NULL,             -- e.g. "Marco Rivas · sub portal"
  portal_channel  text NOT NULL,             -- dm:<sub-slug> | portal:<project-slug> (delivery target)
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','released','skipped')),
  queued_at       timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz,
  UNIQUE (message_id, portal_channel)
);
CREATE INDEX IF NOT EXISTS idx_portal_deliveries_queued ON portal_deliveries(queued_at) WHERE status = 'queued';

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
-- Client confirmation of a resolved punch item: the PM marks it `done`, the
-- client confirms it in their portal (set once they agree it's actually fixed).
ALTER TABLE project_punch ADD COLUMN IF NOT EXISTS client_confirmed_at timestamptz;

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

-- ─── Money: invoices (Review-round-3 S5A) ──────────────────────────────────
-- Native invoices (create/send/track). P&L still lives in QuickBooks; these
-- power the project Money tab. amount is integer CENTS (Phase 5.0 migration).
CREATE TABLE IF NOT EXISTS invoices (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number      text NOT NULL DEFAULT '',          -- display number, e.g. "INV-001"
  milestone   text NOT NULL DEFAULT '',          -- draw/milestone label
  amount      integer NOT NULL DEFAULT 0,        -- CENTS (sum of line_items)
  line_items  jsonb NOT NULL DEFAULT '[]',       -- [{ label, amount(cents) }]
  status      text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','paid')),
  sent_at     timestamptz,
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- RETIRED (P1-B7, 2026-07-16). SJ Carpentry is fixed-price only — nothing bills
-- against a retainer balance, and no app code reads or writes this table any
-- more. It is kept (empty in prod: 0 rows, $0 collected/applied when retired) so
-- the schema stays reproducible and nothing historical is destroyed. Safe to
-- DROP once Joe confirms; do not drop as a drive-by.
CREATE TABLE IF NOT EXISTS retainers (
  project_id  uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  collected   integer NOT NULL DEFAULT 0,        -- CENTS collected up front
  applied     integer NOT NULL DEFAULT 0,        -- CENTS applied to invoices
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
-- Sections nest one level: a room ("Kitchen") owns sub-sections ("Cabinetry",
-- "Plumbing fixtures"). CASCADE so removing a room takes its sub-sections too.
ALTER TABLE project_sections ADD COLUMN IF NOT EXISTS parent_id bigint
  REFERENCES project_sections(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sections_project ON project_sections(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sections_parent ON project_sections(parent_id, sort_order);

-- ─── Design tools: selections board (Review-round-3 S5C) ────────────────────
-- A row here is a DECISION the client has to make — "Kitchen faucet" — not the
-- pick itself. `area` names the decision; the candidate products live in
-- project_selection_options and the client's answer is chosen_option_id.
-- status flows draft → pending (pushed to the portal) → approved (an option was
-- picked) / declined (client wants different options).
-- Money: `allowance` is what the budget carries for this decision; the chosen
-- option's price is what it actually costs, and the delta is what the client
-- sees ("$200 over allowance").
CREATE TABLE IF NOT EXISTS project_selections (
  id            bigserial PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area          text NOT NULL DEFAULT '',         -- the decision, e.g. "Kitchen faucet"
  choice        text NOT NULL DEFAULT '',         -- optional spec note ("wall-mount, 8in spread")
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
-- Decision-level fields (Houzz-style items + options rework).
ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS allowance integer NOT NULL DEFAULT 0;
ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE project_selections ADD COLUMN IF NOT EXISTS chosen_option_id bigint;

-- ─── Design tools: selection options ────────────────────────────────────────
-- The candidate products under one decision. The owner curates two or three,
-- pushes the decision, and the client picks exactly one (project_selections
-- .chosen_option_id). Fields are filled either by pasting a product URL (the
-- app pulls title/brand/price/image) or by hand when a vendor site won't answer.
CREATE TABLE IF NOT EXISTS project_selection_options (
  id            bigserial PRIMARY KEY,
  selection_id  bigint NOT NULL REFERENCES project_selections(id) ON DELETE CASCADE,
  name          text NOT NULL DEFAULT '',         -- "Delta Trinsic, matte black"
  brand         text NOT NULL DEFAULT '',
  sku           text NOT NULL DEFAULT '',
  product_url   text NOT NULL DEFAULT '',
  price         integer NOT NULL DEFAULT 0,       -- dollars
  image_file_id text,                             -- own upload; else catalog image
  catalog_id    bigint REFERENCES catalog_items(id) ON DELETE SET NULL,
  note          text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_selection_options_sel
  ON project_selection_options(selection_id, sort_order);
-- Added after the options table exists. SET NULL so deleting the picked option
-- reopens the decision rather than deleting it.
ALTER TABLE project_selections DROP CONSTRAINT IF EXISTS project_selections_chosen_option_fkey;
ALTER TABLE project_selections ADD CONSTRAINT project_selections_chosen_option_fkey
  FOREIGN KEY (chosen_option_id) REFERENCES project_selection_options(id) ON DELETE SET NULL;

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
-- Mood-board creator (P1-B3): catalog pins + free-form canvas layout.
-- A pin is either an uploaded image or a catalog item, so image_file_id is now
-- nullable (a catalog item may have no image — it renders as a text card).
-- Catalog pins SNAPSHOT name/price onto label/price_label at pin time;
-- catalog_id is provenance only (source-URL link), and deleting the catalog item
-- leaves the board intact because deleteMaterial never removes the files row.
-- pos_x/pos_w are fractions of board width, pos_y of board height (0..1);
-- NULL = never placed, the client auto-lays those out. sort_order doubles as
-- z-order (last dragged is on top).
ALTER TABLE project_mood ALTER COLUMN image_file_id DROP NOT NULL;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS catalog_id bigint
  REFERENCES catalog_items(id) ON DELETE SET NULL;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '';
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS price_label text NOT NULL DEFAULT '';
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS pos_x real;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS pos_y real;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS pos_w real;

-- Full canvas editing (free transform, text/swatch items, per-board settings).
-- A board item is now one of three kinds:
--   'pin'    — uploaded image or catalog snapshot (everything that existed before)
--   'text'   — a standalone caption block, no image; the words live in `label`
--   'swatch' — a solid colour chip; `swatch` holds '#rrggbb', `label` names it
-- pos_h is the height fraction of board height. NULL means auto — the card is as
-- tall as its image's natural aspect makes it, which is what every pre-existing
-- pin does, so back-filling nothing keeps old boards pixel-identical. Once a
-- height is set the image switches to object-cover, so a free resize crops
-- rather than distorts. pos_rot is degrees, -180..180, about the card's centre.
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pin';
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS pos_h real;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS pos_rot real NOT NULL DEFAULT 0;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS swatch text NOT NULL DEFAULT '';
ALTER TABLE project_mood DROP CONSTRAINT IF EXISTS project_mood_kind_check;
ALTER TABLE project_mood ADD CONSTRAINT project_mood_kind_check
  CHECK (kind IN ('pin','text','swatch'));

-- Photoshop-style crop inside the frame. An image in a sized frame is
-- object-cover; crop_x/crop_y pick WHICH part shows (the focal point, 0..1
-- across the hidden overflow in each axis) and crop_zoom magnifies inside the
-- frame (1 = plain cover fit, up to 4). Defaults reproduce the old fixed
-- centre-crop exactly, so existing boards render pixel-identical.
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS crop_x    real NOT NULL DEFAULT 0.5;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS crop_y    real NOT NULL DEFAULT 0.5;
ALTER TABLE project_mood ADD COLUMN IF NOT EXISTS crop_zoom real NOT NULL DEFAULT 1;

-- Per-room board settings: display title and background colour. A row here also
-- lets a board EXIST before it holds any pin — rooms used to be inferred purely
-- from project_mood rows, so a freshly created empty room vanished on reload.
CREATE TABLE IF NOT EXISTS project_mood_boards (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room       text NOT NULL,
  title      text NOT NULL DEFAULT '',
  bg_color   text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, room)
);

-- Client-portal approval of a board's direction (db/apply-portal-approvals.mjs).
-- Same lightweight typed-name acknowledgment as project_floorplans.
ALTER TABLE project_mood_boards ADD COLUMN IF NOT EXISTS client_approved_at timestamptz;
ALTER TABLE project_mood_boards ADD COLUMN IF NOT EXISTS client_approved_name text NOT NULL DEFAULT '';

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

-- Client-portal approval of a plan version (db/apply-portal-approvals.mjs). A
-- lightweight in-portal acknowledgment with the typed name captured; contracts
-- and money documents keep going through signature_requests instead.
ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS client_approved_at timestamptz;
ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS client_approved_name text NOT NULL DEFAULT '';

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
-- The sub side of the join drives the sub's own record (jobs list + live counts).
CREATE INDEX IF NOT EXISTS idx_project_subs_sub     ON project_subs(sub_slug);

-- Sub scope + scheduled dates on the assignment (Phase-3 execution, 6-scope).
-- The owner sets these on the project Subs tab; the sub sees them read-only on
-- their portal.
ALTER TABLE project_subs ADD COLUMN IF NOT EXISTS scope_text text NOT NULL DEFAULT '';
ALTER TABLE project_subs ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE project_subs ADD COLUMN IF NOT EXISTS end_date   date;

-- ─── Sub portal invites (P1-B5) ─────────────────────────────────────────────
-- Composed when a sub is assigned to a project, then PARKED for Joe. The app
-- never transmits these: there is deliberately no 'sent' status, and no code
-- path from here reaches lib/gmail.ts. 'approved' means "Joe took it from here"
-- (he sends it himself via the mailto link), nothing more.
--
-- `token` is stored RAW on purpose. The parked email `body` must contain the
-- clickable link for Joe to send days later, so the plaintext credential lives
-- in this row either way — hashing the column while body holds the same link
-- would be theatre. Tradeoff, stated plainly: DB read access ⇒ ability to enter
-- one sub's portal. Bounded by expires_at, revocable via status='dismissed'.
CREATE TABLE IF NOT EXISTS sub_portal_invites (
  id          bigserial PRIMARY KEY,
  sub_slug    text NOT NULL REFERENCES subs(slug) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_email    text,                              -- subs.email at queue time; may be null
  subject     text NOT NULL,
  body        text NOT NULL,                     -- full plain-text email incl. the portal link
  token       text UNIQUE NOT NULL,              -- opaque bearer token for /sub-portal/enter
  status      text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','approved','dismissed')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                       -- first successful portal entry (audit)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sub_slug, project_id)
);
CREATE INDEX IF NOT EXISTS idx_sub_invites_project ON sub_portal_invites(project_id, status);

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
  amount      integer NOT NULL DEFAULT 0,          -- CENTS (Phase 5.0)
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

-- Manual inbox ↔ record links (Phase-6 P6-3). Pins a Gmail thread to a project
-- or lead; the inbox classifier prefers this over the email/domain guess.
CREATE TABLE IF NOT EXISTS thread_links (
  gmail_thread_id text PRIMARY KEY,
  link_type       text NOT NULL CHECK (link_type IN ('project','lead')),
  link_slug       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

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

-- ─── Newsletter (Phase-7) ───────────────────────────────────────────────────
-- Real newsletter builder: issues with an intro + content blocks (some pulled
-- from completed jobs), sent to a recipient list via Gmail.
CREATE TABLE IF NOT EXISTS newsletters (
  id              bigserial PRIMARY KEY,
  title           text NOT NULL DEFAULT 'Untitled issue',
  intro           text NOT NULL DEFAULT '',
  blocks          jsonb NOT NULL DEFAULT '[]',   -- [{ heading, body, projectSlug? }]
  template        text NOT NULL DEFAULT 'classic', -- P2-5: layout/style key (lib/newsletter-templates.ts)
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sent')),
  recipient_count integer NOT NULL DEFAULT 0,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- P2-5 idempotent upgrades for the live DB (template + queued status).
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'classic';
ALTER TABLE newsletters DROP CONSTRAINT IF EXISTS newsletters_status_check;
ALTER TABLE newsletters ADD CONSTRAINT newsletters_status_check CHECK (status IN ('draft','queued','sent'));

CREATE TABLE IF NOT EXISTS newsletter_recipients (
  id          bigserial PRIMARY KEY,
  email       text UNIQUE NOT NULL,
  name        text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- P2-5: parked send outbox. Issue sends AND auto-greeting emails are QUEUED here
-- and NEVER reach a real recipient until the owner clicks Release (which is the
-- only code path that calls Gmail — see lib/newsletter-outbox.ts). Mirrors the
-- P1-D4 portal_deliveries gate. open_count/opened_at track the 1×1 pixel receipt.
CREATE TABLE IF NOT EXISTS newsletter_outbox (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL DEFAULT 'issue' CHECK (kind IN ('issue','greeting')),
  newsletter_id bigint REFERENCES newsletters(id) ON DELETE CASCADE,   -- NULL for greetings
  recipient_id  bigint REFERENCES newsletter_recipients(id) ON DELETE SET NULL,
  email         text NOT NULL,                 -- snapshot at enqueue
  name          text NOT NULL DEFAULT '',
  subject       text NOT NULL,
  body          text NOT NULL,                 -- fully composed text at enqueue (audit-stable)
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','released','skipped','failed')),
  error         text,                          -- Gmail failure note, if any
  track_token   text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  open_count    integer NOT NULL DEFAULT 0,
  opened_at     timestamptz,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz
);
-- One issue-send per recipient, one greeting per address ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_outbox_issue    ON newsletter_outbox(newsletter_id, email) WHERE kind = 'issue';
CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_outbox_greeting ON newsletter_outbox(email) WHERE kind = 'greeting';
CREATE INDEX IF NOT EXISTS idx_nl_outbox_queued ON newsletter_outbox(queued_at) WHERE status = 'queued';

-- P7-N: one-click unsubscribe. Bulk mail needs a working opt-out to stay on the
-- right side of CAN-SPAM and out of spam folders, and that matters more now that
-- the drip sends without a human in the loop. Token is per-recipient and stable.
ALTER TABLE newsletter_recipients ADD COLUMN IF NOT EXISTS unsub_token text
  NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_recipients_unsub ON newsletter_recipients(unsub_token);

-- P7-N: rich issues. `settings` holds the per-issue design choices made in the
-- editor (font stack key, accent color, logo on/off, footer copy) — jsonb so the
-- design vocabulary can grow without a migration. Blocks gained a `kind`
-- (text/image/button/divider/quote) the same way; see lib/newsletter-render.ts.
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';

-- P7-N: images published for use inside a newsletter. Uploads normally live
-- behind the owner-only /api/files/[id] route, which an email client can never
-- authenticate to — so a block image gets an explicit, unguessable token here and
-- is served publicly at /api/newsletter/img/[token]. Publishing is deliberate and
-- per-image: nothing else in the files table becomes reachable.
CREATE TABLE IF NOT EXISTS newsletter_assets (
  id          bigserial PRIMARY KEY,
  file_id     text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  alt         text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nl_assets_file ON newsletter_assets(file_id);

-- ─── Newsletter drip sequences (P7-N) ───────────────────────────────────────
-- A sequence is an ordered list of existing issues, each with a delay measured in
-- days from the moment someone subscribes. New recipients are enrolled in every
-- active sequence and walked forward one step at a time by the drip timer
-- (/api/cron/newsletter-drip → lib/newsletter-drip.ts).
--
-- IMPORTANT — this is the ONE path in the newsletter feature that emails a real
-- person without the owner clicking Release. That is deliberate and scoped: it
-- fires ONLY for issues referenced by a sequence step, and only ever to the one
-- subscriber whose step came due. Broadcast sends keep the manual Release gate.
CREATE TABLE IF NOT EXISTS newsletter_sequences (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL DEFAULT 'Welcome series',
  active      boolean NOT NULL DEFAULT false,   -- off until the owner turns it on
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_sequence_steps (
  id            bigserial PRIMARY KEY,
  sequence_id   bigint NOT NULL REFERENCES newsletter_sequences(id) ON DELETE CASCADE,
  newsletter_id bigint NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  -- Days after subscribing (not after the previous step) — an absolute offset, so
  -- reordering or re-timing one step never silently shifts the ones behind it.
  delay_days    integer NOT NULL DEFAULT 0 CHECK (delay_days >= 0 AND delay_days <= 3650),
  position      integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nl_steps_seq ON newsletter_sequence_steps(sequence_id, delay_days, position);

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id            bigserial PRIMARY KEY,
  recipient_id  bigint NOT NULL REFERENCES newsletter_recipients(id) ON DELETE CASCADE,
  sequence_id   bigint NOT NULL REFERENCES newsletter_sequences(id) ON DELETE CASCADE,
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  -- How many steps have been delivered. The next due step is the (sent_steps+1)-th
  -- by (delay_days, position); it fires once subscribed_at + delay_days has passed.
  sent_steps    integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
  last_sent_at  timestamptz,
  UNIQUE (recipient_id, sequence_id)
);
CREATE INDEX IF NOT EXISTS idx_nl_subs_due ON newsletter_subscriptions(sequence_id, subscribed_at) WHERE status = 'active';

-- P7-N: the rendered HTML alternative, frozen at enqueue alongside `body`. Before
-- rich content the HTML was derived from the text at release time; photos, logo
-- and buttons can't be recovered from plain text, so it is stored explicitly.
-- Keeping BOTH frozen preserves the audit property: what's in this row is
-- byte-for-byte what was mailed. NULL on pre-P7-N rows → release falls back to
-- deriving from text, so old queued rows still send correctly.
ALTER TABLE newsletter_outbox ADD COLUMN IF NOT EXISTS body_html text;

-- Drip sends are recorded in the outbox like everything else (audit parity), but
-- with kind='drip' so they are visibly distinct from owner-released mail.
ALTER TABLE newsletter_outbox DROP CONSTRAINT IF EXISTS newsletter_outbox_kind_check;
ALTER TABLE newsletter_outbox ADD CONSTRAINT newsletter_outbox_kind_check
  CHECK (kind IN ('issue','greeting','drip'));
-- One drip send per (issue, email): the safety net that makes the timer's
-- at-least-once retry behaviour idempotent — a re-run can never double-send.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_outbox_drip ON newsletter_outbox(newsletter_id, email) WHERE kind = 'drip';

-- ─── Welcome email as a real issue ──────────────────────────────────────────
-- The welcome greeting used to be plain text parked in app_settings; it's now
-- a real newsletters row so it gets the same Edit/Design/Preview tabs, photos,
-- and buttons as any other issue. is_welcome marks the one issue the greeting
-- pipeline (enqueueGreeting) reads from — the partial unique index enforces
-- "at most one" in the DB itself, not just app code. It is never queued via
-- the normal broadcast Send flow; that stays draft/queued/sent for every other
-- issue.
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS is_welcome boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_one_welcome ON newsletters (is_welcome) WHERE is_welcome;

-- ─── Email groups / audiences ───────────────────────────────────────────────
-- Named groups a recipient can belong to (many-to-many) — used to scope a
-- broadcast send to a subset of the list ("audience") at Queue time. Purely
-- additive to the send path: selecting no groups queues to every active
-- recipient, exactly like before groups existed.
CREATE TABLE IF NOT EXISTS newsletter_groups (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness so the "Leads"/"Projects"/"Past projects"
-- auto-classification on import (lib/newsletter-import.ts) can get-or-create
-- by name without ever spawning a duplicate group on a re-import.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nl_groups_name ON newsletter_groups (lower(name));
CREATE TABLE IF NOT EXISTS newsletter_recipient_groups (
  recipient_id bigint NOT NULL REFERENCES newsletter_recipients(id) ON DELETE CASCADE,
  group_id     bigint NOT NULL REFERENCES newsletter_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (recipient_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_nl_recipient_groups_group ON newsletter_recipient_groups(group_id);

-- Per-issue one-time additions: extra addresses that receive THIS issue only,
-- without joining the permanent list. Lives on the issue (not the recipient
-- table) since it's scoped to a single send, edited from that issue's own
-- Recipients tab alongside its audience picks.
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS extra_recipients jsonb NOT NULL DEFAULT '[]';

-- Which audiences (newsletter_groups.id) THIS issue targets when Queued —
-- empty means everyone active. Was client-only React state that silently
-- reset on every reload, which read as "I checked an audience and it did
-- nothing" — persisted now for the same reason extra_recipients is.
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS target_group_ids jsonb NOT NULL DEFAULT '[]';

-- ─── SMS (two-way texting) ──────────────────────────────────────────────────
-- Provider-agnostic SMS inbox mirroring the Gmail inbox. Populated only when a
-- provider (Twilio/Telnyx/SignalWire) is configured (see lib/sms.ts); until then
-- these stay empty and the /messages screen shows a "connect a provider" state.
-- One thread per external counterparty phone number; messages append to it.
CREATE TABLE IF NOT EXISTS sms_threads (
  id            bigserial PRIMARY KEY,
  phone         text UNIQUE NOT NULL,           -- E.164 counterparty number
  contact_name  text,                           -- resolved display name, if known
  link_type     text CHECK (link_type IN ('lead','sub','client','project')),
  link_slug     text,                           -- optional link to a record
  last_message_at timestamptz,
  unread        boolean NOT NULL DEFAULT false,  -- inbound waiting on a reply
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_threads_recent ON sms_threads(last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS sms_messages (
  id             bigserial PRIMARY KEY,
  thread_id      bigint NOT NULL REFERENCES sms_threads(id) ON DELETE CASCADE,
  direction      text NOT NULL CHECK (direction IN ('in','out')),
  body           text NOT NULL DEFAULT '',
  provider_sid   text,                           -- provider's message id (dedup)
  status         text NOT NULL DEFAULT 'received',-- queued/sent/delivered/received/failed
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_messages_sid ON sms_messages(provider_sid) WHERE provider_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_messages_thread ON sms_messages(thread_id, created_at);

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

-- ════════════════════════════════════════════════════════════════════════════
--  OPEN BRAIN / OPEN ENGINE / OPEN SKILLS  (Nate B. Jones patterns, adapted)
--  ---------------------------------------------------------------------------
--  SJC OS Postgres stays the single source of truth — NO separate Open Brain
--  database. These tables add three layers inside SJC OS:
--    • Open Brain  — knowledge_items (+ agent_memories sidecar): what we know.
--    • Open Engine — work_items / agent_runs / agent_receipts / status_ledgers:
--                    what needs to happen, who owns it, and proof it happened.
--    • Open Skills — skills / skill_versions / runbooks / runbook_steps: the
--                    reusable, versioned way to do the work to Joe's standards.
--  All idempotent (safe to re-run). Money stays out of here; this is the
--  operations/knowledge brain, not the ledger.
-- ════════════════════════════════════════════════════════════════════════════

-- Trigram search for fuzzy knowledge/skill lookup. Trusted extension (PG13+),
-- so the app's DB owner can install it. Wrapped so a locked-down environment
-- that forbids it doesn't abort the whole schema apply — the full-text (tsv)
-- path below works without it.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm unavailable (%.); continuing with full-text search only', SQLERRM;
END $$;

-- ─── Open Brain: knowledge_items ────────────────────────────────────────────
-- The durable memory/search layer. Durable business context: client notes,
-- vendor knowledge, project decisions, business rules, SOP text, lessons,
-- estimate assumptions, selection preferences, follow-up context, file/meeting/
-- daily-log summaries. `kind` is free text (see recommended values below) so the
-- memory layer can grow without a migration. Links are soft (ON DELETE SET NULL)
-- so deleting a lead/project never destroys what we learned from it.
--   Recommended kind values: client_note, vendor_note, project_decision,
--   business_rule, sop, lesson, estimate_assumption, selection_preference,
--   followup_context, file_summary, meeting_summary, daily_log_summary,
--   admin_note.
CREATE TABLE IF NOT EXISTS knowledge_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content             text NOT NULL,
  kind                text NOT NULL DEFAULT 'note',
  source              text NOT NULL DEFAULT 'manual',   -- manual/agent/import/email/file/system
  source_uri          text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  lead_id             uuid REFERENCES leads(id)     ON DELETE SET NULL,
  project_id          uuid REFERENCES projects(id)  ON DELETE SET NULL,
  thread_id           uuid REFERENCES threads(id)   ON DELETE SET NULL,
  file_id             text REFERENCES files(id)     ON DELETE SET NULL,
  content_fingerprint text,                            -- de-dupe key (e.g. md5 of content)
  created_by          text NOT NULL DEFAULT 'user',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Full-text search vector, always in sync (generated column, no trigger).
  search_tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_knowledge_metadata ON knowledge_items USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_knowledge_project  ON knowledge_items(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_lead     ON knowledge_items(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_kind     ON knowledge_items(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_created  ON knowledge_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_search   ON knowledge_items USING gin(search_tsv);
-- De-dupe helper: at most one row per identical fingerprint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_fingerprint
  ON knowledge_items(content_fingerprint) WHERE content_fingerprint IS NOT NULL;
-- Trigram index for fuzzy/substring recall (only if pg_trgm installed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_knowledge_trgm ON knowledge_items USING gin(content gin_trgm_ops);
  END IF;
END $$;

-- Optional semantic embeddings — ONLY if pgvector is available. Not installed on
-- this server (checked: only pg_trgm is available), so this block is a no-op
-- here and the app relies on full-text + trigram search. When a future server
-- has pgvector, re-running the schema adds the column + IVFFlat index and the
-- search tools can start using it. Fully idempotent either way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS embedding vector(1536);
    -- Cosine-distance ANN index; lists tuned later as the table grows.
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_knowledge_embedding') THEN
      CREATE INDEX idx_knowledge_embedding ON knowledge_items
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    END IF;
  END IF;
END $$;

-- ─── Open Brain: agent_memories sidecar ─────────────────────────────────────
-- Memories PROPOSED or written by AI agents, kept apart from confirmed
-- knowledge_items with provenance + review state. Governing rule (Section 5.2 of
-- the plan): AI-created memories default to evidence-only / review pending and
-- must NOT act as standing instructions until Joe confirms them (or they come
-- from a trusted import). The column defaults below enforce that.
CREATE TABLE IF NOT EXISTS agent_memories (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary                   text NOT NULL DEFAULT '',
  content                   text NOT NULL,
  memory_type               text NOT NULL DEFAULT 'observation', -- observation/instruction/preference/fact
  provenance_status         text NOT NULL DEFAULT 'inferred'
                              CHECK (provenance_status IN ('asserted','inferred','imported','user_confirmed')),
  confidence                numeric,                             -- 0–1
  review_status             text NOT NULL DEFAULT 'pending'
                              CHECK (review_status IN ('pending','approved','rejected')),
  can_use_as_instruction    boolean NOT NULL DEFAULT false,      -- SAFE DEFAULT: never auto-instruct
  can_use_as_evidence       boolean NOT NULL DEFAULT true,
  requires_user_confirmation boolean NOT NULL DEFAULT true,
  stale_after               timestamptz,
  runtime_name              text,                                -- hermes-telegram / claude-code-server / …
  provider                  text,
  model                     text,
  -- Optional promotion link: once confirmed, the durable copy in knowledge_items.
  knowledge_item_id         uuid REFERENCES knowledge_items(id) ON DELETE SET NULL,
  lead_id                   uuid REFERENCES leads(id)    ON DELETE SET NULL,
  project_id                uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_memories_review  ON agent_memories(review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memories_project ON agent_memories(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memories_lead    ON agent_memories(lead_id, created_at DESC);

-- Provenance: where an agent memory came from (one memory → many source refs).
CREATE TABLE IF NOT EXISTS agent_memory_source_refs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id   uuid NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  ref_kind    text NOT NULL,                 -- knowledge/thread/file/lead/project/uri/receipt
  ref_id      text,                          -- the referenced row id/slug (as text)
  uri         text,                          -- or an external URI (Gmail/Drive/etc.)
  label       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_source_refs_mem ON agent_memory_source_refs(memory_id);

-- ─── Open Engine: work_items ────────────────────────────────────────────────
-- SJC OS's own work queue (replaces Linear in Nate's Open Engine). A unit of
-- work that can be linked to a lead/project/thread and carry the skill/runbook
-- an agent is expected to load before acting. requires_approval defaults TRUE so
-- nothing client-facing/financial slips through unreviewed.
CREATE TABLE IF NOT EXISTS work_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                  text NOT NULL,
  body                   text NOT NULL DEFAULT '',
  status                 text NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','in_progress','waiting_on_human','waiting_on_client',
                                             'waiting_on_sub','blocked','approval_needed','done','cancelled')),
  priority               text NOT NULL DEFAULT 'normal'
                           CHECK (priority IN ('low','normal','high','urgent')),
  assignee_kind          text NOT NULL DEFAULT 'human'
                           CHECK (assignee_kind IN ('human','agent')),
  assignee_key           text,                            -- human-joe / hermes-telegram / claude-code-server / …
  due_at                 timestamptz,
  lead_id                uuid REFERENCES leads(id)     ON DELETE SET NULL,
  project_id             uuid REFERENCES projects(id)  ON DELETE SET NULL,
  thread_id              uuid REFERENCES threads(id)   ON DELETE SET NULL,
  source_kind            text NOT NULL DEFAULT 'manual',-- manual/import/agent/email/schedule
  source_id              text,
  expected_skill_slug    text,                           -- soft ref → skills.slug
  expected_runbook_slug  text,                           -- soft ref → runbooks.slug
  requires_approval      boolean NOT NULL DEFAULT true,
  approval_status        text NOT NULL DEFAULT 'not_requested'
                           CHECK (approval_status IN ('not_requested','requested','approved','rejected')),
  blocked_reason         text,
  completed_at           timestamptz,
  created_by             text NOT NULL DEFAULT 'user',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Today page: when a work item is pulled into the owner's 5-slot Priorities
-- rail (auto-promoted from the backlog, or promoted by checkPriorityCompletion
-- when a slot frees up), promoted_at is stamped. NULL = still sitting in the
-- Waiting-on-me backlog. This is app/owner-driven UI state — no MCP tool
-- exposes it, so Hermes never touches it directly (see docs/hermes-mcp.md).
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS promoted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_work_items_promoted ON work_items(promoted_at)
  WHERE status NOT IN ('done','cancelled');

-- Today page: "Snooze 3d" sets snoozed_until (separate from due_at, which
-- keeps its normal meaning) so the auto-promotion pool can exclude a just-
-- demoted item until its snooze window passes, without also blocking
-- ordinary future-dated backlog items from ever auto-promoting.
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
CREATE INDEX IF NOT EXISTS idx_work_items_status    ON work_items(status, priority, due_at);
CREATE INDEX IF NOT EXISTS idx_work_items_due       ON work_items(due_at) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_work_items_assignee  ON work_items(assignee_key, status);
CREATE INDEX IF NOT EXISTS idx_work_items_project   ON work_items(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_lead      ON work_items(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_approval  ON work_items(approval_status) WHERE approval_status = 'requested';
CREATE INDEX IF NOT EXISTS idx_work_items_created   ON work_items(created_at DESC);

-- ─── Open Engine: agent_runs + agent_receipts ───────────────────────────────
-- One row per automated/assisted AI run, with a receipt trail proving what
-- changed (email id, calendar event, file path, DB row id, git SHA, …).
CREATE TABLE IF NOT EXISTS agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id   uuid REFERENCES work_items(id) ON DELETE SET NULL,
  runtime_name   text NOT NULL,
  model          text,
  status         text NOT NULL DEFAULT 'started'
                   CHECK (status IN ('started','succeeded','failed','cancelled')),
  input_summary  text NOT NULL DEFAULT '',
  output_summary text NOT NULL DEFAULT '',
  error_summary  text,
  cost_usd       numeric,
  skill_slug     text,                          -- skill loaded for this run, if any
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_work    ON agent_runs(work_item_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_runtime ON agent_runs(runtime_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS agent_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id  uuid REFERENCES agent_runs(id)  ON DELETE CASCADE,
  work_item_id  uuid REFERENCES work_items(id)  ON DELETE SET NULL,
  receipt_kind  text NOT NULL,                  -- email/calendar/file/db_row/git/draft/invoice/approval/…
  uri           text,
  label         text NOT NULL DEFAULT '',
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_receipts_run  ON agent_receipts(agent_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_receipts_work ON agent_receipts(work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_receipts_recent ON agent_receipts(created_at DESC);

-- ─── Open Engine: status_ledgers ────────────────────────────────────────────
-- Current state of each AI runtime (one row per runtime) — Nate's "status
-- comment", stored in SJC OS. The UI reads this to show what each agent last did,
-- what it's working, why it's blocked, and when it runs next.
CREATE TABLE IF NOT EXISTS status_ledgers (
  runtime_name          text PRIMARY KEY,
  state                 text NOT NULL DEFAULT 'idle'
                          CHECK (state IN ('idle','running','blocked','waiting_on_human','error')),
  current_work_item_id  uuid REFERENCES work_items(id) ON DELETE SET NULL,
  blocked_reason        text,
  note                  text NOT NULL DEFAULT '',
  last_run_at           timestamptz,
  next_run_at           timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ─── Open Skills: skills + versions ─────────────────────────────────────────
-- Reusable operating procedures agents load on demand. review_status gates
-- proposals: agent-suggested skills land as 'proposed' and stay out of the
-- library until Joe approves. The live procedure text lives in skill_versions
-- (versioned + auditable); skills.current_version_id points at the approved one.
CREATE TABLE IF NOT EXISTS skills (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                      text NOT NULL UNIQUE,
  title                     text NOT NULL,
  description               text NOT NULL DEFAULT '',
  category                  text NOT NULL DEFAULT 'operations',
  trigger_phrases           text[] NOT NULL DEFAULT '{}',
  when_to_use               text NOT NULL DEFAULT '',
  required_context          jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_tools             text[] NOT NULL DEFAULT '{}',
  approval_rules            text NOT NULL DEFAULT '',
  verification_requirements text NOT NULL DEFAULT '',
  current_version_id        uuid,                       -- FK added after skill_versions exists
  review_status             text NOT NULL DEFAULT 'proposed'
                              CHECK (review_status IN ('proposed','approved','rejected')),
  proposed_by               text NOT NULL DEFAULT 'user',
  active                    boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category, slug);
CREATE INDEX IF NOT EXISTS idx_skills_review   ON skills(review_status);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_skills_title_trgm ON skills USING gin(title gin_trgm_ops);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS skill_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id       uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version        integer NOT NULL,
  body_markdown  text NOT NULL,
  change_summary text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('draft','proposed','approved','rejected')),
  created_by     text NOT NULL DEFAULT 'user',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill  ON skill_versions(skill_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_skill_versions_status ON skill_versions(status) WHERE status = 'proposed';

-- Close the skills ↔ skill_versions loop now that both tables exist.
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_current_version_fk;
ALTER TABLE skills ADD CONSTRAINT skills_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES skill_versions(id) ON DELETE SET NULL;

-- ─── Open Skills: runbooks + steps ──────────────────────────────────────────
-- Ordered chains of skills for larger workflows (daily ops review, lead intake,
-- closeout). Each step names the skill an agent should run and whether it pauses
-- for human approval.
CREATE TABLE IF NOT EXISTS runbooks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  body_markdown text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runbook_steps (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id             uuid NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  step_order             integer NOT NULL,
  skill_id               uuid REFERENCES skills(id) ON DELETE SET NULL,
  skill_slug             text,                        -- soft ref, survives skill deletion
  title                  text NOT NULL,
  expected_output        text NOT NULL DEFAULT '',
  requires_human_approval boolean NOT NULL DEFAULT false,
  UNIQUE (runbook_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_runbook_steps ON runbook_steps(runbook_id, step_order);

-- ─── Migration staging: sjc_temp_lead_imports ───────────────────────────────
-- One-way import buffer preserving EVERY column of the temp CRM CSV exactly as
-- raw JSON, so the migration is reversible and nothing from the tracker is lost.
-- The dry-run importer (scripts/import-temp-leads.mjs) stages rows here and
-- proposes a target; official leads/projects/work_items are only written after
-- explicit approval.
CREATE TABLE IF NOT EXISTS sjc_temp_lead_imports (
  record_id       text PRIMARY KEY,
  raw             jsonb NOT NULL,
  proposed_target text NOT NULL DEFAULT 'review'
                    CHECK (proposed_target IN ('lead','project','archive','knowledge','review')),
  import_status   text NOT NULL DEFAULT 'staged'
                    CHECK (import_status IN ('staged','mapped','imported','skipped')),
  review_notes    text NOT NULL DEFAULT '',
  imported_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_temp_imports_status ON sjc_temp_lead_imports(import_status, proposed_target);

-- updated_at touch triggers for the new mutable tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['knowledge_items','agent_memories','work_items','skills','runbooks'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- ─── Business stage rules + crosswalk (Phase-3 stage alignment) ──────────────
-- The temp CRM tracker (stage_gates.md) models the REAL business lifecycle at a
-- finer grain than the official leads.stage (5) / projects.status (9) enums that
-- the UI is built around. Rather than widen those enums (which would ripple
-- through the pipeline strips, chips, and lib/{leads,projects}.ts and risk
-- breaking pages), we preserve the real business stages HERE as machine-readable
-- rules with a crosswalk to the official status an agent should set. Hermes/
-- agents check gate_requirements before advancing a record; the UI is untouched.
-- Full narrative + gate detail: docs/stage-gates.md.
CREATE TABLE IF NOT EXISTS stage_rules (
  stage                   text PRIMARY KEY,      -- business stage from stage_gates.md
  phase                   text NOT NULL          -- lead | precon | construction | closeout
                            CHECK (phase IN ('lead','precon','construction','closeout')),
  sort_order              integer NOT NULL DEFAULT 0,
  gate_requirements       text NOT NULL DEFAULT '',   -- what must be true to enter this stage
  maps_to_lead_stage      text,                  -- official leads.stage, when this is a lead-phase stage
  maps_to_project_status  text,                  -- official projects.status, when project-phase
  is_terminal             boolean NOT NULL DEFAULT false,   -- lost/pass/archived
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stage_rules_phase ON stage_rules(phase, sort_order);

-- Seed the crosswalk (idempotent — same pattern as the schedule template seed).
INSERT INTO stage_rules (stage, phase, sort_order, gate_requirements, maps_to_lead_stage, maps_to_project_status, is_terminal)
SELECT v.stage, v.phase, v.sort_order, v.gate, v.lead_stage, v.proj_status, v.terminal
  FROM (VALUES
    -- ── Lead / sales pipeline ──────────────────────────────────────────────
    ('new',                      'lead',         10, 'Lead captured, not yet reviewed.',                                                  'intake',        NULL,                    false),
    ('needs_response',           'lead',         20, 'Name/contact present; source or notes explain origin.',                            'intake',        NULL,                    false),
    ('discovery_scheduled',      'lead',         30, 'Phone or email present; discovery date in next_action/status_notes.',              'discovery_call',NULL,                    false),
    ('discovery_completed',      'lead',         40, 'Discovery notes captured; project type, budget, timeline known or marked unknown.','discovery_call',NULL,                    false),
    ('rough_estimate_needed',    'lead',         50, 'Discovery complete; scope sufficient for Phase-1 estimate; gaps listed.',          'rough_estimate',NULL,                    false),
    ('rough_estimate_sent',      'lead',         60, 'Rough estimate sent; sent date in last_contact_at; follow-up set (~2 days).',      'rough_estimate',NULL,                    false),
    ('follow_up_needed',         'lead',         70, 'Prior client contact exists; next follow-up reason stated in next_action.',        'rough_estimate',NULL,                    false),
    ('precon_deposit_requested', 'lead',         80, 'Client wants to move forward; pre-con agreement/deposit request sent.',            'rough_estimate',NULL,                    false),
    ('lost',                     'lead',         98, 'Lost reason captured in status_notes.',                                            NULL,            NULL,                    true),
    ('pass',                     'lead',         99, 'Pass/disqualification reason captured in status_notes.',                           NULL,            NULL,                    true),
    -- ── Pre-construction (lead has become a project) ───────────────────────
    ('precon_deposit_paid',      'precon',      110, 'Pre-con agreement approved; deposit paid; precon_deposit_status = paid.',          'precon_signed', 'precon_signed',         false),
    ('site_visit_scheduled',     'precon',      120, 'Deposit paid; site-visit date captured in next_action/status_notes.',              NULL,            'precon_signed',         false),
    ('site_visit_completed',     'precon',      130, 'Site-visit notes captured; photos/measurements status noted.',                     NULL,            'floor_plan',            false),
    ('precon_active',            'precon',      140, 'Detailed takeoff/scope/selections/sub pricing started; next action assigned.',     NULL,            'selections',            false),
    ('formal_estimate_needed',   'precon',      150, 'Site visit complete; scope updated; selections/allowances/questions captured.',   NULL,            'bidding',               false),
    ('formal_estimate_sent',     'precon',      160, 'Formal estimate/SOW sent; sent date in last_contact_at; follow-up set.',           NULL,            'bidding',               false),
    ('contract_requested',       'precon',      170, 'Client approved estimate/SOW; contract request/draft ready or sent.',              NULL,            'bidding',               false),
    ('contract_signed',          'precon',      180, 'Contract signed; contract_status = signed.',                                       NULL,            'construction_contract', false),
    ('retainer_paid',            'precon',      190, 'Contract signed; retainer paid; retainer_status = paid.',                          NULL,            'construction_contract', false),
    -- ── Construction ───────────────────────────────────────────────────────
    ('construction_scheduled',   'construction',210, 'Retainer paid; start date/schedule captured; current milestone identified.',      NULL,            'construction',          false),
    ('active_construction',      'construction',220, 'Construction started; current milestone identified; owner/PM assigned.',          NULL,            'construction',          false),
    ('change_order_pending',     'construction',230, 'CO description in status_notes; client approval/payment/signature need stated.',   NULL,            'construction',          false),
    ('waiting_on_client',        'construction',240, 'Client-blocking decision/payment/access item stated in next_action.',              NULL,            'construction',          false),
    ('waiting_on_sub',           'construction',250, 'Sub/vendor-blocking item stated in next_action.',                                  NULL,            'construction',          false),
    ('milestone_ready_to_invoice','construction',260,'Milestone in current_milestone; completion/approval evidence in status_notes.',   NULL,            'construction',          false),
    ('substantial_completion',   'construction',270, 'Substantial completion reached; punch/walkthrough status in status_notes.',        NULL,            'closeout',              false),
    -- ── Closeout / warranty ────────────────────────────────────────────────
    ('punch_list_active',        'closeout',    310, 'Punch list exists or walkthrough done; open items summarized in status_notes.',    NULL,            'closeout',              false),
    ('final_invoice_sent',       'closeout',    320, 'Final invoice sent; sent date in last_contact_at.',                                NULL,            'closeout',              false),
    ('closed_out',               'closeout',    330, 'Final payment received; punch resolved/accepted; documents archived.',             NULL,            'warranty',              false),
    ('warranty_active',          'closeout',    340, 'Project closed out; warranty period/policy reference captured.',                   NULL,            'warranty',              false),
    ('warranty_claim_open',      'closeout',    350, 'Claim description captured; response/resolution next action set.',                 NULL,            'warranty',              false),
    ('archived',                 'closeout',    399, 'No active project/payment/warranty/client action remains; archive note captured.', NULL,            NULL,                    true)
  ) AS v(stage, phase, sort_order, gate, lead_stage, proj_status, terminal)
 WHERE NOT EXISTS (SELECT 1 FROM stage_rules sr WHERE sr.stage = v.stage);

-- ─── Open Skills seed: initial SJ Carpentry procedures + runbooks ────────────
-- Foundational, Joe-authored operating procedures (from the Open Brain plan §5.5
-- + business rules §13). Seeded 'approved'/active so the library is usable now;
-- agent-PROPOSED skills still land as 'proposed' and wait for review. Idempotent:
-- ON CONFLICT (slug) DO NOTHING + a v1 skill_version created only if missing.
DO $seed_skills$
DECLARE s record; sid uuid; vid uuid;
BEGIN
  FOR s IN
    SELECT * FROM (VALUES
      ('one-project-review', 'One project review', 'Review a single open job with Joe, confirm status, then update the record.',
       'operations', 'When Joe wants to walk open jobs one at a time.', ARRAY['review jobs','open jobs','walk the jobs'],
       $body$# One project review

Review exactly ONE job at a time, in Joe's voice, then stop for confirmation.

1. Pull the project/lead + its recent knowledge_items, work_items, threads.
2. State: where it stands, what's waiting (on Joe / client / sub), the next action + due date.
3. Propose the single next step. Keep it short and plain-spoken.
4. WAIT for Joe to confirm. Do not batch multiple jobs.
5. After Joe confirms, update the record (stage via stage_rules gate, next action, knowledge note) and log a receipt.
6. Client-facing sends stay drafts until Joe approves.$body$),

      ('client-followup-draft', 'Client follow-up draft', 'Draft a short, plain-spoken client follow-up.',
       'communication', 'When a lead/project needs a client-facing follow-up email or text.', ARRAY['follow up','draft reply','email the client'],
       $body$# Client follow-up draft

- Short, plain-spoken, practical, casual — the way Joe talks.
- Do NOT mention subcontractor business names unless explicitly asked.
- One clear ask or next step. No corporate filler.
- Always a DRAFT — never send. Joe reviews and sends.
- Ground on the real thread + knowledge_items; don't invent facts/dates.$body$),

      ('lead-triage-under-20k', 'Lead triage vs $20k floor', 'Triage a lead against the ~$20k job floor.',
       'sales', 'When a new lead arrives and scope/budget must be judged against the floor.', ARRAY['triage lead','is this worth it','under 20k'],
       $body$# Lead triage vs the $20k floor

1. Estimate rough scope from project_type + notes.
2. Basic cellar stairs and similar small jobs are usually under the floor → likely decline.
3. If clearly under ~$20k with no upsell, recommend a polite decline (draft only).
4. If at/over the floor or unclear, advance to discovery and list what's missing.
5. Capture the reason in status_notes / a knowledge_item either way.$body$),

      ('precon-deposit-site-visit-gate', 'Pre-con deposit → site visit gate', 'Enforce the deposit-before-site-visit order.',
       'operations', 'Before scheduling a site visit or advancing pre-construction.', ARRAY['site visit','precon deposit','schedule visit'],
       $body$# Pre-con deposit / site-visit gate

Site visits happen AFTER rough-estimate acceptance AND the pre-construction
deposit is paid. Before advancing:
1. Confirm rough estimate sent + accepted.
2. Confirm precon_deposit_status = paid.
3. Only then schedule the site visit (date in next_action).
4. If the deposit isn't paid, do not schedule — list what's missing (per stage_rules gate).$body$),

      ('file-invoice-receipt-rebate', 'File invoice vs receipt vs rebate', 'Route financial documents to the right place.',
       'finance', 'When filing a financial document (invoice, receipt, rebate, overhead).', ARRAY['file invoice','file receipt','where does this go'],
       $body$# File invoice / receipt / rebate

- Project invoices → Invoices.
- Receipts / payment confirmations / rebate receipts → Receipts / Rebates.
- Overhead / admin receipts → Overhead Receipts/<year>.
- Do NOT create Google Drive files/folders unless explicitly asked; file on the server/local FS.
- Houzz notification emails are NOT client emails.$body$),

      ('project-meeting-brief', 'Project meeting brief', 'Prepare a concise brief before a client/vendor meeting.',
       'operations', 'Before a client or vendor meeting.', ARRAY['meeting prep','brief me','prep for'],
       $body$# Project meeting brief

Pull and summarize (from SJC OS, not memory):
1. Where the project stands + current milestone.
2. Open decisions waiting on the client.
3. Selections/allowances status + any budget deltas.
4. Money: invoiced vs collected, anything overdue.
5. The 2–3 things to get out of the meeting. Keep it to one screen.$body$),

      ('temp-crm-import-review', 'Temp CRM import review', 'Review the temp CRM dry-run before importing.',
       'operations', 'When migrating temp CRM rows into official records.', ARRAY['import review','crm import','migrate leads'],
       $body$# Temp CRM import review

1. Run the dry run (scripts/import-temp-leads.mjs) — never --approve first.
2. Check: active vs closed counts, proposed lead/project split, unrecognized stages, rows needing review, duplicates.
3. Low-certainty rows stay staged/reviewed — never auto-imported as real projects.
4. Only after Joe approves the report: --stage then --approve.
5. Raw rows are preserved in sjc_temp_lead_imports (reversible).$body$),

      ('daily-operations-review', 'Daily operations review', 'Run the recurring daily review of the queue.',
       'operations', 'Once daily, to surface what needs Joe/AI/subs/clients today.', ARRAY['daily review','what is due','morning review'],
       $body$# Daily operations review

1. Read work_items due today/overdue; group by waiting-on-Joe / client / sub.
2. Surface approval_needed items first.
3. Do safe read/draft/organize work per each item's expected skill.
4. Request approval for anything client-facing or financial.
5. Record a receipt per action; update the status ledger.
6. Present to Joe one item at a time.$body$)
    ) AS t(slug, title, descr, category, whenv, triggers, body)
  LOOP
    INSERT INTO skills (slug, title, description, category, when_to_use, trigger_phrases, review_status, proposed_by, active)
    VALUES (s.slug, s.title, s.descr, s.category, s.whenv, s.triggers, 'approved', 'user', true)
    ON CONFLICT (slug) DO NOTHING;
    SELECT id INTO sid FROM skills WHERE slug = s.slug;
    IF NOT EXISTS (SELECT 1 FROM skill_versions WHERE skill_id = sid AND version = 1) THEN
      INSERT INTO skill_versions (skill_id, version, body_markdown, change_summary, status, created_by)
      VALUES (sid, 1, s.body, 'seeded from Open Brain plan', 'approved', 'user')
      RETURNING id INTO vid;
      UPDATE skills SET current_version_id = vid WHERE id = sid AND current_version_id IS NULL;
    END IF;
  END LOOP;
END $seed_skills$;

-- Runbooks: ordered chains of the seeded skills. Idempotent per slug + step_order.
DO $seed_runbooks$
DECLARE rb record; st record; rbid uuid;
BEGIN
  FOR rb IN
    SELECT * FROM (VALUES
      ('daily-sjc-operations-review', 'Daily SJC operations review', 'Walk the queue each morning, one item at a time.'),
      ('lead-intake-to-qualified-or-declined', 'Lead intake → qualified or declined', 'Take a new lead through triage to discovery or a polite decline.'),
      ('rough-estimate-to-site-visit', 'Rough estimate → site visit', 'From rough estimate sent through deposit to a scheduled site visit.'),
      ('active-project-followup-loop', 'Active project follow-up loop', 'Keep an active job moving with client/sub follow-ups.'),
      ('completed-project-closeout', 'Completed project closeout', 'Close out a finished job cleanly.')
    ) AS t(slug, title, descr)
  LOOP
    INSERT INTO runbooks (slug, title, description) VALUES (rb.slug, rb.title, rb.descr)
    ON CONFLICT (slug) DO NOTHING;
    SELECT id INTO rbid FROM runbooks WHERE slug = rb.slug;
    FOR st IN
      SELECT * FROM (VALUES
        ('daily-sjc-operations-review', 1, 'Review the queue', 'daily-operations-review', false),
        ('daily-sjc-operations-review', 2, 'Walk each open job with Joe', 'one-project-review', true),
        ('lead-intake-to-qualified-or-declined', 1, 'Triage against the $20k floor', 'lead-triage-under-20k', false),
        ('lead-intake-to-qualified-or-declined', 2, 'Draft the reply (advance or decline)', 'client-followup-draft', true),
        ('rough-estimate-to-site-visit', 1, 'Draft the estimate follow-up', 'client-followup-draft', true),
        ('rough-estimate-to-site-visit', 2, 'Enforce deposit before scheduling', 'precon-deposit-site-visit-gate', false),
        ('active-project-followup-loop', 1, 'Review the project', 'one-project-review', false),
        ('active-project-followup-loop', 2, 'Draft the client/sub follow-up', 'client-followup-draft', true),
        ('completed-project-closeout', 1, 'Prep the closeout brief', 'project-meeting-brief', false),
        ('completed-project-closeout', 2, 'File final invoice/receipts correctly', 'file-invoice-receipt-rebate', false)
      ) AS t(rb_slug, ord, title, skill_slug, approval)
      WHERE t.rb_slug = rb.slug
    LOOP
      INSERT INTO runbook_steps (runbook_id, step_order, title, skill_id, skill_slug, requires_human_approval)
      VALUES (rbid, st.ord, st.title, (SELECT id FROM skills WHERE slug = st.skill_slug), st.skill_slug, st.approval)
      ON CONFLICT (runbook_id, step_order) DO NOTHING;
    END LOOP;
  END LOOP;
END $seed_runbooks$;

-- ── Dev-agent chat runs (Ask window: Claude via headless CLI) ─────────────────
-- Asynchronous agent turns. Qwen and Hermes answer synchronously in-request;
-- Claude runs headless `claude -p` with full edit access (minutes, detached),
-- so each Claude turn is a row here that a detached runner updates on finish
-- and the chat polls. page_context = the app route the user was viewing, so the
-- agent can open the right source files.
CREATE TABLE IF NOT EXISTS dev_agent_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent        text NOT NULL DEFAULT 'claude',
  prompt       text NOT NULL,
  page_context text,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','done','error')),
  answer       text,
  cost_usd     numeric,
  session_id   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dev_agent_runs_status_idx ON dev_agent_runs (status, created_at DESC);

-- ── Persisted AI chat: per-model conversations + messages ─────────────────────
-- Backs the /ai Ask window (and ⌘K Claude launches). Conversations are scoped
-- to one agent (claude/qwen/hermes) so history stays separated by model. Claude
-- threads store the CLI session id so follow-ups resume with full context.
CREATE TABLE IF NOT EXISTS ai_conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent             text NOT NULL CHECK (agent IN ('claude','qwen','hermes')),
  title             text NOT NULL DEFAULT 'New chat',
  claude_session_id text,
  archived          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_agent_idx
  ON ai_conversations (agent, archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant')),
  body            text NOT NULL,
  page_context    text,
  cost_usd        numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
  ON ai_messages (conversation_id, created_at);

-- Link an async Claude run to its conversation (so the runner can persist the
-- assistant message + resume the session).
ALTER TABLE dev_agent_runs
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES ai_conversations(id) ON DELETE CASCADE;

-- Per-run Claude controls (chosen in the Ask window) + a live activity log the
-- runner streams into so the chat can show what Claude is doing in real time.
--   model    → CLI --model ("" = the CLI's configured default)
--   mode     → 'edit' (acceptEdits) or 'plan' (read-only, proposes changes)
--   effort   → 'normal'|'think'|'hard'|'ultra' (injects a thinking directive)
--   activity → newline-joined progress lines (Reading/Editing/Thinking…)
ALTER TABLE dev_agent_runs
  ADD COLUMN IF NOT EXISTS model    text,
  ADD COLUMN IF NOT EXISTS mode     text NOT NULL DEFAULT 'edit',
  ADD COLUMN IF NOT EXISTS effort   text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS activity text;

-- ── Today v2: interactive AI feed ────────────────────────────────────────────
-- Triage lane override. NULL = classify by rules at read time
-- (lib/today-triage.ts). Set by the owner (UI) or by an agent proposal the
-- owner accepted — rules are the default, this column is the exception.
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS effort_class text
  CHECK (effort_class IN ('chat','quick','deep'));

-- When a chat turn is ABOUT one work item (a card handed to an agent), stamp it
-- so the thread renders the card's chips under the reply and the client knows
-- which item to re-check after the turn lands.
ALTER TABLE ai_messages    ADD COLUMN IF NOT EXISTS subject_work_item_id uuid
  REFERENCES work_items(id) ON DELETE SET NULL;
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS subject_work_item_id uuid
  REFERENCES work_items(id) ON DELETE SET NULL;

-- ─── Document templates (doc-templates plan) ───────────────────────────────
-- The editable unit behind AI-fillable business documents (construction
-- contract, precon agreement, lien release, completion cert, change order,
-- estimate, invoice). Canonical legal/visual text lives in code
-- (lib/doc-templates/*); this row holds only the FIELD VALUES an owner/agent
-- filled in. The rendered PDF/DOCX is deterministic from
-- (template_key, template_version, field_values). Money in field_values is
-- CENTS, matching the rest of the transactional layer. AI may write only
-- `source:'ai'` narrative fields — enforced in the fill layer, not here.
--   status: draft → rendered (files exist) → submitted (signature_request
--   created) → signed/void. After `submitted` a draft is read-only (void +
--   clone to revise). Scope is project_id XOR lead_slug (precon/estimate can be
--   lead-scoped before a project row exists).
CREATE TABLE IF NOT EXISTS document_drafts (
  id               bigserial PRIMARY KEY,
  project_id       uuid REFERENCES projects(id) ON DELETE CASCADE,  -- project-scoped (most)
  lead_slug        text,                                            -- or lead-scoped (precon/estimate)
  template_key     text NOT NULL,           -- 'contract','precon','lien_release','completion_cert','change_order','estimate_doc','invoice_doc'
  template_version text NOT NULL DEFAULT '',
  title            text NOT NULL DEFAULT '',
  field_values     jsonb NOT NULL DEFAULT '{}',   -- { field_key: value }
  fill_report      jsonb NOT NULL DEFAULT '{}',   -- { field_key: 'auto'|'ai'|'owner'|'missing' }
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','rendered','submitted','signed','void')),
  pdf_file_id      text REFERENCES files(id) ON DELETE SET NULL,
  docx_file_id     text REFERENCES files(id) ON DELETE SET NULL,
  signature_request_id bigint REFERENCES signature_requests(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_via      text NOT NULL DEFAULT 'app',   -- 'app' | 'ai' | 'mcp'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_drafts_project ON document_drafts(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_drafts_lead    ON document_drafts(lead_slug, created_at DESC);

-- Widen signature_requests doc_type for the new templates (adds 'precon').
-- NOT VALID so an existing table with legacy rows re-constrains without a scan.
ALTER TABLE signature_requests DROP CONSTRAINT IF EXISTS signature_requests_doc_type_check;
ALTER TABLE signature_requests ADD CONSTRAINT signature_requests_doc_type_check
  CHECK (doc_type IN ('design','estimate','contract','sow','change_order',
                      'completion','lien_waiver','precon','other')) NOT VALID;

-- ─── Client portal invites (link-in access) ─────────────────────────────────
-- The homeowner equivalent of sub_portal_invites. A client gets a link, not an
-- account: /client-portal/enter?token=… trades the token for a normal session
-- cookie (role=client, link_slug=<project slug>), so every existing
-- requireRole("owner","client") check works unchanged.
--
-- SECURITY — a BEARER LINK, deliberately, the same trade as the sub flow:
-- anyone holding the email reaches that one project's portal. It cannot reach
-- owner surfaces or another project. Levers if a link leaks: expires_at, Revoke
-- (status='dismissed'), users.active=false, and — unique to clients — the
-- client CLAIMING the portal with a password, which refuses bearer entry from
-- then on (users.portal_claimed_at).
CREATE TABLE IF NOT EXISTS client_portal_invites (
  id           bigserial PRIMARY KEY,
  project_slug text NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
  to_email     text,                              -- client email at issue time
  to_name      text NOT NULL DEFAULT '',
  token        text UNIQUE NOT NULL,              -- opaque bearer token
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','dismissed')),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,                       -- first successful entry (audit)
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_slug)
);
CREATE INDEX IF NOT EXISTS idx_client_invites_project
  ON client_portal_invites(project_slug, status);

-- Set when a client trades their bearer link for a real password. Non-null ⇒
-- links are refused for that account and password login is the only way in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_claimed_at timestamptz;

-- ─── Purchase orders (per-project) ─────────────────────────────────────────
-- Materials-side procurement, the money-out counterpart to invoices. A PO goes
-- to a saved vendor (materials supplier), an assigned sub, or a one-off entry
-- typed once and not saved. vendor_name/email/phone are a snapshot at
-- create-time (or the one-off entry itself) so the PO stays readable even if
-- the vendor row is later edited or removed. Lines carry qty_ordered vs
-- qty_received so partial/backorder shows up per line; the PO's own status is
-- derived from its lines by lib/actions/purchase-orders.ts's recompute().
CREATE TABLE IF NOT EXISTS vendors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  trade       text NOT NULL DEFAULT '',   -- e.g. "Lumber", "Cabinets", "Hardware"
  email       text,
  phone       text,
  notes       text NOT NULL DEFAULT '',   -- owner's private notes on the vendor
  fav         boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            bigserial PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  po_number     text NOT NULL DEFAULT '',       -- display, e.g. "PO-001"
  vendor_kind   text NOT NULL DEFAULT 'one_off'
                  CHECK (vendor_kind IN ('vendor','sub','one_off')),
  vendor_id     uuid REFERENCES vendors(id) ON DELETE SET NULL,
  sub_slug      text REFERENCES subs(slug) ON DELETE SET NULL,
  vendor_name   text NOT NULL DEFAULT '',       -- snapshot (or the one-off entry itself)
  vendor_email  text NOT NULL DEFAULT '',
  vendor_phone  text NOT NULL DEFAULT '',
  title         text NOT NULL DEFAULT '',
  notes         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','queued','sent','partial','fulfilled','closed','void')),
  subtotal      integer NOT NULL DEFAULT 0,     -- cents, Σ(extended) — recomputed from lines
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at       timestamptz,
  fulfilled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_project ON purchase_orders(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                bigserial PRIMARY KEY,
  purchase_order_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  cost_item_id      bigint REFERENCES cost_items(id) ON DELETE SET NULL,
  description       text NOT NULL DEFAULT '',
  unit              text NOT NULL DEFAULT 'ea',
  qty_ordered       numeric(12,2) NOT NULL DEFAULT 0,
  qty_received      numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost         integer NOT NULL DEFAULT 0,  -- cents
  extended          integer NOT NULL DEFAULT 0,  -- cents = qty_ordered * unit_cost
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(purchase_order_id, sort_order);

-- ── Live updates ─────────────────────────────────────────────────────────────
-- Append-only signal log: every INSERT/UPDATE/DELETE that goes through the
-- app's query() helper (lib/db.ts) or the MCP server's rows() helper logs one
-- row here. Open browser tabs poll MAX(id) (components/shell/LiveUpdates.tsx)
-- and router.refresh() when it advances, so agent/MCP edits appear without a
-- reload. Pruned opportunistically to the last 7 days by the bump helper.
CREATE TABLE IF NOT EXISTS app_change_log (
  id         bigserial PRIMARY KEY,
  scope      text NOT NULL DEFAULT '',    -- table the write touched ('' = unknown)
  source     text NOT NULL DEFAULT 'app', -- 'app' | 'mcp'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_change_log_created ON app_change_log (created_at);
