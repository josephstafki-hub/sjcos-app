// Approved marketing (A17): drafts are built from AUTHORIZED photos only
// (publication_rights present and not withdrawn — portal visibility is not a
// right), released by a one-tap 'publication' decision bound to the content +
// audience hash, and a withdrawal of rights cancels anything queued.
// Newsletter drip arming stays owner-only: no code path here touches it.

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { consumeDecision, getDecision, revokeDecision, type Decision } from "../commands/decisions.ts";
import { stageDecision } from "../commands/decisions.ts";
import { cancelIntent, enqueueIntent } from "../commands/intents.ts";
import { isOwner, type Principal } from "../commands/principal.ts";
import { pinRevision, revisionRef } from "./revisions.ts";

export async function grantPublicationRights(run: Run, input: { fileIds: string[]; projectId: string | null; grantedBy: string; grantedByUserId?: string | null; scope?: string[]; note?: string }): Promise<number> {
  let n = 0;
  for (const fileId of input.fileIds) {
    const [live] = await run(`SELECT 1 FROM publication_rights WHERE file_id = $1 AND withdrawn_at IS NULL`, [fileId]);
    if (live) continue;
    await run(`INSERT INTO publication_rights (file_id, project_id, granted_by, granted_by_user_id, scope, note) VALUES ($1, $2, $3, $4, $5::text[], $6)`, [
      fileId,
      input.projectId,
      input.grantedBy,
      input.grantedByUserId ?? null,
      input.scope ?? ["social", "website"],
      input.note ?? "",
    ]);
    n++;
  }
  return n;
}

/** Files on a project the company may publish right now. */
export async function authorizedPhotos(run: Run, projectId: string, scope = "social"): Promise<string[]> {
  const rows = await run<{ file_id: string }>(
    `SELECT DISTINCT r.file_id FROM publication_rights r JOIN files f ON f.id = r.file_id
      WHERE r.project_id = $1 AND r.withdrawn_at IS NULL AND $2 = ANY(r.scope) AND f.type = 'img'`,
    [projectId, scope],
  );
  return rows.map((r) => r.file_id);
}

export interface MarketingDraftRow {
  id: number;
  project_id: string | null;
  kind: string;
  title: string;
  body: string;
  status: string;
  audience: string;
  publication_decision_id: string | null;
  publication_intent_id: string | null;
  media: string[];
}

const DRAFT_COLS = `d.id, d.project_id, d.kind, d.title, d.body, d.status, d.audience, d.publication_decision_id, d.publication_intent_id,
  COALESCE((SELECT array_agg(m.file_id ORDER BY m.sort) FROM marketing_draft_media m WHERE m.draft_id = d.id), '{}'::text[]) AS media`;

export async function getDraft(run: Run, id: number): Promise<MarketingDraftRow | null> {
  const [row] = await run<MarketingDraftRow>(`SELECT ${DRAFT_COLS} FROM marketing_drafts d WHERE d.id = $1`, [id]);
  return row ? { ...row, id: Number(row.id) } : null;
}

/** Create a draft using only authorized photos. Unauthorized ids are dropped
 *  and reported; a draft with no authorized media is still a draft (text only). */
export async function draftFromAuthorizedPhotos(
  run: Run,
  input: { projectId: string; kind: "social" | "blog"; title: string; body: string; audience: string; requestedPhotoIds?: string[] },
): Promise<{ draft: MarketingDraftRow; rejectedPhotoIds: string[] }> {
  const allowed = await authorizedPhotos(run, input.projectId, input.kind === "blog" ? "website" : "social");
  const wanted = input.requestedPhotoIds ?? allowed;
  const media = wanted.filter((id) => allowed.includes(id));
  const rejected = wanted.filter((id) => !allowed.includes(id));
  const [row] = await run<{ id: string }>(`INSERT INTO marketing_drafts (project_id, kind, title, body, status, audience) VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING id`, [
    input.projectId,
    input.kind,
    input.title,
    input.body,
    input.audience,
  ]);
  for (const [i, f] of media.entries()) await run(`INSERT INTO marketing_draft_media (draft_id, file_id, sort) VALUES ($1, $2, $3)`, [row.id, f, i]);
  return { draft: (await getDraft(run, Number(row.id)))!, rejectedPhotoIds: rejected };
}

function publicationContent(d: MarketingDraftRow) {
  return { title: d.title, body: d.body, media: d.media, audience: d.audience, kind: d.kind };
}

/** Stage the one-tap release. Content + audience hashed; a change supersedes. */
export async function stagePublication(run: Run, principal: Principal, draftId: number): Promise<{ decision: Decision; created: boolean; draft: MarketingDraftRow }> {
  const d = await getDraft(run, draftId);
  if (!d) throw new Error("No such draft.");
  if (d.status === "posted") throw new Error("Already posted.");
  if (!d.audience) throw new Error("Pick an audience/platform before staging the release.");
  // Every photo must still be authorized at staging time.
  const allowed = d.project_id ? await authorizedPhotos(run, d.project_id, d.kind === "blog" ? "website" : "social") : [];
  const bad = d.media.filter((m) => !allowed.includes(m));
  if (bad.length) throw new Error(`Photo(s) without publication rights: ${bad.join(", ")}`);
  const { revision } = await pinRevision(run, "marketing_draft", d.id, publicationContent(d), "release");
  const staged = await stageDecision(run, {
    kind: "publication",
    action: "publish_marketing",
    title: `Publish ${d.kind} post → ${d.audience}: ${d.title}`,
    summary: { recipients: [{ name: d.audience, role: "audience" }], inclusions: [d.body.slice(0, 300)], attachments: d.media.map((m) => ({ label: m, fileId: m })), effect: `Publishes to ${d.audience}.` },
    targetKind: "marketing_draft",
    targetId: d.id,
    recipient: d.audience,
    content: publicationContent(d),
    artifactRevision: revisionRef(revision),
    projectId: d.project_id,
    href: "/marketing",
    dedupeKey: `publication:${d.id}`,
    requestedBy: principal,
  });
  await run(`UPDATE marketing_drafts SET status = 'pending_decision', publication_decision_id = $2 WHERE id = $1`, [d.id, staged.decision.id]);
  return { decision: staged.decision, created: staged.created, draft: (await getDraft(run, d.id))! };
}

/** After approval: consume for exactly this content/audience and queue the
 *  publication intent (dispatcher owns the platform call). */
export async function queueApprovedPublication(run: Run, principal: Principal, draftId: number): Promise<{ ok: true; intentId: string } | { ok: false; reason: string }> {
  const d = await getDraft(run, draftId);
  if (!d?.publication_decision_id) return { ok: false, reason: "No release decision on this draft." };
  if (d.publication_intent_id) return { ok: true, intentId: d.publication_intent_id };
  const dec = await getDecision(run, d.publication_decision_id);
  if (!dec) return { ok: false, reason: "Decision vanished." };
  const content = publicationContent(d);
  const hash = hashInput(content);
  if (dec.content_hash !== hash) return { ok: false, reason: "The post or its audience changed after approval; stage a fresh release." };
  const allowed = d.project_id ? await authorizedPhotos(run, d.project_id, d.kind === "blog" ? "website" : "social") : [];
  if (d.media.some((m) => !allowed.includes(m))) return { ok: false, reason: "A photo's publication rights were withdrawn; the release is void." };
  const c = await consumeDecision(run, { id: dec.id, action: "publish_marketing", contentHash: hash, recipient: d.audience, targetKind: "marketing_draft", targetId: d.id, consumer: "closeout.queueApprovedPublication" });
  if (!c.ok) return { ok: false, reason: c.reason };
  const { intent } = await enqueueIntent(run, {
    operationKey: `publication:${d.id}:${dec.artifact_revision ?? hash.slice(0, 12)}`,
    kind: "publication",
    targetKind: "marketing_draft",
    targetId: d.id,
    recipient: d.audience,
    projectId: d.project_id,
    payload: content,
    artifactRevision: dec.artifact_revision,
    decisionId: dec.id,
    principal,
  });
  await run(`UPDATE marketing_drafts SET status = 'queued', publication_intent_id = $2 WHERE id = $1`, [d.id, intent.id]);
  return { ok: true, intentId: intent.id };
}

/** Withdraw rights on a file: pending release decisions are revoked and
 *  queued publications that include it are cancelled. Owner only. */
export async function withdrawPublicationRights(run: Run, principal: Principal, fileId: string, reason: string): Promise<{ withdrawn: number; cancelledIntents: number; revokedDecisions: number }> {
  if (!isOwner(principal)) throw new Error("Only the owner withdraws publication rights.");
  const rows = await run(`UPDATE publication_rights SET withdrawn_at = now(), withdrawn_reason = $2 WHERE file_id = $1 AND withdrawn_at IS NULL RETURNING id`, [fileId, reason]);
  const drafts = await run<{ id: string; publication_decision_id: string | null; publication_intent_id: string | null; status: string }>(
    `SELECT d.id, d.publication_decision_id, d.publication_intent_id, d.status FROM marketing_drafts d JOIN marketing_draft_media m ON m.draft_id = d.id WHERE m.file_id = $1 AND d.status IN ('pending_decision','queued')`,
    [fileId],
  );
  let cancelledIntents = 0;
  let revokedDecisions = 0;
  for (const d of drafts) {
    if (d.publication_intent_id && (await cancelIntent(run, d.publication_intent_id, `publication rights withdrawn for ${fileId}: ${reason}`))) cancelledIntents++;
    if (d.publication_decision_id && (await revokeDecision(run, d.publication_decision_id, principal, `publication rights withdrawn for ${fileId}`))) revokedDecisions++;
    await run(`UPDATE marketing_drafts SET status = 'draft', publication_intent_id = NULL WHERE id = $1`, [d.id]);
  }
  return { withdrawn: rows.length, cancelledIntents, revokedDecisions };
}
