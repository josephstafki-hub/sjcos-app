// Field evidence (A16 / W10): sub progress, completion reports, milestone
// confirmation and the compiled weekly sub report.
//
// Pure module (Run-based, no server-only) so tests/field-db.test.mjs drives
// it against the disposable harness. Every write is expected to run inside a
// command transaction (lib/commands/core.ts); server.ts binds that.
//
// Rules encoded here:
//   • A report is authenticated to a sub AND a job: the sub must be assigned
//     (project_subs) or the caller is the owner/agent-for-owner.
//   • Author, time, source and visibility are stored on every row.
//   • A completion report never confirms a milestone. It stages a decision
//     with the evidence; Joe's tap + confirmMilestone() records the
//     confirmation exactly once and fires onMilestoneConfirmed once.
//   • Photos already supplied count. A request goes out ONLY for what is
//     missing, and only once per (project, sub, milestone / week).

import { humanOf, isOwner, type Principal } from "../commands/principal.ts";
import type { Run } from "../commands/core.ts";
import { consumeDecision, getDecision, stageDecision, type Decision } from "../commands/decisions.ts";
import { centralWeekStart } from "./dates.ts";
import type { FieldHooks } from "./hooks.ts";

export interface PhotoRef {
  fileId: string;
  sha256?: string | null;
}

export interface FieldReport {
  id: string;
  project_id: string;
  sub_slug: string | null;
  kind: "progress" | "completion" | "snag" | "weekly_compiled";
  body: string;
  photos: PhotoRef[];
  author: string;
  source: string;
  visibility: "internal" | "client_ok";
  verification: "unverified" | "owner_confirmed";
  claimed_milestone_key: string | null;
  week_start: string;
  reported_at: string;
  created_at: string;
}

export const REPORT_COLS = `id, project_id, sub_slug, kind, body, photos, author, source, visibility, verification, claimed_milestone_key,
  to_char(week_start, 'YYYY-MM-DD') AS week_start, reported_at::text AS reported_at, created_at::text AS created_at`;

export class FieldAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "FieldAuthError";
  }
}

/** Resolve who may write for which sub on which project. A sub principal
 *  always writes as itself and only on its assigned projects (cross-job
 *  isolation). Owner / agent-for-owner may write for any assigned sub or as
 *  the owner (sub_slug null). */
export async function authorizeSubWrite(
  run: Run,
  principal: Principal,
  input: { projectId: string; subSlug?: string | null },
): Promise<{ subSlug: string | null; author: string; authorUserId: string | null; source: "portal" | "owner" | "agent" }> {
  const human = humanOf(principal);
  const [proj] = await run<{ id: string }>(`SELECT id FROM projects WHERE id = $1`, [input.projectId]);
  if (!proj) throw new FieldAuthError("Unknown project.");
  if (human?.role === "sub") {
    const slug = human.linkSlug ?? null;
    if (!slug) throw new FieldAuthError("This account has no subcontractor identity.");
    if (input.subSlug && input.subSlug !== slug) throw new FieldAuthError("A sub can only report as themselves.");
    const [asg] = await run(`SELECT 1 FROM project_subs WHERE project_id = $1 AND sub_slug = $2`, [input.projectId, slug]);
    if (!asg) throw new FieldAuthError("You are not assigned to this job.");
    return { subSlug: slug, author: human.name, authorUserId: human.userId, source: "portal" };
  }
  if (isOwner(principal) || (human?.role === "staff" && human.permissions.includes("projects"))) {
    if (input.subSlug) {
      const [asg] = await run(`SELECT 1 FROM project_subs WHERE project_id = $1 AND sub_slug = $2`, [input.projectId, input.subSlug]);
      if (!asg) throw new FieldAuthError(`${input.subSlug} is not assigned to this job.`);
    }
    return {
      subSlug: input.subSlug ?? null,
      author: human!.name,
      authorUserId: human!.userId,
      source: principal.kind === "agent" ? "agent" : "owner",
    };
  }
  throw new FieldAuthError("Not allowed to record field evidence.");
}

export interface RecordProgressInput {
  projectId: string;
  subSlug?: string | null;
  body: string;
  photos?: PhotoRef[];
  visibility?: "internal" | "client_ok";
  source?: "portal" | "sms" | "email" | "owner" | "agent";
  /** Optional: which milestone this progress evidence supports. */
  milestoneKey?: string | null;
  clientEventId?: string | null;
  reportedAt?: string | null;
  subLogId?: number | null;
}

/** Dedupe photo refs: same file id, or same sha256 under a different id. */
export function dedupePhotos(photos: PhotoRef[]): PhotoRef[] {
  const seenId = new Set<string>();
  const seenHash = new Set<string>();
  const out: PhotoRef[] = [];
  for (const p of photos) {
    if (!p?.fileId) continue;
    if (seenId.has(p.fileId)) continue;
    if (p.sha256 && seenHash.has(p.sha256)) continue;
    seenId.add(p.fileId);
    if (p.sha256) seenHash.add(p.sha256);
    out.push({ fileId: p.fileId, sha256: p.sha256 ?? null });
  }
  return out;
}

async function verifiedFileIds(run: Run, projectId: string, refs: PhotoRef[]): Promise<PhotoRef[]> {
  if (!refs.length) return [];
  const rows = await run<{ id: string }>(
    `SELECT f.id FROM files f WHERE f.id = ANY($1::text[])
        AND f.project_key = (SELECT slug FROM projects WHERE id = $2)`,
    [refs.map((r) => r.fileId), projectId],
  );
  const ok = new Set(rows.map((r) => r.id));
  return refs.filter((r) => ok.has(r.fileId));
}

/** Record a progress report. Replay-safe on (project, clientEventId). */
export async function recordSubProgress(
  run: Run,
  principal: Principal,
  input: RecordProgressInput,
): Promise<{ report: FieldReport; created: boolean }> {
  const who = await authorizeSubWrite(run, principal, input);
  const photos = await verifiedFileIds(run, input.projectId, dedupePhotos(input.photos ?? []));
  const body = (input.body ?? "").trim();
  if (!body && !photos.length) throw new Error("A report needs a note or a photo.");
  const weekStart = await centralWeekStart(run, input.reportedAt ?? new Date());
  const [inserted] = await run<FieldReport>(
    `INSERT INTO field_reports (project_id, sub_slug, kind, body, photos, author, author_user_id, source, visibility, claimed_milestone_key,
                                week_start, sub_log_id, client_event_id, reported_at)
     VALUES ($1, $2, 'progress', $3, $4::jsonb, $5, $6, $7, $8, $9, $10::date, $11, $12, COALESCE($13::timestamptz, now()))
     ON CONFLICT (project_id, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
     RETURNING ${REPORT_COLS}`,
    [
      input.projectId,
      who.subSlug,
      body,
      JSON.stringify(photos),
      who.author,
      who.authorUserId,
      input.source ?? who.source,
      input.visibility ?? "client_ok",
      input.milestoneKey ?? null,
      weekStart,
      input.subLogId ?? null,
      input.clientEventId ?? null,
      input.reportedAt ?? null,
    ],
  );
  if (inserted) return { report: inserted, created: true };
  const [existing] = await run<FieldReport>(`SELECT ${REPORT_COLS} FROM field_reports WHERE project_id = $1 AND client_event_id = $2`, [
    input.projectId,
    input.clientEventId,
  ]);
  return { report: existing, created: false };
}

// ── Completion reports → evidence check → decision ──────────────────────────

export interface CompletionInput {
  projectId: string;
  subSlug?: string | null;
  milestoneKey: string;
  milestoneLabel?: string;
  body: string;
  photos?: PhotoRef[];
  clientEventId?: string | null;
  /** How many photos count as adequate for this milestone (policy default 2). */
  minPhotos?: number;
  /** Named views that must be present, e.g. ["niche", "overall"]; matched
   *  against the report body / photo hashes supplied as `photoTags`. */
  requiredViews?: string[];
  /** Tags the sub attached to the photos of THIS report (view names). */
  photoTags?: string[];
}

export interface CompletionOutcome {
  report: FieldReport;
  created: boolean;
  evidence: { reportIds: string[]; photoIds: string[]; views: string[] };
  missing: string[];
  /** Whether a request for the missing evidence was filed by THIS call. */
  requested: boolean;
  requestWorkItemId: string | null;
  decision: Decision;
  decisionCreated: boolean;
}

/** Photos already on file for a milestone (any report claiming it, plus
 *  progress reports tagged with it), with views seen in their bodies. */
export async function milestoneEvidence(run: Run, projectId: string, milestoneKey: string): Promise<{ reportIds: string[]; photoIds: string[]; views: string[] }> {
  const rows = await run<{ id: string; photos: PhotoRef[]; body: string }>(
    `SELECT id, photos, body FROM field_reports
      WHERE project_id = $1 AND claimed_milestone_key = $2 AND kind IN ('progress','completion')
      ORDER BY reported_at`,
    [projectId, milestoneKey],
  );
  const seenHash = new Set<string>();
  const photoIds: string[] = [];
  const views = new Set<string>();
  for (const r of rows) {
    for (const p of r.photos ?? []) {
      if (p.sha256 && seenHash.has(p.sha256)) continue;
      if (photoIds.includes(p.fileId)) continue;
      if (p.sha256) seenHash.add(p.sha256);
      photoIds.push(p.fileId);
    }
    for (const m of r.body.matchAll(/#([a-z0-9_-]+)/gi)) views.add(m[1].toLowerCase());
  }
  return { reportIds: rows.map((r) => r.id), photoIds, views: [...views] };
}

export async function completionReportReceived(
  run: Run,
  principal: Principal,
  input: CompletionInput,
  hooks: FieldHooks,
): Promise<CompletionOutcome> {
  const who = await authorizeSubWrite(run, principal, input);
  const photos = await verifiedFileIds(run, input.projectId, dedupePhotos(input.photos ?? []));
  const weekStart = await centralWeekStart(run);
  const tagLine = (input.photoTags ?? []).map((t) => `#${t.toLowerCase()}`).join(" ");
  const body = [input.body?.trim() ?? "", tagLine].filter(Boolean).join("\n");
  const [inserted] = await run<FieldReport>(
    `INSERT INTO field_reports (project_id, sub_slug, kind, body, photos, author, author_user_id, source, visibility, claimed_milestone_key, week_start, client_event_id)
     VALUES ($1, $2, 'completion', $3, $4::jsonb, $5, $6, $7, 'client_ok', $8, $9::date, $10)
     ON CONFLICT (project_id, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
     RETURNING ${REPORT_COLS}`,
    [input.projectId, who.subSlug, body, JSON.stringify(photos), who.author, who.authorUserId, who.source, input.milestoneKey, weekStart, input.clientEventId ?? null],
  );
  let report = inserted;
  let created = true;
  if (!report) {
    [report] = await run<FieldReport>(`SELECT ${REPORT_COLS} FROM field_reports WHERE project_id = $1 AND client_event_id = $2`, [input.projectId, input.clientEventId]);
    created = false;
  }

  // What do we already have for this milestone (this report included)?
  const evidence = await milestoneEvidence(run, input.projectId, input.milestoneKey);
  const minPhotos = Math.max(0, input.minPhotos ?? 2);
  const missing: string[] = [];
  if (evidence.photoIds.length < minPhotos) missing.push(`${minPhotos - evidence.photoIds.length} more photo${minPhotos - evidence.photoIds.length === 1 ? "" : "s"}`);
  for (const v of input.requiredViews ?? []) if (!evidence.views.includes(v.toLowerCase())) missing.push(`photo of the ${v}`);

  // Ask ONLY for what is missing, and only once per (project, sub, milestone).
  let requested = false;
  let requestWorkItemId: string | null = null;
  if (missing.length) {
    const [req] = await run<{ id: string }>(
      `INSERT INTO field_evidence_requests (project_id, sub_slug, request_kind, request_ref, missing)
       VALUES ($1, $2, 'completion_photos', $3, $4::jsonb)
       ON CONFLICT (project_id, sub_slug, request_kind, request_ref) DO NOTHING RETURNING id`,
      [input.projectId, who.subSlug, input.milestoneKey, JSON.stringify(missing)],
    );
    if (req) {
      requested = true;
      requestWorkItemId = await hooks.createFollowUp(run, {
        projectId: input.projectId,
        subSlug: who.subSlug,
        title: `Completion photos needed · ${input.milestoneLabel ?? input.milestoneKey}`,
        body: `Still needed: ${missing.join(", ")}. Already on file: ${evidence.photoIds.length} photo(s).`,
        dedupeKey: `field:completion_photos:${input.projectId}:${who.subSlug ?? "owner"}:${input.milestoneKey}`,
        audience: "sub",
      });
      if (requestWorkItemId) await run(`UPDATE field_evidence_requests SET work_item_id = $2 WHERE id = $1`, [req.id, requestWorkItemId]);
    }
  } else {
    await run(
      `UPDATE field_evidence_requests SET fulfilled_at = now()
        WHERE project_id = $1 AND request_kind = 'completion_photos' AND request_ref = $2 AND fulfilled_at IS NULL`,
      [input.projectId, input.milestoneKey],
    );
  }

  // Stage Joe's confirmation with the evidence. Same evidence → same pending
  // decision; more evidence → supersedes (fresh card, no duplicate alert).
  const content = { projectId: input.projectId, milestoneKey: input.milestoneKey, reportIds: evidence.reportIds, photoIds: evidence.photoIds };
  const [proj] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [input.projectId]);
  const staged = await stageDecision(run, {
    kind: "milestone_confirmation",
    action: "confirm_milestone",
    title: `Confirm ${input.milestoneLabel ?? input.milestoneKey} complete · ${proj?.name ?? "project"}`,
    summary: {
      inclusions: [`${evidence.photoIds.length} photo(s) on file`, `${evidence.reportIds.length} report(s)`],
      gaps: missing,
      attachments: evidence.photoIds.map((id) => ({ label: id, fileId: id })),
      effect: "Confirms physical completion; WS-money issues the corresponding progress invoice under the predetermined structure.",
      recommendation: missing.length ? "Wait for the missing evidence or inspect on site before confirming." : "Evidence adequate; confirm if the site matches.",
      claimedBy: report.author,
    },
    targetKind: "milestone",
    targetId: `${input.projectId}:${input.milestoneKey}`,
    content,
    projectId: input.projectId,
    href: proj ? `/projects/${proj.slug}` : null,
    dedupeKey: `milestone:${input.projectId}:${input.milestoneKey}`,
    requestedBy: principal,
  });
  return {
    report,
    created,
    evidence,
    missing,
    requested,
    requestWorkItemId,
    decision: staged.decision,
    decisionCreated: staged.created,
  };
}

/** After Joe approves the milestone_confirmation decision: consume it, record
 *  the confirmation (UNIQUE per project+milestone) and fire the money hook
 *  exactly once. Safe to call repeatedly. */
export async function confirmMilestone(
  run: Run,
  decisionId: string,
  hooks: FieldHooks,
): Promise<{ ok: true; confirmed: boolean; hookFired: boolean; milestoneKey: string } | { ok: false; reason: string }> {
  const d = await getDecision(run, decisionId);
  if (!d) return { ok: false, reason: "No such decision." };
  if (d.kind !== "milestone_confirmation") return { ok: false, reason: "Not a milestone confirmation." };
  const idx = (d.target_id ?? "").indexOf(":");
  const milestoneKey = idx >= 0 ? (d.target_id ?? "").slice(idx + 1) : "";
  if (!d.project_id || !milestoneKey) return { ok: false, reason: "Decision is missing its project/milestone binding." };
  if (d.status === "pending") return { ok: false, reason: "Joe has not confirmed this milestone yet." };
  if (d.status === "rejected") return { ok: false, reason: "Joe rejected this completion claim." };
  if (d.status === "approved") {
    const c = await consumeDecision(run, { id: d.id, action: "confirm_milestone", contentHash: d.content_hash, targetKind: "milestone", targetId: d.target_id, consumer: "field.confirmMilestone" });
    if (!c.ok) return { ok: false, reason: c.reason };
  }
  // 'consumed' (already spent) falls through: the row below decides once-ness.
  const evidence = await milestoneEvidence(run, d.project_id, milestoneKey);
  const [ins] = await run<{ id: string }>(
    `INSERT INTO milestone_confirmations (project_id, milestone_key, evidence, decision_id, confirmed_by)
     VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (project_id, milestone_key) DO NOTHING RETURNING id`,
    [d.project_id, milestoneKey, JSON.stringify({ report_ids: evidence.reportIds, photo_ids: evidence.photoIds }), d.id, d.decided_by_user_id],
  );
  let hookFired = false;
  if (ins) {
    await run(
      `UPDATE field_reports SET verification = 'owner_confirmed', verified_by = $3, verified_at = now()
        WHERE project_id = $1 AND claimed_milestone_key = $2 AND kind IN ('progress','completion')`,
      [d.project_id, milestoneKey, d.decided_by_user_id],
    );
  }
  const [fire] = await run<{ id: string }>(
    `UPDATE milestone_confirmations SET hook_fired_at = now() WHERE project_id = $1 AND milestone_key = $2 AND hook_fired_at IS NULL RETURNING id`,
    [d.project_id, milestoneKey],
  );
  if (fire) {
    await hooks.onMilestoneConfirmed(run, d.project_id, milestoneKey, d.id);
    hookFired = true;
  }
  return { ok: true, confirmed: !!ins, hookFired, milestoneKey };
}

// ── Weekly sub report ───────────────────────────────────────────────────────

export interface WeeklySubReport {
  report: FieldReport;
  weekStart: string;
  parts: { progress: boolean; photos: number; snags: number };
  missing: string[];
  requested: boolean;
}

/** Compile the week's sub report from what was ALREADY supplied. Proactive
 *  updates count. Missing parts are requested precisely and once. */
export async function compileWeeklySubReport(
  run: Run,
  input: { projectId: string; subSlug: string; weekStart?: string; principal: Principal },
  hooks: FieldHooks,
): Promise<WeeklySubReport> {
  const weekStart = input.weekStart ?? (await centralWeekStart(run));
  const rows = await run<FieldReport>(
    `SELECT ${REPORT_COLS} FROM field_reports
      WHERE project_id = $1 AND sub_slug = $2 AND week_start = $3::date AND kind IN ('progress','completion','snag')
      ORDER BY reported_at`,
    [input.projectId, input.subSlug, weekStart],
  );
  const progress = rows.filter((r) => r.kind !== "snag" && r.body.trim().length > 0);
  const photos = dedupePhotos(rows.flatMap((r) => r.photos ?? []));
  const snags = rows.filter((r) => r.kind === "snag");
  const missing: string[] = [];
  if (!progress.length) missing.push("a short note on what was done this week");
  if (!photos.length) missing.push("at least one progress photo");

  const body = [
    `Week of ${weekStart}`,
    progress.length ? `Work done:\n${progress.map((r) => `• ${r.body.split("\n")[0]}`).join("\n")}` : "Work done: (no note received)",
    `Photos: ${photos.length}`,
    snags.length ? `Snags reported:\n${snags.map((r) => `• ${r.body.split("\n")[0]}`).join("\n")}` : "Snags: none reported",
  ].join("\n\n");
  const [report] = await run<FieldReport>(
    `INSERT INTO field_reports (project_id, sub_slug, kind, body, photos, author, source, visibility, week_start)
     VALUES ($1, $2, 'weekly_compiled', $3, $4::jsonb, 'system', 'agent', 'internal', $5::date)
     ON CONFLICT (project_id, sub_slug, week_start) WHERE kind = 'weekly_compiled'
     DO UPDATE SET body = EXCLUDED.body, photos = EXCLUDED.photos
     RETURNING ${REPORT_COLS}`,
    [input.projectId, input.subSlug, body, JSON.stringify(photos), weekStart],
  );

  let requested = false;
  if (missing.length) {
    const [req] = await run<{ id: string }>(
      `INSERT INTO field_evidence_requests (project_id, sub_slug, request_kind, request_ref, missing)
       VALUES ($1, $2, 'weekly_part', $3, $4::jsonb)
       ON CONFLICT (project_id, sub_slug, request_kind, request_ref) DO NOTHING RETURNING id`,
      [input.projectId, input.subSlug, weekStart, JSON.stringify(missing)],
    );
    if (req) {
      requested = true;
      const wi = await hooks.createFollowUp(run, {
        projectId: input.projectId,
        subSlug: input.subSlug,
        title: `Weekly report · still need ${missing.join(" and ")}`,
        body: `Everything else for the week of ${weekStart} is already on file (${photos.length} photo(s), ${progress.length} note(s)).`,
        dedupeKey: `field:weekly_part:${input.projectId}:${input.subSlug}:${weekStart}`,
        audience: "sub",
      });
      if (wi) await run(`UPDATE field_evidence_requests SET work_item_id = $2 WHERE id = $1`, [req.id, wi]);
    }
  } else {
    await run(`UPDATE field_evidence_requests SET fulfilled_at = now() WHERE project_id = $1 AND sub_slug = $2 AND request_kind = 'weekly_part' AND request_ref = $3 AND fulfilled_at IS NULL`, [
      input.projectId,
      input.subSlug,
      weekStart,
    ]);
  }
  return { report, weekStart, parts: { progress: progress.length > 0, photos: photos.length, snags: snags.length }, missing, requested };
}

export async function listFieldReports(run: Run, projectId: string, opts: { weekStart?: string; subSlug?: string; limit?: number } = {}): Promise<FieldReport[]> {
  return run<FieldReport>(
    `SELECT ${REPORT_COLS} FROM field_reports
      WHERE project_id = $1 AND ($2::date IS NULL OR week_start = $2::date) AND ($3::text IS NULL OR sub_slug = $3)
      ORDER BY reported_at DESC LIMIT $4`,
    [projectId, opts.weekStart ?? null, opts.subSlug ?? null, opts.limit ?? 100],
  );
}
