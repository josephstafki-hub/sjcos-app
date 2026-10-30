-- 0043 — a lead's value reads only the dollar amounts in its rough estimate.
--
-- 0040's parser took every number in the total: "Option B (incl. 2nd floor)
-- $196,000–$259,000" counted a $2 figure (Dembinski's value fell to $142,200),
-- and "15x15: $44,000 / 18x15: $50,200 (+$6,200)" read as $15–6k. Now, as in
-- lib/lead-estimate-value.mjs: only "$" amounts count when there are any, a
-- "+$…" difference never does, and the range runs lowest to highest figure.
-- Value = the average of the figures, as before. Caught before 0040 went live.

CREATE OR REPLACE FUNCTION lead_estimate_value(total text, OUT display text, OUT value integer) AS $$
DECLARE
  nums numeric[];
  lo integer;
  hi integer;
BEGIN
  SELECT array_agg(replace(m[2], ',', '')::numeric) INTO nums
    FROM regexp_matches(coalesce(total, ''), '(\+\s*)?\$\s*(\d[\d,]*(?:\.\d+)?)', 'g') AS t(m)
   WHERE m[1] IS NULL;
  IF nums IS NULL THEN
    SELECT array_agg(replace(m[1], ',', '')::numeric) INTO nums
      FROM regexp_matches(coalesce(total, ''), '(\d[\d,]*(?:\.\d+)?)', 'g') AS t(m);
  END IF;
  IF nums IS NULL OR array_length(nums, 1) = 0 THEN
    display := NULL; value := NULL; RETURN;
  END IF;
  lo := round((SELECT min(n) FROM unnest(nums) n) / 1000);
  hi := round((SELECT max(n) FROM unnest(nums) n) / 1000);
  display := CASE WHEN array_length(nums, 1) > 1 AND lo <> hi THEN '$' || lo || '–' || hi || 'k' ELSE '$' || lo || 'k' END;
  value := round((SELECT avg(n) FROM unnest(nums) n));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Bring every lead with a saved rough estimate in line again.
UPDATE leads SET estimate_value = estimate_value
 WHERE id IN (SELECT lead_id FROM lead_estimates);
