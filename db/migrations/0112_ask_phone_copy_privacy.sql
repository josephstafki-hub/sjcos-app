-- Phone owner channels are shared owner infrastructure, never private Ask storage.
-- Retain opaque associations after purge; redact even Joe's automatic Ask copies.
ALTER TABLE owner_push_messages ADD COLUMN ask_reply_erased boolean NOT NULL DEFAULT false;
INSERT INTO private_ask_push_sources(kind,ref)
 SELECT 'reply',id FROM owner_replies WHERE conversation_id IS NOT NULL
 UNION SELECT 'phone',push_message_id FROM owner_replies WHERE conversation_id IS NOT NULL AND push_message_id IS NOT NULL
 UNION SELECT 'phone',m.id FROM owner_push_messages m JOIN telegram_reply_targets t ON t.message_id::text=m.telegram_message_id
 JOIN owner_replies r ON r.id=t.owner_reply_id WHERE r.conversation_id IS NOT NULL ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION bind_ask_push_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE obj jsonb;
BEGIN
 IF NEW.conversation_id IS NOT NULL THEN
  obj:=to_jsonb(NEW);
  INSERT INTO private_ask_push_sources(kind,ref)
   SELECT kind,ref::uuid FROM (VALUES ('decision',obj->>'decision_id'),('work',obj->>'work_item_id'),
    ('reply',CASE WHEN TG_TABLE_NAME='owner_replies' THEN obj->>'id' END),
    ('phone',obj->>'push_message_id'),
    ('grant',CASE WHEN TG_TABLE_NAME='owner_grants' THEN obj->>'id' ELSE obj->>'grant_id' END)) x(kind,ref)
   WHERE ref IS NOT NULL ON CONFLICT DO NOTHING;
  PERFORM erase_ask_phone_copies();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION bind_ask_push_source() FROM PUBLIC;

-- Conversational dedup keys were hashes of reply/answer text, so they are
-- derivatives too. Do not retain them on private status shells.
CREATE OR REPLACE FUNCTION guard_ask_push_copy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (TG_OP='UPDATE' AND OLD.ask_reply_erased) OR NEW.ask_reply_erased OR ask_push_is_private(NEW.payload,NEW.href) THEN
  NEW.ask_reply_erased:=true;
  NEW.title:='Private Ask request updated.';
  NEW.body:=NULL; NEW.payload:='{}'; NEW.href:='/today'; NEW.conversation_key:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_push_copy() FROM PUBLIC;

CREATE OR REPLACE FUNCTION guard_ask_phone_copy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (TG_OP='UPDATE' AND OLD.ask_reply_erased) OR NEW.ask_reply_erased OR ask_push_is_private(to_jsonb(NEW),NEW.href) OR EXISTS(SELECT 1 FROM push_outbox o WHERE o.id=NEW.push_outbox_id AND o.ask_reply_erased) THEN
  NEW.ask_reply_erased:=true;
  NEW.title:='Private Ask request updated.'; NEW.body:=NULL; NEW.href:='/today';
  NEW.outcome:='Private Ask request updated.'; NEW.agent_name:=NULL;
  NEW.thread_key:='private:'||COALESCE(NEW.decision_id,NEW.work_item_id,NEW.grant_id,NEW.reply_to_id,NEW.id)::text;
  NEW.state:='decided'; NEW.category:='SJC_INFO'; NEW.sends:=false;
  INSERT INTO private_ask_push_sources(kind,ref) VALUES('phone',NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_phone_copy() FROM PUBLIC;
CREATE TRIGGER guard_ask_phone_copy BEFORE INSERT OR UPDATE ON owner_push_messages FOR EACH ROW EXECUTE FUNCTION guard_ask_phone_copy();

CREATE OR REPLACE FUNCTION guard_ask_phone_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF ask_push_is_private(jsonb_build_object('message',NEW.message_id),NULL) THEN
  NEW.text:=NULL; NEW.evidence:=NULL;
  NEW.result:='{"ok":false,"code":"THREAD_UNAVAILABLE","message":"Open your private Ask chat to continue.","outcome":"unavailable"}';
  NEW.phase:='completed'; NEW.lease_until:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_ask_phone_action() FROM PUBLIC;
CREATE TRIGGER guard_ask_phone_action BEFORE INSERT OR UPDATE ON push_actions FOR EACH ROW EXECUTE FUNCTION guard_ask_phone_action();

CREATE OR REPLACE FUNCTION erase_ask_phone_copies() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed integer;
BEGIN
 -- 0105 already erased some payload/href associations but left dedup hashes.
 -- Re-scrub marked shells too so the current trigger clears every derivative.
 UPDATE push_outbox SET ask_reply_erased=true WHERE ask_reply_erased OR ask_push_is_private(payload,href);
 -- A historical summary may have lost every private UUID from its payload.
 LOOP
  UPDATE push_outbox summary SET ask_reply_erased=true WHERE NOT summary.ask_reply_erased
   AND EXISTS(SELECT 1 FROM push_outbox part WHERE part.ask_reply_erased AND part.summary_id=summary.id);
  GET DIAGNOSTICS changed=ROW_COUNT;
  EXIT WHEN changed=0;
 END LOOP;
 -- Reach a fixed point: legacy children can precede their parent in the heap.
 LOOP
  UPDATE owner_push_messages m SET ask_reply_erased=true
   WHERE NOT ask_reply_erased AND (ask_push_is_private(to_jsonb(m),m.href) OR EXISTS(SELECT 1 FROM push_outbox o WHERE o.id=m.push_outbox_id AND o.ask_reply_erased));
  GET DIAGNOSTICS changed=ROW_COUNT;
  EXIT WHEN changed=0;
 END LOOP;
 UPDATE owner_push_messages SET ask_reply_erased=true WHERE ask_reply_erased;
 UPDATE push_outbox SET ask_reply_erased=true WHERE ask_reply_erased OR ask_push_is_private(payload,href);
 UPDATE push_actions SET text=NULL WHERE ask_push_is_private(jsonb_build_object('message',message_id),NULL);
END $$;
REVOKE ALL ON FUNCTION erase_ask_phone_copies() FROM PUBLIC;
-- Preserve the existing source/runtime erasure and website identity check.
ALTER FUNCTION erase_ask_reply_copies(uuid) RENAME TO erase_ask_reply_copies_pre_phone;
CREATE FUNCTION erase_ask_reply_copies(thread uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF session_user<>ask_website_login() THEN RAISE EXCEPTION 'private Ask repair denied' USING ERRCODE='42501'; END IF;
 PERFORM erase_ask_phone_copies();
 PERFORM erase_ask_reply_copies_pre_phone(thread);
END $$;
REVOKE ALL ON FUNCTION erase_ask_reply_copies(uuid) FROM PUBLIC;
SELECT erase_ask_reply_copies(NULL);
-- No new table or narrow-role privileges. Existing phone/outbox grants remain
-- those of 0092/0105; private_ask_push_sources stays website-only.
