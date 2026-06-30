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
         chat_members, project_punch, catalog_items,
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
  ('ai.sendBeforeReview',    'false');

-- ─── Users / auth ────────────────────────────────────────────────────────────
-- Only the real owner account (Joe). Seeded with the demo password "sjcos"
-- (scrypt, salt:hash) — ROTATE before/after deploy. Sub/client portal accounts
-- are now created live by the owner in Settings.
INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES
  ('josephstafki@sjcarpentryllc.com', '40676a86efbd86836c89a27ef60bb454:5ef3dfb212f1dbd1aaa746f37e245d9d3c0b160f8e0ac3a2a681ad3d66dda4c5d2494df8f38b1c3eff9ebe7b2b387ddfb034ed6ece57bc84ee9dffcb50f03b8b', 'Joe Stafki', 'owner', 'JS', NULL);

-- ─── Team chat ──────────────────────────────────────────────────────────────
-- Sample chat messages / reads / memberships removed — populated live. Tables
-- start empty after reseed.

-- ─── Material catalog ────────────────────────────────────────────────────────
-- Sample materials removed — catalog is built live in the app. Table starts empty.

-- ─── Project-scoped data ─────────────────────────────────────────────────────
-- Invoices, retainers, selection sections + selections, punch lists, project↔sub
-- assignments, and sub-portal logs/invoices were all keyed to the demo projects.
-- Removed — these are created live per project. Tables start empty after reseed.

COMMIT;
