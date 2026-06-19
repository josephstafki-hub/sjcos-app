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
         invoices, retainers
         RESTART IDENTITY CASCADE;

-- ─── Leads ──────────────────────────────────────────────────────────────────
INSERT INTO leads (slug, name, scope, stage, estimate_value, value_display, source, hot, flag_label, flag_kind, email, phone, last_contact_at) VALUES
  ('maria-chen',      'Maria & David Chen',      'Kitchen reno · Edina',   'rough_estimate',   54000, '$49–60k', 'Site form',    true,  'Needs reply', 'flag', 'maria.chen@gmail.example',   '(612) 555-0148', now() - interval '6 days'),
  ('anh-pham',        'Anh Pham',                'Bath reno · St Paul',    'qualified',        22000, '$22k',    'Site form',    false, NULL,          NULL,   'anh.pham@gmail.example',     '(651) 555-0173', now() - interval '2 days'),
  ('a-cole',          'A. Cole',                 'Basement bar · Mpls',    'intake',           NULL,  '?',       'Site form',    false, 'New',         'ai',   'acole@gmail.example',        '(612) 555-0119', now() - interval '4 days'),
  ('linda-bauer',     'Linda Bauer',             'Mudroom · Mpls',         'precon_signed',    28000, '$28k',    'Referral',     false, NULL,          NULL,   'lbauer@gmail.example',       '(612) 555-0186', now() - interval '21 days'),
  ('erik-holmstrom',  'Erik Holmstrom',          'Front porch · Edina',    'discovery_call',   32000, '$32k',    'Site form',    true,  'Cooling',     'flag', 'erik.holmstrom@gmail.example','(952) 555-0140', now() - interval '9 days'),
  ('gabe-reyes',      'Gabe Reyes (referral)',   'Master bath · Mpls',     'rough_estimate',   41000, '$41k',    'Referral',     false, NULL,          NULL,   'gabe.reyes@gmail.example',   '(612) 555-0162', now() - interval '15 days'),
  ('n-sandberg',      'N. Sandberg',             'Built-ins · Edina',      'precon_signed',    14000, '$14k',    'Manual entry', false, NULL,          NULL,   'nsandberg@gmail.example',    '(952) 555-0155', now() - interval '11 days');

-- Lead intake answers — maria-chen has the full 5-question intake.
INSERT INTO lead_intake (lead_id, sort_order, question, answer)
SELECT leads.id, v.sort_order, v.question, v.answer
FROM leads, (VALUES
  (1, 'Scope', 'Full kitchen reno — cabinets, counters, backsplash, flooring, recessed lighting'),
  (2, 'Timeline', 'Hoping to start late June, done before Thanksgiving'),
  (3, 'Budget', '$45,000 – $55,000'),
  (4, 'Address', '4218 Hillcrest Ave, Edina MN'),
  (5, 'Other bids?', 'Yes — 2 others (one is Smith Bros)')
) AS v(sort_order, question, answer)
WHERE leads.slug = 'maria-chen';

-- Lead rough estimate — maria-chen (Qwen-drafted, already emailed).
INSERT INTO lead_estimates (lead_id, notes, line_items, total, status, sent_at)
SELECT leads.id,
  'Full gut kitchen; mid-tier shaker cabinets, Calacatta quartz, LVP floor. Two competing bids — keep the range tight.',
  '[{"label":"Demo + prep","value":"$3,200"},{"label":"Cabinetry (mid-tier)","value":"$14,500 – $18,500"},{"label":"Counters (Calacatta)","value":"$8,200 – $11,000"},{"label":"Backsplash + tile","value":"$3,400 – $4,800"},{"label":"Flooring (LVP)","value":"$4,200 – $5,400"},{"label":"Electrical + light","value":"$3,800"},{"label":"Labor + GC + sub","value":"$12,000 – $14,000"}]'::jsonb,
  '$49,300 – $60,700', 'sent', now() - interval '5 days'
FROM leads WHERE leads.slug = 'maria-chen';

-- Lead activity — a 'created' event for every lead, plus a richer trail on maria.
INSERT INTO lead_activity (lead_id, kind, summary, actor, created_at)
SELECT id, 'created', 'Lead created · ' || COALESCE(source, 'Manual entry'), 'Joe', created_at
FROM leads;

INSERT INTO lead_activity (lead_id, kind, summary, actor, created_at)
SELECT leads.id, v.kind, v.summary, v.actor, now() - v.off
FROM leads, (VALUES
  ('stage',    'Moved to Qualified',                              'Joe',  interval '5 days 8 hours'),
  ('stage',    'Moved to Discovery call',                         'Joe',  interval '5 days 2 hours'),
  ('estimate', 'Rough estimate drafted by Qwen ($49.3k–$60.7k)',  'Qwen', interval '5 days'),
  ('email',    'Rough estimate emailed to Maria',                 'Joe',  interval '5 days'),
  ('stage',    'Moved to Rough estimate',                         'Joe',  interval '4 days')
) AS v(kind, summary, actor, off)
WHERE leads.slug = 'maria-chen';

-- ─── Projects ───────────────────────────────────────────────────────────────
INSERT INTO projects (slug, name, status, client_name, contract_value, value_display, collected_to_date, progress, sub_label, stage_label) VALUES
  ('henderson', 'Henderson kitchen',   'construction',          'Tom & Kate Henderson', 58400, '$58,400',       35040, 60, 'Edina · day 74 of ~92',    'Tile phase'),
  ('reyes',     'Reyes bath',          'construction',          'Gabe Reyes',           18500, '$18,500',        6475, 35, 'Mpls · day 22',            'Drywall'),
  ('olson',     'Olson porch',         'closeout',              'Diane Olson',          22000, '$22,000',       19800, 90, 'Edina · client walk Tues', 'Punch list'),
  ('bauer',     'Bauer mudroom',       'selections',            'Linda Bauer',          28000, '$28,000 (est)',     0,  0, 'Mpls · selections phase',  '6/24 selected'),
  ('sandberg',  'Sandberg built-ins',  'mood_board',            'N. Sandberg',          14000, '$14,000 (est)',     0,  0, 'Edina · mood board',       'Awaiting selections');

-- ─── Subcontractors ─────────────────────────────────────────────────────────
INSERT INTO subs (slug, name, trade, rate, fav, open_jobs, jobs_count, rating, coi_status, coi_expires_at, email, phone) VALUES
  ('marco',  'Marco Rivas',         'Tile · stone', '$60/hr',   true,  1, 14, 5, 'current',  DATE '2026-08-14', 'marco@rivastile.example',        '(612) 555-0102'),
  ('tomas',  'Tomas Sanchez',       'Electric',     '$72/hr',   true,  2, 22, 5, 'current',  DATE '2026-10-03', 'tomas@sanchezelectric.example',  '(612) 555-0124'),
  ('brad',   'Brad Petersen',       'Paint',        '$48/hr',   false, 1, 18, 4, 'current',  DATE '2026-08-14', 'brad@petersenpaint.example',     '(612) 555-0138'),
  ('jen',    'Jen Doyle Plumbing',  'Plumbing',     '$85/hr',   false, 0,  8, 5, 'current',  DATE '2026-07-22', 'jen@doyleplumbing.example',      '(651) 555-0166'),
  ('kris',   'Kris Rajan',          'Framing',      '$58/hr',   false, 0,  9, 4, 'current',  DATE '2026-11-11', 'kris@rajanframing.example',      '(612) 555-0171'),
  ('rivera', 'Rivera HVAC',         'HVAC',         'lump sum', false, 0,  4, 4, 'current',  DATE '2026-09-01', 'ops@riverahvac.example',         '(952) 555-0188'),
  ('carl',   'Carl Lund',           'Tile',         '$55/hr',   false, 0,  3, 3, 'expiring', CURRENT_DATE + interval '5 days', 'carl.lund@gmail.example', '(612) 555-0193'),
  ('falk',   'Falk Floors',         'Flooring',     'sq ft',    false, 0,  6, 4, 'current',  DATE '2026-12-08', 'hello@falkfloors.example',       '(651) 555-0149');

UPDATE subs SET notes = 'Preferred tile sub — first call for marble/zellige. Slightly slower on backsplash tear-out, build that into the schedule. Bills lump-sum on jobs over ~60 hrs.' WHERE slug = 'marco';
UPDATE subs SET notes = 'Reliable, fast on rough-in. Books up — give 2+ weeks notice for anything beyond a service call.' WHERE slug = 'tomas';

-- ─── Notifications ──────────────────────────────────────────────────────────
-- created_at offsets preserve the intended feed order (newest/urgent first).
INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href, created_at) VALUES
  ('decision','Decision','flag', 'money',  'Reyes invoice hits Day 15 today — send demand letter?', 'Draft ready · $4,800 outstanding',          'Just now', true,  '/projects/reyes',       now() - interval '0 hour'),
  ('decision','Decision','flag', 'mail',   'Reply to Maria Chen (Phase 1 lead)',                    'Quartz alternate draft ready',              '5h 12m',   true,  '/inbox',                     now() - interval '1 hour'),
  ('decision','Decision','flag', 'star',   'Sandberg warranty claim · ack deadline Fri',            'Cabinet hinge · reply drafted',             '4 hrs',    true,  '/warranty',                  now() - interval '2 hour'),
  ('mention', 'Mention', 'ai',   'chat',   '@claude posted in #henderson-kitchen',                  'Pinned QC checklist + Friday flatness photo','6 hrs',    false, '/chat',                      now() - interval '3 hour'),
  ('job',     'Job',     'accent','project','Henderson tile install starts in 4h',                   'Marco on the way · materials verified on site','8 hrs',  false, '/projects/henderson',now() - interval '4 hour'),
  ('money',   'Money',   'money', 'money',  'Olson final · $8,200 cleared',                          'Stripe → SJC Operating · auto-marked paid', 'Yesterday',false, '/projects/olson',      now() - interval '5 hour'),
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

-- ─── Users / auth (demo accounts) ───────────────────────────────────────────
-- All seeded with the demo password "sjcos" (scrypt, salt:hash). Owner is Joe;
-- sub/client accounts link to subs.slug / projects.slug to scope the portals.
-- SYNTHETIC credentials — rotate before any real deployment.
INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES
  ('josephstafki@sjcarpentryllc.com', '40676a86efbd86836c89a27ef60bb454:5ef3dfb212f1dbd1aaa746f37e245d9d3c0b160f8e0ac3a2a681ad3d66dda4c5d2494df8f38b1c3eff9ebe7b2b387ddfb034ed6ece57bc84ee9dffcb50f03b8b', 'Joe Stafki',      'owner',  'JS', NULL),
  ('marco@trade.demo',                 '7b0fde8bb853a839033153bdeaa36f85:13a5b94d59ae067395c377f3602a18bd1fcb0a304bd3d285596a96ddd2b19d32bf37ce1e3e3642cd266ce14a5133eea46c3c549d84ecd6d28f761a4a3ba1a04b', 'Marco Ruiz',      'sub',    'MR', 'marco'),
  ('tomas@trade.demo',                 'c1ecbe91601cd65169760ecdd5ccb26e:13bf853d514195961b84b2f7ced4923c326c383b305ad91e2bd44c4389521062bdcc4d0a9600372816449b823fa373bb5685c9b040de181adde4b98bfd49b2c8', 'Tomas Silva',     'sub',    'TS', 'tomas'),
  ('henderson@client.demo',            '2d3bf6e4e58f765b030d9ff3ad872e90:42e5321e91427191cc385489d0287e5f51ffa12e5392baab39dda1f0bf9d1ab40bd9d7b79a3c5b4743c174c75439388fa662f2ea9b135f1f6b09b785b760ddef', 'Kate Henderson',  'client', 'KH', 'henderson');

-- ─── Team chat ──────────────────────────────────────────────────────────────
INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body, created_at) VALUES
  ('field-daily','user','Marco','MR','On Henderson at 12:30 — bringing the 1/4 trowel for the mosaic strip. Need the access code again?', now() - interval '240 min'),
  ('field-daily','owner','Joe','JS','Code is 4429. I''ll be on site at noon for the QC walk.', now() - interval '237 min'),
  ('field-daily','ai','Claude','CL','Pinned to #henderson-kitchen: tile pre-install QC checklist + Friday flatness photo. Marco — that soft spot at the pantry threshold is your watch-out.', now() - interval '226 min'),
  ('field-daily','user','Tomas','TS','Pham bid sent. Let me know if you want me to walk Joe through the load calc.', now() - interval '214 min'),
  ('field-daily','owner','Joe','JS','@claude what''s outstanding on Olson for the Tues walk?', now() - interval '196 min'),
  ('field-daily','ai','Claude','CL','4 punch items remain — all minor. Paint touch-up by Brad (Mon EOD), trim caulk SW corner, replace one cabinet pull (back-ordered, ETA Tues AM), check vent dampener.', now() - interval '196 min'),
  ('selections','user','Dani','DH','Chen picked the Calacatta quartz — sending the slab photo now.', now() - interval '90 min'),
  ('selections','user','Marco','MR','Got it, I''ll template Thursday once the slab is on site.', now() - interval '75 min'),
  ('marketing-queue','ai','Claude','CL','3 social posts drafted from the Olson closeout photos — captions + crops ready for your approval.', now() - interval '120 min'),
  ('marketing-queue','user','Dani','DH','The before/after on the porch is great — let''s push that one first.', now() - interval '60 min'),
  ('marketing-queue','ai','Claude','CL','Queued. I''ll publish on approval and add it to the newsletter draft.', now() - interval '55 min'),
  -- Direct messages (channel_key = dm:<sub-slug>): one-to-one with a sub.
  ('dm:marco','owner','Joe','JS','Marco — can you template the Henderson backsplash Thursday or Friday this week?', now() - interval '180 min'),
  ('dm:marco','user','Marco','MR','Thursday works. I''ll bring the laser and the schluter samples so we can lock the edge profile.', now() - interval '168 min'),
  ('dm:marco','owner','Joe','JS','Perfect. Slab should be on site by then.', now() - interval '165 min'),
  ('dm:marco','user','Marco','MR','Sounds good — text me the gate code morning of.', now() - interval '40 min'),
  ('dm:tomas','owner','Joe','JS','Tomas, did the Pham load calc come back ok for the new range circuit?', now() - interval '95 min'),
  ('dm:tomas','user','Tomas','TS','Yep, 50A is fine on the existing panel. I''ll pull the permit this week.', now() - interval '88 min');

INSERT INTO chat_reads (channel_key, last_read_at) VALUES ('field-daily', now());

-- Channel membership (subs only; owner + AI are implicit).
INSERT INTO chat_members (channel_key, sub_slug) VALUES
  ('field-daily','marco'), ('field-daily','tomas'), ('field-daily','brad'),
  ('selections','marco'),
  ('safety','kris'),
  ('henderson-kitchen','marco'), ('henderson-kitchen','tomas'),
  ('olson-porch','brad'),
  ('reyes-bath','jen');

-- ─── Material catalog ────────────────────────────────────────────────────────
INSERT INTO catalog_items (name, supplier, sku, category, use_label, price) VALUES
  ('Calacatta marble · slab',      'Cambria stoneyards', 'CAL-SLB-3CM', 'Counters', '4 projects',  '$185 / sq ft'),
  ('Cambria Brittanicca · quartz', 'Cambria stoneyards', 'CAM-BRI-3CM', 'Counters', '6 projects',  '$95 / sq ft'),
  ('Shaker maple base · 36"',      'Twin Cities Cab Co', 'SHK-MAP-B36', 'Cabinets', '12 projects', '$420'),
  ('Zellige · honey · 2×8',        'Cle Tile',           'CLE-ZEL-H28', 'Tile',     '3 projects',  '$24 / sq ft'),
  ('White oak LVP · 7"',           'Falk Floors',        'FLK-WO7',     'Flooring', '8 projects',  '$5.20 / sq ft'),
  ('Brass bar pull · 4"',          'Schoolhouse',        'SCH-BBP-4',   'Hardware', '6 projects',  '$22'),
  ('Kohler farmhouse 30"',         'Ferguson',           'KOH-FH30',    'Plumbing', '4 projects',  '$780'),
  ('Sconce · brass · linen shade', 'Schoolhouse',        'SCH-SC-L',    'Lighting', '5 projects',  '$220');

-- ─── Money: invoices + retainer (Henderson showcase, from draw milestones) ───
INSERT INTO invoices (project_id, number, milestone, amount, line_items, status, sent_at, paid_at)
SELECT p.id, v.number, v.milestone, v.amount, v.line_items::jsonb, v.status, v.sent_at, v.paid_at
FROM projects p
JOIN (VALUES
  ('henderson','INV-001','Demo + framing',          11680, '[{"label":"Demo + framing","amount":11680}]',          'paid',  now() - interval '90 days', now() - interval '88 days'),
  ('henderson','INV-002','Cabinets installed',      11680, '[{"label":"Cabinets installed","amount":11680}]',      'paid',  now() - interval '50 days', now() - interval '48 days'),
  ('henderson','INV-003','Tile substrate sign-off', 12400, '[{"label":"Tile substrate sign-off","amount":12400}]', 'sent',  now() - interval '2 days',  NULL),
  ('henderson','INV-004','Final + punch',           10960, '[{"label":"Final + punch","amount":10960}]',           'draft', NULL,                        NULL)
) AS v(slug, number, milestone, amount, line_items, status, sent_at, paid_at)
  ON p.slug = v.slug;

INSERT INTO retainers (project_id, collected, applied)
SELECT id, 11680, 11680 FROM projects WHERE slug = 'henderson';

-- ─── Project punch lists ─────────────────────────────────────────────────────
INSERT INTO project_punch (project_id, item, owner_name, done, sort_order)
SELECT p.id, v.item, v.owner_name, v.done, v.sort_order
FROM projects p
JOIN (VALUES
  ('henderson', 'Replace hairline-damaged pantry door (supplier RMA)', 'Marco', false, 1),
  ('henderson', 'Caulk gap at range-wall cabinet',                     'Joe',   false, 2),
  ('henderson', 'Touch-up paint — island return',                      'Brad',  false, 3),
  ('henderson', 'Verify under-cabinet LED dimming',                    'Tomas', true,  4),
  ('reyes',     'Re-seat wobbly vanity drawer slide',                  'Joe',   false, 1),
  ('reyes',     'Grout haze wipe-down in shower niche',                'Marco', false, 2),
  ('reyes',     'Confirm exhaust fan timer wiring',                    'Tomas', true,  3),
  ('olson',     'Final walkthrough punch with client',                 'Joe',   false, 1),
  ('olson',     'Touch-up porch column paint after rain delay',        'Brad',  true,  2)
) AS v(slug, item, owner_name, done, sort_order)
  ON v.slug = p.slug;

COMMIT;
