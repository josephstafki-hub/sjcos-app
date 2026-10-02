-- 0023 — A23: one project workflow per job (WORKFLOW.md W01–W12) and one
-- project history. Stages are DERIVED from the feature records the other
-- workstreams own (scope register, estimate, signatures, invoices, schedule
-- plans, milestone confirmations, sign-off); the workflow row pins the
-- definition/policy versions the job runs under and records every event once.

CREATE TABLE IF NOT EXISTS project_workflows (
  project_id          uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  definition_version  text NOT NULL DEFAULT 'workflow@2026-09-23',
  policy_versions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage               text NOT NULL DEFAULT 'W01'
                        CHECK (stage IN ('W01','W02','W03','W04','W05','W06','W07','W08','W09','W10','W11','W12','done')),
  precon_signature_request_id  bigint REFERENCES signature_requests(id) ON DELETE SET NULL,
  precon_signed_at    timestamptz,
  scope_prepared_at   timestamptz,
  accepted_estimate_id bigint REFERENCES estimates(id) ON DELETE SET NULL,
  accepted_at         timestamptz,
  contract_signed_at  timestamptz,
  initial_paid_at     timestamptz,
  schedule_confirmed_at timestamptz,
  client_signoff_at   timestamptz,
  blocked             jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_by          text NOT NULL DEFAULT 'system',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The one project history: every business event exactly once.
CREATE TABLE IF NOT EXISTS project_workflow_events (
  id           bigserial PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         text NOT NULL,      -- precon_signed / scope_prepared / site_notes / package_released / estimate_offered / estimate_accepted / contract_signed / initial_paid / schedule_confirmed / milestone_confirmed / snag / change_order / client_signoff / final_invoiced / post_project / …
  ref          text NOT NULL,      -- stable reference (signature_request:12, invoice:4, decision:<uuid>, …)
  stage_before text,
  stage_after  text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor        text NOT NULL DEFAULT 'system',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_project_workflow_events_project ON project_workflow_events(project_id, id);

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS trg_project_workflows_updated_at ON project_workflows;
           CREATE TRIGGER trg_project_workflows_updated_at BEFORE UPDATE ON project_workflows
           FOR EACH ROW EXECUTE FUNCTION set_updated_at();';
END $$;
