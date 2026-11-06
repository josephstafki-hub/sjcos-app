-- Versioned generic runbook/catalog; no city-specific state or live tool hookup.
CREATE TABLE IF NOT EXISTS browser_release_catalog (
 version int PRIMARY KEY CHECK(version>0),permit_runbook_version text NOT NULL CHECK(permit_runbook_version='generic_permit_v1'),
 model_tools text[] NOT NULL CHECK(model_tools=ARRAY['browser_open','browser_status','browser_observe','browser_navigate','browser_act','browser_list_logins','browser_fill_login','browser_prepare_action','browser_request_take_over','browser_action_status','browser_list_downloads','browser_stage_upload','browser_close']::text[]),
 required_gates text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO browser_release_catalog(version,permit_runbook_version,model_tools,required_gates) VALUES
 (1,'generic_permit_v1',ARRAY['browser_open','browser_status','browser_observe','browser_navigate','browser_act','browser_list_logins','browser_fill_login','browser_prepare_action','browser_request_take_over','browser_action_status','browser_list_downloads','browser_stage_upload','browser_close'],ARRAY['schema_vault','runtime_containment','thread_privacy','independent_checkpoints','coordinator_acceptance']) ON CONFLICT DO NOTHING;
-- Never turn on a flag; preserve existing owner configuration on replay.
INSERT INTO app_settings(key,value) VALUES
 ('browser.enabled','false'),('browser.staff_enabled','false'),('browser.vault_enabled','false'),
 ('browser.files_enabled','false'),('browser.final_steps_enabled','false'),('browser.permit_handoff_enabled','false') ON CONFLICT DO NOTHING;

-- node scripts/db-roles-sql.mjs browser_release_catalog
-- Output: empty (all of these tables intentionally grant no narrow privileges).
DO $$ DECLARE tab text; r text; BEGIN
 FOREACH tab IN ARRAY ARRAY['browser_release_catalog'] LOOP
 EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',tab);
 FOREACH r IN ARRAY ARRAY['sjcos_agent','sjcos_worker','sjcos_readonly','sjcos_browser','sjcos_browser_reader'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',tab,r); END IF;
 END LOOP;
 END LOOP; END $$;

CREATE OR REPLACE FUNCTION browser_schema_no_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'BROWSER_RETAINED_IDENTITY' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION browser_schema_no_truncate() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['browser_logins','browser_login_access','browser_profiles','browser_vault_counters','browser_handoffs','browser_handoff_attempts','browser_handoff_outcomes','browser_actions','browser_artifacts','browser_handoff_effects','browser_handoff_reconciliations','browser_action_reviews','browser_action_executions','browser_audit_outbox','browser_notification_deliveries','browser_file_links','browser_release_catalog'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS guard_browser_truncate_schema ON %I',tab);
 EXECUTE format('CREATE TRIGGER guard_browser_truncate_schema BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION browser_schema_no_truncate()',tab);
 END LOOP; END $$;
