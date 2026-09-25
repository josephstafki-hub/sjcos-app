-- 0009 — Delegated approvals, employee accounts, business-agent profiles and
-- usage metering (A22, A08a, A08b). Additive only. See
-- docs/automation-reliability/status/A22.md and lib/authority/*.
--
-- authority_grants (0001) already carries the per-user / per-action-type /
-- per-project / max-amount shape authorityFor() reads. This migration adds:
--   • the audit + revocation records around it (permission_audit,
--     session_revocations, users.last_permission_change_at, users.ai_scope);
--   • the run profile + acting person on dev_agent_runs so the runner and the
--     MCP layer can scope a run to the staff member who started it;
--   • agent_usage — one metering row per run for budgets/thresholds.

-- ── Users: AI scope + last permission change ───────────────────────────────
-- ai_scope: {"agents": ["claude","hermes","qwen"], "tools": "business"|"none"}.
-- An empty object = the catalog default (business profile, every agent).
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_scope jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_permission_change_at timestamptz;

-- ── Session revocations ────────────────────────────────────────────────────
-- A JWT minted (iat / authAt claim) BEFORE revoked_before is refused by
-- lib/dal.ts getCurrentUser and lib/api-auth.ts getUserFromRequest, so a
-- permission change or an explicit "sign them out everywhere" bites without
-- waiting for the cookie to expire. One row per revocation event; the newest
-- revoked_before per user is what the check reads.
CREATE TABLE IF NOT EXISTS session_revocations (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_before timestamptz NOT NULL DEFAULT now(),
  reason         text NOT NULL DEFAULT '',
  revoked_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_revocations_user ON session_revocations(user_id, revoked_before DESC);

-- ── Permission audit ───────────────────────────────────────────────────────
-- Every authority grant/revoke, area change, AI-scope change and session
-- revocation lands here: who did it, to whom, what changed. Append-only.
CREATE TABLE IF NOT EXISTS permission_audit (
  id              bigserial PRIMARY KEY,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label     text NOT NULL DEFAULT '',
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  change          text NOT NULL,            -- authority.grant / authority.revoke / areas.set / ai_scope.set / sessions.revoke / account.active
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  command_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permission_audit_subject ON permission_audit(subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permission_audit_created ON permission_audit(created_at DESC);

-- authority_grants: the action_type must be a catalog kind (lib/authority/
-- catalog.ts); '*' is refused at the table so no caller can mint a blanket
-- approval. Kept as a CHECK on the value shape, not a FK, so the catalog can
-- grow without a migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'authority_grants'::regclass AND conname = 'authority_grants_action_type_check'
  ) THEN
    ALTER TABLE authority_grants ADD CONSTRAINT authority_grants_action_type_check
      CHECK (action_type <> '*' AND action_type ~ '^[a-z][a-z0-9_]{1,63}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'authority_grants'::regclass AND conname = 'authority_grants_max_amount_check'
  ) THEN
    ALTER TABLE authority_grants ADD CONSTRAINT authority_grants_max_amount_check
      CHECK (max_amount_cents IS NULL OR max_amount_cents > 0);
  END IF;
END $$;

-- ── Agent runs: profile + acting person ────────────────────────────────────
-- profile: 'operator' = Joe's full in-app operator (repo edit access) —
-- ONLY when the starting user is the owner; 'business' = sjcos tools only,
-- no Bash/Write/Edit/WebFetch, cwd = scratch dir, finite turn/time limits
-- (the default for staff-started and unattended runs).
-- principal_user_id: the person the run acts for (NULL = unattended).
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'business';
ALTER TABLE dev_agent_runs ADD COLUMN IF NOT EXISTS principal_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'dev_agent_runs'::regclass AND conname = 'dev_agent_runs_profile_check'
  ) THEN
    ALTER TABLE dev_agent_runs ADD CONSTRAINT dev_agent_runs_profile_check CHECK (profile IN ('operator','business'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dev_agent_runs_principal ON dev_agent_runs(principal_user_id, created_at DESC);

-- ── Agent usage metering ───────────────────────────────────────────────────
-- One row per finished run (any runtime). Thresholds live in app_settings:
--   agent.max_cost_per_run_usd   — business runs get --max-budget-usd; owner runs are warned
--   agent.max_runs_per_hour      — business runs are refused past this; owner runs are warned
CREATE TABLE IF NOT EXISTS agent_usage (
  id                bigserial PRIMARY KEY,
  run_id            uuid REFERENCES dev_agent_runs(id) ON DELETE SET NULL,
  runtime           text NOT NULL,            -- claude-cli / hermes / qwen / business-agent-worker
  model             text,
  profile           text NOT NULL DEFAULT 'business',
  principal_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  tokens_in         bigint,
  tokens_out        bigint,
  cost_usd          numeric(12,6),
  duration_ms       integer,
  num_turns         integer,
  outcome           text NOT NULL DEFAULT 'done',   -- done / error / stopped / timeout / turn_cap / budget_cap / revoked
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_created ON agent_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_usage_principal ON agent_usage(principal_user_id, created_at DESC);
