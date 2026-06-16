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
         files, app_settings RESTART IDENTITY CASCADE;

-- ─── Leads ──────────────────────────────────────────────────────────────────
INSERT INTO leads (slug, name, scope, stage, estimate_value, value_display, source, hot, flag_label, flag_kind, last_contact_at) VALUES
  ('maria-chen',      'Maria & David Chen',      'Kitchen reno · Edina',   'phase1_sent',      54000, '$49–60k', 'Site form',    true,  'Needs reply', 'flag', now() - interval '6 days'),
  ('anh-pham',        'Anh Pham',                'Bath reno · St Paul',    'intake',           22000, '$22k',    'Site form',    false, NULL,          NULL,   now() - interval '2 days'),
  ('a-cole',          'A. Cole',                 'Basement bar · Mpls',    'intake',           NULL,  '?',       'Site form',    false, 'New',         'ai',   now() - interval '4 days'),
  ('linda-bauer',     'Linda Bauer',             'Mudroom · Mpls',         'precon_in_flight', 28000, '$28k',    'Referral',     false, NULL,          NULL,   now() - interval '21 days'),
  ('erik-holmstrom',  'Erik Holmstrom',          'Front porch · Edina',    'phase1_sent',      32000, '$32k',    'Site form',    true,  'Cooling',     'flag', now() - interval '9 days'),
  ('gabe-reyes',      'Gabe Reyes (referral)',   'Master bath · Mpls',     'formal_proposal',  41000, '$41k',    'Referral',     false, NULL,          NULL,   now() - interval '15 days'),
  ('n-sandberg',      'N. Sandberg',             'Built-ins · Edina',      'precon_signed',    14000, '$14k',    'Manual entry', false, NULL,          NULL,   now() - interval '11 days');

-- ─── Projects ───────────────────────────────────────────────────────────────
INSERT INTO projects (slug, name, status, client_name, contract_value, value_display, collected_to_date, progress, sub_label, stage_label) VALUES
  ('henderson', 'Henderson kitchen',   'active',          'Tom & Kate Henderson', 58400, '$58,400',       35040, 60, 'Edina · day 74 of ~92',    'Tile phase'),
  ('reyes',     'Reyes bath',          'active',          'Gabe Reyes',           18500, '$18,500',        6475, 35, 'Mpls · day 22',            'Drywall'),
  ('olson',     'Olson porch',         'closeout',        'Diane Olson',          22000, '$22,000',       19800, 90, 'Edina · client walk Tues', 'Punch list'),
  ('bauer',     'Bauer mudroom',       'pre_construction','Linda Bauer',          28000, '$28,000 (est)',     0,  0, 'Mpls · selections phase',  '6/24 selected'),
  ('sandberg',  'Sandberg built-ins',  'pre_construction','N. Sandberg',          14000, '$14,000 (est)',     0,  0, 'Edina · site visit done',  'Awaiting selections');

-- ─── Subcontractors ─────────────────────────────────────────────────────────
INSERT INTO subs (slug, name, trade, rate, fav, open_jobs, jobs_count, rating, coi_status, coi_expires_at) VALUES
  ('marco',  'Marco Rivas',         'Tile · stone', '$60/hr',   true,  1, 14, 5, 'current',  DATE '2026-08-14'),
  ('tomas',  'Tomas Sanchez',       'Electric',     '$72/hr',   true,  2, 22, 5, 'current',  DATE '2026-10-03'),
  ('brad',   'Brad Petersen',       'Paint',        '$48/hr',   false, 1, 18, 4, 'current',  DATE '2026-08-14'),
  ('jen',    'Jen Doyle Plumbing',  'Plumbing',     '$85/hr',   false, 0,  8, 5, 'current',  DATE '2026-07-22'),
  ('kris',   'Kris Rajan',          'Framing',      '$58/hr',   false, 0,  9, 4, 'current',  DATE '2026-11-11'),
  ('rivera', 'Rivera HVAC',         'HVAC',         'lump sum', false, 0,  4, 4, 'current',  DATE '2026-09-01'),
  ('carl',   'Carl Lund',           'Tile',         '$55/hr',   false, 0,  3, 3, 'expiring', CURRENT_DATE + interval '5 days'),
  ('falk',   'Falk Floors',         'Flooring',     'sq ft',    false, 0,  6, 4, 'current',  DATE '2026-12-08');

-- ─── Notifications ──────────────────────────────────────────────────────────
-- created_at offsets preserve the intended feed order (newest/urgent first).
INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href, created_at) VALUES
  ('decision','Decision','flag', 'money',  'Reyes invoice hits Day 15 today — send demand letter?', 'Draft ready · $4,800 outstanding',          'Just now', true,  '/projects/reyes-bath',       now() - interval '0 hour'),
  ('decision','Decision','flag', 'mail',   'Reply to Maria Chen (Phase 1 lead)',                    'Quartz alternate draft ready',              '5h 12m',   true,  '/inbox',                     now() - interval '1 hour'),
  ('decision','Decision','flag', 'star',   'Sandberg warranty claim · ack deadline Fri',            'Cabinet hinge · reply drafted',             '4 hrs',    true,  '/warranty',                  now() - interval '2 hour'),
  ('mention', 'Mention', 'ai',   'chat',   '@claude posted in #henderson-kitchen',                  'Pinned QC checklist + Friday flatness photo','6 hrs',    false, '/chat',                      now() - interval '3 hour'),
  ('job',     'Job',     'accent','project','Henderson tile install starts in 4h',                   'Marco on the way · materials verified on site','8 hrs',  false, '/projects/henderson-kitchen',now() - interval '4 hour'),
  ('money',   'Money',   'money', 'money',  'Olson final · $8,200 cleared',                          'Stripe → SJC Operating · auto-marked paid', 'Yesterday',false, '/projects/olson-porch',      now() - interval '5 hour'),
  ('job',     'Intake',  'ghost', 'site',   'New site form · A. Cole · basement bar',                '5-question reply queued',                   'Sat 4:12p',false, '/leads/a-cole',              now() - interval '6 hour'),
  ('compliance','Compliance','flag','shield','Carl Lund COI expires Jun 1',                          'AI auto-requested renewal',                 'Sat',      true,  '/compliance',                now() - interval '7 hour');

-- ─── Compliance items ───────────────────────────────────────────────────────
INSERT INTO compliance_items (title, kind, due_date, who, step, dot) VALUES
  ('Carl Lund · COI expires',         'coi',       DATE '2026-06-01', 'AI requesting renewal', 'Send reminder + receive doc',                'flag'),
  ('IRS CP2100 mismatch · respond',   'tax',       DATE '2026-06-15', 'Joe + Dani',            'Draft response ready · review',              'flag'),
  ('Q2 estimated tax (MN + Fed)',     'tax',       DATE '2026-06-17', 'Dani · QuickBooks',     'Auto-pull payments',                         'ghost'),
  ('Auto policy renewal',             'insurance', DATE '2026-06-28', 'State Farm',            'Verify additional insured stays on policy',  'ghost'),
  ('Q2 sales tax filing',             'tax',       DATE '2026-07-31', 'Dani',                  'P&L close runs Jul 26',                      'ghost'),
  ('Marco + Brad COI',                'coi',       DATE '2026-08-14', 'AI auto-requests Jul 14','—',                                          'ghost'),
  ('MN contractor license · renewal', 'license',   DATE '2026-09-30', 'Joe',                   '$200 fee · CE hours TBD',                    'accent'),
  ('1099 issue (all subs > $600)',    'tax',       DATE '2027-01-31', 'AI prep · Dani files',  '8 subs expected',                            'ghost');

-- ─── Warranty: closed projects under warranty ──────────────────────────────
INSERT INTO warranty_projects (project, client, closed_at, warranty_label, warranty_ends_at, flag) VALUES
  ('Olson porch',       'Diane Olson', DATE '2026-05-22', '1 yr · ends May 23 2027', DATE '2027-05-23', NULL),
  ('Sandberg built-ins','N. Sandberg', DATE '2026-03-14', '1 yr · ends Mar 14 2027', DATE '2027-03-14', 'open claim'),
  ('Bauer roof line',   'L. Bauer',    DATE '2026-02-22', '1 yr · ends Feb 22 2027', DATE '2027-02-22', NULL),
  ('Reyes prior bath',  'G. Reyes',    DATE '2026-02-08', '1 yr · ends Feb 8 2027',  DATE '2027-02-08', NULL),
  ('Knutsen mudroom',   'P. Knutsen',  DATE '2026-01-28', '1 yr · ends Jan 28 2027', DATE '2027-01-28', NULL),
  ('Mendez kitchen',    'A. Mendez',   DATE '2025-12-14', '2 yr · structural',       NULL,              NULL);

-- ─── Warranty: active claims ────────────────────────────────────────────────
INSERT INTO warranty_claims (project, client, issue, age_label, deadline_label, step, dot, opened_at) VALUES
  ('Sandberg built-ins', 'N. Sandberg', 'Cabinet hinge loose · soft-close failing on 1 door', '4 hrs', '5d ack · Fri', 'Reply drafted · Marco prepped', 'accent', now() - interval '4 hour');

-- ─── Schedule: timeblocks for the current week (Mon–Fri) ────────────────────
-- block_date is computed off date_trunc('week', CURRENT_DATE) (= Monday) so the
-- view always lands on "this week".
INSERT INTO schedule_blocks (block_date, time_label, sort_min, label, tone) VALUES
  (date_trunc('week', CURRENT_DATE)::date,                  '8:00',  480, 'Sub check-ins',            'ghost'),
  (date_trunc('week', CURRENT_DATE)::date,                  '12:45', 765, 'QC walk · Henderson',      'accent'),
  (date_trunc('week', CURRENT_DATE)::date,                  '1:00',  780, 'Tile · Marco · Henderson', 'accent'),
  (date_trunc('week', CURRENT_DATE)::date,                  '3:30',  930, 'New lead call · Pham',     'ai'),
  (date_trunc('week', CURRENT_DATE)::date + 1,              '8:00',  480, 'Tile day 2 · Marco',       'accent'),
  (date_trunc('week', CURRENT_DATE)::date + 1,              '9:00',  540, 'Chen site walk',           'ai'),
  (date_trunc('week', CURRENT_DATE)::date + 1,              '4:00',  960, 'Olson client walk',        'ai'),
  (date_trunc('week', CURRENT_DATE)::date + 2,              '8:00',  480, 'Grout · Henderson',        'accent'),
  (date_trunc('week', CURRENT_DATE)::date + 2,              '10:00', 600, 'Reyes drywall day 3',      'ghost'),
  (date_trunc('week', CURRENT_DATE)::date + 3,              'all',   0,   'Reyes paint',              'ghost'),
  (date_trunc('week', CURRENT_DATE)::date + 4,              'AM',    480, 'Plumbing fixtures · Tomas','ghost'),
  (date_trunc('week', CURRENT_DATE)::date + 4,              'PM',    720, 'Weekly close + invoice',   'ai');

-- ─── Schedule: today's daily log (one logged day) ───────────────────────────
INSERT INTO daily_logs (log_date, body, photos) VALUES
  (CURRENT_DATE, 'Tile underway in the main bath — Marco set the field by 3pm, niche tomorrow. QC walk flagged one soft spot at the threshold; subfloor screwed off and re-checked flat.', 3);

-- ─── Files: Henderson project folder ────────────────────────────────────────
INSERT INTO files (id, project_key, type, name, tag, ai_origin, modified_label, size_label, subtitle, ai_tags, sort) VALUES
  ('contract',        'Henderson', 'doc',    'Signed contract.pdf',              'CONTRACT',   false, 'Mar 8',  '480 KB', 'Henderson kitchen · v3 final',          ARRAY['Contract','$58,400','5 milestones','Edina'], 1),
  ('sow',             'Henderson', 'doc',    'SOW v3 — final.docx',              'SCOPE',      false, 'Apr 30', '92 KB',  NULL,                                    '{}', 2),
  ('estimate',        'Henderson', 'doc',    'Estimate · v1.pdf',                'ESTIMATE',   false, 'Mar 6',  '1.1 MB', NULL,                                    '{}', 3),
  ('selections',      'Henderson', 'doc',    'Selections — final.xlsx',          'SELECTIONS', false, 'Apr 18', '88 KB',  NULL,                                    '{}', 4),
  ('floorplan',       'Henderson', 'img',    'Floor plan v3.pdf',                'DRAWING',    false, 'Mar 4',  '2.3 MB', NULL,                                    '{}', 5),
  ('render',          'Henderson', 'img',    '3D rendering.png',                 'RENDER',     false, 'Mar 4',  '4.8 MB', NULL,                                    '{}', 6),
  ('photos-before',   'Henderson', 'folder', 'Photos / before',                  '14 photos',  false, 'Mar 12', '—',      NULL,                                    '{}', 7),
  ('photos-progress', 'Henderson', 'folder', 'Photos / progress',                '62 photos',  false, 'May 22', '—',      NULL,                                    '{}', 8),
  ('sub-paperwork',   'Henderson', 'folder', 'Sub paperwork',                    'MARCO · TOMAS · BRAD', false, 'Apr 12', '—', NULL,                               '{}', 9),
  ('co-001',          'Henderson', 'doc',    'CO-001 · soft close hinges.pdf',   'CO · SIGNED',false, 'Mar 28', '64 KB',  NULL,                                    '{}', 10),
  ('co-002',          'Henderson', 'doc',    'CO-002 · island vent grate.pdf',   'CO · SIGNED',false, 'Apr 21', '52 KB',  NULL,                                    '{}', 11),
  ('demand',          'Henderson', 'doc',    'Demand letter · template fill.pdf','AI · DRAFT', true,  'Today',  '88 KB',  'Reyes bath · Day 15 · drafted by Claude', ARRAY['Demand letter','$4,800','Day 15','Reyes'], 12);

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

COMMIT;
