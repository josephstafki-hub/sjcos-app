-- 0003 — Transactional runbook engine v2 (A02) + evidence-backed completion
-- contracts (A04). Additive only.
--
--   runbook_definition_versions  immutable snapshot of a runbook's steps; an
--                                instance pins one version at start and reads
--                                it forever (edits to runbook_steps never
--                                alter a live walk).
--   runbook_steps_log            one row per (instance, step_order) — the
--                                UNIQUE key that makes concurrent advance /
--                                repair create a successor exactly once.
--   runbook_wakeups              outbox recorded in the SAME transaction as the
--                                step; delivered after commit by polling
--                                (drainRunbookWakeups in lib/runbook-engine.ts).
--   runbook_repairs              log of every repair pass (dry-run or real).
--   runbook_steps.required_evidence  the step's completion contract
--                                (lib/completion/complete.ts).

-- ── Step completion contract ────────────────────────────────────────────────
ALTER TABLE runbook_steps ADD COLUMN IF NOT EXISTS required_evidence text NOT NULL DEFAULT 'any';
DO $$ BEGIN
  ALTER TABLE runbook_steps ADD CONSTRAINT runbook_steps_required_evidence_check
    CHECK (required_evidence IN ('any','draft','provider_accepted','delivered','business_response','manual','record'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Immutable definition versions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS runbook_definition_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id   uuid REFERENCES runbooks(id) ON DELETE SET NULL,
  runbook_slug text NOT NULL,
  version      integer NOT NULL,
  title        text NOT NULL,
  steps        jsonb NOT NULL,                              -- [{step_order,title,skill_slug,expected_output,requires_approval,assigned_to,required_evidence}]
  checksum     text NOT NULL,                               -- sha256 of canonical steps json
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL DEFAULT 'system',
  UNIQUE (runbook_slug, version),
  UNIQUE (runbook_slug, checksum)
);

-- ── Instance columns ────────────────────────────────────────────────────────
ALTER TABLE runbook_instances ADD COLUMN IF NOT EXISTS definition_version_id uuid REFERENCES runbook_definition_versions(id) ON DELETE SET NULL;
ALTER TABLE runbook_instances ADD COLUMN IF NOT EXISTS policy_version text;
ALTER TABLE runbook_instances ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE runbook_instances ADD COLUMN IF NOT EXISTS repair_state text NOT NULL DEFAULT 'ok';
DO $$ BEGIN
  ALTER TABLE runbook_instances ADD CONSTRAINT runbook_instances_repair_state_check
    CHECK (repair_state IN ('ok','needs_review','repaired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_runbook_instances_repair ON runbook_instances(repair_state) WHERE repair_state <> 'ok';

-- ── Step log: the exactly-once key for step creation ────────────────────────
CREATE TABLE IF NOT EXISTS runbook_steps_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid NOT NULL REFERENCES runbook_instances(id) ON DELETE CASCADE,
  step_order    integer NOT NULL,
  work_item_id  uuid REFERENCES work_items(id) ON DELETE SET NULL,
  created_by    text NOT NULL DEFAULT 'runbook-engine',    -- start / advance / repair / backfill
  evidence      jsonb,                                      -- predecessor evidence recorded when this step was spawned
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, step_order)
);

-- ── Wakeup outbox ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS runbook_wakeups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid NOT NULL REFERENCES runbook_instances(id) ON DELETE CASCADE,
  step_order    integer NOT NULL,
  work_item_id  uuid REFERENCES work_items(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('agent_ping','owner_notify')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_runbook_wakeups_pending ON runbook_wakeups(created_at) WHERE state = 'pending';

-- ── Repair log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS runbook_repairs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  uuid REFERENCES runbook_instances(id) ON DELETE SET NULL,
  step_order   integer,
  action       text NOT NULL,                               -- recreate_step / needs_review / noop
  dry_run      boolean NOT NULL DEFAULT true,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- 1. A version 1 snapshot of every runbook that exists today.
INSERT INTO runbook_definition_versions (runbook_id, runbook_slug, version, title, steps, checksum, created_by)
SELECT r.id, r.slug, 1, r.title,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'step_order', s.step_order,
                  'title', s.title,
                  'skill_slug', s.skill_slug,
                  'expected_output', s.expected_output,
                  'requires_approval', s.requires_human_approval,
                  'assigned_to', s.assigned_to,
                  'required_evidence', s.required_evidence) ORDER BY s.step_order)
           FROM runbook_steps s WHERE s.runbook_id = r.id), '[]'::jsonb),
       encode(sha256(convert_to(COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'step_order', s.step_order,
                  'title', s.title,
                  'skill_slug', s.skill_slug,
                  'expected_output', s.expected_output,
                  'requires_approval', s.requires_human_approval,
                  'assigned_to', s.assigned_to,
                  'required_evidence', s.required_evidence) ORDER BY s.step_order)
           FROM runbook_steps s WHERE s.runbook_id = r.id), '[]'::jsonb)::text, 'UTF8')), 'hex'),
       'migration:0003'
  FROM runbooks r
 WHERE NOT EXISTS (SELECT 1 FROM runbook_definition_versions v WHERE v.runbook_slug = r.slug);

-- 2. Active instances whose runbook still exists pin its version 1. (The
--    definition may have drifted since they started; that is recorded as
--    policy_version 'legacy-pinned-at-0003' so nobody mistakes it for proof.)
UPDATE runbook_instances i
   SET definition_version_id = v.id,
       policy_version = COALESCE(i.policy_version, 'legacy-pinned-at-0003')
  FROM runbook_definition_versions v
 WHERE i.definition_version_id IS NULL
   AND v.runbook_slug = i.runbook_slug AND v.version = 1
   AND i.status NOT IN ('done','cancelled');

-- 3. Active instances whose runbook is gone cannot be pinned: repair state.
UPDATE runbook_instances i
   SET repair_state = 'needs_review',
       blocked_reason = COALESCE(i.blocked_reason, 'runbook definition missing; cannot pin a version')
 WHERE i.definition_version_id IS NULL
   AND i.status NOT IN ('done','cancelled');

-- 4. Step log from the work items the old engine already spawned (earliest
--    row per step), so repair never recreates a step that exists.
INSERT INTO runbook_steps_log (instance_id, step_order, work_item_id, created_by, created_at)
SELECT DISTINCT ON (w.runbook_instance_id, w.runbook_step_order)
       w.runbook_instance_id, w.runbook_step_order, w.id, 'backfill:0003', w.created_at
  FROM work_items w
 WHERE w.runbook_instance_id IS NOT NULL AND w.runbook_step_order IS NOT NULL
 ORDER BY w.runbook_instance_id, w.runbook_step_order, w.created_at ASC
ON CONFLICT (instance_id, step_order) DO NOTHING;
