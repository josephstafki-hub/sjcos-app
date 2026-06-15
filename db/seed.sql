-- SJC OS — demo seed (SYNTHETIC data only; no real client records).
-- Mirrors the curated showcase cast the screens already reference, so the app
-- is identical whether reading mock or DB. Idempotent: truncates then inserts.
-- Apply with:  psql "$DATABASE_URL" -f db/seed.sql
--
-- Dates that should stay "fresh" relative to the demo day are computed from
-- CURRENT_DATE; everything else uses literal dates.

BEGIN;

TRUNCATE leads, projects, subs, threads, notifications, compliance_items RESTART IDENTITY CASCADE;

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

COMMIT;
