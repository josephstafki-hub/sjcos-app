-- Stable outbound identity is recorded before dialing, including uncertain outcomes.
ALTER TABLE checklist_sessions ADD COLUMN dial_call_id uuid;
CREATE FUNCTION checklist_reconcile_insurance() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target uuid; sid uuid;
BEGIN
 IF TG_TABLE_NAME='checklist_sessions' THEN sid:=NEW.id; ELSE sid:=NEW.session_id; END IF;
 SELECT lead_id INTO target FROM checklist_sessions WHERE id=sid;
 IF target IS NOT NULL AND EXISTS(SELECT 1 FROM checklist_item_coverage WHERE session_id=sid AND value->>'method'='insurance') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(target::text,3));
  INSERT INTO work_items(title,lead_id,source_kind,source_id,requires_approval)
   SELECT 'Include the § 325E.66 written notice with the initial estimate — counsel supplies wording',target,'manual','checklist-insurance:'||target,false
   WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_id='checklist-insurance:'||target);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checklist_insurance_link AFTER UPDATE OF lead_id ON checklist_sessions FOR EACH ROW EXECUTE FUNCTION checklist_reconcile_insurance();
CREATE TRIGGER checklist_insurance_answer AFTER UPDATE OF value ON checklist_item_coverage FOR EACH ROW EXECUTE FUNCTION checklist_reconcile_insurance();
