-- 0051 — Every outbound send is a measurement case (A18; 2026-10-30).
--
-- measurement_cases had no writer (openCase/closeCase were never called), so
-- /engine/measurement and measurement_summary read an empty table. Every
-- action intent is a unit of work the system either did or didn't do, so a
-- trigger records it from every code path at once:
--   insert       → a case opens: kind 'send:<intent kind>', mode from what
--                  authorised it (decision = one_tap, grant = assisted,
--                  active policy = unattended, owner/staff click = manual);
--   accepted /   → verified_success
--   confirmed
--   permanent_failure → failed
--   cancelled    → corrected (a person stopped it: a rejected card, a revoke)
-- 'unknown' leaves the case open until reconciliation settles it. Owner
-- seconds come from owner_touches on the same decision. Failures stay in the
-- denominator; nothing is deleted.

CREATE OR REPLACE FUNCTION measure_intent_case() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO measurement_cases (kind, ref_kind, ref_id, decision_id, project_id, lead_id, eligible, mode, auth_ref, opened_by)
    VALUES (
      'send:' || NEW.kind, 'intent', NEW.id::text, NEW.decision_id, NEW.project_id, NEW.lead_id, true,
      CASE
        WHEN NEW.decision_id IS NOT NULL THEN 'one_tap'
        WHEN NEW.grant_id IS NOT NULL THEN 'assisted'
        WHEN NEW.policy_ref LIKE 'policy:%' THEN 'unattended'
        WHEN NEW.policy_ref LIKE 'owner:%' OR NEW.policy_ref LIKE 'staff:%' THEN 'manual'
        ELSE 'unknown'
      END,
      COALESCE(
        CASE WHEN NEW.decision_id IS NOT NULL THEN 'decision:' || NEW.decision_id END,
        CASE WHEN NEW.grant_id IS NOT NULL THEN 'grant:' || NEW.grant_id END,
        NEW.policy_ref
      ),
      'dispatcher'
    )
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('accepted','confirmed','permanent_failure','cancelled') THEN
    UPDATE measurement_cases c
       SET outcome = CASE WHEN NEW.state IN ('accepted','confirmed') THEN 'verified_success'
                          WHEN NEW.state = 'cancelled' THEN 'corrected' ELSE 'failed' END,
           closed_at = now(),
           latency_ms = (EXTRACT(EPOCH FROM (now() - c.created_at)) * 1000)::bigint,
           owner_seconds = CASE WHEN NEW.decision_id IS NULL THEN c.owner_seconds
                                ELSE (SELECT sum(t.seconds)::int FROM owner_touches t WHERE t.decision_id = NEW.decision_id) END,
           notes = CASE WHEN NEW.state IN ('permanent_failure','cancelled') THEN left(COALESCE(NEW.last_error, NEW.state), 300) ELSE c.notes END
     WHERE c.ref_kind = 'intent' AND c.ref_id = NEW.id::text AND c.closed_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_measure_intent_case ON action_intents;
CREATE TRIGGER trg_measure_intent_case
  AFTER INSERT OR UPDATE OF state ON action_intents
  FOR EACH ROW EXECUTE FUNCTION measure_intent_case();
