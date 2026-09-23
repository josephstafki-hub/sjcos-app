-- 0002 — Stable obligations and protected task state (A01).
-- Additive only. A business obligation ("reply to Larson about the deck
-- railing", "send the Kleven estimate") is its own record, separate from the
-- Gmail thread / SMS thread / call that surfaced it. One thread can carry many
-- obligations; one obligation can span many sources. Stable provider ids
-- (thread id + message id) are the identity — never title text.
-- See docs/automation-reliability/DESIGN.md "Required records and invariants".

-- ── Obligations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS obligations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL DEFAULT 'reply',       -- reply / promise / follow_up / deliverable / review / detector / call_action / other
  title              text NOT NULL,
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','waiting','done','cancelled','review')),
  owner_kind         text NOT NULL DEFAULT 'human'
                       CHECK (owner_kind IN ('human','agent')),
  owner_key          text,                                 -- human-joe / hermes-telegram / claude-code-server / …
  lead_id            uuid REFERENCES leads(id)    ON DELETE SET NULL,
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,
  next_action        text NOT NULL DEFAULT '',
  -- Planned work (when Joe intends to work it). Mirrors the work item's due_at
  -- semantics; NOT a contractual date.
  due_at             timestamptz,
  -- Contractual / financial deadline. Deliberately separate from due_at: the
  -- Today rule snoozes on due_at and must never be driven by a legal date.
  deadline_at        timestamptz,
  deadline_source    text,                                 -- where the deadline came from (contract clause, invoice terms, …)
  -- Why this obligation is considered resolved: { kind, ... } (see
  -- lib/obligations/core.ts ResolutionEvidence). Empty until done.
  resolution         jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at        timestamptz,
  resolved_by        text,
  -- Provider message ids that CREATED or re-opened this obligation. A new
  -- message id in an old thread that is not in any obligation's list is a new
  -- obligation, not a bump of the old one.
  source_message_ids text[] NOT NULL DEFAULT '{}'::text[],
  review_reason      text,                                 -- set when status = 'review'
  created_by         text NOT NULL DEFAULT 'system',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_obligations_open    ON obligations(status, updated_at DESC) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_obligations_lead    ON obligations(lead_id)    WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obligations_project ON obligations(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obligations_deadline ON obligations(deadline_at) WHERE deadline_at IS NOT NULL AND status NOT IN ('done','cancelled');

-- ── Obligation sources: many sources per obligation, many obligations per
--    source thread. (provider, thread_id, message_id, role) is unique per
--    obligation so replaying the same message never double-attaches. ─────────
CREATE TABLE IF NOT EXISTS obligation_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  provider      text NOT NULL,                              -- gmail / sms / call / detector / portal / manual / …
  account       text NOT NULL DEFAULT '',                   -- mailbox / number; part of identity across accounts
  thread_id     text,                                       -- provider thread id (Gmail threadId, sms_threads.id, …)
  message_id    text,                                       -- provider message id (Gmail message id, sms_messages.id, …)
  role          text NOT NULL DEFAULT 'origin'
                  CHECK (role IN ('origin','reply','evidence','reference')),
  occurred_at   timestamptz,
  summary       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obligation_id, provider, account, thread_id, message_id, role)
);
CREATE INDEX IF NOT EXISTS idx_obligation_sources_thread  ON obligation_sources(provider, account, thread_id);
CREATE INDEX IF NOT EXISTS idx_obligation_sources_message ON obligation_sources(provider, account, message_id) WHERE message_id IS NOT NULL;

-- ── Work items carry the obligation they execute. Nullable: manual to-dos and
--    runbook steps have no obligation. ──────────────────────────────────────
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS obligation_id uuid REFERENCES obligations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_obligation ON work_items(obligation_id) WHERE obligation_id IS NOT NULL;

-- Scan-absence review flag (replaces the old 14-day auto-cancel in
-- lib/reminders.ts). Stamped at most once per item; absence from a scan is
-- never proof of business resolution.
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS scan_review_flagged_at timestamptz;

-- ── Mailbox checkpoints: checkpointed Gmail catch-up. One row per mailbox
--    (+ scope: 'lead-thread-sync', 'inbox-scan', …). The cursor is whatever
--    the provider paginates on (Gmail historyId or an epoch-ms watermark);
--    last_ok_at is stamped only by a completed, writing run so a crash
--    re-covers the window. ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mailbox_checkpoints (
  mailbox      text NOT NULL,                               -- account address
  scope        text NOT NULL DEFAULT 'default',
  cursor       text,                                        -- provider cursor / history id
  watermark_at timestamptz,                                 -- newest message instant fully processed
  last_ok_at   timestamptz,
  last_run_at  timestamptz,
  last_error   text,
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (mailbox, scope)
);
