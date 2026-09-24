-- 0013 — Closeout, warranty follow-through, pinned signed documents and
-- approved marketing (A17, WORKFLOW W12). Additive only; owned by WS-field.

-- ── Closeout checklist, one row per phase ────────────────────────────────────
CREATE TABLE IF NOT EXISTS closeout_checklists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase         text NOT NULL CHECK (phase IN ('internal_inspection','corrections','client_walkthrough','client_punch','signoff','final_invoice','post_project')),
  -- [{ key, label, state: open|corrected|resolved|done, evidence: { report_ids[], photo_ids[] }, source }]
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','confirmed','blocked')),
  blocked_reason text,
  scheduled_for timestamptz,                    -- client_walkthrough: the appointment
  confirmed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, phase)
);

-- ── Written client sign-off (doc_type 'completion') ──────────────────────────
CREATE TABLE IF NOT EXISTS client_signoffs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  signature_request_id  bigint NOT NULL REFERENCES signature_requests(id) ON DELETE RESTRICT,
  signed_at             timestamptz NOT NULL,
  content_hash          text,
  -- When the final-invoice / post-project hooks ran (exactly once).
  hooks_fired_at        timestamptz,
  hooks_blocked_reason  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id),
  UNIQUE (signature_request_id)
);

-- ── Post-project follow-through (policy postproject.followthrough) ───────────
CREATE TABLE IF NOT EXISTS post_project_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('warranty_docs','review_request','checkin','learning')),
  scheduled_for  timestamptz NOT NULL DEFAULT now(),
  intent_id      uuid REFERENCES action_intents(id) ON DELETE SET NULL,
  decision_id    uuid REFERENCES decisions(id) ON DELETE SET NULL,
  state          text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','queued','pending_decision','done','skipped','not_configured','issue_reported')),
  note           text NOT NULL DEFAULT '',
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_post_project_due ON post_project_actions(scheduled_for) WHERE state = 'scheduled';

-- Closeout actuals handed to WS-estimating; a late adjustment is a new
-- revision (never a second ingestion of the same numbers).
CREATE TABLE IF NOT EXISTS closeout_actuals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision      integer NOT NULL,
  actuals       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { materials_cents, subs_cents, owner_hours: {category: hours}, notes }
  reason        text NOT NULL DEFAULT '',
  ingested_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision)
);

-- ── Publication rights (marketing) — portal visibility is NOT a right ────────
CREATE TABLE IF NOT EXISTS publication_rights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  granted_by    text NOT NULL DEFAULT '',       -- who gave permission (client name / owner)
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  scope         text[] NOT NULL DEFAULT '{social,website}'::text[],
  note          text NOT NULL DEFAULT '',
  granted_at    timestamptz NOT NULL DEFAULT now(),
  withdrawn_at  timestamptz,
  withdrawn_reason text
);
CREATE INDEX IF NOT EXISTS idx_publication_rights_file ON publication_rights(file_id) WHERE withdrawn_at IS NULL;

-- Media attached to a marketing draft (marketing_drafts is the existing table).
CREATE TABLE IF NOT EXISTS marketing_draft_media (
  draft_id   bigint NOT NULL REFERENCES marketing_drafts(id) ON DELETE CASCADE,
  file_id    text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  sort       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (draft_id, file_id)
);
ALTER TABLE marketing_drafts ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT '';
ALTER TABLE marketing_drafts ADD COLUMN IF NOT EXISTS publication_decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL;
ALTER TABLE marketing_drafts ADD COLUMN IF NOT EXISTS publication_intent_id uuid REFERENCES action_intents(id) ON DELETE SET NULL;
ALTER TABLE marketing_drafts DROP CONSTRAINT IF EXISTS marketing_drafts_status_check;
ALTER TABLE marketing_drafts ADD CONSTRAINT marketing_drafts_status_check
  CHECK (status IN ('draft','pending_decision','queued','posted','cancelled')) NOT VALID;

-- ── Immutable document revisions ─────────────────────────────────────────────
-- A signed or released artifact is pinned by content hash. Editing it creates
-- a new revision; any decision / release bound to the old hash is invalid.
CREATE TABLE IF NOT EXISTS document_revisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_kind      text NOT NULL,        -- signature_request / document_draft / plan_design_version / marketing_draft / weekly_summary
  doc_id        text NOT NULL,
  revision      integer NOT NULL,
  content_hash  text NOT NULL,
  pinned_by     text NOT NULL DEFAULT '',   -- signature:<id> / release:<decision id> / edit
  pinned_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_kind, doc_id, revision),
  UNIQUE (doc_kind, doc_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_document_revisions_doc ON document_revisions(doc_kind, doc_id, revision DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['closeout_checklists','post_project_actions'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;
