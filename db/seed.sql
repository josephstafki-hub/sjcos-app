-- SJC OS — demo seed (SYNTHETIC data only; no real client records).
-- Mirrors the curated showcase cast the screens already reference, so the app
-- is identical whether reading mock or DB. Idempotent: truncates then inserts.
-- Apply with:  psql "$DATABASE_URL" -f db/seed.sql
--
-- Dates that should stay "fresh" relative to the demo day are computed from
-- CURRENT_DATE; everything else uses literal dates.

BEGIN;

TRUNCATE leads, projects, subs, threads, notifications, compliance_items,
         warranty_projects, warranty_claims, schedule_blocks, daily_logs,
         files, app_settings, users, chat_messages, chat_reads,
         chat_members, chat_channels, chat_ai_members, team_members,
         chat_team_members, project_punch, catalog_items,
         lead_activity, lead_intake, lead_estimates,
         invoices, retainers, project_selections, project_sections,
         project_mood, project_floorplans, project_subs,
         sub_logs, sub_invoices
         RESTART IDENTITY CASCADE;

-- ─── Leads ──────────────────────────────────────────────────────────────────
-- Sample leads (and their intake / estimates / activity) removed — leads are
-- now collected live in the app. The leads table starts empty after reseed.

-- ─── Projects ───────────────────────────────────────────────────────────────
-- Sample projects removed — projects are now created live in the app. The
-- projects table (and all project-scoped data below) starts empty after reseed.

-- ─── Subcontractors ─────────────────────────────────────────────────────────
-- Sample subcontractors removed — subs are now onboarded live in the app. The
-- subs table starts empty after reseed.

-- ─── Notifications ──────────────────────────────────────────────────────────
-- Sample notifications removed — these referenced the demo leads/projects and
-- are now generated live from real app activity. Table starts empty after reseed.

-- ─── Compliance items ───────────────────────────────────────────────────────
-- Sample compliance items removed — tracked live in the app. Table starts empty.

-- ─── Warranty ───────────────────────────────────────────────────────────────
-- Sample warranty projects + claims removed — populated live as projects close.
-- Both tables start empty after reseed.

-- ─── Schedule ───────────────────────────────────────────────────────────────
-- Sample schedule blocks + daily log removed — created live in the app. Both
-- tables start empty after reseed.

-- ─── Files ──────────────────────────────────────────────────────────────────
-- Sample project files removed with the demo projects — files are now uploaded
-- live per project. The files table starts empty after reseed.

-- ─── App settings: Claude/AI toggles + profile defaults ─────────────────────
INSERT INTO app_settings (key, value) VALUES
  ('profile.name',          'Joe Stafki'),
  ('profile.company',       'SJ Carpentry LLC'),
  ('profile.email',         'josephstafki@sjcarpentryllc.com'),
  ('ai.draftReplies',        'true'),
  ('ai.autoPinWatchouts',    'true'),
  ('ai.summarizeVoicemails', 'true'),
  ('ai.weeklyStatusEmails',  'true'),
  ('ai.autoPublishSocial',   'false'),
  ('ai.sendBeforeReview',    'false'),
  -- Company / contract boilerplate used by generated contracts + SOWs (B5).
  -- Edited live in Settings → Company & documents. License/address start blank
  -- so they read as "—" until Joe fills them in.
  ('company.license',        ''),
  ('company.address',        ''),
  ('contract.deposit_pct',   '10'),
  ('contract.terms',         'This Agreement is between SJ Carpentry LLC ("Contractor") and the Client named above. Contractor agrees to furnish the labor, materials, and services described in the attached Scope of Work and Estimate for the Total Price stated. Payments are due per the Payment Schedule below within 7 days of each invoice. Any change to the scope must be authorized in writing via a signed Change Order before the work proceeds; approved changes adjust the Total Price accordingly. Contractor warrants its workmanship for one (1) year from substantial completion. Either party may terminate for material breach with written notice and a 10-day cure period; on termination the Client pays for all work completed and materials ordered to date. This Agreement is governed by the laws of the State of Minnesota.');

-- ─── Users / auth ────────────────────────────────────────────────────────────
-- Only the real owner account (Joe). Seeded with the demo password "sjcos"
-- (scrypt, salt:hash) — ROTATE before/after deploy. Sub/client portal accounts
-- are now created live by the owner in Settings.
INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES
  ('josephstafki@sjcarpentryllc.com', '40676a86efbd86836c89a27ef60bb454:5ef3dfb212f1dbd1aaa746f37e245d9d3c0b160f8e0ac3a2a681ad3d66dda4c5d2494df8f38b1c3eff9ebe7b2b387ddfb034ed6ece57bc84ee9dffcb50f03b8b', 'Joe Stafki', 'owner', 'JS', NULL);

-- ─── Team chat ──────────────────────────────────────────────────────────────
-- Sample chat messages / reads / memberships removed — populated live. The five
-- default channels (with all three AI models) are restored so the rail isn't
-- empty after a reseed; schema.sql seeds the same rows idempotently.
INSERT INTO chat_channels (key, name, description, sort_order) VALUES
  ('field-daily',     'field-daily',     'Daily check-ins from active sites · AI pins what''s blocking', 10),
  ('selections',      'selections',      'Client selections + approvals · AI logs each decision',        20),
  ('bookkeeping',     'bookkeeping',     'Receipts, invoices, and money questions',                      30),
  ('safety',          'safety',          'Site safety notes and incident reports',                       40),
  ('marketing-queue', 'marketing-queue', 'AI-drafted posts waiting on your approval',                    50)
ON CONFLICT (key) DO NOTHING;
INSERT INTO chat_ai_members (channel_key, agent)
SELECT c.key, a.agent
  FROM (VALUES ('field-daily'),('selections'),('bookkeeping'),('safety'),('marketing-queue')) AS c(key)
 CROSS JOIN (VALUES ('claude'),('qwen'),('hermes')) AS a(agent)
 WHERE NOT EXISTS (SELECT 1 FROM chat_ai_members x WHERE x.channel_key = c.key)
ON CONFLICT DO NOTHING;

-- Demo internal-team roster (dev only — the live roster is built inline in the
-- app). Dana is dropped into #field-daily so the Team section has something to
-- show in a fresh reseed.
INSERT INTO team_members (slug, name, role_label) VALUES
  ('dana-whitfield', 'Dana Whitfield', 'Office manager'),
  ('leah-tran',      'Leah Tran',      'Estimator')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO chat_team_members (channel_key, member_slug) VALUES
  ('field-daily', 'dana-whitfield')
ON CONFLICT DO NOTHING;

-- ─── Material catalog ────────────────────────────────────────────────────────
-- Sample materials removed — catalog is built live in the app. Table starts empty.

-- ─── Project-scoped data ─────────────────────────────────────────────────────
-- Invoices, retainers, selection sections + selections, punch lists, project↔sub
-- assignments, and sub-portal logs/invoices were all keyed to the demo projects.
-- Removed — these are created live per project. Tables start empty after reseed.

COMMIT;
