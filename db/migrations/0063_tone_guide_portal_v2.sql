-- 0063 — tone_guide v2: reply on the channel the client used (Joe, 2026-10-31).
--
-- An agent answered Tom Tierney's client-portal message with an email draft
-- (Joe rejected it: "this one should have been in the portal"). Since 0062 a
-- portal reply is submit_draft_for_approval channel "portal", which Approve
-- posts in the client's portal thread. v2 is v1 with exactly the one
-- replacement in lib/agent-runtime/instruction-texts.mjs (TONE_GUIDE_V2_EDITS):
-- reply where the client wrote, and always draft the reply (a holding reply
-- when Joe has to decide first). Activated here; v1 is retired (kept, so a
-- rollback re-activates it). Skipped when v2 already exists.

DO $$
DECLARE v1 text; v2 text;
BEGIN
  IF EXISTS (SELECT 1 FROM agent_instruction_versions WHERE key = 'tone_guide' AND version = 2) THEN RETURN; END IF;
  SELECT body INTO v1 FROM agent_instruction_versions WHERE key = 'tone_guide' AND version = 1;
  IF v1 IS NULL THEN RETURN; END IF;
  v2 := replace(v1,
          '- Client email drafts start with "To: <address>" and "Subject: ..." lines so the owner''s Approve click can send them; sign off as "Joe / SJ Carpentry LLC / 612-361-6585" only when the message is from Joe.',
          '- Reply on the channel the client used. A client who wrote in the client portal gets a portal reply: submit_draft_for_approval with channel "portal" and only the message body (no To:/Subject: lines, no signature block); Joe''s Approve click posts it in their portal thread. Never answer a portal message with an email.
- Draft a reply to every client message without being asked, even when Joe has to decide something first; then it is a short holding reply that promises nothing.
- Client email drafts start with "To: <address>" and "Subject: ..." lines so the owner''s Approve click can send them; sign off as "Joe / SJ Carpentry LLC / 612-361-6585" only when the message is from Joe.');
  IF v2 = v1 THEN RAISE EXCEPTION 'tone_guide v1 text changed; v2 replacement did not apply'; END IF;
  UPDATE agent_instruction_versions SET state = 'retired', retired_at = now() WHERE key = 'tone_guide' AND state = 'active';
  INSERT INTO agent_instruction_versions (key, version, body, checksum, state, activated_by, activated_at, notes)
  VALUES ('tone_guide', 2, v2, encode(sha256(convert_to(v2, 'UTF8')), 'hex'), 'active', 'migration:0063', now(),
          'v2 — Joe 2026-10-31: reply on the channel the client used (portal message → portal reply); always draft the reply.');
END $$;
