// Weekly client summaries (A16 / W10, policy weekly.client_summary).
//
// A summary is assembled ONLY from field_reports with visibility 'client_ok'
// (and their photos). Every claim carries the report id and photo ids it came
// from. Internal notes, prices, private files and unverified milestone claims
// never enter. Reports tied to an OPEN incident (snag) are withheld until Joe
// decides how to tell the client; unrelated factual progress still goes out.
//
// Publishing enqueues intents (portal_publish + optional send_email) that the
// WS-approvals dispatcher delivers. Replay-safe: UNIQUE(project, week,
// revision) + intent operation keys derived from the summary id.

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { consumeDecision, getDecision, stageDecision } from "../commands/decisions.ts";
import { enqueueIntent } from "../commands/intents.ts";
import { activePolicy, laneOpen, policyRef } from "../commands/policies.ts";
import type { Principal } from "../commands/principal.ts";
import { centralWeekStart, weeklySlotInstant } from "./dates.ts";
import type { PhotoRef } from "./reports.ts";

export const WEEKLY_POLICY_KEY = "weekly.client_summary";

export interface SummaryClaim {
  text: string;
  reportId: string;
  photoIds: string[];
  reportedAt: string;
  author: string;
}

export interface SummaryContent {
  weekStart: string;
  projectName: string;
  claims: SummaryClaim[];
  photos: string[];
  /** Internal only — never delivered. */
  held: { reportId: string; reason: string }[];
  milestonesConfirmed: string[];
}

export interface WeeklySummary {
  id: string;
  project_id: string;
  week_start: string;
  revision: number;
  content: SummaryContent;
  status: "draft" | "held" | "pending_decision" | "published";
  held_reason: string | null;
  publish_intent_id: string | null;
  email_intent_id: string | null;
  decision_id: string | null;
  auth_ref: string | null;
  published_at: string | null;
}

const SUMMARY_COLS = `id, project_id, to_char(week_start, 'YYYY-MM-DD') AS week_start, revision, content, status, held_reason, publish_intent_id,
  email_intent_id, decision_id, auth_ref, published_at::text AS published_at`;

/** Photos the client may see: attached to a client_ok report, exist in files,
 *  and not marked private/internal. Private project files that were never put
 *  on a client_ok report cannot appear by construction. */
async function permittedPhotoIds(run: Run, refs: PhotoRef[]): Promise<string[]> {
  if (!refs.length) return [];
  const rows = await run<{ id: string }>(
    `SELECT id FROM files WHERE id = ANY($1::text[]) AND tag NOT ILIKE '%private%' AND tag NOT ILIKE '%internal%' AND type = 'img'`,
    [refs.map((r) => r.fileId)],
  );
  const ok = new Set(rows.map((r) => r.id));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (!ok.has(r.fileId) || seen.has(r.fileId)) continue;
    if (r.sha256 && seen.has(`h:${r.sha256}`)) continue;
    seen.add(r.fileId);
    if (r.sha256) seen.add(`h:${r.sha256}`);
    out.push(r.fileId);
  }
  return out;
}

/** Assemble the content for (project, week). Pure read; no rows written. */
export async function assembleWeeklyContent(run: Run, projectId: string, weekStart: string): Promise<SummaryContent> {
  const [proj] = await run<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [projectId]);
  const reports = await run<{ id: string; kind: string; body: string; photos: PhotoRef[]; author: string; reported_at: string; claimed_milestone_key: string | null; verification: string }>(
    `SELECT id, kind, body, photos, author, reported_at::text AS reported_at, claimed_milestone_key, verification
       FROM field_reports
      WHERE project_id = $1 AND week_start = $2::date AND ((visibility = 'client_ok' AND kind IN ('progress','completion')) OR kind = 'snag')
      ORDER BY reported_at`,
    [projectId, weekStart],
  );
  const openIncidentReports = await run<{ source_report_id: string | null; affected_scope: string }>(
    `SELECT source_report_id, affected_scope FROM field_incidents WHERE project_id = $1 AND resolved_at IS NULL AND owner_decision = 'pending'`,
    [projectId],
  );
  const heldIds = new Set(openIncidentReports.map((r) => r.source_report_id).filter(Boolean) as string[]);
  const confirmed = await run<{ milestone_key: string }>(`SELECT milestone_key FROM milestone_confirmations WHERE project_id = $1 AND confirmed_at >= $2::date AND confirmed_at < ($2::date + 7)`, [
    projectId,
    weekStart,
  ]);
  const claims: SummaryClaim[] = [];
  const held: SummaryContent["held"] = [];
  const photoSet: string[] = [];
  const seenBodies = new Set<string>();
  const seenSha = new Set<string>();
  for (const r of reports) {
    const body = r.body.replace(/#[a-z0-9_-]+/gi, "").trim();
    if (heldIds.has(r.id) || r.kind === "snag") {
      held.push({ reportId: r.id, reason: r.kind === "snag" ? "snag report — Joe decides before the client hears about it" : "linked to an open incident awaiting Joe's decision" });
      continue;
    }
    // Only the incident's own reports are held; factual progress on the same
    // scope still publishes (WORKFLOW W10: hold affected content, not unrelated facts).
    // A completion claim is only a claim until Joe confirmed it.
    let text = body;
    if (r.kind === "completion" && r.verification !== "owner_confirmed") {
      text = body ? `${body} (reported by the crew; pending Joe's site check)` : "";
      if (!text) {
        held.push({ reportId: r.id, reason: "completion claim not yet confirmed" });
        continue;
      }
    }
    // Same bytes re-uploaded under a new id in a later report: one photo, once.
    const unseenRefs = (r.photos ?? []).filter((p) => {
      if (p?.sha256 && seenSha.has(p.sha256)) return false;
      if (p?.sha256) seenSha.add(p.sha256);
      return true;
    });
    const photos = await permittedPhotoIds(run, unseenRefs);
    const fresh = photos.filter((p) => !photoSet.includes(p));
    photoSet.push(...fresh);
    const key = text.toLowerCase();
    if (text && !seenBodies.has(key)) {
      seenBodies.add(key);
      claims.push({ text, reportId: r.id, photoIds: photos, reportedAt: r.reported_at, author: r.author });
    } else if (text) {
      // Duplicate wording (re-sent update): keep the first claim, merge photos.
      const c = claims.find((x) => x.text.toLowerCase() === key);
      if (c) for (const p of fresh) if (!c.photoIds.includes(p)) c.photoIds.push(p);
    } else if (fresh.length) {
      claims.push({ text: `${fresh.length} new site photo${fresh.length === 1 ? "" : "s"}`, reportId: r.id, photoIds: fresh, reportedAt: r.reported_at, author: r.author });
    }
  }
  return { weekStart, projectName: proj?.name ?? "", claims, photos: photoSet, milestonesConfirmed: confirmed.map((c) => c.milestone_key), held };
}

/** The client-facing rendering of a summary (what the intents carry). Held
 *  items are NOT included. */
export function renderClientSummary(c: SummaryContent): { subject: string; text: string } {
  const lines = [`Weekly update · ${c.projectName} · week of ${c.weekStart}`, ""];
  if (c.claims.length) for (const cl of c.claims) lines.push(`• ${cl.text}`);
  else lines.push("• No new field updates were recorded this week.");
  if (c.milestonesConfirmed.length) lines.push("", `Milestones confirmed: ${c.milestonesConfirmed.join(", ")}`);
  if (c.photos.length) lines.push("", `${c.photos.length} photo${c.photos.length === 1 ? "" : "s"} added to your dashboard.`);
  return { subject: `Weekly update — ${c.projectName}`, text: lines.join("\n") };
}

export interface BuildSummaryResult {
  summary: WeeklySummary;
  created: boolean;
  /** What happened on this call. */
  outcome: "published" | "held" | "pending_decision" | "already_published" | "lane_paused";
}

/** Build (or return) the week's summary and publish it under the policy.
 *  Same (project, week) → the same row; nothing is enqueued twice. */
export async function buildWeeklyClientSummary(
  run: Run,
  principal: Principal,
  projectId: string,
  weekStart?: string,
  opts: { commandId?: string | null; revision?: number } = {},
): Promise<BuildSummaryResult> {
  const ws = weekStart ?? (await centralWeekStart(run));
  const revision = opts.revision ?? 1;
  const [existing] = await run<WeeklySummary>(`SELECT ${SUMMARY_COLS} FROM weekly_summaries WHERE project_id = $1 AND week_start = $2::date AND revision = $3 FOR UPDATE`, [
    projectId,
    ws,
    revision,
  ]);
  if (existing?.status === "published") return { summary: existing, created: false, outcome: "already_published" };
  if (existing?.status === "pending_decision") return { summary: existing, created: false, outcome: "pending_decision" };

  const content = await assembleWeeklyContent(run, projectId, ws);
  const nothingPublishable = content.claims.length === 0 && content.photos.length === 0 && content.milestonesConfirmed.length === 0;
  const heldReason = content.held.length
    ? `${content.held.length} item(s) withheld: ${[...new Set(content.held.map((h) => h.reason))].join("; ")}`
    : null;

  let summary: WeeklySummary;
  if (existing) {
    [summary] = await run<WeeklySummary>(`UPDATE weekly_summaries SET content = $2::jsonb, held_reason = $3 WHERE id = $1 RETURNING ${SUMMARY_COLS}`, [existing.id, JSON.stringify(content), heldReason]);
  } else {
    [summary] = await run<WeeklySummary>(
      `INSERT INTO weekly_summaries (project_id, week_start, revision, content, status, held_reason)
       VALUES ($1, $2::date, $3, $4::jsonb, 'draft', $5) RETURNING ${SUMMARY_COLS}`,
      [projectId, ws, revision, JSON.stringify(content), heldReason],
    );
  }

  if (nothingPublishable && content.held.length) {
    [summary] = await run<WeeklySummary>(`UPDATE weekly_summaries SET status = 'held' WHERE id = $1 RETURNING ${SUMMARY_COLS}`, [summary.id]);
    return { summary, created: !existing, outcome: "held" };
  }

  const lane = await laneOpen(run, "weekly_summary");
  if (!lane.open) {
    [summary] = await run<WeeklySummary>(`UPDATE weekly_summaries SET status = 'held', held_reason = $2 WHERE id = $1 RETURNING ${SUMMARY_COLS}`, [summary.id, `lane paused: ${lane.reason}`]);
    return { summary, created: !existing, outcome: "lane_paused" };
  }

  const policy = await activePolicy(run, WEEKLY_POLICY_KEY);
  if (!policy) {
    const staged = await stageDecision(run, {
      kind: "weekly_summary",
      action: "publish_weekly_summary",
      title: `Publish weekly update · ${content.projectName} · week of ${ws}`,
      summary: {
        inclusions: content.claims.map((c) => c.text),
        exclusions: content.held.map((h) => `report ${h.reportId}: ${h.reason}`),
        attachments: content.photos.map((id) => ({ label: id, fileId: id })),
        effect: "Publishes to the client dashboard (and emails the client if configured).",
      },
      targetKind: "weekly_summary",
      targetId: summary.id,
      content: { summaryId: summary.id, rendered: renderClientSummary(content), photos: content.photos },
      projectId,
      dedupeKey: `weekly_summary:${summary.id}`,
      requestedBy: principal,
    });
    [summary] = await run<WeeklySummary>(`UPDATE weekly_summaries SET status = 'pending_decision', decision_id = $2 WHERE id = $1 RETURNING ${SUMMARY_COLS}`, [summary.id, staged.decision.id]);
    return { summary, created: !existing, outcome: "pending_decision" };
  }
  summary = await publishSummary(run, principal, summary, { authRef: policyRef(policy), policyRef: policyRef(policy), decisionId: null, commandId: opts.commandId ?? null, sendEmail: policy.config.send_email !== false });
  return { summary, created: !existing, outcome: "published" };
}

/** Enqueue the delivery intents and mark published. Idempotent by operation key. */
async function publishSummary(
  run: Run,
  principal: Principal,
  summary: WeeklySummary,
  o: { authRef: string; policyRef: string | null; decisionId: string | null; commandId: string | null; sendEmail: boolean },
): Promise<WeeklySummary> {
  const content = summary.content;
  const rendered = renderClientSummary(content);
  const contentHash = hashInput({ rendered, photos: content.photos });
  const artifactRevision = `weekly_summary:${summary.id}:rev${summary.revision}:${contentHash.slice(0, 12)}`;
  const [settings] = await run<{ send_email: boolean }>(`SELECT send_email FROM weekly_summary_settings WHERE project_id = $1`, [summary.project_id]);
  const { intent: portal } = await enqueueIntent(run, {
    operationKey: `weekly_summary:${summary.id}:portal:rev${summary.revision}`,
    kind: "portal_publish",
    targetKind: "weekly_summary",
    targetId: summary.id,
    projectId: summary.project_id,
    payload: { summaryId: summary.id, weekStart: summary.week_start, rendered, photos: content.photos, claims: content.claims },
    artifactRevision,
    decisionId: o.decisionId,
    policyRef: o.policyRef,
    commandId: o.commandId,
    principal,
  });
  let emailId: string | null = null;
  const wantEmail = o.sendEmail && (settings?.send_email ?? true);
  if (wantEmail) {
    const [client] = await run<{ email: string | null }>(
      `SELECT COALESCE(NULLIF((SELECT u.email FROM users u WHERE u.role = 'client' AND u.active AND u.link_slug = p.slug AND u.email NOT LIKE '%@client-portal.invalid' LIMIT 1), ''), NULLIF(p.client_email, '')) AS email
         FROM projects p WHERE p.id = $1`,
      [summary.project_id],
    );
    if (client?.email) {
      const { intent: email } = await enqueueIntent(run, {
        operationKey: `weekly_summary:${summary.id}:email:rev${summary.revision}`,
        kind: "send_email",
        targetKind: "weekly_summary",
        targetId: summary.id,
        recipient: client.email,
        projectId: summary.project_id,
        payload: { to: client.email, subject: rendered.subject, body: rendered.text, photos: content.photos, summaryId: summary.id },
        artifactRevision,
        decisionId: o.decisionId,
        policyRef: o.policyRef,
        commandId: o.commandId,
        principal,
      });
      emailId = email.id;
    }
  }
  const [updated] = await run<WeeklySummary>(
    `UPDATE weekly_summaries SET status = 'published', publish_intent_id = $2, email_intent_id = $3, auth_ref = $4, decision_id = COALESCE($5, decision_id), published_at = now()
      WHERE id = $1 RETURNING ${SUMMARY_COLS}`,
    [summary.id, portal.id, emailId, o.authRef, o.decisionId],
  );
  return updated;
}

/** After Joe approves a 'weekly_summary' decision (policy inactive path). */
export async function publishApprovedWeeklySummary(run: Run, principal: Principal, decisionId: string): Promise<{ ok: true; summary: WeeklySummary } | { ok: false; reason: string }> {
  const d = await getDecision(run, decisionId);
  if (!d || d.kind !== "weekly_summary" || !d.target_id) return { ok: false, reason: "Not a weekly summary decision." };
  const [summary] = await run<WeeklySummary>(`SELECT ${SUMMARY_COLS} FROM weekly_summaries WHERE id = $1 FOR UPDATE`, [d.target_id]);
  if (!summary) return { ok: false, reason: "Summary vanished." };
  if (summary.status === "published") return { ok: true, summary };
  if (d.status === "approved") {
    const c = await consumeDecision(run, { id: d.id, action: "publish_weekly_summary", contentHash: d.content_hash, targetKind: "weekly_summary", targetId: d.target_id, consumer: "field.publishApprovedWeeklySummary" });
    if (!c.ok) return { ok: false, reason: c.reason };
  } else if (d.status !== "consumed") {
    return { ok: false, reason: `Decision is ${d.status}.` };
  }
  const out = await publishSummary(run, principal, summary, { authRef: `decision:${d.id}`, policyRef: null, decisionId: d.id, commandId: null, sendEmail: true });
  return { ok: true, summary: out };
}

/** Projects whose weekly slot has passed for the current Central week and
 *  that have no summary yet. Default slot from the policy config (weekday 5
 *  = Friday, 15:00) with per-project overrides in weekly_summary_settings. */
export async function dueWeeklySummaries(run: Run, now: Date = new Date()): Promise<{ projectId: string; weekStart: string; dueAt: string }[]> {
  const ws = await centralWeekStart(run, now);
  const policy = await activePolicy(run, WEEKLY_POLICY_KEY);
  const cfg = policy?.config ?? {};
  const defWeekday = Number(cfg.weekday ?? 5);
  const defHour = Number(cfg.hour ?? 15);
  const defMinute = Number(cfg.minute ?? 0);
  const rows = await run<{ id: string; weekday: number | null; hour: number | null; minute: number | null; enabled: boolean | null }>(
    `SELECT p.id, s.weekday, s.hour, s.minute, s.enabled
       FROM projects p LEFT JOIN weekly_summary_settings s ON s.project_id = p.id
      WHERE p.status IN ('construction','closeout')
        AND NOT EXISTS (SELECT 1 FROM weekly_summaries w WHERE w.project_id = p.id AND w.week_start = $1::date)`,
    [ws],
  );
  const due: { projectId: string; weekStart: string; dueAt: string }[] = [];
  for (const r of rows) {
    if (r.enabled === false) continue;
    const at = await weeklySlotInstant(run, ws, r.weekday ?? defWeekday, r.hour ?? defHour, r.minute ?? defMinute);
    if (new Date(at).getTime() <= now.getTime()) due.push({ projectId: r.id, weekStart: ws, dueAt: at });
  }
  return due;
}

export async function listPublishedSummaries(run: Run, projectId: string, limit = 26): Promise<WeeklySummary[]> {
  return run<WeeklySummary>(`SELECT ${SUMMARY_COLS} FROM weekly_summaries WHERE project_id = $1 AND status = 'published' ORDER BY week_start DESC, revision DESC LIMIT $2`, [projectId, limit]);
}
