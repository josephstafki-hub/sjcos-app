// A23 workflow tools: the derived project workflow (stage, gates, blockers,
// pending decisions, next actions, history) and the history recorder. Read
// side imports the pure engine directly (node type-stripping, same as the
// tests); the write side runs in its own transaction on this process's pool.
// Nothing here sends, pays or approves — it reports and records.

import { z } from "zod";
import { projectWorkflowView, noteWorkflowEvent } from "../lib/workflow/engine.ts";

export function registerWorkflowTools(server, { rows, json, pool, slugToId }) {
  server.registerTool(
    "get_project_workflow",
    {
      title: "Project workflow (W01–W12)",
      description:
        "Where a job stands in the confirmed lead-to-closeout workflow, derived from its records: stage, every gate " +
        "(pre-con signature, scope prepared/allocated, site visit, estimate readiness, offer sent, client acceptance, " +
        "initial payment, construction agreement, schedule confirmed, client sign-off), blockers, decisions waiting on " +
        "Joe, ready next actions and the project history. Load this before working any project event.",
      inputSchema: { project_slug: z.string() },
    },
    async ({ project_slug }) => {
      const id = await slugToId("projects", project_slug);
      if (!id) return json({ ok: false, error: `No project ${project_slug}` });
      const view = await projectWorkflowView(rows, id);
      return json(view ? { ok: true, ...view } : { ok: false, error: "no project" });
    },
  );

  server.registerTool(
    "record_workflow_event",
    {
      title: "Record a workflow event",
      description:
        "Append one event to the project history (site notes processed, package released, milestone confirmed, snag, " +
        "post-project step…). Idempotent on (project, kind, ref): repeating the same ref changes nothing. This records " +
        "history and moves the derived stage — it never sends, invoices, or approves anything.",
      inputSchema: {
        project_slug: z.string(),
        kind: z.enum(["initial_paid", "schedule_confirmed", "milestone_confirmed", "snag", "package_released", "estimate_offered", "final_invoiced", "post_project", "site_notes"]),
        ref: z.string().describe("Stable reference, e.g. decision:<id>, invoice:<id>, note:<file id>"),
        detail: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ project_slug, kind, ref, detail }) => {
      const id = await slugToId("projects", project_slug);
      if (!id) return json({ ok: false, error: `No project ${project_slug}` });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const run = async (sql, params) => (await client.query(sql, params)).rows;
        const r = await noteWorkflowEvent(run, { projectId: id, kind, ref, detail: detail ?? {}, actor: process.env.SJCOS_AGENT_NAME || "agent" });
        await client.query("COMMIT");
        return json({ ok: true, created: r.created });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        return json({ ok: false, error: e.message });
      } finally {
        client.release();
      }
    },
  );
}
