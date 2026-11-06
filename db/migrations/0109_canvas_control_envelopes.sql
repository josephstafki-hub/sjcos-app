-- Align fixed controls with canvas/state.ts helpers after composer trim.
-- Exact same-thread live version/title lookup and original-byte hash remain.
-- Regression tests feed all UI diagnostic helpers through the real SQL helper.
-- No tables, triggers or narrow privileges are added; 0107 is checksum-stable.
CREATE OR REPLACE FUNCTION ask_canvas_instruction(tid uuid, prompt text) RETURNS TABLE(known boolean,areas text[],envelope jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v record; inherited text[]:='{}'; refs jsonb:='[]'; BEGIN
 IF prompt IN ('Show permit steps.','Draw a permit process diagram.','Show a simple workflow.','Draw the permit steps for this job as a diagram.') THEN
  RETURN QUERY SELECT true,'{}'::text[],jsonb_build_object('control','create','hash',encode(sha256(convert_to(prompt,'UTF8')),'hex')); RETURN;
 END IF;
 FOR v IN SELECT x.* FROM ask_canvas_versions x JOIN ask_canvases c ON c.id=x.canvas_id WHERE c.conversation_id=tid AND c.deleted_at IS NULL AND x.purged_at IS NULL LOOP
  IF prompt IN (
   format('Simplify the "%s" diagram (version %s) so it can be shown here.',v.title,v.version),
   format('Fix the "%s" diagram (version %s). The error was: The diagram source did not pass the supported syntax checks.',v.title,v.version),
   format('Fix the "%s" diagram (version %s). The error was: Mermaid could not parse the diagram. Check its syntax.',v.title,v.version),
   format('Fix the "%s" diagram (version %s). The error was: Mermaid could not lay out the diagram.',v.title,v.version),
   format('Fix the "%s" diagram (version %s). The error was: The drawing did not pass the supported SVG checks.',v.title,v.version),
   format('Fix the "%s" diagram (version %s). The error was: The diagram could not be drawn.',v.title,v.version),
   format('Change the "%s" diagram (version %s):',v.title,v.version),
   format('Change the "%s" diagram (version %s): ',v.title,v.version)
  ) THEN
   inherited=ARRAY(SELECT DISTINCT x FROM unnest(inherited||v.baseline_areas) x ORDER BY x);
   refs=refs||jsonb_build_array(jsonb_build_object('canvas_id',v.canvas_id,'version',v.version));
  END IF;
 END LOOP;
 IF jsonb_array_length(refs)>0 THEN RETURN QUERY SELECT true,inherited,jsonb_build_object('control','change','records',refs,'hash',encode(sha256(convert_to(prompt,'UTF8')),'hex')); RETURN; END IF;
 RETURN QUERY SELECT false,'{}'::text[],'{}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION ask_canvas_instruction(uuid,text) FROM PUBLIC;
