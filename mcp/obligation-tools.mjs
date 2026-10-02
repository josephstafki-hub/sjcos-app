// Obligation + evidence-backed completion tools (A01 / A02 / A04). Own module
// so it can be developed without colliding with sjcos-mcp.mjs; the owner wires
// it with one line inside buildServer():
//
//   import { registerObligationTools } from "./obligation-tools.mjs";
//   ...
//   registerObligationTools(server, { rows, json, appCall: runbooksCall });
//
// `appCall(action, payload)` posts to the app's internal runbooks route
// (app/api/internal/runbooks/route.ts) — the completion command and the repair
// pass live in lib/completion + lib/runbook-engine (TS) which this process
// can't import. list/get are direct reads.

import { z } from "zod";

const OBLIGATION_SELECT = `
  SELECT o.id, o.kind, o.title, o.status, o.owner_kind, o.owner_key, o.next_action,
         o.due_at, o.deadline_at, o.deadline_source, o.resolution, o.resolved_at, o.resolved_by,
         o.source_message_ids, o.review_reason, o.created_by, o.created_at, o.updated_at,
         l.slug AS lead_slug, p.slug AS project_slug,
         (SELECT count(*)::int FROM work_items w WHERE w.obligation_id = o.id AND w.status NOT IN ('done','cancelled')) AS open_work_items
    FROM obligations o
    LEFT JOIN leads l    ON l.id = o.lead_id
    LEFT JOIN projects p ON p.id = o.project_id`;

export function registerObligationTools(server, { rows, json, appCall }) {
  server.registerTool(
    "list_obligations",
    {
      title: "List obligations",
      description:
        "Business obligations (things we owe someone) with their lifecycle: open / waiting / " +
        "done / cancelled / review. Separate from the message or thread that surfaced them — " +
        "one thread can carry several, and each is keyed by stable provider ids, never by " +
        "title. 'review' = the system could not tie the source to a stable identity or the " +
        "item dropped out of its scan; a person decides. Filter by status, lead, project or kind.",
      inputSchema: {
        status: z.enum(["open", "waiting", "done", "cancelled", "review"]).optional(),
        lead_slug: z.string().optional(),
        project_slug: z.string().optional(),
        kind: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ status, lead_slug, project_slug, kind, limit }) => {
      const out = await rows(
        `${OBLIGATION_SELECT}
          WHERE ($1::text IS NULL OR o.status = $1)
            AND ($2::text IS NULL OR l.slug = $2)
            AND ($3::text IS NULL OR p.slug = $3)
            AND ($4::text IS NULL OR o.kind = $4)
          ORDER BY CASE o.status WHEN 'review' THEN 0 WHEN 'open' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, o.updated_at DESC
          LIMIT $5`,
        [status ?? null, lead_slug ?? null, project_slug ?? null, kind ?? null, limit ?? 50],
      );
      return json({ ok: true, count: out.length, obligations: out });
    },
  );

  server.registerTool(
    "get_obligation",
    {
      title: "Get an obligation",
      description: "One obligation with its source links (provider thread/message ids and roles) and the work items executing it.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const [o] = await rows(`${OBLIGATION_SELECT} WHERE o.id = $1`, [id]);
      if (!o) return json({ ok: false, error: `No obligation ${id}` });
      const sources = await rows(
        `SELECT id, provider, account, thread_id, message_id, role, occurred_at, summary, created_at
           FROM obligation_sources WHERE obligation_id = $1 ORDER BY created_at`,
        [id],
      );
      const work = await rows(
        `SELECT id, title, status, priority, assignee_key, due_at, snoozed_until, approval_status, blocked_reason, created_by, created_at, completed_at
           FROM work_items WHERE obligation_id = $1 ORDER BY created_at`,
        [id],
      );
      return json({ ok: true, obligation: o, sources, work_items: work });
    },
  );

  server.registerTool(
    "complete_work_item_with_evidence",
    {
      title: "Complete a work item with evidence",
      description:
        "Mark a work item done ONLY with typed evidence of the business outcome; the app " +
        "validates it before anything is written. Kinds: draft {knowledge_item_id | " +
        "document_draft_id} · provider_accepted {intent_id} (intent accepted/confirmed) · " +
        "delivered {intent_id} (intent confirmed) · business_response {obligation_id | " +
        "source_event_id} · manual {actor, reason} (a person resolved it; no receipt is " +
        "invented) · record {table, id, revision} (the row at the revision you read). " +
        "Stale, wrong or missing evidence is refused with a reason. On success one receipt " +
        "is written and a runbook step advances in the same transaction. Runbook steps " +
        "declare the evidence kind they need; the error tells you which.",
      inputSchema: {
        work_item_id: z.string(),
        evidence: z.object({
          kind: z.enum(["draft", "provider_accepted", "delivered", "business_response", "manual", "record"]),
          knowledge_item_id: z.string().optional(),
          document_draft_id: z.union([z.string(), z.number()]).optional(),
          intent_id: z.string().optional(),
          obligation_id: z.string().optional(),
          source_event_id: z.string().optional(),
          actor: z.string().optional(),
          reason: z.string().optional(),
          table: z.string().optional(),
          id: z.union([z.string(), z.number()]).optional(),
          revision: z.string().optional(),
          label: z.string().optional(),
        }),
        agent_run_id: z.string().optional(),
        note: z.string().optional(),
        agent: z.string().optional().describe("Runtime name for the audit principal (claude / hermes / qwen). Default 'mcp'."),
      },
    },
    async ({ work_item_id, evidence, agent_run_id, note, agent }) => {
      return json(await appCall("complete", { work_item_id, evidence, agent_run_id, note, agent: agent ?? "mcp" }));
    },
  );

  server.registerTool(
    "runbook_repair_preview",
    {
      title: "Preview runbook repair",
      description:
        "Dry-run the runbook repair pass: lists live runbook instances whose current step has no " +
        "work item and what a real repair would do (recreate exactly that step from the pinned " +
        "definition, or flag needs_review when the definition cannot be proven). Writes only the " +
        "repair log; never creates work items. Real repair is owner-run in the app.",
      inputSchema: { limit: z.number().int().min(1).max(500).optional() },
    },
    async ({ limit }) => json(await appCall("repair", { dry_run: true, limit })),
  );
}
