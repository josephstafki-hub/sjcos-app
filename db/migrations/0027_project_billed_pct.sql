-- 0027 — projects.progress (the "% billed" bar) follows the money on its own.
-- progress = collected_to_date ÷ contract_value (capped at 100), and it is what
-- the projects list, the project Money card, Today and the workbench draw.
-- Until now every writer had to remember to recompute it (project-totals.ts,
-- set_project_contract_value / set_project_collected); the Money › Overview
-- reconcile and any raw/script write did not, so the bar drifted from the
-- figures beside it. Recomputed here whenever either figure is written, by any
-- path. A job with no contract value keeps whatever progress it has.
-- No backfill: rows already out of line keep their figure until one of the
-- two columns is next written.

CREATE OR REPLACE FUNCTION projects_billed_pct() RETURNS trigger AS $$
BEGIN
  IF NEW.contract_value > 0 THEN
    NEW.progress := LEAST(100, GREATEST(0, ROUND(100.0 * NEW.collected_to_date / NEW.contract_value)))::int;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_billed_pct ON projects;
CREATE TRIGGER trg_projects_billed_pct
  BEFORE INSERT OR UPDATE OF contract_value, collected_to_date ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_billed_pct();
