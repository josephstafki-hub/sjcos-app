-- 0039 — a lead's value comes from its saved rough estimate, never a typed figure.
--
-- Joe, 2026-10-30: Timothy Dessonville's lead showed "?" although a rough
-- estimate ($13,500 – $19,500) had been emailed to him on Oct 5 — an agent sent
-- it with send_email and never saved it on the lead. The /leads list read
-- leads.value_display / estimate_value, which three code paths each copied
-- from lead_estimates.total by hand.
--
-- From here on Postgres keeps them in step: whenever a lead's rough estimate
-- total is written, and on any write to the lead, value_display / estimate_value
-- are recomputed from it (lib/lead-estimate-value.mjs, ported below: "$51,000 –
-- $64,500" → "$51–65k", value = the midpoint in dollars). A lead with no saved
-- rough estimate keeps the value typed at intake.

CREATE OR REPLACE FUNCTION lead_estimate_value(total text, OUT display text, OUT value integer) AS $$
DECLARE
  nums numeric[];
  lo integer;
  hi integer;
BEGIN
  SELECT array_agg(replace(m[1], ',', '')::numeric ORDER BY ord) INTO nums
    FROM regexp_matches(coalesce(total, ''), '(\d[\d,]*(?:\.\d+)?)', 'g') WITH ORDINALITY AS t(m, ord);
  IF nums IS NULL OR array_length(nums, 1) = 0 THEN
    display := NULL; value := NULL; RETURN;
  END IF;
  lo := round(nums[1] / 1000);
  hi := round(nums[array_length(nums, 1)] / 1000);
  display := CASE WHEN array_length(nums, 1) > 1 AND lo <> hi THEN '$' || lo || '–' || hi || 'k' ELSE '$' || lo || 'k' END;
  value := round((SELECT avg(n) FROM unnest(nums) n));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Any write to a lead takes its value from the saved rough estimate, if one has a figure.
CREATE OR REPLACE FUNCTION leads_value_from_estimate() RETURNS trigger AS $$
DECLARE
  v record;
BEGIN
  SELECT (lead_estimate_value(e.total)).* INTO v FROM lead_estimates e WHERE e.lead_id = NEW.id;
  IF v.display IS NOT NULL THEN
    NEW.value_display := v.display;
    NEW.estimate_value := v.value;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_value_from_estimate ON leads;
CREATE TRIGGER trg_leads_value_from_estimate
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_value_from_estimate();

-- Saving a rough estimate re-runs the trigger above on its lead.
CREATE OR REPLACE FUNCTION lead_estimates_touch_lead() RETURNS trigger AS $$
BEGIN
  UPDATE leads SET estimate_value = estimate_value WHERE id = NEW.lead_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_estimates_value ON lead_estimates;
CREATE TRIGGER trg_lead_estimates_value
  AFTER INSERT OR UPDATE OF total ON lead_estimates
  FOR EACH ROW EXECUTE FUNCTION lead_estimates_touch_lead();

-- Bring every lead in line now.
UPDATE leads SET estimate_value = estimate_value
 WHERE id IN (SELECT lead_id FROM lead_estimates);
