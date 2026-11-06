-- Native owner alerts; owner authentication remains in the API/command layer.
CREATE TABLE IF NOT EXISTS push_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 platform text NOT NULL CHECK(platform IN ('ios','android')), token text NOT NULL UNIQUE,
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 app_version text, build text, device_name text, created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz, disabled_reason text
);
-- 0004 already created a placeholder registry, including web subscriptions.
-- Preserve those rows; only ios/android registrations are accepted by the API.
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox' CHECK(environment IN ('sandbox','production'));
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS app_version text;
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS build text;
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS device_name text;
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS disabled_reason text;
-- Tokens are unique across native platforms; retain the newest registration.
DELETE FROM push_devices a USING push_devices b WHERE a.token=b.token AND (a.created_at,a.id)<(b.created_at,b.id);
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_token ON push_devices(token);
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
UPDATE push_devices SET disabled_at=revoked_at,disabled_reason='Previously removed' WHERE revoked_at IS NOT NULL AND disabled_at IS NULL;
CREATE INDEX IF NOT EXISTS push_devices_user ON push_devices(user_id) WHERE disabled_at IS NULL;
CREATE TABLE IF NOT EXISTS owner_push_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, title text NOT NULL, body text, href text,
 decision_id uuid REFERENCES decisions(id), work_item_id uuid REFERENCES work_items(id), grant_id uuid REFERENCES owner_grants(id),
 portal_channel_key text, portal_message_id text, owner_reply_id uuid REFERENCES owner_replies(id),
 reply_to_id uuid REFERENCES owner_push_messages(id), thread_key text NOT NULL, category text NOT NULL,
 state text NOT NULL CHECK(state IN ('open','decided','info')), outcome text, content_hash text, sends boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, push_outbox_id bigint REFERENCES push_outbox(id),
 delivered_channels text[] NOT NULL DEFAULT '{}', telegram_message_id text, cleanup_pending boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS owner_push_messages_feed ON owner_push_messages(created_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS owner_push_messages_outbox ON owner_push_messages(push_outbox_id) WHERE push_outbox_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS owner_push_messages_thread ON owner_push_messages(thread_key,created_at);
CREATE TABLE IF NOT EXISTS push_actions (
 id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES owner_push_messages(id), user_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL CHECK(action IN ('approve','decline','changes','hold','reply')), text text, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE owner_replies ADD COLUMN IF NOT EXISTS push_message_id uuid REFERENCES owner_push_messages(id);
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS channels text[];

-- A registration is authorized by the actual login, never its renewal time.
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS session_auth_at timestamptz;
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS session_expires_at timestamptz;
ALTER TABLE push_actions ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1;
ALTER TABLE owner_push_messages ADD COLUMN IF NOT EXISTS "from" text NOT NULL DEFAULT 'system' CHECK ("from" IN ('owner','agent','system'));
ALTER TABLE owner_push_messages ADD COLUMN IF NOT EXISTS agent_name text;
ALTER TABLE owner_push_messages ADD COLUMN IF NOT EXISTS draft_binding text;
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS summary_id bigint REFERENCES push_outbox(id);
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS approval_revision uuid NOT NULL DEFAULT gen_random_uuid();

-- Rotate on resubmission; failed-send reopening retains the same revision.
CREATE OR REPLACE FUNCTION phone_push_draft_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NEW.approval_status='requested' AND OLD.approval_status IN ('not_requested','rejected') THEN NEW.approval_revision=gen_random_uuid(); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phone_push_draft_revision ON work_items;
CREATE TRIGGER phone_push_draft_revision BEFORE UPDATE OF approval_status ON work_items FOR EACH ROW EXECUTE FUNCTION phone_push_draft_revision();

-- Owner-only immutable approval evidence; the sender receives its id, never
-- derives an outbound payload from a later read of knowledge/receipts/targets.
CREATE TABLE IF NOT EXISTS approved_work_item_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
 binding text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approved_work_item_drafts_item ON approved_work_item_drafts(work_item_id);

-- One statement produces BOTH the binding and every input used by dispatch.
CREATE OR REPLACE FUNCTION phone_push_draft_source(item uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT to_jsonb(s) || jsonb_build_object('binding',md5(to_jsonb(s)::text)) FROM (
 SELECT w.approval_revision,w.title,w.body,w.assignee_key,w.lead_id,l.slug AS lead_slug,l.email AS lead_email,
        w.project_id,p.slug AS project_slug,
        NULLIF(COALESCE(NULLIF(p.client_email,''),pl.email),'') AS project_email,
        r.id AS receipt_id,k.content,r.uri AS knowledge_uri,k.created_at AS draft_at,
        ps.portal_slug,
        EXISTS(SELECT 1 FROM users u WHERE u.role='client' AND u.active AND u.link_slug=ps.portal_slug) AS portal_login,
        COALESCE(NULLIF(p.client_name,''),l.name,pl.name) AS portal_client
 FROM work_items w
 LEFT JOIN leads l ON l.id=w.lead_id
 LEFT JOIN projects p ON p.id=w.project_id
 LEFT JOIN leads pl ON pl.id=p.lead_id
 LEFT JOIN LATERAL (SELECT id,uri FROM agent_receipts WHERE work_item_id=w.id AND receipt_kind='draft' AND uri LIKE 'knowledge_items/%' ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
 LEFT JOIN knowledge_items k ON 'knowledge_items/'||k.id::text=r.uri
 LEFT JOIN LATERAL (SELECT COALESCE(p.slug,(SELECT lp.slug FROM projects lp WHERE lp.lead_id=l.id ORDER BY lp.created_at DESC LIMIT 1),'lead:'||l.slug) AS portal_slug) ps ON true
 WHERE w.id=item
 ) s
$$;
CREATE OR REPLACE FUNCTION phone_push_draft_binding(item uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT phone_push_draft_source(item)->>'binding'
$$;
ALTER TABLE push_actions ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'claimed';
ALTER TABLE push_actions ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE push_actions ADD COLUMN IF NOT EXISTS evidence jsonb;
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS claimed_until timestamptz;
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS counted_at timestamptz;
CREATE TABLE IF NOT EXISTS push_device_deliveries (
 message_id uuid NOT NULL REFERENCES owner_push_messages(id),
 device_id uuid NOT NULL REFERENCES push_devices(id),
 delivered_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(message_id,device_id)
);
CREATE INDEX IF NOT EXISTS owner_push_messages_decision ON owner_push_messages(decision_id);
CREATE INDEX IF NOT EXISTS owner_push_messages_work_item ON owner_push_messages(work_item_id);
-- Reconcile on reads as well as writes: expiry/hold expiry has no UPDATE event.
CREATE OR REPLACE FUNCTION phone_push_reconcile() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 WITH live AS (
 SELECT m.id,
 CASE WHEN d.status='pending' AND d.expires_at>now() AND (d.held_until IS NULL OR d.held_until<=now()) AND d.content_hash LIKE m.content_hash||'%' THEN 'open' ELSE 'decided' END AS state,
 CASE WHEN d.status='pending' AND d.held_until>now() THEN 'On hold until '||CASE WHEN (d.held_until AT TIME ZONE 'America/Chicago')::date=(now() AT TIME ZONE 'America/Chicago')::date THEN to_char(d.held_until AT TIME ZONE 'America/Chicago','FMHH12:MI am') ELSE to_char(d.held_until AT TIME ZONE 'America/Chicago','Mon FMDD "at" FMHH12:MI am') END||' Central'
 WHEN d.status='pending' AND d.expires_at<=now() THEN 'Expired'
 WHEN d.status='pending' AND d.content_hash NOT LIKE m.content_hash||'%' THEN 'Superseded by a newer card'
 WHEN d.status='rejected' AND d.decision_note LIKE 'Changes requested%' THEN 'changes_requested' || COALESCE(' — '||d.decision_note,'')
 WHEN d.status<>'pending' THEN d.status || COALESCE(' — '||d.decision_note,'') END AS outcome
 FROM owner_push_messages m JOIN decisions d ON d.id=m.decision_id
 WHERE m.category IN ('SJC_DECISION','SJC_GRANT','SJC_DECISION_SEND','SJC_GRANT_SEND')
 UNION ALL
 SELECT m.id, CASE WHEN w.approval_status='requested' AND m.draft_binding=phone_push_draft_binding(w.id) AND m.id=(SELECT m2.id FROM owner_push_messages m2 WHERE m2.work_item_id=w.id AND m2.draft_binding=phone_push_draft_binding(w.id) AND m2.category IN ('SJC_DRAFT','SJC_DRAFT_SEND') ORDER BY m2.created_at DESC,m2.id DESC LIMIT 1) THEN 'open' ELSE 'decided' END,
 CASE WHEN m.draft_binding IS DISTINCT FROM phone_push_draft_binding(w.id) THEN 'Replaced by a newer card' WHEN w.approval_status='not_requested' THEN 'Changes requested' WHEN w.approval_status<>'requested' THEN w.approval_status || COALESCE(' — '||w.blocked_reason,'') ELSE 'Superseded by a newer card' END
 FROM owner_push_messages m JOIN work_items w ON w.id=m.work_item_id WHERE m.category IN ('SJC_DRAFT','SJC_DRAFT_SEND')
 ) UPDATE owner_push_messages m SET state=l.state,outcome=CASE WHEN l.state='open' THEN NULL ELSE l.outcome END,cleanup_pending=l.state='decided'
 FROM live l WHERE m.id=l.id AND (m.state IS DISTINCT FROM l.state OR m.outcome IS DISTINCT FROM CASE WHEN l.state='open' THEN NULL ELSE l.outcome END);
END $$;
CREATE OR REPLACE FUNCTION phone_push_decided() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 PERFORM phone_push_reconcile(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS phone_push_decision ON decisions;
CREATE TRIGGER phone_push_decision AFTER UPDATE OF status,held_until,content_hash ON decisions FOR EACH ROW EXECUTE FUNCTION phone_push_decided();
DROP TRIGGER IF EXISTS phone_push_work_item ON work_items;
CREATE TRIGGER phone_push_work_item AFTER UPDATE OF approval_status ON work_items FOR EACH ROW EXECUTE FUNCTION phone_push_decided();
-- Remove the R0 table-wide grants, including a previously applied R0 install.
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON push_devices FROM %I',r); END IF;
 END LOOP;
END $$;
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'owner_push_messages');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'owner_push_messages');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'owner_push_messages');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'push_device_deliveries');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'push_device_deliveries');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'push_device_deliveries');
SELECT sjcos_grant('sjcos_agent', 'SELECT, INSERT, UPDATE', 'push_outbox');
SELECT sjcos_grant('sjcos_worker', 'SELECT, INSERT, UPDATE', 'push_outbox');
SELECT sjcos_grant('sjcos_readonly', 'SELECT', 'push_outbox');

ALTER TABLE push_outbox DROP CONSTRAINT IF EXISTS push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check CHECK(kind IN ('grant','decision','urgent_item','agent_failure','stale_approval','approval_needed','sms_inbound','voice_call','comms','payment','contract_signed','portal_message','reply','ack'));
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS conversation_key text;
CREATE UNIQUE INDEX IF NOT EXISTS push_outbox_conversation ON push_outbox(conversation_key);

CREATE OR REPLACE FUNCTION sjcos_disable_push_device(device uuid, reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF reason NOT IN ('BadDeviceToken','Unregistered') THEN RAISE EXCEPTION 'Invalid device failure'; END IF;
 UPDATE push_devices SET disabled_at=now(),disabled_reason=reason WHERE id=device AND disabled_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION sjcos_disable_push_device(uuid,text) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION sjcos_disable_push_device(uuid,text) TO %I',r); END IF;
 END LOOP;
END $$;
SELECT sjcos_grant('sjcos_agent', 'SELECT (id, user_id, platform, token, environment, disabled_at, revoked_at, session_auth_at, session_expires_at)', 'push_devices');
SELECT sjcos_grant('sjcos_worker', 'SELECT (id, user_id, platform, token, environment, disabled_at, revoked_at, session_auth_at, session_expires_at)', 'push_devices');

-- Only the owner creates frozen approval evidence; the worker reads for recovery.
REVOKE ALL ON approved_work_item_drafts FROM PUBLIC;
REVOKE ALL ON FUNCTION phone_push_draft_source(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION phone_push_approved_draft_frozen() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Approved draft snapshots are immutable';
END $$;
DROP TRIGGER IF EXISTS phone_push_approved_draft_frozen ON approved_work_item_drafts;
CREATE TRIGGER phone_push_approved_draft_frozen BEFORE UPDATE ON approved_work_item_drafts FOR EACH ROW EXECUTE FUNCTION phone_push_approved_draft_frozen();

-- Approval checkpoint: created in the SAME transaction as the frozen source
-- and approval gate. Pending may be dispatched; interrupted running work is
-- held for review (existing email intents reconcile, never blindly resend).
CREATE TABLE IF NOT EXISTS approved_draft_dispatches (
 approved_draft_id uuid PRIMARY KEY REFERENCES approved_work_item_drafts(id) ON DELETE CASCADE,
 phase text NOT NULL DEFAULT 'pending' CHECK (phase IN ('pending','running','done','needs_review')),
 lease_until timestamptz, result jsonb
);
CREATE INDEX IF NOT EXISTS approved_draft_dispatches_pending ON approved_draft_dispatches(phase,lease_until);
REVOKE ALL ON approved_draft_dispatches FROM PUBLIC;
-- node scripts/db-roles-sql.mjs approved_draft_dispatches approved_work_item_drafts
SELECT sjcos_grant('sjcos_worker', 'SELECT, UPDATE (phase, lease_until, result)', 'approved_draft_dispatches');
SELECT sjcos_grant('sjcos_worker', 'SELECT', 'approved_work_item_drafts');

-- Worker cannot insert arbitrary owner portal messages. This one-purpose
-- helper posts only the immutable, already-approved portal body/recipient.
CREATE OR REPLACE FUNCTION phone_push_post_approved_portal(draft uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s jsonb; lines text[]; parts text[]; i integer := 1; portal boolean := false;
        body text; me users%ROWTYPE; posted bigint;
BEGIN
 SELECT a.snapshot INTO s FROM approved_work_item_drafts a
 JOIN approved_draft_dispatches d ON d.approved_draft_id=a.id
 WHERE a.id=draft AND d.phase='running' FOR UPDATE OF d;
 IF s IS NULL OR NOT COALESCE((s->>'portal_login')::boolean,false) OR s->>'portal_slug' IS NULL THEN
   RAISE EXCEPTION 'No approved portal dispatch';
 END IF;
 lines := regexp_split_to_array(regexp_replace(s->>'content','^\s+',''),E'\r?\n');
 WHILE i <= cardinality(lines) LOOP
   IF btrim(lines[i],E' \t\r\n')='' THEN i:=i+1; EXIT; END IF;
   parts:=regexp_match(lines[i],'^(To|Subject|From|Cc|Channel|Via):\s*(.*)$','i');
   IF parts IS NULL THEN EXIT; END IF;
   IF lower(parts[1]) IN ('to','channel','via') AND
     btrim(regexp_replace(parts[2],'<[^>]*>','','g')) ~* '^(the\s+)?(client\s+)?portal(\s+(thread|message|messages|chat))?$' THEN portal:=true; END IF;
   i:=i+1;
 END LOOP;
 body:=btrim(array_to_string(lines[i:cardinality(lines)],E'\n'),E' \t\r\n');
 IF NOT portal OR COALESCE(body,'')='' THEN RAISE EXCEPTION 'Not an approved portal body'; END IF;
 -- Idempotent even for accidental repeated helper calls after the post.
 SELECT split_part(uri,'/',2)::bigint INTO posted FROM agent_receipts
 WHERE work_item_id=(SELECT work_item_id FROM approved_work_item_drafts WHERE id=draft)
 AND receipt_kind='portal_message' AND uri LIKE 'chat_messages/%'
 AND created_at>(s->>'draft_at')::timestamptz ORDER BY created_at DESC LIMIT 1;
 IF posted IS NOT NULL THEN RETURN posted; END IF;
 SELECT * INTO me FROM users WHERE role='owner' AND active ORDER BY created_at LIMIT 1;
 INSERT INTO chat_messages(channel_key,author_kind,author_name,author_initials,body,author_user_id)
 VALUES('portal:'||(s->>'portal_slug'),'owner',COALESCE(me.name,'Joe'),COALESCE(me.initials,'JS'),body,me.id)
 RETURNING id INTO posted;
 -- Receipt shares the post's transaction, including helper calls by worker.
 INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label)
 SELECT work_item_id,'portal_message','chat_messages/'||posted,'Approved reply posted in the client portal'
 FROM approved_work_item_drafts WHERE id=draft;
 RETURN posted;
END $$;
REVOKE ALL ON FUNCTION phone_push_post_approved_portal(uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_worker') THEN
   GRANT EXECUTE ON FUNCTION phone_push_post_approved_portal(uuid) TO sjcos_worker;
 END IF;
END $$;
