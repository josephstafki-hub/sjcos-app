// A16/A17 field, schedule and closeout tools (WORKFLOW W09–W12). Every write
// is proxied to the app's internal field route (app/api/internal/field) so
// the funding, billing and owner-push hooks are the real ones; reads too, so
// visibility rules live in one place. Sub-portal identity is enforced in the
// app: an agent records what a sub or Joe supplied, source-linked.

import { z } from "zod";

const photo = z.object({ fileId: z.string(), sha256: z.string().optional() });

export function registerFieldTools(server, { json, fieldCall, slugToId }) {
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
  const project = async (slug) => {
    const id = await slugToId("projects", slug);
    if (!id) throw new Error(`No project ${slug}`);
    return id;
  };
  const call = async (action, payload) => json(await fieldCall(action, payload));

  server.registerTool(
    "record_field_progress",
    { title: "Record sub progress / photos (W10)", description: "A progress report from the sub portal, a text, an email or Joe, with photo file ids (deduped by hash) and visibility (client_ok or internal). Source-linked evidence for the weekly summary and milestone confirmation; never a completion by itself.", inputSchema: { project_slug: z.string(), body: z.string(), sub_slug: z.string().optional(), photos: z.array(photo).optional(), visibility: z.enum(["internal", "client_ok"]).optional(), source: z.enum(["portal", "sms", "email", "owner", "agent"]).optional(), milestone_key: z.string().optional(), client_event_id: z.string().optional(), reported_at: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        return call("record_progress", { input: { projectId: id, subSlug: a.sub_slug ?? null, body: a.body, photos: a.photos, visibility: a.visibility, source: a.source ?? "agent", milestoneKey: a.milestone_key ?? null, clientEventId: a.client_event_id ?? null, reportedAt: a.reported_at ?? null } });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_completion_report",
    { title: "Sub reports a milestone complete (W10)", description: "Checks the photos already on file for the milestone, asks ONLY for what is missing (a targeted request, once), and stages Joe's milestone_confirmation decision with the evidence. Joe's confirmation — not the claim — triggers billing.", inputSchema: { project_slug: z.string(), milestone_key: z.string(), milestone_label: z.string().optional(), body: z.string(), sub_slug: z.string().optional(), photos: z.array(photo).optional(), client_event_id: z.string().optional(), min_photos: z.number().int().optional(), required_views: z.array(z.string()).optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        return call("completion_report", { input: { projectId: id, subSlug: a.sub_slug ?? null, milestoneKey: a.milestone_key, milestoneLabel: a.milestone_label, body: a.body, photos: a.photos, clientEventId: a.client_event_id ?? null, minPhotos: a.min_photos, requiredViews: a.required_views } });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "report_snag",
    { title: "Report a snag → Joe decides (W11)", description: "Immediate owner alert with source evidence, affected work, cost/schedule/client impact, recommendation and the actual site status, plus the continue/pause decision. The agent never decides continue/pause; silence is not permission.", inputSchema: { project_slug: z.string(), body: z.string(), affected_scope: z.string(), sub_slug: z.string().optional(), photos: z.array(photo).optional(), impacts: z.object({ cost: z.object({ cents: z.number().int().optional(), note: z.string().optional() }).optional(), schedule: z.object({ days: z.number().int().optional(), note: z.string().optional() }).optional(), client: z.object({ note: z.string().optional() }).optional() }).optional(), recommendation: z.string().optional(), actual_site_status: z.string().optional(), client_event_id: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        return call("report_snag", { input: { projectId: id, subSlug: a.sub_slug ?? null, body: a.body, affectedScope: a.affected_scope, photos: a.photos, impacts: a.impacts, recommendation: a.recommendation, actualSiteStatus: a.actual_site_status, clientEventId: a.client_event_id ?? null } });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "apply_snag_decision",
    { title: "Apply Joe's snag decision", description: "After the snag decision is resolved by a person with authority: record the instruction (continue / pause / other) and update tasks. Refused while pending or when the caller is an agent without a person behind it.", inputSchema: { incident_id: z.string().uuid(), choice: z.enum(["continue", "pause", "other"]), instructions: z.string().optional() } },
    async (a) => call("apply_snag_decision", { input: { incidentId: a.incident_id, choice: a.choice, instructions: a.instructions } }),
  );

  server.registerTool(
    "compile_weekly_sub_report",
    { title: "Compile a sub's weekly report from existing evidence (W10)", description: "Uses the progress notes, photos and snags already supplied this week; asks precisely for only the missing part (once). If evidence is sufficient nothing is requested.", inputSchema: { project_slug: z.string(), sub_slug: z.string(), week_start: z.string().optional() } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        return call("compile_weekly_report", { input: { projectId: id, subSlug: a.sub_slug, weekStart: a.week_start } });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_field_evidence",
    { title: "Field reports, incidents and the weekly summary content", description: "What is on file for a project: reports (with photos and verification), open incidents awaiting Joe, and the assembled weekly client-summary content (verified client-safe claims, held items, photos).", inputSchema: { project_slug: z.string(), week_start: z.string().optional(), sub_slug: z.string().optional() } },
    async ({ project_slug, week_start, sub_slug }) => {
      try {
        const id = await project(project_slug);
        const reports = await fieldCall("list_reports", { project_id: id, week_start, sub_slug });
        const weekly = await fieldCall("weekly_content", { project_id: id, week_start });
        return json({ ...reports, weekly });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "prepare_tentative_schedule",
    { title: "Prepare a tentative construction schedule (W09)", description: "Lays out phases from dependencies, durations (business days), inspections, material lead times and funding readiness. Tentative only: nothing is confirmed with the client or subs until Joe approves AND the agreement is signed AND the initial payment is received.", inputSchema: { project_slug: z.string(), start_date: z.string().optional(), note: z.string().optional(), phases: z.array(z.object({ key: z.string(), label: z.string(), durationDays: z.number().int().positive(), dependsOn: z.array(z.string()).optional(), inspection: z.string().optional(), crew: z.string().optional(), calendarDays: z.boolean().optional(), materials: z.array(z.object({ item: z.string(), leadTimeDays: z.number().int(), bufferDays: z.number().int().optional(), amountCents: z.number().int().optional() })).optional() })) } },
    async (a) => {
      try {
        const id = await project(a.project_slug);
        return call("prepare_schedule", { input: { projectId: id, phases: a.phases, startDate: a.start_date, note: a.note } });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "submit_schedule_for_approval",
    { title: "Stage the schedule decision for Joe (W09)", description: "Stages the full-schedule approval card (dates, dependencies, inspections, lead times, funding readiness). Approval alone does not confirm dates — see confirm_schedule.", inputSchema: { plan_id: z.string().uuid() } },
    async ({ plan_id }) => call("submit_schedule", { plan_id }),
  );

  server.registerTool(
    "confirm_schedule",
    { title: "Confirm the schedule (all gates)", description: "Confirms dates only when the schedule decision is approved, the construction agreement is signed and the initial payment is received; otherwise returns the exact blockers. Records the client/sub commitments made.", inputSchema: { plan_id: z.string().uuid(), commitments: z.array(z.object({ party: z.enum(["client", "sub", "supplier"]), partyRef: z.string(), phaseKey: z.string(), date: z.string(), promise: z.string() })).optional() } },
    async ({ plan_id, commitments }) => call("confirm_schedule", { plan_id, commitments: commitments ?? [] }),
  );

  server.registerTool(
    "adjust_internal_schedule",
    { title: "Adjust the schedule internally (W10)", description: "Applied automatically ONLY when no client/sub promise changes, cost does not rise (state the delta; unknown = not automatic) and no funding gap opens. Otherwise an immediate owner alert + schedule_impact decision with consequences and a recommendation; nothing is applied.", inputSchema: { plan_id: z.string().uuid(), changes: z.array(z.object({ phaseKey: z.string(), start: z.string(), end: z.string() })), cost_delta_cents: z.number().int().nullable(), note: z.string().optional() } },
    async (a) => call("adjust_schedule", { input: { planId: a.plan_id, changes: a.changes, costDeltaCents: a.cost_delta_cents, note: a.note } }),
  );

  server.registerTool(
    "list_schedule_plans",
    { title: "Schedule plans for a project", description: "Every plan revision with status (tentative / awaiting_approval / approved / confirmed / superseded), phases, lead times and commitments.", inputSchema: { project_slug: z.string() } },
    async ({ project_slug }) => {
      try {
        return call("list_plans", { project_id: await project(project_slug) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "closeout_checklists",
    { title: "Closeout checklists (W12)", description: "Internal inspection → corrections (Joe confirms) → client walkthrough → client punch → written sign-off → final invoice → post-project, with each item's evidence.", inputSchema: { project_slug: z.string() } },
    async ({ project_slug }) => {
      try {
        return call("closeout_overview", { project_id: await project(project_slug) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "closeout_step",
    { title: "Advance closeout (W12)", description: "prepare_inspection (punch list from field evidence), record_correction (sub evidence on an item), confirm_corrections (Joe's confirmation — required before the walkthrough), schedule_walkthrough (refused until corrections are confirmed), record_client_punch, resolve_client_punch, checkin_reply (a post-project reply; has_issue opens a warranty claim + escalation), record_actuals (materials/subs/owner hours with a traceable revision).", inputSchema: { project_slug: z.string(), step: z.enum(["prepare_inspection", "record_correction", "confirm_corrections", "schedule_walkthrough", "record_client_punch", "resolve_client_punch", "checkin_reply", "record_actuals"]), input: z.record(z.string(), z.unknown()).optional(), at: z.string().optional() } },
    async ({ project_slug, step, input, at }) => {
      try {
        const id = await project(project_slug);
        const payload = { project_id: id, at, input: { projectId: id, ...(input ?? {}) } };
        return call(step, payload);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
