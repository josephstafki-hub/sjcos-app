// Snags and owner decisions (A16 / W11). The agent gathers facts and prepares
// options; it NEVER decides continue/pause and never reads silence as
// permission. Every snag reaches Joe immediately through the injected
// notifyOwner (urgent, not batched into a weekly summary).

import type { Run } from "../commands/core.ts";
import { getDecision, stageDecision, type Decision } from "../commands/decisions.ts";
import { humanOf, isOwner, type Principal } from "../commands/principal.ts";
import { centralWeekStart } from "./dates.ts";
import type { FieldHooks } from "./hooks.ts";
import { authorizeSubWrite, dedupePhotos, REPORT_COLS, type FieldReport, type PhotoRef } from "./reports.ts";

export interface FieldIncident {
  id: string;
  project_id: string;
  source_report_id: string | null;
  affected_scope: string;
  impacts: Record<string, unknown>;
  recommendation: string;
  actual_site_status: string;
  owner_decision: "pending" | "continue" | "pause" | "other";
  decision_id: string | null;
  instructions: string;
  decided_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

const INCIDENT_COLS = `id, project_id, source_report_id, affected_scope, impacts, recommendation, actual_site_status, owner_decision, decision_id,
  instructions, decided_at::text AS decided_at, resolved_at::text AS resolved_at, created_at::text AS created_at`;

export interface SnagInput {
  projectId: string;
  subSlug?: string | null;
  body: string;
  photos?: PhotoRef[];
  affectedScope: string;
  impacts?: { cost?: { cents?: number | null; note?: string }; schedule?: { days?: number | null; note?: string }; client?: { note?: string } };
  recommendation?: string;
  /** What the site reports right now (crew stopped / still working / unknown). */
  actualSiteStatus?: string;
  clientEventId?: string | null;
}

export async function reportSnag(
  run: Run,
  principal: Principal,
  input: SnagInput,
  hooks: FieldHooks,
): Promise<{ report: FieldReport; incident: FieldIncident; decision: Decision; created: boolean }> {
  const who = await authorizeSubWrite(run, principal, input);
  const weekStart = await centralWeekStart(run);
  const photos = dedupePhotos(input.photos ?? []);
  const [inserted] = await run<FieldReport>(
    `INSERT INTO field_reports (project_id, sub_slug, kind, body, photos, author, author_user_id, source, visibility, week_start, client_event_id)
     VALUES ($1, $2, 'snag', $3, $4::jsonb, $5, $6, $7, 'internal', $8::date, $9)
     ON CONFLICT (project_id, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
     RETURNING ${REPORT_COLS}`,
    [input.projectId, who.subSlug, input.body.trim(), JSON.stringify(photos), who.author, who.authorUserId, who.source, weekStart, input.clientEventId ?? null],
  );
  if (!inserted) {
    const [report] = await run<FieldReport>(`SELECT ${REPORT_COLS} FROM field_reports WHERE project_id = $1 AND client_event_id = $2`, [input.projectId, input.clientEventId]);
    const [incident] = await run<FieldIncident>(`SELECT ${INCIDENT_COLS} FROM field_incidents WHERE source_report_id = $1`, [report.id]);
    const decision = incident?.decision_id ? await getDecision(run, incident.decision_id) : null;
    return { report, incident, decision: decision!, created: false };
  }
  const [proj] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [input.projectId]);
  const impacts = input.impacts ?? {};
  const [incident0] = await run<FieldIncident>(
    `INSERT INTO field_incidents (project_id, source_report_id, affected_scope, impacts, recommendation, actual_site_status)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING ${INCIDENT_COLS}`,
    [input.projectId, inserted.id, input.affectedScope, JSON.stringify(impacts), input.recommendation ?? "", input.actualSiteStatus ?? "unknown"],
  );
  const staged = await stageDecision(run, {
    kind: "snag_decision",
    action: "decide_snag",
    title: `Snag · ${input.affectedScope} · ${proj?.name ?? "project"}`,
    summary: {
      effect: input.body.trim(),
      changes: [
        impacts.cost?.cents != null ? `Cost impact ~$${(impacts.cost.cents / 100).toFixed(0)}${impacts.cost.note ? ` (${impacts.cost.note})` : ""}` : `Cost impact: ${impacts.cost?.note ?? "unknown"}`,
        impacts.schedule?.days != null ? `Schedule impact ~${impacts.schedule.days} day(s)${impacts.schedule.note ? ` (${impacts.schedule.note})` : ""}` : `Schedule impact: ${impacts.schedule?.note ?? "unknown"}`,
        `Client impact: ${impacts.client?.note ?? "unknown"}`,
      ],
      recommendation: input.recommendation ?? "",
      siteStatus: input.actualSiteStatus ?? "unknown",
      reportedBy: inserted.author,
      attachments: photos.map((p) => ({ label: p.fileId, fileId: p.fileId })),
    },
    options: ["continue", "pause", "other"],
    targetKind: "field_incident",
    targetId: incident0.id,
    content: { incidentId: incident0.id, reportId: inserted.id, affectedScope: input.affectedScope, impacts },
    projectId: input.projectId,
    href: proj ? `/projects/${proj.slug}` : null,
    dedupeKey: `snag:${incident0.id}`,
    expiresInMinutes: 3 * 24 * 60,
    requestedBy: principal,
  });
  const [incident] = await run<FieldIncident>(`UPDATE field_incidents SET decision_id = $2 WHERE id = $1 RETURNING ${INCIDENT_COLS}`, [incident0.id, staged.decision.id]);
  await hooks.notifyOwner({
    kind: "urgent_item",
    title: `Snag on ${proj?.name ?? "a job"}: ${input.affectedScope}`,
    body: `${inserted.author}: ${input.body.trim().slice(0, 200)}${input.recommendation ? `\nRecommendation: ${input.recommendation}` : ""}\nSite now: ${input.actualSiteStatus ?? "unknown"}. Continue / pause is your call.`,
    href: proj ? `/projects/${proj.slug}` : "/engine",
  });
  return { report: inserted, incident, decision: staged.decision, created: true };
}

export type SnagChoice = "continue" | "pause" | "other";

/** Record Joe's decision on a snag. Requires the decision to have been
 *  resolved by a human with authority (resolveDecision already enforced it);
 *  a pending decision is refused — no agent can pick continue/pause. */
export async function applyOwnerSnagDecision(
  run: Run,
  principal: Principal,
  input: { incidentId: string; choice: SnagChoice; instructions?: string },
  hooks: FieldHooks,
): Promise<{ ok: true; incident: FieldIncident } | { ok: false; reason: string }> {
  const [inc] = await run<FieldIncident>(`SELECT ${INCIDENT_COLS} FROM field_incidents WHERE id = $1 FOR UPDATE`, [input.incidentId]);
  if (!inc) return { ok: false, reason: "No such incident." };
  if (inc.owner_decision !== "pending") return { ok: true, incident: inc };
  const d = inc.decision_id ? await getDecision(run, inc.decision_id) : null;
  if (!d) return { ok: false, reason: "The snag has no decision card." };
  if (d.status === "pending") return { ok: false, reason: "Joe has not decided yet. Silence is not permission — keep the work marked pending." };
  if (d.status !== "approved" && d.status !== "rejected" && d.status !== "consumed") return { ok: false, reason: `Decision is ${d.status}; a fresh card is needed.` };
  if (!isOwner(principal) && d.decided_by_user_id !== humanOf(principal)?.userId) {
    return { ok: false, reason: "Only the person who decided (or the owner) can record the instruction." };
  }
  if (!["continue", "pause", "other"].includes(input.choice)) return { ok: false, reason: "Choice must be continue, pause or other." };
  const [updated] = await run<FieldIncident>(
    `UPDATE field_incidents SET owner_decision = $2, instructions = $3, decided_by = $4, decided_at = now()
      WHERE id = $1 AND owner_decision = 'pending' RETURNING ${INCIDENT_COLS}`,
    [inc.id, input.choice, input.instructions ?? "", d.decided_by_user_id],
  );
  if (!updated) return { ok: true, incident: inc };
  // Update tasks: file the instruction for the sub through the follow-up hook.
  await hooks.createFollowUp(run, {
    projectId: inc.project_id,
    subSlug: null,
    title: `${input.choice === "pause" ? "PAUSE" : input.choice === "continue" ? "Continue" : "Instruction"} · ${inc.affected_scope}`,
    body: input.instructions ?? "",
    dedupeKey: `field:snag_instruction:${inc.id}`,
    audience: "sub",
    priority: input.choice === "pause" ? "urgent" : "high",
  });
  return { ok: true, incident: updated };
}

export async function resolveIncident(run: Run, incidentId: string): Promise<boolean> {
  const rows = await run(`UPDATE field_incidents SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL RETURNING id`, [incidentId]);
  return rows.length === 1;
}

export async function openIncidents(run: Run, projectId: string): Promise<FieldIncident[]> {
  return run<FieldIncident>(`SELECT ${INCIDENT_COLS} FROM field_incidents WHERE project_id = $1 AND resolved_at IS NULL ORDER BY created_at`, [projectId]);
}
