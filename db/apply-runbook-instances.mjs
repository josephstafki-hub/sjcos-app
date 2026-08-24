// Migration runner for W6 (runbook stepper): runbook_instances + the work_items
// back-refs + runbook_steps.assigned_to, plus the idempotent seed patch that
// sets per-step assignment and the two-gate intake expected_output text.
//
// Idempotent — safe to re-run. Mirrors the "W6: Runbook stepper" section of
// db/schema.sql.
//
//   node db/apply-runbook-instances.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
const env = readFileSync(envFile, "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS runbook_instances (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     runbook_id    uuid REFERENCES runbooks(id) ON DELETE SET NULL,
     runbook_slug  text NOT NULL,
     lead_id       uuid REFERENCES leads(id)    ON DELETE CASCADE,
     project_id    uuid REFERENCES projects(id) ON DELETE CASCADE,
     current_step  integer NOT NULL DEFAULT 1,
     status        text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','waiting_approval','waiting_human',
                                       'done','cancelled')),
     started_by    text NOT NULL DEFAULT 'user',
     started_at    timestamptz NOT NULL DEFAULT now(),
     completed_at  timestamptz,
     note          text NOT NULL DEFAULT ''
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_runbook_instance_active_lead
     ON runbook_instances (runbook_slug, lead_id)
     WHERE lead_id IS NOT NULL AND status NOT IN ('done','cancelled')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_runbook_instance_active_project
     ON runbook_instances (runbook_slug, project_id)
     WHERE project_id IS NOT NULL AND status NOT IN ('done','cancelled')`,
  `CREATE INDEX IF NOT EXISTS idx_runbook_instances_status
     ON runbook_instances (status, started_at DESC)`,
  `ALTER TABLE work_items ADD COLUMN IF NOT EXISTS runbook_instance_id uuid
     REFERENCES runbook_instances(id) ON DELETE SET NULL`,
  `ALTER TABLE work_items ADD COLUMN IF NOT EXISTS runbook_step_order integer`,
  `CREATE INDEX IF NOT EXISTS idx_work_items_runbook_instance
     ON work_items (runbook_instance_id) WHERE runbook_instance_id IS NOT NULL`,
  `ALTER TABLE runbook_steps ADD COLUMN IF NOT EXISTS assigned_to text NOT NULL
     DEFAULT 'agent' CHECK (assigned_to IN ('agent','human'))`,
  `UPDATE runbook_steps s SET assigned_to = v.assigned
     FROM (VALUES
       ('daily-sjc-operations-review',           1, 'agent'),
       ('daily-sjc-operations-review',           2, 'agent'),
       ('lead-intake-to-qualified-or-declined',  1, 'agent'),
       ('lead-intake-to-qualified-or-declined',  2, 'agent'),
       ('rough-estimate-to-site-visit',          1, 'agent'),
       ('rough-estimate-to-site-visit',          2, 'human'),
       ('active-project-followup-loop',          1, 'agent'),
       ('active-project-followup-loop',          2, 'agent'),
       ('completed-project-closeout',            1, 'agent'),
       ('completed-project-closeout',            2, 'human')
     ) AS v(rb_slug, ord, assigned), runbooks r
    WHERE r.slug = v.rb_slug AND s.runbook_id = r.id AND s.step_order = v.ord`,
  `UPDATE runbook_steps s
      SET expected_output = 'Gate 1, agent discretion: judge qualification from the intake answers as provided. Qualified, declined, or unclear — with reasons. The intake questions are sufficient as asked; do not demand fields the client skipped.'
     FROM runbooks r
    WHERE r.slug = 'lead-intake-to-qualified-or-declined' AND s.runbook_id = r.id AND s.step_order = 1`,
  `UPDATE runbook_steps s
      SET expected_output = 'Gate 2 prep: draft the reply per the triage outcome. If advancing: ask for what a rough estimate needs — a detailed description of the work (as much as the client is able), photos, and rough measurements — plus anything Gate 1 found unclear. If declining: polite decline draft. Joe approves before anything is sent.'
     FROM runbooks r
    WHERE r.slug = 'lead-intake-to-qualified-or-declined' AND s.runbook_id = r.id AND s.step_order = 2`,
];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
    console.log("ok:", sql.replace(/\s+/g, " ").slice(0, 96));
  }
  const steps = await client.query(
    `SELECT r.slug AS runbook, s.step_order, s.title, s.skill_slug, s.assigned_to, s.requires_human_approval
       FROM runbook_steps s JOIN runbooks r ON r.id = s.runbook_id
      ORDER BY r.slug, s.step_order`,
  );
  console.log("\nSeeded step table:");
  console.table(steps.rows);
  console.log("runbook-instances migration complete.");
} finally {
  await client.end();
}
