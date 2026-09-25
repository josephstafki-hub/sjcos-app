-- 0017 — Lead intake facts, follow-ups and estimate input packages
-- (WS-procurement, A11 / WORKFLOW W01). Additive and idempotent.
--
--   • lead_facts               — one row per qualification fact per lead with
--                                its source and known/unknown/conflicting state;
--                                the collector asks only for 'unknown' rows.
--   • lead_followups           — each automatic or staged follow-up (missing
--                                info / nurture / estimate) with its policy or
--                                decision, the intent that carried it, and the
--                                stop reason. Separate from newsletter drips.
--   • estimate_input_packages  — the traceable hand-off to estimating (A15):
--                                a facts snapshot + photos + measurements +
--                                open questions, revisioned per lead.

CREATE TABLE IF NOT EXISTS lead_facts (
  id           bigserial PRIMARY KEY,
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  key          text NOT NULL,                                  -- service_area / job_type / scope / budget_fit / timeline / goals / photos / measurements / address / contact_preference
  value        jsonb,
  source_ref   text NOT NULL DEFAULT '',                       -- 'message:<id>' / 'portal' / 'call:<id>' / 'intake' / 'owner'
  status       text NOT NULL DEFAULT 'unknown' CHECK (status IN ('known','unknown','conflicting')),
  asked_at     timestamptz,
  answered_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, key)
);

CREATE TABLE IF NOT EXISTS lead_followups (
  id              bigserial PRIMARY KEY,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('missing_info','nurture','estimate_followup','first_response')),
  policy_ref      text,                                        -- policy:<key>@<v> when sent automatically
  decision_id     uuid REFERENCES decisions(id) ON DELETE SET NULL,
  intent_id       uuid REFERENCES action_intents(id) ON DELETE SET NULL,
  recipient       text NOT NULL DEFAULT '',
  asked_keys      text[] NOT NULL DEFAULT '{}',
  subject         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  next_at         timestamptz,
  sent_at         timestamptz,
  stop_reason     text,
  state           text NOT NULL DEFAULT 'planned'
                    CHECK (state IN ('planned','staged','sent','stopped','answered')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_followups_lead ON lead_followups(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS estimate_input_packages (
  id                   bigserial PRIMARY KEY,
  lead_id              uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  revision             integer NOT NULL DEFAULT 1,
  facts                jsonb NOT NULL DEFAULT '{}'::jsonb,
  photos               jsonb NOT NULL DEFAULT '[]'::jsonb,     -- file ids only (scoped handles, never bytes)
  measurements         jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  handed_to_estimating_at timestamptz,
  created_by           text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, revision)
);

-- Review items for intake that could not be matched to a known identity.
CREATE TABLE IF NOT EXISTS lead_intake_reviews (
  id          bigserial PRIMARY KEY,
  reason      text NOT NULL,                                   -- unknown_identity / conflicting_match
  email       text,
  phone       text,
  thread_ref  text,
  candidates  jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  state       text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','dismissed')),
  resolved_lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
