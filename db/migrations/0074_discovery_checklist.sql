-- Shared checklist contract v3. No capture, provider calls or AI enabled.
CREATE TABLE IF NOT EXISTS checklist_definitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE,              -- 'discovery_call' | 'consult:<form_key>'
  kind               text NOT NULL CHECK (kind IN ('discovery_call','in_home_consult')),
  label              text NOT NULL,
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id    uuid NOT NULL REFERENCES checklist_definitions(id),
  version          integer NOT NULL CHECK (version > 0),
  contract_version integer NOT NULL DEFAULT 3 CHECK (contract_version = 3),
  items            jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  wrap_up_phrases  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(wrap_up_phrases) = 'array'),
  compiled_from    jsonb,                                -- consult: {"form_version_id": "..."}
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version)
);
ALTER TABLE checklist_definitions
  ADD CONSTRAINT checklist_definitions_current_fk FOREIGN KEY (current_version_id) REFERENCES checklist_versions(id);

CREATE TABLE IF NOT EXISTS checklist_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL CHECK (kind IN ('discovery_call','in_home_consult')),
  engine_mode            text NOT NULL CHECK (engine_mode IN ('call','consult')),
  definition_version_id  uuid NOT NULL REFERENCES checklist_versions(id),
  call_id                uuid UNIQUE REFERENCES calls(id) ON DELETE SET NULL,
  manual_notes           text NOT NULL DEFAULT '',
  source_ref             text,                            -- consult id; NULL for calls
  lead_id                uuid REFERENCES leads(id) ON DELETE SET NULL,
  project_id             uuid REFERENCES projects(id) ON DELETE SET NULL,
  capture                text NOT NULL DEFAULT 'manual' CHECK (capture IN ('manual','live')),
  status                 text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','ringing','live','ended','reconciled','cancelled')),
  direction              text CHECK (direction IN ('inbound','outbound')),
  started_at             timestamptz NOT NULL DEFAULT now(),
  bridged_at             timestamptz,
  ended_at               timestamptz,
  consent_status         text NOT NULL DEFAULT 'not_asked'
                           CHECK (consent_status IN ('not_asked','pending','awaiting_recorded_confirmation','paused_confirmation','granted','declined','withdrawn','not_on_recording')),
  consent_notice_version text,
  consent_method         text CHECK (consent_method IN ('verbal_phone','verbal_in_person')),
  consent_by             uuid REFERENCES users(id),
  consent_at             timestamptz,
  withdrawn_at           timestamptz,
  consent_evidence_segment_id uuid,                       -- FK below
  canonical_leg          text,                            -- call_control_id transcription runs on
  track_mapping          jsonb,                           -- {"inbound":"client","outbound":"joe"}
  transcription_status   text NOT NULL DEFAULT 'off'
                           CHECK (transcription_status IN ('off','starting','on','stopping','stopped','failed','stop_unconfirmed')),
  last_event_at          timestamptz,
  last_segment_at        timestamptz,
  reminders_on           boolean NOT NULL DEFAULT true,
  revision               bigint NOT NULL DEFAULT 0,
  cursor_seq             bigint NOT NULL DEFAULT 0,
  finalization_status    text NOT NULL DEFAULT 'none' CHECK (finalization_status IN ('none','pending','done','failed')),
  finalization_error     text,
  capture_origin_at      timestamptz,
  capture_ended_at        timestamptz,
  capture_epoch          bigint NOT NULL DEFAULT 0,
  deletion_epoch         bigint NOT NULL DEFAULT 0,
  policy_version         text NOT NULL DEFAULT 'capture-2026-11-v3',
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_ref),
  UNIQUE (id, definition_version_id),
  CHECK (kind <> 'in_home_consult' OR (source_ref IS NOT NULL AND call_id IS NULL AND engine_mode = 'consult')),
  CHECK (consent_status <> 'granted' OR (consent_by IS NOT NULL AND consent_at IS NOT NULL AND consent_notice_version IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_checklist_sessions_live ON checklist_sessions(status) WHERE status IN ('ringing','live');
CREATE INDEX IF NOT EXISTS idx_checklist_sessions_lead ON checklist_sessions(lead_id);

-- Stable template registry. Reuse id across wording changes, never across different meanings.
CREATE TABLE checklist_definition_items (
  id uuid PRIMARY KEY,
  definition_id uuid NOT NULL REFERENCES checklist_definitions(id),
  key text NOT NULL,
  UNIQUE (definition_id, key)
);
CREATE TABLE checklist_version_items (
  definition_version_id uuid NOT NULL REFERENCES checklist_versions(id),
  definition_item_id uuid NOT NULL REFERENCES checklist_definition_items(id),
  spec jsonb NOT NULL,
  PRIMARY KEY (definition_version_id, definition_item_id)
);
CREATE TABLE checklist_session_items (
  session_id uuid NOT NULL,
  item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  definition_version_id uuid NOT NULL,
  definition_item_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (session_id, item_id),
  UNIQUE (session_id, definition_item_id, instance_id),
  FOREIGN KEY (session_id, definition_version_id)
    REFERENCES checklist_sessions(id, definition_version_id),
  FOREIGN KEY (definition_version_id, definition_item_id)
    REFERENCES checklist_version_items(definition_version_id, definition_item_id)
);

CREATE TABLE IF NOT EXISTS conversation_segments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigserial,                               -- engine cursor
  session_id      uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('telnyx_live','telnyx_recording','media_stream','consult_audio')),
  source_event_id text NOT NULL,                           -- exact names in §8.5; never a device-local sequence alone
  source_ref      text,                                    -- consult chunk UUID as text, or provider recording id
  revision        integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  supersedes_id   uuid,
  speaker         text NOT NULL CHECK (speaker IN ('joe','client','staff','unknown')),
  track           text CHECK (track IN ('inbound','outbound','mono')),
  timing_basis    text NOT NULL CHECK (timing_basis IN ('provider_audio','receiver_relative','receipt_only')),
  start_ms        integer NOT NULL CHECK (start_ms >= 0),
  end_ms          integer NOT NULL,
  text            text NOT NULL CHECK (octet_length(text) <= 8192),
  confidence      real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  section_key     text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  cleared_at      timestamptz,
  CHECK (end_ms >= start_ms),
  UNIQUE (session_id, id),
  UNIQUE (session_id, id, revision),
  FOREIGN KEY (session_id, supersedes_id) REFERENCES conversation_segments(session_id, id),
  UNIQUE (session_id, source, source_event_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_conversation_segments_cursor ON conversation_segments(session_id, seq);
ALTER TABLE checklist_sessions ADD CONSTRAINT checklist_sessions_consent_seg_fk
  FOREIGN KEY (id, consent_evidence_segment_id) REFERENCES conversation_segments(session_id, id);

CREATE TABLE IF NOT EXISTS checklist_item_coverage (
  session_id       uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  item_id          uuid NOT NULL,
  state            text NOT NULL DEFAULT 'open' CHECK (state IN ('open','partial','covered','not_applicable')),
  component_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  value            jsonb,
  evidence         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai','ai_confirmed','prior_record')),
  suggestion       jsonb,
  manual_lock      boolean NOT NULL DEFAULT false,
  conflict         jsonb,
  reason           text,
  revision         bigint NOT NULL DEFAULT 0,
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, item_id),
  FOREIGN KEY (session_id, item_id) REFERENCES checklist_session_items(session_id, item_id),
  CHECK (state <> 'not_applicable' OR reason IS NOT NULL)
);

-- Transactionally maintained by apply/confirm; JSON evidence is checked against this projection.
CREATE TABLE checklist_evidence_refs (
  session_id uuid NOT NULL,
  item_id uuid NOT NULL,
  slot text NOT NULL CHECK (slot IN ('committed','suggested')),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  segment_id uuid NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (session_id, item_id, slot, ordinal),
  FOREIGN KEY (session_id, item_id) REFERENCES checklist_session_items(session_id, item_id),
  FOREIGN KEY (session_id, segment_id, revision) REFERENCES conversation_segments(session_id, id, revision)
);

CREATE TABLE IF NOT EXISTS checklist_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE,                       -- idempotency ledger
  actor_kind   text NOT NULL CHECK (actor_kind IN ('person','agent','worker')),
  actor_id     text,
  event_type   text NOT NULL CHECK (event_type IN ('created','linked','item_set','suggestion_confirmed','engine_applied',
                 'consent','capture','reminder','promotion','finalized','retention','legal_hold')),
  before       jsonb, after jsonb, segment_ids uuid[],
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_events_session ON checklist_events(session_id, created_at);

CREATE TABLE IF NOT EXISTS checklist_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES checklist_sessions(id) ON DELETE CASCADE,
  phase        text NOT NULL CHECK (phase IN ('live','control','finalize','promote','followup','retention')),
  input_hash   text NOT NULL,
  state        text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','done','failed')),
  attempts     integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token  uuid,
  leased_until timestamptz,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, phase, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_checklist_jobs_due ON checklist_jobs(phase, available_at) WHERE state IN ('pending','failed');

-- Published versions are immutable; segment text may only be cleared.
CREATE OR REPLACE FUNCTION checklist_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME IN ('checklist_versions','checklist_version_items','checklist_definition_items') THEN
    RAISE EXCEPTION 'checklist versions are immutable';
  ELSIF TG_TABLE_NAME = 'checklist_session_items' THEN
    IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN
      RAISE EXCEPTION 'runtime item identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'conversation_segments' THEN
    IF (to_jsonb(NEW) - 'text' - 'cleared_at') IS DISTINCT FROM
       (to_jsonb(OLD) - 'text' - 'cleared_at') THEN
      RAISE EXCEPTION 'segment identity and metadata are immutable';
    END IF;
    IF NEW.text IS DISTINCT FROM OLD.text AND NOT (NEW.text = '' AND NEW.cleared_at IS NOT NULL) THEN
      RAISE EXCEPTION 'segment text is immutable (clear only)';
    END IF;
  ELSIF TG_TABLE_NAME = 'checklist_sessions' THEN
    IF NEW.engine_mode = 'call' AND OLD.engine_mode = 'consult' THEN RAISE EXCEPTION 'cannot leave consult mode'; END IF;
    IF NEW.definition_version_id <> OLD.definition_version_id THEN RAISE EXCEPTION 'version is fixed'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER checklist_versions_guard BEFORE UPDATE OR DELETE ON checklist_versions FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_version_items_guard BEFORE UPDATE OR DELETE ON checklist_version_items FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_definition_items_guard BEFORE UPDATE OR DELETE ON checklist_definition_items FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_session_items_guard BEFORE UPDATE ON checklist_session_items FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER conversation_segments_guard BEFORE UPDATE ON conversation_segments FOR EACH ROW EXECUTE FUNCTION checklist_guard();
CREATE TRIGGER checklist_sessions_guard BEFORE UPDATE ON checklist_sessions FOR EACH ROW EXECUTE FUNCTION checklist_guard();

INSERT INTO checklist_definitions(key,kind,label) VALUES ('discovery_call','discovery_call','Discovery checklist');
INSERT INTO checklist_versions(definition_id,version,items) SELECT id,1,$seed$[{"id": "1f11cf2e-c891-57fb-80d6-70609aeeb12d", "key": "work", "label": "Work", "questions": ["Tell me what you're hoping to do.", "What's not working with the space now, and what would you like instead?"], "covered_when": "A room or space plus the change wanted (\"upstairs bath, tub out, walk-in shower\")", "partial_when": "\"Some work on the house\"; a room with no change; Joe's own suggestion the client didn't confirm", "reminder": "Remember to ask what work they want done.", "partial_reminders": {"answer": "Remember to ask what they'd like to change in the {space}."}, "components": [{"key": "space", "label": "Space", "required": true}, {"key": "change", "label": "Change", "required": true}], "fact_target": "scope", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 1, "section_key": null, "source_ref": null}, {"id": "ee35c017-15d1-587d-9d4e-1f5045189d51", "key": "budget", "label": "Budget", "questions": ["Do you have a budget in mind, or are you still figuring that out?", "Is there a range you'd like us to work within?"], "covered_when": "An amount or range, **or** \"no budget yet\" / \"rather not say\"", "partial_when": "\"Reasonable\"; \"fifty\" without units; Joe floats a number and gets no clear answer", "reminder": "Remember to ask if they have a budget in mind.", "partial_reminders": {"answer": "Remember to confirm the budget amount."}, "components": [{"key": "response", "label": "Response", "required": true}], "fact_target": "budget_fit", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 3, "section_key": null, "source_ref": null}, {"id": "5754e77b-8be0-52b2-a109-ee89c1eec675", "key": "timeline", "label": "Timeline", "questions": ["When are you hoping to get started?", "Is there a date you need it finished by, or are you flexible?"], "covered_when": "A start or finish window, or \"flexible\" / \"not decided\"", "partial_when": "\"Soon\"; a deadline with no date", "reminder": "Remember to ask when they're hoping to start.", "partial_reminders": {"answer": "Remember to ask if that date is firm."}, "components": [{"key": "window", "label": "Window", "required": true}], "fact_target": "timeline", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 4, "section_key": null, "source_ref": null}, {"id": "e1c65fe0-9c84-57a4-b6c4-6321f5065ede", "key": "address", "label": "Address", "questions": ["Where is the house?", "What's the project address, including the city?"], "covered_when": "Street address and city confirmed by the client (or a saved address reconfirmed)", "partial_when": "City only; unclear house number; mailing address not confirmed as the job address", "reminder": "Remember to confirm the project address and city.", "partial_reminders": {"answer": "Remember to confirm the street address."}, "components": [{"key": "street", "label": "Street", "required": true}, {"key": "city", "label": "City", "required": true}], "fact_target": "address", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 2, "section_key": null, "source_ref": null}, {"id": "9a2539ab-3efb-5b55-9eb4-3b157c4bad94", "key": "contact", "label": "Contact", "questions": ["What's the best name, number and email for following up?", "Is this the best callback number, and what email should I use?"], "covered_when": "Name, callback number and email read back, or email declined with another way to reach them", "partial_when": "Caller ID only; an email that wasn't spelled back; name only", "reminder": "Remember to confirm the best callback number and email.", "partial_reminders": {"answer": "Remember to read back their email."}, "components": [{"key": "name", "label": "Name", "required": true}, {"key": "callback", "label": "Callback", "required": true}, {"key": "email_or_alternative", "label": "Email or alternative", "required": true}], "fact_target": "contact_info", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 0, "section_key": null, "source_ref": null}, {"id": "841007a1-cc1c-53f0-bf97-fd7d86596440", "key": "who_decides", "label": "Who decides", "questions": ["Who else will be involved in making decisions?", "Would your spouse or partner like to be part of the next conversation?"], "covered_when": "\"Just me\", or the other people/roles named", "partial_when": "\"We\" or a spouse mentioned, involvement unclear", "reminder": "Remember to ask who else should be involved.", "partial_reminders": {"answer": "Remember to ask if {person} should join the next conversation."}, "components": [{"key": "people", "label": "People", "required": true}], "fact_target": "decision_makers", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 5, "section_key": null, "source_ref": null}, {"id": "f4abe080-dbdd-517d-abf7-2e03bc0e0db0", "key": "found_us", "label": "How they found us", "questions": ["How did you hear about SJ Carpentry?", "Did someone refer you, or did you find us online?"], "covered_when": "A channel or referrer, or \"don't remember\"", "partial_when": "Joe's guess; \"somewhere online\" never confirmed", "reminder": "Remember to ask how they found us.", "partial_reminders": {"answer": "Remember to ask who referred them."}, "components": [{"key": "channel", "label": "Channel", "required": true}], "fact_target": "referral_source", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 9, "section_key": null, "source_ref": null}, {"id": "8ff2a254-7e82-5384-a125-b13b7ae3b1f5", "key": "other_bids", "label": "Other bids", "questions": ["Are you talking with any other contractors?", "Are you getting other bids, or are we your first conversation?"], "covered_when": "yes / no / undecided / declined", "partial_when": "\"Shopping around\" with no context", "reminder": "Remember to ask if they're getting other bids.", "partial_reminders": {}, "components": [{"key": "answer", "label": "Answer", "required": true}], "fact_target": "other_bids", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 8, "section_key": null, "source_ref": null}, {"id": "34dadc11-976f-54c6-9717-ba6a0722fa59", "key": "years_staying", "label": "Years in house / staying", "questions": ["How long have you lived there, and do you plan to stay a while?", "Is this a long-term home for you, or are you thinking about selling?"], "covered_when": "Both parts answered (uncertainty counts; \"not moved in yet\" counts)", "partial_when": "Only one part", "reminder": "Remember to ask how long they've lived there and plan to stay.", "partial_reminders": {"answer": "Remember to ask how long they plan to stay."}, "components": [{"key": "occupancy", "label": "Occupancy", "required": true}, {"key": "stay_plan", "label": "Stay plan", "required": true}], "fact_target": "house_history", "optional": false, "enabled": true, "reminder_enabled": true, "reminder_priority": 12, "section_key": null, "source_ref": null}, {"id": "de810ce6-f82f-5bb4-baf9-b5bc4afd7861", "key": "next_step", "label": "Next step", "questions": ["What's the best next step for you — should I send the pre-con agreement and set up a time to come out?"], "covered_when": "A dated meeting or visit; the client agrees Joe sends the pre-con agreement; or the client says they'll call back", "partial_when": "\"Sounds good\" with nothing agreed", "reminder": "Remember to agree on the next step.", "partial_reminders": {"answer": "Remember to set a date to come out."}, "components": [{"key": "agreement", "label": "Agreement", "required": true}], "fact_target": null, "optional": true, "enabled": true, "reminder_enabled": true, "reminder_priority": 6, "section_key": null, "source_ref": null}, {"id": "bc06c781-30ff-5068-a947-ad3740aecfc0", "key": "photos_request", "label": "Photos", "questions": ["Could you text or email me a few photos of the space?"], "covered_when": "Yes / no / already sent", "partial_when": "—", "reminder": "Remember to ask for photos.", "partial_reminders": {}, "components": [{"key": "answer", "label": "Answer", "required": true}], "fact_target": null, "optional": true, "enabled": true, "reminder_enabled": true, "reminder_priority": 11, "section_key": null, "source_ref": null}, {"id": "ea7a6412-adf3-5a23-bc28-9db322440cc5", "key": "property", "label": "The property", "questions": ["Do you own the home? Is it a house, townhome or condo — any HOA?"], "covered_when": "Owner yes/no (buying or renting → whose approval) **and** property type **and** HOA yes/no", "partial_when": "Any one or two of the three", "reminder": "Remember to ask if they own the home and if there's an HOA.", "partial_reminders": {"hoa": "Remember to ask if there's an HOA.", "owner": "Remember to ask if they own the home.", "type": "Remember to ask if it's a house, townhome or condo."}, "components": [{"key": "owner", "label": "Owner", "required": true}, {"key": "type", "label": "Type", "required": true}, {"key": "hoa", "label": "Hoa", "required": true}], "fact_target": "property", "optional": true, "enabled": true, "reminder_enabled": true, "reminder_priority": 7, "section_key": null, "source_ref": null}, {"id": "3ce065d5-647b-5a2a-8a28-204b569f864b", "key": "paying", "label": "Paying for it", "questions": ["Will you pay for this out of pocket, or through a loan or insurance claim?"], "covered_when": "cash / loan or HELOC / insurance claim / declined", "partial_when": "\"We'll figure it out\"", "reminder": "Remember to ask how they plan to pay.", "partial_reminders": {}, "components": [{"key": "method", "label": "Method", "required": true}], "fact_target": "paying_with", "optional": true, "enabled": true, "reminder_enabled": true, "reminder_priority": 10, "section_key": null, "source_ref": null}]$seed$::jsonb FROM checklist_definitions WHERE key='discovery_call';
INSERT INTO checklist_definition_items(id,definition_id,key) SELECT (i->>'id')::uuid,d.id,i->>'key' FROM checklist_definitions d JOIN checklist_versions v ON v.definition_id=d.id CROSS JOIN LATERAL jsonb_array_elements(v.items) i WHERE d.key='discovery_call';
INSERT INTO checklist_version_items SELECT v.id,(i->>'id')::uuid,i FROM checklist_versions v CROSS JOIN LATERAL jsonb_array_elements(v.items) i;
UPDATE checklist_definitions d SET current_version_id=v.id FROM checklist_versions v WHERE v.definition_id=d.id;

-- Owner-only key material. Contexts are signed by the trusted website connection;
-- narrow connections can verify through scoped functions but cannot mint/read keys.
CREATE TABLE checklist_context_keys (id boolean PRIMARY KEY DEFAULT true CHECK(id), secret bytea NOT NULL);
INSERT INTO checklist_context_keys VALUES(true,gen_random_bytes(32));
CREATE TABLE checklist_consent_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES checklist_sessions(id),
 segment_id uuid NOT NULL, segment_revision integer NOT NULL, clip_file_id text REFERENCES files(id),
 segment_text text NOT NULL, notice_version text NOT NULL, consent_by uuid NOT NULL REFERENCES users(id),
 consent_at timestamptz NOT NULL, attestation_operation_id uuid, captured_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, clip_state text NOT NULL DEFAULT 'pending' CHECK(clip_state IN ('pending','verified','failed','not_required')),
 byte_hash text, text_hash text, audio_start_ms integer, audio_end_ms integer, verification_receipt jsonb,
 FOREIGN KEY(session_id,segment_id,segment_revision) REFERENCES conversation_segments(session_id,id,revision),
 CHECK(audio_end_ms IS NULL OR audio_end_ms-audio_start_ms BETWEEN 0 AND 20000)
);
CREATE TABLE checklist_legal_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_kind text NOT NULL CHECK(scope_kind IN ('session','lead','project')),
 scope_id uuid NOT NULL, reason text NOT NULL, by_user uuid NOT NULL REFERENCES users(id),
 at timestamptz NOT NULL DEFAULT now(), expires_or_review_on timestamptz NOT NULL, released_at timestamptz
);
CREATE TABLE checklist_purge_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES checklist_sessions(id),
 target text NOT NULL CHECK(target IN ('audio','text','both')), reason text NOT NULL,
 operation_id uuid NOT NULL UNIQUE, requested_by uuid REFERENCES users(id), requested_at timestamptz NOT NULL DEFAULT now(),
 deletion_epoch bigint NOT NULL, backup_deadline timestamptz, completed_at timestamptz
);
CREATE TABLE checklist_purge_targets (
 request_id uuid NOT NULL REFERENCES checklist_purge_requests(id), target_kind text NOT NULL, target_id text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','held','done','failed')), attempts integer NOT NULL DEFAULT 0,
 last_error text, completed_at timestamptz, PRIMARY KEY(request_id,target_kind,target_id)
);
CREATE TABLE checklist_content_lineage (
 session_id uuid NOT NULL REFERENCES checklist_sessions(id), target_kind text NOT NULL, target_id text NOT NULL,
 segment_ids uuid[] NOT NULL DEFAULT '{}', segment_revisions integer[] NOT NULL DEFAULT '{}',
 contains_quote boolean NOT NULL, human_confirmed boolean NOT NULL, PRIMARY KEY(session_id,target_kind,target_id)
);
CREATE TABLE checklist_operation_receipts (
 operation_id uuid PRIMARY KEY, subject uuid NOT NULL, input_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE checklist_call_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), screen_phone boolean NOT NULL DEFAULT false,
 send_call_link boolean NOT NULL DEFAULT false
);
INSERT INTO checklist_call_settings(id) VALUES(true);

CREATE FUNCTION checklist_mint_context(p_claims jsonb) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_claims || jsonb_build_object('signature',encode(hmac(convert_to(p_claims::text,'UTF8'),secret,'sha256'),'hex'))
 FROM checklist_context_keys WHERE id
$$;
REVOKE ALL ON FUNCTION checklist_mint_context(jsonb) FROM PUBLIC;

CREATE FUNCTION checklist_verify(p_context jsonb,p_operation text,p_session uuid DEFAULT NULL) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u users; claims jsonb := p_context-'signature'; sig text;
BEGIN
 SELECT encode(hmac(convert_to(claims::text,'UTF8'),secret,'sha256'),'hex') INTO sig FROM checklist_context_keys WHERE id;
 IF sig IS DISTINCT FROM p_context->>'signature' OR (claims->>'expires_at')::timestamptz <= clock_timestamp()
 OR NOT (claims->'operations' ? p_operation) OR (p_session IS NOT NULL AND NOT(claims->'session_ids' ? p_session::text))
 THEN RAISE EXCEPTION 'CHECKLIST_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM users WHERE id=(claims->>'subject')::uuid AND active;
 IF u.id IS NULL OR u.role NOT IN ('owner','staff') OR (u.role='staff' AND NOT('comms'=ANY(u.permissions)))
 OR (claims->>'role' NOT IN ('owner','staff','agent')) OR (claims->>'role'<>'agent' AND claims->>'role'<>u.role)
 OR (claims->>'role'='agent' AND claims->>'delegating_subject' IS DISTINCT FROM u.id::text)
 THEN RAISE EXCEPTION 'CHECKLIST_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_session IS NOT NULL AND NOT EXISTS(SELECT 1 FROM checklist_sessions WHERE id=p_session AND kind='discovery_call')
 THEN RAISE EXCEPTION 'CHECKLIST_NOT_FOUND'; END IF;
 RETURN u.id;
END $$;
REVOKE ALL ON FUNCTION checklist_verify(jsonb,text,uuid) FROM PUBLIC;

CREATE FUNCTION checklist_read(p_context jsonb,p_session uuid,p_projection text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM checklist_verify(p_context,'read',p_session);
 IF p_projection <> 'rows' THEN RAISE EXCEPTION 'CHECKLIST_PROJECTION_UNAVAILABLE'; END IF;
 SELECT jsonb_build_object('session',to_jsonb(s),'version',to_jsonb(v),
 'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('identity',to_jsonb(i),'coverage',to_jsonb(c),'spec',vi.spec,'prior',
 (SELECT jsonb_build_object('value',f.value,'fact_key',f.key) FROM lead_facts f WHERE f.lead_id=s.lead_id AND f.key=vi.spec->>'fact_target' AND f.status='known')) ORDER BY ord.n)
 FROM checklist_session_items i JOIN checklist_item_coverage c USING(session_id,item_id)
 JOIN checklist_version_items vi ON vi.definition_version_id=i.definition_version_id AND vi.definition_item_id=i.definition_item_id
 JOIN LATERAL jsonb_array_elements(v.items) WITH ORDINALITY ord(spec,n) ON ord.spec->>'id'=i.definition_item_id::text
 WHERE i.session_id=s.id AND i.active),'[]'::jsonb)) INTO result
 FROM checklist_sessions s JOIN checklist_versions v ON v.id=s.definition_version_id WHERE s.id=p_session;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION checklist_read(jsonb,uuid,text) FROM PUBLIC;

CREATE FUNCTION checklist_valid_manual_value(p_key text,p_value jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE allowed text[]; k text; v jsonb;
BEGIN
 IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(p_value)<>'object' THEN RETURN false; END IF;
 allowed:=CASE p_key
 WHEN 'work' THEN ARRAY['scope','job_type','goals'] WHEN 'budget' THEN ARRAY['response','amount_text']
 WHEN 'timeline' THEN ARRAY['text','start','finish','firm'] WHEN 'address' THEN ARRAY['street','city','confirmed']
 WHEN 'contact' THEN ARRAY['name','phone_e164','email','preferred_channel','email_declined']
 WHEN 'who_decides' THEN ARRAY['sole','people'] WHEN 'found_us' THEN ARRAY['channel','referrer','detail','unknown']
 WHEN 'other_bids' THEN ARRAY['answer','detail'] WHEN 'years_staying' THEN ARRAY['occupancy_text','stay_plan_text']
 WHEN 'next_step' THEN ARRAY['kind','date'] WHEN 'photos_request' THEN ARRAY['answer']
 WHEN 'property' THEN ARRAY['owner','type','hoa'] WHEN 'paying' THEN ARRAY['method'] ELSE NULL END;
 IF allowed IS NULL THEN RETURN false; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_value) LOOP
  IF NOT(k=ANY(allowed)) THEN RETURN false; END IF;
  IF v='null'::jsonb THEN CONTINUE; END IF;
  IF k IN ('firm','confirmed','email_declined','sole','unknown') THEN
   IF jsonb_typeof(v)<>'boolean' THEN RETURN false; END IF;
  ELSIF k='people' THEN
   IF jsonb_typeof(v)<>'array' THEN RETURN false; END IF;
  ELSIF jsonb_typeof(v)<>'string' THEN RETURN false; END IF;
 END LOOP;
 IF p_key='budget' AND p_value ? 'response' AND p_value->>'response' NOT IN ('stated','not_set','declined') THEN RETURN false; END IF;
 IF p_key='paying' AND p_value ? 'method' AND p_value->>'method' NOT IN ('cash','loan_heloc','insurance','declined') THEN RETURN false; END IF;
 IF p_key='photos_request' AND p_value ? 'answer' AND p_value->>'answer' NOT IN ('will_send','sent','no') THEN RETURN false; END IF;
 IF p_key='other_bids' AND p_value ? 'answer' AND p_value->>'answer' NOT IN ('yes','no','undecided','declined') THEN RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION checklist_valid_manual_value(text,jsonb) FROM PUBLIC;

-- One replay boundary for all Phase 1 website mutations. Wrappers below keep
-- the published SQL API stable for consult integration.
CREATE FUNCTION checklist_command(p_context jsonb,p_command text,p_input jsonb,p_op uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; s checklist_sessions; prior checklist_operation_receipts; h text;
 sid uuid := (p_input->>'session_id')::uuid; result jsonb; v checklist_versions; d checklist_definitions;
 item jsonb; cv checklist_item_coverage; before_row jsonb; new_id uuid; n integer;
BEGIN
 actor:=checklist_verify(p_context,p_command,sid);
 IF p_context->>'role'='agent' THEN RAISE EXCEPTION 'CHECKLIST_READ_ONLY' USING ERRCODE='42501'; END IF;
 h:=encode(digest(jsonb_build_array(p_command,p_input)::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_op::text,0));
 SELECT * INTO prior FROM checklist_operation_receipts WHERE operation_id=p_op;
 IF FOUND THEN
  IF prior.subject<>actor OR prior.input_hash<>h THEN RAISE EXCEPTION 'CHECKLIST_OPERATION_REUSED'; END IF;
  RETURN prior.result;
 END IF;
 IF p_command='start' THEN
  IF p_context->'create_scope' IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'CHECKLIST_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_input->>'kind'<>'discovery_call' OR p_input->>'project_id' IS NOT NULL OR p_input->>'source_ref' IS NOT NULL THEN RAISE EXCEPTION 'CHECKLIST_INVALID_TARGET'; END IF;
  SELECT vv.* INTO v FROM checklist_definitions dd JOIN checklist_versions vv ON vv.id=dd.current_version_id WHERE dd.key='discovery_call';
  IF p_input->>'call_id' IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(p_input->>'call_id',1));
   SELECT * INTO s FROM checklist_sessions WHERE call_id=(p_input->>'call_id')::uuid;
  END IF;
  IF s.id IS NULL THEN
   INSERT INTO checklist_sessions(kind,engine_mode,definition_version_id,call_id,lead_id,created_by)
   VALUES('discovery_call','call',v.id,(p_input->>'call_id')::uuid,(p_input->>'lead_id')::uuid,actor) RETURNING * INTO s;
   INSERT INTO checklist_session_items(session_id,definition_version_id,definition_item_id,instance_id)
    SELECT s.id,v.id,(j->>'id')::uuid,s.id FROM jsonb_array_elements(v.items) j WHERE (j->>'enabled')::boolean;
   INSERT INTO checklist_item_coverage(session_id,item_id) SELECT session_id,item_id FROM checklist_session_items WHERE session_id=s.id;
   INSERT INTO checklist_events(session_id,operation_id,actor_kind,actor_id,event_type) VALUES(s.id,p_op,'person',actor::text,'created');
  END IF;
  result:=jsonb_build_object('ok',true,'session_id',s.id,'revision',s.revision);
 ELSIF p_command='publish' THEN
  IF p_context->>'role'<>'owner' THEN RAISE EXCEPTION 'CHECKLIST_OWNER_ONLY' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM checklist_definitions WHERE id=(p_input->>'definition_id')::uuid AND key='discovery_call' FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'CHECKLIST_NOT_FOUND'; END IF;
  SELECT * INTO v FROM checklist_versions WHERE id=d.current_version_id;
  IF (p_input->>'expected_version')::uuid IS DISTINCT FROM v.id THEN RAISE EXCEPTION 'CHECKLIST_VERSION_CONFLICT'; END IF;
  IF jsonb_typeof(p_input->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'items')<>13 THEN RAISE EXCEPTION 'CHECKLIST_INVALID_SETTINGS'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_input->'items') LOOP
   IF jsonb_typeof(item->'questions') IS DISTINCT FROM 'array' OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'reminder') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(item->'reminder_enabled') IS DISTINCT FROM 'boolean' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.items) old WHERE old->>'id'=item->>'id' AND
    (old-'label'-'reminder'-'questions'-'enabled'-'reminder_enabled')=(item-'label'-'reminder'-'questions'-'enabled'-'reminder_enabled'))
    OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 40 OR length(btrim(item->>'reminder')) NOT BETWEEN 1 AND 120
    OR jsonb_array_length(item->'questions')>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'questions') q WHERE length(q)>160)
    OR (NOT (item->>'optional')::boolean AND NOT (item->>'enabled')::boolean)
   THEN RAISE EXCEPTION 'CHECKLIST_INVALID_SETTINGS'; END IF;
  END LOOP;
  SELECT count(DISTINCT j->>'id') INTO n FROM jsonb_array_elements(p_input->'items') j;
  IF n<>13 THEN RAISE EXCEPTION 'CHECKLIST_INVALID_SETTINGS'; END IF;
  INSERT INTO checklist_versions(definition_id,version,items,wrap_up_phrases,created_by)
   VALUES(d.id,v.version+1,p_input->'items',v.wrap_up_phrases,actor) RETURNING * INTO v;
  INSERT INTO checklist_version_items SELECT v.id,(j->>'id')::uuid,j FROM jsonb_array_elements(v.items) j;
  UPDATE checklist_definitions SET current_version_id=v.id,updated_at=now() WHERE id=d.id;
  UPDATE checklist_call_settings SET screen_phone=(p_input->>'screen_phone')::boolean,send_call_link=(p_input->>'send_call_link')::boolean WHERE id;
  result:=jsonb_build_object('ok',true,'version_id',v.id);
 ELSE
  SELECT * INTO s FROM checklist_sessions WHERE id=sid FOR UPDATE;
  IF (p_input->>'expected_revision') IS NULL OR s.revision IS DISTINCT FROM (p_input->>'expected_revision')::bigint THEN
   RETURN jsonb_build_object('ok',false,'code','CHECKLIST_CONFLICT','status',409,'current',checklist_read(p_context,sid,'rows'),'proposed',p_input);
  END IF;
  IF p_command='set_item' THEN
   SELECT c.* INTO cv FROM checklist_item_coverage c JOIN checklist_session_items i USING(session_id,item_id)
    WHERE c.session_id=sid AND c.item_id=(p_input->>'item_id')::uuid AND i.active FOR UPDATE OF c;
   IF cv.item_id IS NULL THEN RAISE EXCEPTION 'CHECKLIST_INVALID_ITEM'; END IF;
   IF p_input->>'state' IS NULL OR p_input->>'state' NOT IN ('open','partial','covered','not_applicable') OR
    (p_input->>'state'='not_applicable' AND length(btrim(COALESCE(p_input->>'reason','')))=0)
    OR octet_length(COALESCE((p_input->'value')::text,''))>16000 THEN RAISE EXCEPTION 'CHECKLIST_INVALID_ANSWER'; END IF;
   IF NOT checklist_valid_manual_value((SELECT spec->>'key' FROM checklist_version_items vi JOIN checklist_session_items si ON si.definition_version_id=vi.definition_version_id AND si.definition_item_id=vi.definition_item_id WHERE si.session_id=sid AND si.item_id=cv.item_id),p_input->'value') THEN RAISE EXCEPTION 'CHECKLIST_INVALID_ANSWER'; END IF;
   before_row:=to_jsonb(cv);
   UPDATE checklist_item_coverage SET state=p_input->>'state',value=p_input->'value',reason=p_input->>'reason',
    source='manual',manual_lock=true,suggestion=NULL,evidence='[]',component_states='{}',revision=revision+1,updated_by=actor,updated_at=now()
    WHERE session_id=sid AND item_id=cv.item_id;
   DELETE FROM checklist_evidence_refs WHERE session_id=sid AND item_id=cv.item_id;
   IF s.lead_id IS NOT NULL AND p_input->'value'->>'method'='insurance' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(s.lead_id::text,3));
    INSERT INTO work_items(title,lead_id,source_kind,source_id,requires_approval)
     SELECT 'Include the § 325E.66 written notice with the initial estimate — counsel supplies wording',s.lead_id,'manual','checklist-insurance:'||s.lead_id,false
     WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_id='checklist-insurance:'||s.lead_id);
   END IF;
  ELSIF p_command='link' THEN
   UPDATE checklist_sessions SET lead_id=(p_input->>'lead_id')::uuid,call_id=(p_input->>'call_id')::uuid WHERE id=sid;
  ELSIF p_command='notes' THEN
   IF length(p_input->>'notes')>30000 THEN RAISE EXCEPTION 'CHECKLIST_INVALID_ANSWER'; END IF;
   UPDATE checklist_sessions SET manual_notes=COALESCE(p_input->>'notes','') WHERE id=sid;
  ELSIF p_command='finish' THEN
   UPDATE checklist_sessions SET status='ended',ended_at=COALESCE(ended_at,now()) WHERE id=sid;
  ELSE RAISE EXCEPTION 'CHECKLIST_INVALID_COMMAND'; END IF;
  UPDATE checklist_sessions SET revision=revision+1,updated_at=now() WHERE id=sid RETURNING * INTO s;
  INSERT INTO checklist_events(session_id,operation_id,actor_kind,actor_id,event_type,before,after)
   VALUES(sid,p_op,'person',actor::text,CASE p_command WHEN 'set_item' THEN 'item_set' WHEN 'link' THEN 'linked' WHEN 'notes' THEN 'item_set' ELSE 'finalized' END,before_row,p_input);
  result:=jsonb_build_object('ok',true,'session_id',sid,'revision',s.revision);
 END IF;
 INSERT INTO checklist_operation_receipts(operation_id,subject,input_hash,result) VALUES(p_op,actor,h,result);
 INSERT INTO app_change_log(scope,source) VALUES('checklist_sessions','app');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION checklist_command(jsonb,text,jsonb,uuid) FROM PUBLIC;

CREATE FUNCTION checklist_start_session(p_context jsonb,p_kind text,p_call uuid,p_lead uuid,p_project uuid,p_source_ref text,p_op uuid) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT checklist_command(p_context,'start',jsonb_build_object('kind',p_kind,'call_id',p_call,'lead_id',p_lead,'project_id',p_project,'source_ref',p_source_ref),p_op) $$;
CREATE FUNCTION checklist_manual_set_item(p_context jsonb,p_session uuid,p_item uuid,p_state text,p_value jsonb,p_reason text,p_expected_rev bigint,p_op uuid) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT checklist_command(p_context,'set_item',jsonb_build_object('session_id',p_session,'item_id',p_item,'state',p_state,'value',p_value,'reason',p_reason,'expected_revision',p_expected_rev),p_op) $$;
CREATE FUNCTION checklist_publish_version(p_context jsonb,p_definition uuid,p_items jsonb,p_wrap jsonb,p_op uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE current_id uuid; BEGIN
 SELECT current_version_id INTO current_id FROM checklist_definitions WHERE id=p_definition FOR UPDATE;
 RETURN checklist_command(p_context,'publish',jsonb_build_object('definition_id',p_definition,'items',p_items,'expected_version',COALESCE(p_context->>'expected_version',current_id::text),'screen_phone',false,'send_call_link',false),p_op); END $$;
REVOKE ALL ON FUNCTION checklist_start_session(jsonb,text,uuid,uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION checklist_manual_set_item(jsonb,uuid,uuid,text,jsonb,text,bigint,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION checklist_publish_version(jsonb,uuid,jsonb,jsonb,uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_agent') THEN
 GRANT EXECUTE ON FUNCTION checklist_read(jsonb,uuid,text) TO sjcos_agent;
 END IF;
END $$;

-- Exact db-roles-sql generator output (protected tables produce no grants).
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'checklist_definitions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'checklist_definitions');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'checklist_versions');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'checklist_versions');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'checklist_definition_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'checklist_definition_items');
SELECT sjcos_grant('sjcos_agent', 'SELECT', 'checklist_version_items');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'checklist_version_items');

CREATE FUNCTION checklist_consent_evidence_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k text;
BEGIN
 SELECT kind INTO k FROM checklist_sessions WHERE id=NEW.session_id;
 IF (k='in_home_consult' AND (NEW.clip_file_id IS NOT NULL OR NEW.clip_state<>'not_required')) OR
 (k='discovery_call' AND NEW.clip_state='verified' AND (NEW.clip_file_id IS NULL OR NEW.byte_hash IS NULL OR NEW.verification_receipt IS NULL))
 THEN RAISE EXCEPTION 'CHECKLIST_INVALID_CONSENT_EVIDENCE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checklist_consent_evidence_guard BEFORE INSERT OR UPDATE ON checklist_consent_evidence FOR EACH ROW EXECUTE FUNCTION checklist_consent_evidence_guard();

-- Checklist lifecycle (folded in from the R1 engineering fix; 0075 belongs to in-home consults)
-- Stable outbound identity is recorded before dialing, including uncertain outcomes.
ALTER TABLE checklist_sessions ADD COLUMN dial_call_id uuid;
CREATE FUNCTION checklist_reconcile_insurance() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target uuid; sid uuid;
BEGIN
 IF TG_TABLE_NAME='checklist_sessions' THEN sid:=NEW.id; ELSE sid:=NEW.session_id; END IF;
 SELECT lead_id INTO target FROM checklist_sessions WHERE id=sid;
 IF target IS NOT NULL AND EXISTS(SELECT 1 FROM checklist_item_coverage WHERE session_id=sid AND value->>'method'='insurance') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(target::text,3));
  INSERT INTO work_items(title,lead_id,source_kind,source_id,requires_approval)
   SELECT 'Include the § 325E.66 written notice with the initial estimate — counsel supplies wording',target,'manual','checklist-insurance:'||target,false
   WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_id='checklist-insurance:'||target);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checklist_insurance_link AFTER UPDATE OF lead_id ON checklist_sessions FOR EACH ROW EXECUTE FUNCTION checklist_reconcile_insurance();
CREATE TRIGGER checklist_insurance_answer AFTER UPDATE OF value ON checklist_item_coverage FOR EACH ROW EXECUTE FUNCTION checklist_reconcile_insurance();
