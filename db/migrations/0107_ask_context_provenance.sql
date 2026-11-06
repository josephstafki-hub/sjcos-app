-- Private website-only provenance. Versions keep revision/manifest hash, no FK.
CREATE TABLE ask_context_provenance (
 conversation_id uuid PRIMARY KEY REFERENCES ai_conversations(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 unknown boolean NOT NULL DEFAULT false,
 tracker_version integer NOT NULL DEFAULT 1,
 classifier_version integer NOT NULL DEFAULT 1,
 epoch_run_id uuid,
 policy_hash text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ask_context_inputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
 run_id uuid,
 kind text NOT NULL CHECK(length(kind)<=40),
 ref text NOT NULL CHECK(length(ref)<=300),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','resolved')),
 complete boolean NOT NULL DEFAULT false,
 areas text[] NOT NULL DEFAULT '{}',
 source_hash text CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 output_hash text CHECK(output_hash ~ '^[a-f0-9]{64}$'),
 facts jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,kind,ref)
);
CREATE INDEX ask_context_inputs_thread ON ask_context_inputs(conversation_id,state);
-- Existing threads cannot be reconstructed from a truncated visible transcript.
INSERT INTO ask_context_provenance(conversation_id,unknown) SELECT id,true FROM ai_conversations;
CREATE FUNCTION track_ask_conversation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO ask_context_provenance(conversation_id) VALUES(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER track_ask_conversation AFTER INSERT ON ai_conversations FOR EACH ROW EXECUTE FUNCTION track_ask_conversation();
CREATE FUNCTION track_ask_context_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tid uuid; safe boolean:=false; rid uuid; bytes text; BEGIN
 IF TG_TABLE_NAME='ai_messages' THEN
  tid=NEW.conversation_id; bytes=to_jsonb(NEW)::text;
  -- Only fixed instruction templates have positively established empty sensitivity.
  safe=TG_OP='INSERT' AND NEW.role='user' AND NEW.body IN ('Show permit steps.','Draw a permit process diagram.','Show a simple workflow.')
    AND coalesce(NEW.attachments,'[]'::jsonb)='[]'::jsonb AND coalesce(NEW.page_context,'')='';
  IF NEW.role='assistant' AND NEW.agent='claude' AND TG_OP='INSERT' THEN
   SELECT epoch_run_id INTO rid FROM ask_context_provenance WHERE conversation_id=tid;
   safe=rid IS NOT NULL AND EXISTS(SELECT 1 FROM dev_agent_runs WHERE id=rid AND profile='business');
  END IF;
 ELSE
  SELECT conversation_id INTO tid FROM dev_agent_runs WHERE id=NEW.run_id;
  bytes=to_jsonb(NEW)::text;
 END IF;
 IF tid IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM ai_conversations WHERE id=tid FOR UPDATE;
 INSERT INTO ask_context_inputs(conversation_id,run_id,kind,ref,state,complete,output_hash)
 VALUES(tid,rid,TG_TABLE_NAME,NEW.id::text,'resolved',safe,encode(sha256(convert_to(bytes,'UTF8')),'hex'))
 ON CONFLICT(conversation_id,kind,ref) DO UPDATE SET complete=false,output_hash=EXCLUDED.output_hash;
 UPDATE ask_context_provenance SET revision=revision+1,unknown=unknown OR NOT safe,updated_at=now() WHERE conversation_id=tid;
 RETURN NEW;
END $$;
CREATE TRIGGER track_ask_message AFTER INSERT OR UPDATE OF body,attachments,page_context ON ai_messages FOR EACH ROW EXECUTE FUNCTION track_ask_context_row();
CREATE TRIGGER track_ask_steer AFTER INSERT OR UPDATE OF body ON run_steers FOR EACH ROW EXECUTE FUNCTION track_ask_context_row();
REVOKE ALL ON ask_context_provenance,ask_context_inputs FROM PUBLIC;
REVOKE ALL ON FUNCTION track_ask_conversation(),track_ask_context_row() FROM PUBLIC;
-- node scripts/db-roles-sql.mjs ask_context_provenance ask_context_inputs
-- No narrow grants generated; access only through authenticated website commands.
CREATE FUNCTION track_ask_interaction_reply() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE safe boolean; BEGIN
 IF NEW.conversation_id IS NULL OR NEW.status='pending' THEN RETURN NEW; END IF;
 PERFORM 1 FROM ai_conversations WHERE id=NEW.conversation_id FOR UPDATE;
 safe=NEW.status IN ('expired','dismissed') OR
 (NEW.kind='question' AND NEW.response->>'kind'='question'
  AND NOT jsonb_path_exists(NEW.response,'$.answers[*].other ? (@ != "")')) OR
 (NEW.kind='permission' AND NEW.response->>'kind'='permission' AND coalesce(NEW.response->>'note','')='');
 INSERT INTO ask_context_inputs(conversation_id,run_id,kind,ref,state,complete,output_hash)
 VALUES(NEW.conversation_id,NEW.run_id,'interaction_response',NEW.id::text,'resolved',coalesce(safe,false),encode(sha256(convert_to(coalesce(NEW.response::text,NEW.status),'UTF8')),'hex'))
 ON CONFLICT(conversation_id,kind,ref) DO UPDATE SET complete=ask_context_inputs.complete AND EXCLUDED.complete,output_hash=EXCLUDED.output_hash;
 UPDATE ask_context_provenance SET unknown=unknown OR NOT coalesce(safe,false),revision=revision+1 WHERE conversation_id=NEW.conversation_id;
 RETURN NEW;
END $$;
CREATE TRIGGER track_ask_interaction_reply AFTER INSERT OR UPDATE OF response,status ON agent_interactions FOR EACH ROW EXECUTE FUNCTION track_ask_interaction_reply();
REVOKE ALL ON FUNCTION track_ask_interaction_reply() FROM PUBLIC;
CREATE FUNCTION track_ask_epoch_pending() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.conversation_id IS NOT NULL THEN
  PERFORM 1 FROM ai_conversations WHERE id=NEW.conversation_id FOR UPDATE;
  UPDATE ask_context_provenance SET epoch_run_id=NULL,unknown=unknown OR NEW.profile<>'business',revision=revision+CASE WHEN epoch_run_id IS NULL AND NEW.profile<>'business' THEN 0 ELSE 1 END WHERE conversation_id=NEW.conversation_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER track_ask_epoch_pending AFTER INSERT ON dev_agent_runs FOR EACH ROW EXECUTE FUNCTION track_ask_epoch_pending();
REVOKE ALL ON FUNCTION track_ask_epoch_pending() FROM PUBLIC;
