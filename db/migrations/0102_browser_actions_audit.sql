-- Disabled action/review/execution schema. These are database guards, not runtime RPCs.
CREATE TABLE IF NOT EXISTS browser_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL,run_id uuid NOT NULL,initiating_user_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('login','lookup','save_page','submit','pay','sign','upload')),
 category text NOT NULL CHECK(category IN ('personal_login','delegated_login','personal_contact','company_save','company_submission','company_send','company_payment','company_signature','unknown')),
 needs_owner boolean NOT NULL, snapshot_digest bytea NOT NULL CHECK(octet_length(snapshot_digest)=32),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=65536),secret_manifest_envelope jsonb CHECK(browser_schema_envelope(secret_manifest_envelope)),
 screenshot_artifact_id uuid,context_boot_id uuid NOT NULL,document_epoch bigint NOT NULL CHECK(document_epoch>=0),control_epoch bigint NOT NULL CHECK(control_epoch>=0),
 revision int NOT NULL DEFAULT 1 CHECK(revision>0),amount_cents bigint CHECK(amount_cents>=0),currency char(3) CHECK(currency ~ '^[A-Z]{3}$'),payee varchar(255),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','armed','executing','succeeded','denied','expired','stale','failed','unknown')),
 expires_at timestamptz NOT NULL,approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,approver_session_id uuid REFERENCES web_sessions(id) ON DELETE RESTRICT,
 approved_at timestamptz,approval_method text CHECK(approval_method IN ('card','direct_person_click')),token_hash bytea CHECK(octet_length(token_hash)=32),token_expires_at timestamptz,token_consumed_at timestamptz,
 owner_grant_id uuid REFERENCES owner_grants(id) ON DELETE RESTRICT,command_id uuid REFERENCES browser_commands(id) ON DELETE RESTRICT,
 transmitted_at timestamptz,receipt_reference uuid,outcome_code varchar(80) CHECK(outcome_code ~ '^[A-Z0-9_]{1,80}$'),checked_at timestamptz,
 review_mode text NOT NULL CHECK(review_mode IN ('buffered','preclick')),request_deadline timestamptz NOT NULL,
 audit_consume_seq bigint REFERENCES browser_audit(id) ON DELETE RESTRICT,request_digest bytea CHECK(octet_length(request_digest)=32),dispatched_flow_nonce uuid,
 gate_generation bigint NOT NULL CHECK(gate_generation>0),read_manifest_revision int NOT NULL,read_manifest_digest bytea NOT NULL CHECK(octet_length(read_manifest_digest)=32),
 adapter_manifest_hmac bytea CHECK(octet_length(adapter_manifest_hmac)=32),arm_command_id uuid REFERENCES browser_commands(id) ON DELETE RESTRICT,arm_nonce_hash bytea CHECK(octet_length(arm_nonce_hash)=32),
 armed_at timestamptz,arm_deadline timestamptz,click_dispatched_at timestamptz,last_verified_at timestamptz,
 handoff_id uuid REFERENCES browser_handoffs(id) ON DELETE RESTRICT,handoff_attempt_id uuid,handoff_effect_id uuid,effect_evidence_revision int,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,task_id),
 FOREIGN KEY(task_id,run_id,initiating_user_id) REFERENCES browser_task_runs(task_id,run_id,initiator_user_id) ON DELETE RESTRICT,
 FOREIGN KEY(task_id,read_manifest_revision) REFERENCES browser_read_manifests(task_id,revision) ON DELETE RESTRICT,
 FOREIGN KEY(handoff_id,handoff_attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT,
 CHECK(needs_owner=(category NOT IN ('personal_login','delegated_login','personal_contact'))),
 CHECK(kind<>'pay' OR (category='company_payment' AND amount_cents IS NOT NULL AND currency IS NOT NULL AND length(trim(payee))>0)),
 CHECK(kind NOT IN ('submit','sign','upload','save_page') OR needs_owner),
 CHECK(kind<>'sign' OR category='company_signature'),
 CHECK(expires_at>created_at AND expires_at<=request_deadline AND expires_at<=created_at+CASE WHEN review_mode='buffered' THEN interval '60 seconds' ELSE interval '5 minutes' END),
 CHECK(review_mode<>'buffered' OR (request_digest IS NOT NULL AND dispatched_flow_nonce IS NOT NULL)),
 CHECK(review_mode<>'preclick' OR adapter_manifest_hmac IS NOT NULL),
 CHECK(state NOT IN ('approved','armed','executing','succeeded','unknown') OR (approved_by_user_id IS NOT NULL AND approver_session_id IS NOT NULL AND approved_at IS NOT NULL AND approval_method IS NOT NULL AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL)),
 CHECK(NOT needs_owner OR state NOT IN ('approved','armed','executing','succeeded','unknown') OR owner_grant_id IS NOT NULL),
 CHECK(token_expires_at IS NULL OR (token_expires_at<=approved_at+interval '30 seconds' AND token_expires_at<=expires_at)),
 CHECK(state NOT IN ('executing','succeeded','unknown') OR (token_consumed_at IS NOT NULL AND command_id IS NOT NULL AND request_digest IS NOT NULL AND dispatched_flow_nonce IS NOT NULL AND audit_consume_seq IS NOT NULL)),
 CHECK((handoff_id IS NULL AND handoff_attempt_id IS NULL) OR (handoff_id IS NOT NULL AND handoff_attempt_id IS NOT NULL)),
 CHECK(handoff_id IS NULL OR NOT needs_owner OR state NOT IN ('approved','armed','executing','succeeded','unknown') OR (handoff_effect_id IS NOT NULL AND effect_evidence_revision IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS browser_actions_live ON browser_actions(task_id) WHERE state IN ('pending','approved','armed','executing');
CREATE UNIQUE INDEX IF NOT EXISTS browser_actions_grant ON browser_actions(owner_grant_id) WHERE owner_grant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS browser_actions_flow ON browser_actions(dispatched_flow_nonce) WHERE dispatched_flow_nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS browser_actions_expiry ON browser_actions(state,expires_at);
CREATE INDEX IF NOT EXISTS browser_actions_task ON browser_actions(task_id,created_at);
CREATE TABLE IF NOT EXISTS browser_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,action_id uuid,
 kind text NOT NULL CHECK(kind IN ('review_image','quarantine_file')),safe_name varchar(120) NOT NULL CHECK(safe_name ~ '^[a-zA-Z0-9_. -]{1,120}$'),
 canonical_origin varchar(255) NOT NULL CHECK(browser_schema_origin(canonical_origin)),mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','application/pdf')),
 byte_count bigint NOT NULL CHECK(byte_count BETWEEN 1 AND 26214400),sha256 bytea NOT NULL CHECK(octet_length(sha256)=32),private boolean NOT NULL,
 storage_key varchar(120) NOT NULL UNIQUE CHECK(storage_key ~ '^[a-z0-9_-]{1,120}$'),envelope jsonb CHECK(browser_schema_envelope(envelope)),download_id uuid,
 sanitizer_build varchar(80),sanitizer_policy varchar(80),signature_version varchar(80),sanitizer_result text CHECK(sanitizer_result IN ('pending','validated','rejected')),
 original_hash_envelope jsonb CHECK(browser_schema_envelope(original_hash_envelope)),sanitized_ciphertext_hash bytea CHECK(octet_length(sanitized_ciphertext_hash)=32),
 expires_at timestamptz NOT NULL,deleted_at timestamptz,tombstoned_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,task_id),UNIQUE(task_id,download_id),
 FOREIGN KEY(action_id,task_id) REFERENCES browser_actions(id,task_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CHECK((private AND (envelope IS NOT NULL OR deleted_at IS NOT NULL)) OR (NOT private AND envelope IS NULL)),CHECK(kind<>'review_image' OR private),CHECK(kind<>'quarantine_file' OR download_id IS NOT NULL),
 CHECK(expires_at<=created_at+CASE WHEN kind='quarantine_file' THEN interval '24 hours' ELSE interval '25 hours' END)
);
ALTER TABLE browser_actions DROP CONSTRAINT IF EXISTS browser_action_image_fk;
ALTER TABLE browser_actions ADD CONSTRAINT browser_action_image_fk FOREIGN KEY(screenshot_artifact_id,task_id) REFERENCES browser_artifacts(id,task_id) ON DELETE RESTRICT;
ALTER TABLE browser_read_manifests DROP CONSTRAINT IF EXISTS browser_read_action_fk;
ALTER TABLE browser_read_manifests ADD CONSTRAINT browser_read_action_fk FOREIGN KEY(release_action_id,task_id) REFERENCES browser_actions(id,task_id) ON DELETE RESTRICT;
ALTER TABLE browser_owner_views DROP CONSTRAINT IF EXISTS browser_owner_action_fk;
ALTER TABLE browser_owner_views ADD CONSTRAINT browser_owner_action_fk FOREIGN KEY(action_id,task_id) REFERENCES browser_actions(id,task_id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS browser_handoff_effects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handoff_id uuid NOT NULL REFERENCES browser_handoffs(id) ON DELETE RESTRICT,
 operation_digest bytea NOT NULL CHECK(octet_length(operation_digest)=32),original_action_id uuid NOT NULL REFERENCES browser_actions(id) ON DELETE RESTRICT,original_attempt_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','executing','unresolved','verified_received','verified_not_received')),revision int NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(handoff_id,id),UNIQUE(handoff_id,operation_digest),
 FOREIGN KEY(handoff_id,original_attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT
);
ALTER TABLE browser_actions DROP CONSTRAINT IF EXISTS browser_action_effect_fk;
ALTER TABLE browser_actions ADD CONSTRAINT browser_action_effect_fk FOREIGN KEY(handoff_id,handoff_effect_id) REFERENCES browser_handoff_effects(handoff_id,id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS browser_handoff_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handoff_id uuid NOT NULL,effect_id uuid NOT NULL,action_id uuid NOT NULL REFERENCES browser_actions(id) ON DELETE RESTRICT,attempt_id uuid NOT NULL,
 owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,owner_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT,expected_evidence_revision int NOT NULL CHECK(expected_evidence_revision>0),
 verdict text NOT NULL CHECK(verdict IN ('verified_received','verified_not_received')),evidence_artifact_id uuid REFERENCES browser_artifacts(id) ON DELETE RESTRICT,
 evidence_reference uuid,checked_at timestamptz NOT NULL,audit_seq bigint NOT NULL REFERENCES browser_audit(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(handoff_id,effect_id) REFERENCES browser_handoff_effects(handoff_id,id) ON DELETE RESTRICT,FOREIGN KEY(handoff_id,attempt_id) REFERENCES browser_handoff_attempts(handoff_id,id) ON DELETE RESTRICT,
 CHECK(evidence_artifact_id IS NOT NULL OR evidence_reference IS NOT NULL),UNIQUE(effect_id,expected_evidence_revision)
);
-- Immutable decision and execution receipts. Hashes never contain passwords.
CREATE TABLE IF NOT EXISTS browser_action_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action_id uuid NOT NULL UNIQUE REFERENCES browser_actions(id) ON DELETE RESTRICT,
 snapshot_digest bytea NOT NULL CHECK(octet_length(snapshot_digest)=32),action_revision int NOT NULL CHECK(action_revision>0),
 reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,reviewer_session_id uuid NOT NULL REFERENCES web_sessions(id) ON DELETE RESTRICT,
 decision text NOT NULL CHECK(decision IN ('approved','denied')),idempotency_key uuid NOT NULL UNIQUE,body_digest bytea NOT NULL CHECK(octet_length(body_digest)=32),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS browser_action_executions (
 action_id uuid PRIMARY KEY REFERENCES browser_actions(id) ON DELETE RESTRICT,command_id uuid NOT NULL UNIQUE REFERENCES browser_commands(id) ON DELETE RESTRICT,
 flow_nonce uuid NOT NULL UNIQUE,request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),consume_seq bigint NOT NULL UNIQUE REFERENCES browser_audit(id) ON DELETE RESTRICT,
 checkpoint_id uuid REFERENCES browser_audit_checkpoints(checkpoint_id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS browser_audit_outbox (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,action_id uuid REFERENCES browser_actions(id) ON DELETE RESTRICT,
 event text NOT NULL CHECK(event IN ('action_prepared','action_approved','action_denied','action_consumed','action_result','action_stale','vault_changed','file_changed','handoff_changed')),
 result_code varchar(80) NOT NULL CHECK(result_code ~ '^[A-Z0-9_]{1,80}$'),revision int NOT NULL CHECK(revision>0),
 chained_seq bigint UNIQUE REFERENCES browser_audit(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS browser_notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES browser_tasks(id) ON DELETE RESTRICT,action_id uuid NOT NULL REFERENCES browser_actions(id) ON DELETE RESTRICT,
 notification_revision int NOT NULL CHECK(notification_revision>0),kind text NOT NULL CHECK(kind IN ('pending','outcome')),prior_message_id bigint,current_message_id bigint,
 provider_operation_id uuid NOT NULL UNIQUE,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','cancelled')),deadline timestamptz NOT NULL,
 attempts int NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),next_attempt timestamptz,safe_error_code varchar(80) CHECK(safe_error_code ~ '^[A-Z0-9_]{1,80}$'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(task_id,action_id,notification_revision,kind)
);
CREATE OR REPLACE FUNCTION guard_browser_action_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a browser_actions%ROWTYPE;t browser_tasks%ROWTYPE;g owner_grants%ROWTYPE;e browser_handoff_effects%ROWTYPE;r browser_action_reviews%ROWTYPE;expected_action text;
BEGIN
 IF NOT browser_schema_website() THEN RAISE EXCEPTION 'BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BROWSER_RETAINED_IDENTITY' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='browser_actions' THEN
  SELECT * INTO t FROM browser_tasks WHERE id=NEW.task_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
   IF NEW.state<>'pending' OR NEW.approved_at IS NOT NULL OR NEW.owner_grant_id IS NOT NULL OR NEW.token_hash IS NOT NULL OR NEW.token_consumed_at IS NOT NULL OR NEW.command_id IS NOT NULL THEN RAISE EXCEPTION 'BROWSER_PENDING_REQUIRED' USING ERRCODE='42501'; END IF;
  ELSE
   IF OLD.state IN ('succeeded','denied','expired','stale','failed','unknown') AND OLD.secret_manifest_envelope IS NOT NULL AND NEW.secret_manifest_envelope IS NULL AND greatest(OLD.expires_at,coalesce(OLD.checked_at,OLD.expires_at))+interval '24 hours'<=clock_timestamp() AND to_jsonb(NEW)-ARRAY['secret_manifest_envelope','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['secret_manifest_envelope','updated_at'] THEN RETURN NEW; END IF;
   IF (to_jsonb(NEW)-ARRAY['state','approved_by_user_id','approver_session_id','approved_at','approval_method','token_hash','token_expires_at','token_consumed_at','owner_grant_id','command_id','transmitted_at','receipt_reference','outcome_code','checked_at','audit_consume_seq','request_digest','dispatched_flow_nonce','arm_command_id','arm_nonce_hash','armed_at','arm_deadline','click_dispatched_at','last_verified_at','handoff_effect_id','effect_evidence_revision','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','approved_by_user_id','approver_session_id','approved_at','approval_method','token_hash','token_expires_at','token_consumed_at','owner_grant_id','command_id','transmitted_at','receipt_reference','outcome_code','checked_at','audit_consume_seq','request_digest','dispatched_flow_nonce','arm_command_id','arm_nonce_hash','armed_at','arm_deadline','click_dispatched_at','last_verified_at','handoff_effect_id','effect_evidence_revision','updated_at']) THEN RAISE EXCEPTION 'BROWSER_REVIEW_IMMUTABLE' USING ERRCODE='42501'; END IF;
   IF OLD.state IN ('succeeded','denied','expired','stale','failed','unknown') THEN RAISE EXCEPTION 'BROWSER_TERMINAL' USING ERRCODE='42501'; END IF;
   IF NEW.state<>OLD.state AND NOT ((OLD.state='pending' AND NEW.state IN ('approved','denied','stale','expired')) OR (OLD.state='approved' AND NEW.state IN ('armed','executing','stale','expired')) OR (OLD.state='armed' AND NEW.state IN ('executing','stale','expired','failed')) OR (OLD.state='executing' AND NEW.state IN ('succeeded','failed','unknown'))) THEN RAISE EXCEPTION 'BROWSER_BAD_STATE' USING ERRCODE='42501'; END IF;
   IF OLD.state<>'pending' AND ROW(NEW.approved_by_user_id,NEW.approver_session_id,NEW.approved_at,NEW.approval_method,NEW.token_hash,NEW.token_expires_at,NEW.owner_grant_id) IS DISTINCT FROM ROW(OLD.approved_by_user_id,OLD.approver_session_id,OLD.approved_at,OLD.approval_method,OLD.token_hash,OLD.token_expires_at,OLD.owner_grant_id) THEN RAISE EXCEPTION 'BROWSER_APPROVAL_IMMUTABLE' USING ERRCODE='42501'; END IF;
   IF (OLD.request_digest IS NOT NULL AND ROW(NEW.request_digest,NEW.dispatched_flow_nonce) IS DISTINCT FROM ROW(OLD.request_digest,OLD.dispatched_flow_nonce)) OR (OLD.handoff_effect_id IS NOT NULL AND ROW(NEW.handoff_effect_id,NEW.effect_evidence_revision) IS DISTINCT FROM ROW(OLD.handoff_effect_id,OLD.effect_evidence_revision)) OR (OLD.arm_command_id IS NOT NULL AND ROW(NEW.arm_command_id,NEW.arm_nonce_hash,NEW.armed_at,NEW.arm_deadline) IS DISTINCT FROM ROW(OLD.arm_command_id,OLD.arm_nonce_hash,OLD.armed_at,OLD.arm_deadline)) OR (OLD.click_dispatched_at IS NOT NULL AND NEW.click_dispatched_at IS DISTINCT FROM OLD.click_dispatched_at) OR (OLD.token_consumed_at IS NOT NULL AND ROW(NEW.token_consumed_at,NEW.command_id,NEW.audit_consume_seq) IS DISTINCT FROM ROW(OLD.token_consumed_at,OLD.command_id,OLD.audit_consume_seq)) THEN RAISE EXCEPTION 'BROWSER_ONE_EXECUTION' USING ERRCODE='42501'; END IF;
  END IF;
  IF NEW.state IN ('approved','armed','executing') THEN
   IF NEW.category='delegated_login' AND NOT EXISTS(SELECT 1 FROM browser_logins l JOIN browser_login_access access_row ON access_row.login_id=l.id WHERE l.id=t.vault_login_id AND l.revision=t.vault_revision AND l.disabled_at IS NULL AND l.deleted_at IS NULL AND access_row.user_id=NEW.initiating_user_id AND access_row.revoked_at IS NULL) THEN RAISE EXCEPTION 'BROWSER_LOGIN_REVOKED' USING ERRCODE='42501'; END IF;
   IF NOT browser_schema_person(NEW.approver_session_id,NEW.approved_by_user_id,NEW.needs_owner) OR (NOT NEW.needs_owner AND NEW.approved_by_user_id<>NEW.initiating_user_id) THEN RAISE EXCEPTION 'BROWSER_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
   IF t.state NOT IN ('active','paused') OR ROW(NEW.document_epoch,NEW.control_epoch,NEW.context_boot_id) IS DISTINCT FROM ROW(t.document_epoch,t.control_epoch,t.controller_boot_id) OR NEW.expires_at<=clock_timestamp() OR NEW.token_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'BROWSER_REVIEW_STALE' USING ERRCODE='42501'; END IF;
   SELECT * INTO r FROM browser_action_reviews WHERE action_id=NEW.id;
   IF NOT FOUND OR r.decision<>'approved' OR ROW(r.reviewer_user_id,r.reviewer_session_id,r.action_revision,r.snapshot_digest) IS DISTINCT FROM ROW(NEW.approved_by_user_id,NEW.approver_session_id,NEW.revision,NEW.snapshot_digest) THEN RAISE EXCEPTION 'BROWSER_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
   IF NEW.needs_owner THEN
    SELECT * INTO g FROM owner_grants WHERE id=NEW.owner_grant_id FOR UPDATE;
    expected_action:=CASE NEW.kind WHEN 'pay' THEN 'external_browser_pay' WHEN 'sign' THEN 'external_browser_sign' ELSE 'external_browser_submit' END;
    IF NOT FOUND OR g.status<>'approved' OR g.actions IS DISTINCT FROM ARRAY[expected_action] OR g.target_kind IS DISTINCT FROM 'browser_action' OR g.target_id IS DISTINCT FROM NEW.id::text OR g.run_id IS DISTINCT FROM NEW.run_id OR g.max_uses<>1 OR g.expires_at>NEW.expires_at OR g.expires_at<=clock_timestamp()
      OR g.scope->>'snapshot_digest' IS DISTINCT FROM encode(NEW.snapshot_digest,'hex') OR g.scope->>'action_revision' IS DISTINCT FROM NEW.revision::text
      OR g.scope->>'amount_cents' IS DISTINCT FROM NEW.amount_cents::text OR g.scope->>'currency' IS DISTINCT FROM NEW.currency::text OR g.scope->>'payee' IS DISTINCT FROM NEW.payee THEN RAISE EXCEPTION 'BROWSER_EXACT_GRANT_REQUIRED' USING ERRCODE='42501'; END IF;
   END IF;
   IF NEW.handoff_id IS NOT NULL AND NEW.needs_owner THEN
    SELECT * INTO e FROM browser_handoff_effects WHERE id=NEW.handoff_effect_id AND handoff_id=NEW.handoff_id FOR UPDATE;
    IF NOT FOUND OR e.revision<>NEW.effect_evidence_revision OR e.state NOT IN ('ready','verified_not_received') OR NOT EXISTS(SELECT 1 FROM browser_handoff_attempts WHERE id=NEW.handoff_attempt_id AND destination_task_id=NEW.task_id) THEN RAISE EXCEPTION 'BROWSER_EFFECT_UNRESOLVED' USING ERRCODE='42501'; END IF;
   END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.state='armed' AND OLD.state='approved' AND (NEW.review_mode<>'preclick' OR NEW.arm_command_id IS NULL OR NEW.arm_nonce_hash IS NULL OR NEW.armed_at IS NULL OR NEW.arm_deadline IS NULL OR NEW.arm_deadline>least(NEW.token_expires_at,NEW.expires_at,clock_timestamp()+interval '10 seconds')) THEN RAISE EXCEPTION 'BROWSER_ARM_REQUIRED' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND NEW.state='executing' AND OLD.state<>'executing' THEN
   IF OLD.token_consumed_at IS NOT NULL OR NEW.token_consumed_at IS NULL OR (NEW.review_mode='buffered' AND OLD.state<>'approved') OR (NEW.review_mode='preclick' AND (OLD.state<>'armed' OR NEW.click_dispatched_at IS NULL OR NEW.arm_deadline<=clock_timestamp())) THEN RAISE EXCEPTION 'BROWSER_ONE_EXECUTION' USING ERRCODE='42501'; END IF;
   IF NOT EXISTS(SELECT 1 FROM browser_audit au WHERE au.id=NEW.audit_consume_seq AND au.event='action_consumed' AND au.object_id=NEW.id AND au.task_id=NEW.task_id) OR NOT EXISTS(SELECT 1 FROM browser_audit_outbox o JOIN browser_audit au ON au.id=o.chained_seq WHERE o.action_id=NEW.id AND o.event='action_approved' AND au.object_id=NEW.id) THEN RAISE EXCEPTION 'BROWSER_AUDIT_REQUIRED' USING ERRCODE='42501'; END IF;
   IF NOT EXISTS(SELECT 1 FROM browser_commands c WHERE c.id=NEW.command_id AND c.task_id=NEW.task_id AND c.run_id=NEW.run_id AND c.initiator_user_id=NEW.initiating_user_id) THEN RAISE EXCEPTION 'BROWSER_COMMAND_BINDING' USING ERRCODE='42501'; END IF;
   IF NEW.needs_owner THEN
    IF g.uses<>0 THEN RAISE EXCEPTION 'BROWSER_GRANT_CONSUMED' USING ERRCODE='42501'; END IF;
    UPDATE owner_grants SET uses=1,used_at=now(),updated_at=now() WHERE id=g.id;
   END IF;
   IF NEW.handoff_effect_id IS NOT NULL THEN UPDATE browser_handoff_effects SET state='executing',revision=revision+1,updated_at=now() WHERE id=NEW.handoff_effect_id; END IF;
   INSERT INTO browser_action_executions(action_id,command_id,flow_nonce,request_digest,consume_seq) VALUES(NEW.id,NEW.command_id,NEW.dispatched_flow_nonce,NEW.request_digest,NEW.audit_consume_seq);
  END IF;
 ELSIF TG_TABLE_NAME='browser_action_reviews' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'BROWSER_REVIEW_IMMUTABLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM browser_actions WHERE id=NEW.action_id FOR UPDATE;
  IF a.state<>'pending' OR a.expires_at<=clock_timestamp() OR ROW(a.snapshot_digest,a.revision) IS DISTINCT FROM ROW(NEW.snapshot_digest,NEW.action_revision) OR NOT browser_schema_person(NEW.reviewer_session_id,NEW.reviewer_user_id,a.needs_owner) OR (NOT a.needs_owner AND NEW.reviewer_user_id<>a.initiating_user_id) THEN RAISE EXCEPTION 'BROWSER_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_action_executions' THEN
  IF TG_OP='UPDATE' AND OLD.checkpoint_id IS NOT NULL AND NEW.checkpoint_id IS DISTINCT FROM OLD.checkpoint_id THEN RAISE EXCEPTION 'BROWSER_CHECKPOINT_IMMUTABLE' USING ERRCODE='42501'; END IF;
  IF NEW.checkpoint_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_audit_checkpoints WHERE checkpoint_id=NEW.checkpoint_id AND through_seq>=NEW.consume_seq AND sink_signature IS NOT NULL) THEN RAISE EXCEPTION 'BROWSER_CHECKPOINT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'checkpoint_id') IS DISTINCT FROM (to_jsonb(OLD)-'checkpoint_id') THEN RAISE EXCEPTION 'BROWSER_ONE_EXECUTION' USING ERRCODE='42501'; END IF;
  IF TG_OP='INSERT' AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'BROWSER_CONSUME_REQUIRED' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_handoff_reconciliations' THEN
  IF TG_OP<>'INSERT' OR NOT browser_schema_person(NEW.owner_session_id,NEW.owner_user_id,true) THEN RAISE EXCEPTION 'BROWSER_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM browser_actions WHERE id=NEW.action_id;
  IF ROW(a.handoff_id,a.handoff_effect_id,a.handoff_attempt_id) IS DISTINCT FROM ROW(NEW.handoff_id,NEW.effect_id,NEW.attempt_id) THEN RAISE EXCEPTION 'BROWSER_EFFECT_BINDING' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_handoff_effects' THEN
  IF NOT EXISTS(SELECT 1 FROM browser_actions original_action WHERE original_action.id=NEW.original_action_id AND original_action.handoff_id=NEW.handoff_id AND original_action.handoff_attempt_id=NEW.original_attempt_id) THEN RAISE EXCEPTION 'BROWSER_EFFECT_BINDING' USING ERRCODE='42501'; END IF;
  IF TG_OP='INSERT' AND NEW.state<>'ready' THEN RAISE EXCEPTION 'BROWSER_EFFECT_BINDING' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','updated_at']) OR NEW.revision<>OLD.revision+1 OR OLD.state='verified_received' OR NOT ((OLD.state IN ('ready','verified_not_received') AND NEW.state='executing') OR (OLD.state='executing' AND NEW.state IN ('unresolved','verified_received')) OR (OLD.state='unresolved' AND NEW.state IN ('verified_not_received','verified_received') AND EXISTS(SELECT 1 FROM browser_handoff_reconciliations WHERE effect_id=OLD.id AND expected_evidence_revision=OLD.revision AND verdict=NEW.state)))) THEN RAISE EXCEPTION 'BROWSER_EFFECT_UNRESOLVED' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_audit_outbox' THEN
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'chained_seq') IS DISTINCT FROM (to_jsonb(OLD)-'chained_seq') OR OLD.chained_seq IS NOT NULL) THEN RAISE EXCEPTION 'BROWSER_AUDIT_IMMUTABLE' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='browser_artifacts' AND TG_OP='UPDATE' THEN
  IF OLD.tombstoned_at IS NOT NULL AND NEW.deleted_at IS NOT NULL AND NEW.envelope IS NULL AND NEW.original_hash_envelope IS NULL AND to_jsonb(NEW)-ARRAY['envelope','original_hash_envelope','deleted_at','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['envelope','original_hash_envelope','deleted_at','updated_at'] THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW)-ARRAY['deleted_at','tombstoned_at','updated_at','sanitizer_build','sanitizer_policy','signature_version','sanitizer_result','original_hash_envelope','sanitized_ciphertext_hash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deleted_at','tombstoned_at','updated_at','sanitizer_build','sanitizer_policy','signature_version','sanitizer_result','original_hash_envelope','sanitized_ciphertext_hash']) OR (OLD.sanitizer_result IN ('validated','rejected') AND ROW(NEW.sanitizer_build,NEW.sanitizer_policy,NEW.signature_version,NEW.sanitizer_result,NEW.original_hash_envelope,NEW.sanitized_ciphertext_hash) IS DISTINCT FROM ROW(OLD.sanitizer_build,OLD.sanitizer_policy,OLD.signature_version,OLD.sanitizer_result,OLD.original_hash_envelope,OLD.sanitized_ciphertext_hash)) THEN RAISE EXCEPTION 'BROWSER_ARTIFACT_IMMUTABLE' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_browser_action_schema() FROM PUBLIC;
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['browser_actions','browser_artifacts','browser_action_reviews','browser_action_executions','browser_handoff_effects','browser_handoff_reconciliations','browser_audit_outbox','browser_notification_deliveries'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS guard_browser_action_schema ON %I',tab);
 EXECUTE format('CREATE TRIGGER guard_browser_action_schema BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_browser_action_schema()',tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION record_browser_action_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.state='executing' AND NEW.handoff_effect_id IS NOT NULL AND NEW.state IN ('succeeded','failed','unknown') THEN
  UPDATE browser_handoff_effects SET state=CASE NEW.state WHEN 'succeeded' THEN 'verified_received' ELSE 'unresolved' END,revision=revision+1,updated_at=now() WHERE id=NEW.handoff_effect_id AND state='executing';
 END IF;
 IF TG_OP='INSERT' OR NEW.state<>OLD.state THEN
  INSERT INTO browser_audit_outbox(task_id,action_id,event,result_code,revision) VALUES(NEW.task_id,NEW.id,
   CASE NEW.state WHEN 'pending' THEN 'action_prepared' WHEN 'approved' THEN 'action_approved' WHEN 'denied' THEN 'action_denied' WHEN 'executing' THEN 'action_consumed' WHEN 'stale' THEN 'action_stale' ELSE 'action_result' END,'BROWSER_'||upper(NEW.state),NEW.revision);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION record_browser_action_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS record_browser_action_schema ON browser_actions;
CREATE TRIGGER record_browser_action_schema AFTER INSERT OR UPDATE ON browser_actions FOR EACH ROW EXECUTE FUNCTION record_browser_action_schema();
CREATE OR REPLACE FUNCTION fence_browser_action_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='web_sessions' THEN
  IF ROW(NEW.revoked_at,NEW.generation) IS DISTINCT FROM ROW(OLD.revoked_at,OLD.generation) OR NEW.expires_at<=now() THEN
   UPDATE browser_actions a SET state='stale',outcome_code='BROWSER_SESSION_REVOKED',updated_at=now() WHERE state IN ('pending','approved','armed') AND
    (approver_session_id=NEW.id OR EXISTS(SELECT 1 FROM browser_tasks t WHERE t.id=a.task_id AND t.initiating_web_session_id=NEW.id));
  END IF;
 ELSE
  IF ROW(NEW.document_epoch,NEW.control_epoch,NEW.manifest_revision,NEW.vault_context_generation,NEW.state) IS DISTINCT FROM ROW(OLD.document_epoch,OLD.control_epoch,OLD.manifest_revision,OLD.vault_context_generation,OLD.state) THEN
   UPDATE browser_actions SET state='stale',outcome_code='BROWSER_CONTEXT_CHANGED',updated_at=now() WHERE task_id=NEW.id AND state IN ('pending','approved','armed');
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fence_browser_action_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS fence_browser_action_schema ON web_sessions;
CREATE TRIGGER fence_browser_action_schema AFTER UPDATE ON web_sessions FOR EACH ROW EXECUTE FUNCTION fence_browser_action_schema();
DROP TRIGGER IF EXISTS fence_browser_action_schema ON browser_tasks;
CREATE TRIGGER fence_browser_action_schema AFTER UPDATE ON browser_tasks FOR EACH ROW EXECUTE FUNCTION fence_browser_action_schema();
-- The service holds HMAC/signing keys outside Postgres; SQL never authenticates a
-- purported HMAC/ack by itself. Controller/offline verifier MUST verify signatures.
ALTER TABLE browser_audit DROP CONSTRAINT IF EXISTS browser_audit_event_check;
ALTER TABLE browser_audit ADD CONSTRAINT browser_audit_event_check CHECK(event IN ('task_admitted','run_attached','run_ended','task_transition','viewer_joined','viewer_left','session_revoked','command_begin','command_finish','manifest_published','read_consumed','checkpoint','maintenance','action_prepared','action_approved','action_denied','action_consumed','action_result','action_stale','vault_changed','file_changed','handoff_changed','key_rotated','retention_boundary'));
ALTER TABLE browser_audit_checkpoints ADD COLUMN IF NOT EXISTS install_id uuid;
ALTER TABLE browser_audit_checkpoints ADD COLUMN IF NOT EXISTS boot_id uuid;
ALTER TABLE browser_audit_checkpoints ADD COLUMN IF NOT EXISTS sink_key_id varchar(80);
ALTER TABLE browser_audit_checkpoints ADD COLUMN IF NOT EXISTS sink_signature bytea CHECK(octet_length(sink_signature)=64);
ALTER TABLE browser_audit_checkpoints ADD COLUMN IF NOT EXISTS prior_checkpoint_id uuid REFERENCES browser_audit_checkpoints(checkpoint_id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION guard_browser_chain_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE head browser_audit_heads%ROWTYPE;prev bigint;
BEGIN
 IF NOT browser_schema_website() OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'BROWSER_AUDIT_APPEND_ONLY' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='browser_audit' THEN
  INSERT INTO browser_audit_heads(singleton,seq,digest) VALUES(true,0,decode(repeat('00',32),'hex')) ON CONFLICT DO NOTHING;
  SELECT * INTO head FROM browser_audit_heads WHERE singleton FOR UPDATE;
  IF NEW.id<>head.seq+1 OR NEW.previous_digest<>head.digest THEN RAISE EXCEPTION 'BROWSER_AUDIT_HEAD_CONFLICT' USING ERRCODE='40001'; END IF;
  UPDATE browser_audit_heads SET seq=NEW.id,digest=NEW.digest,updated_at=now() WHERE singleton;
 ELSE
  SELECT max(through_seq) INTO prev FROM browser_audit_checkpoints;
  IF NEW.through_seq<=coalesce(prev,0) OR NEW.install_id IS NULL OR NEW.boot_id IS NULL OR NEW.sink_key_id IS NULL OR NEW.sink_signature IS NULL OR octet_length(NEW.signature)<>64 OR NOT EXISTS(SELECT 1 FROM browser_audit WHERE id=NEW.through_seq AND digest=NEW.digest) THEN RAISE EXCEPTION 'BROWSER_CHECKPOINT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_browser_chain_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_browser_chain_schema ON browser_audit;
CREATE TRIGGER guard_browser_chain_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_audit FOR EACH ROW EXECUTE FUNCTION guard_browser_chain_schema();
DROP TRIGGER IF EXISTS guard_browser_chain_schema ON browser_audit_checkpoints;
CREATE TRIGGER guard_browser_chain_schema BEFORE INSERT OR UPDATE OR DELETE ON browser_audit_checkpoints FOR EACH ROW EXECUTE FUNCTION guard_browser_chain_schema();

-- node scripts/db-roles-sql.mjs browser_actions browser_artifacts browser_handoff_effects browser_handoff_reconciliations browser_action_reviews browser_action_executions browser_audit_outbox browser_notification_deliveries
-- Output: empty (all of these tables intentionally grant no narrow privileges).
DO $$ DECLARE tab text; r text; BEGIN
 FOREACH tab IN ARRAY ARRAY['browser_actions','browser_artifacts','browser_handoff_effects','browser_handoff_reconciliations','browser_action_reviews','browser_action_executions','browser_audit_outbox','browser_notification_deliveries'] LOOP
 EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',tab);
 FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly','sjcos_browser','sjcos_browser_reader'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',tab,r); END IF;
 END LOOP;
 END LOOP; END $$;
CREATE OR REPLACE FUNCTION fence_browser_action_authority_schema() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='owner_grants' THEN
  IF NEW.status IN ('revoked','denied') OR NEW.expires_at<=clock_timestamp() THEN UPDATE browser_actions SET state='stale',outcome_code='BROWSER_GRANT_REVOKED',updated_at=now() WHERE owner_grant_id=NEW.id AND state IN ('pending','approved','armed'); END IF;
 ELSE
  IF ROW(NEW.active,NEW.role,NEW.permissions) IS DISTINCT FROM ROW(OLD.active,OLD.role,OLD.permissions) THEN UPDATE browser_actions SET state='stale',outcome_code='BROWSER_ACCESS_CHANGED',updated_at=now() WHERE (initiating_user_id=NEW.id OR approved_by_user_id=NEW.id) AND state IN ('pending','approved','armed'); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fence_browser_action_authority_schema() FROM PUBLIC;
DROP TRIGGER IF EXISTS fence_browser_action_authority_schema ON owner_grants;
CREATE TRIGGER fence_browser_action_authority_schema AFTER UPDATE ON owner_grants FOR EACH ROW EXECUTE FUNCTION fence_browser_action_authority_schema();
DROP TRIGGER IF EXISTS fence_browser_action_authority_schema ON users;
CREATE TRIGGER fence_browser_action_authority_schema AFTER UPDATE OF active,role,permissions ON users FOR EACH ROW EXECUTE FUNCTION fence_browser_action_authority_schema();
-- Content-free audit columns cannot become a URL-query or free-text channel.
ALTER TABLE browser_audit DROP CONSTRAINT IF EXISTS browser_audit_safe_fields;
ALTER TABLE browser_audit ADD CONSTRAINT browser_audit_safe_fields CHECK(result_code ~ '^[A-Z0-9_]{1,80}$' AND key_id ~ '^[a-z0-9_-]{1,80}$' AND (canonical_origin IS NULL OR browser_schema_origin(canonical_origin)) AND (revision IS NULL OR revision>0));
ALTER TABLE browser_audit_checkpoints DROP CONSTRAINT IF EXISTS browser_checkpoint_safe_fields;
ALTER TABLE browser_audit_checkpoints ADD CONSTRAINT browser_checkpoint_safe_fields CHECK(external_ack_id ~ '^[a-zA-Z0-9_-]{1,120}$' AND key_id ~ '^[a-z0-9_-]{1,80}$' AND (sink_key_id IS NULL OR sink_key_id ~ '^[a-z0-9_-]{1,80}$'));
