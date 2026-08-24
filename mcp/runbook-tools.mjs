// W6 runbook stepper tools: start a runbook against a lead/project and read
// live instances. Lives in its own module (same pattern as mood-tools.mjs) so
// this surface can be developed without colliding with concurrent work on
// sjcos-mcp.mjs. Wire it up with one line inside buildServer():
//
//   import { registerRunbookTools } from "./runbook-tools.mjs";
//   ...
//   registerRunbookTools(server, { rows, json, runbooksCall });
//
// start_runbook proxies to the app's internal runbooks route (the engine —
// work-item spawn, agent pings, duplicate guard — lives in
// lib/runbook-engine.ts, which this .mjs process can't import). The list/get
// tools are direct reads. Deliberately NO cancel tool: cancelling an instance
// is owner-only in the app UI (/engine).

import { z } from "zod";

const INSTANCE_SELECT = `
  SELECT i.id, i.runbook_slug, COALESCE(r.title, i.runbook_slug) AS runbook_title,
         i.status, i.current_step, i.started_by, i.started_at, i.completed_at, i.note,
         COALESCE((SELECT count(*)::int FROM runbook_steps s WHERE s.runbook_id = i.runbook_id), 0) AS step_count,
         (SELECT s.title FROM runbook_steps s
           WHERE s.runbook_id = i.runbook_id AND s.step_order = i.current_step) AS current_step_title,
         l.slug AS lead_slug, p.slug AS project_slug
    FROM runbook_instances i
    LEFT JOIN runbooks r ON r.id = i.runbook_id
    LEFT JOIN leads l    ON l.id = i.lead_id
    LEFT JOIN projects p ON p.id = i.project_id`;

export function registerRunbookTools(server, { rows, json, runbooksCall }) {
  server.registerTool(
    "start_runbook",
    {
      title: "Start a runbook",
      description:
        "Start a live runbook instance against exactly one lead OR project. Spawns the " +
        "step-1 work item (with the step's skill attached) and pings its assignee. " +
        "Refuses if that runbook is already running for the same target. Steps advance " +
        "as their work items are completed (update_work_item_status → done, plus Joe's " +
        "approval where a step requires it).",
      inputSchema: {
        runbook_slug: z.string(),
        lead_slug: z.string().optional(),
        project_slug: z.string().optional(),
      },
    },
    async ({ runbook_slug, lead_slug, project_slug }) => {
      if (!!lead_slug === !!project_slug)
        return json({ ok: false, error: "Provide exactly one of lead_slug / project_slug." });
      return json(
        await runbooksCall("start", { runbook_slug, lead_slug, project_slug, started_by: "agent:mcp" }),
      );
    },
  );

  server.registerTool(
    "list_runbook_instances",
    {
      title: "List runbook instances",
      description:
        "Live + recent runbook runs: target, current step N of M, status " +
        "(running/waiting_approval/waiting_human/done/cancelled). Filter by status.",
      inputSchema: {
        status: z.enum(["running", "waiting_approval", "waiting_human", "done", "cancelled"]).optional(),
      },
    },
    async ({ status }) => {
      const where = status ? `WHERE i.status = $1` : ``;
      return json(
        await rows(`${INSTANCE_SELECT} ${where} ORDER BY i.started_at DESC LIMIT 50`, status ? [status] : []),
      );
    },
  );

  server.registerTool(
    "get_runbook_instance",
    {
      title: "Get runbook instance",
      description: "One runbook instance by id, with its step work items so far.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const inst = await rows(`${INSTANCE_SELECT} WHERE i.id = $1`, [id]);
      if (!inst[0]) return json({ error: `No runbook instance ${id}` });
      const steps = await rows(
        `SELECT id, runbook_step_order, title, status, approval_status, requires_approval,
                assignee_kind, assignee_key, expected_skill_slug, created_at, completed_at
           FROM work_items WHERE runbook_instance_id = $1 ORDER BY runbook_step_order`,
        [id],
      );
      return json({ instance: inst[0], step_work_items: steps });
    },
  );
}
