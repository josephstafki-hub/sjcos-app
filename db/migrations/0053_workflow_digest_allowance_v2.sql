-- 0053 — workflow_digest v2: a selection over its allowance is a change order
-- only after the contract (Joe, 2026-10-30).
--
-- "A selection overage should not trigger a change order because it precedes
-- a contract, so there is nothing to change. If the selection is made post
-- contract, as might happen if the contract uses an allowance for a specific
-- thing, then a change order makes sense." The agents' W07/W11 digest said
-- every above-allowance choice becomes a change order. v2 is v1 with exactly
-- the two replacements in lib/agent-runtime/instruction-texts.mjs
-- (WORKFLOW_DIGEST_V2_EDITS); it is activated here and v1 is retired (kept,
-- so a rollback re-activates it). Skipped when v2 already exists.

DO $$
DECLARE v1 text; v2 text;
BEGIN
  IF EXISTS (SELECT 1 FROM agent_instruction_versions WHERE key = 'workflow_digest' AND version = 2) THEN RETURN; END IF;
  SELECT body INTO v1 FROM agent_instruction_versions WHERE key = 'workflow_digest' AND version = 1;
  IF v1 IS NULL THEN RETURN; END IF;
  v2 := replace(
          replace(v1,
            'An allowance is labelled with what it covers; a choice above it becomes a priced change order for approval, then client acceptance/payment.',
            'An allowance is labelled with what it covers. Before the contract, a choice above an allowance goes into the estimate at its chosen price (no change order: there is no contract to change); after the contract, a choice above an allowance in the contract becomes a priced change order for approval, then client acceptance/payment.'),
          'Above-allowance selections follow the same path.',
          'Above-allowance selections made after the contract follow the same path; before the contract they go into the estimate, not a change order.');
  IF v2 = v1 THEN RAISE EXCEPTION 'workflow_digest v1 text changed; v2 replacements did not apply'; END IF;
  UPDATE agent_instruction_versions SET state = 'retired', retired_at = now() WHERE key = 'workflow_digest' AND state = 'active';
  INSERT INTO agent_instruction_versions (key, version, body, checksum, state, activated_by, activated_at, notes)
  VALUES ('workflow_digest', 2, v2, encode(sha256(convert_to(v2, 'UTF8')), 'hex'), 'active', 'migration:0053', now(),
          'v2 — Joe 2026-10-30: above-allowance selections are a change order only after the contract; before it they go into the estimate.');
END $$;
