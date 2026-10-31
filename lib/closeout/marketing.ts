// Approved marketing (A17): drafts are built from AUTHORIZED photos only
// (publication_rights present and not withdrawn — portal visibility is not a
// right), released by a one-tap 'publication' decision bound to the content +
// audience hash, and a withdrawal of rights cancels anything queued.
// Newsletter drip arming stays owner-only: no code path here touches it.
//
// Posting (Joe, 2026-10-30: no paid APIs): a social draft goes to ONE platform
// (audience = facebook / instagram / google_business). Approving its card
// queues a `publication` intent carrying the decision; the dispatcher spends
// the approval at dispatch and hands the post to the posting agent
// (lib/providers/publisher.ts). The outcome comes back through the dispatch
// effect (lib/dispatch/effects.ts).

import type { Run } from "../commands/core.ts";
import { hashInput } from "../commands/core.ts";
import { getDecision, revokeDecision, type Decision } from "../commands/decisions.ts";
import { stageDecision } from "../commands/decisions.ts";
import { cancelIntent, enqueueIntent, getIntent, hashPayload, reconcileIntent, type ActionIntent } from "../commands/intents.ts";
import { isOwner, type Principal } from "../commands/principal.ts";
import { isPostPlatform, POST_LIMITS, postProblem, POST_PLATFORM_LABEL } from "../marketing-types.ts";
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

/** A pending card no longer matches an edited draft: retire it (the draft
 *  goes back to 'draft' and Joe asks again). Refuses while it's on its way. */
async function retirePendingCard(run: Run, d: MarketingDraftRow, actor: string): Promise<void> {
  if (d.status === "queued" || d.status === "posting") throw new Error("This post is on its way; wait for it to finish.");
  if (d.status !== "pending_decision" || !d.publication_decision_id) return;
  const rows = await run(`UPDATE decisions SET status = 'superseded', dedupe_key = NULL WHERE id = $1 AND status = 'pending' RETURNING id`, [d.publication_decision_id]);
  if (rows.length) await run(`INSERT INTO decision_events (decision_id, kind, actor, detail) VALUES ($1, 'superseded', $2, $3::jsonb)`, [d.publication_decision_id, actor, JSON.stringify({ reason: "the post was edited" })]);
  await run(`UPDATE marketing_drafts SET status = 'draft' WHERE id = $1 AND status = 'pending_decision'`, [d.id]);
}

/** The job's shareable photos, newest first: what an automatic pick draws from. */
async function shareablePhotosNewestFirst(run: Run, projectId: string, scope: string): Promise<string[]> {
  const rows = await run<{ file_id: string }>(
    `SELECT r.file_id FROM publication_rights r JOIN files f ON f.id = r.file_id
      WHERE r.project_id = $1 AND r.withdrawn_at IS NULL AND $2 = ANY(r.scope) AND f.type = 'img'
      GROUP BY r.file_id, f.created_at ORDER BY f.created_at DESC`,
    [projectId, scope],
  );
  return rows.map((r) => r.file_id);
}

/** Where a social post goes and which shareable photos go with it, in order.
 *  Only photos with a live publication right on the post's job are accepted.
 *  `autoPick`: with no photos asked for and a site picked, take the newest
 *  shareable photos the site takes (Joe changes them after). More photos than
 *  the site takes are cut to its limit, first ones kept. */
export async function setDraftPost(
  run: Run,
  draftId: number,
  input: { platform: string; photoIds: string[]; actor: string; autoPick?: boolean },
): Promise<{ draft: MarketingDraftRow; rejectedPhotoIds: string[]; autoPicked: number; trimmed: number }> {
  const d = await getDraft(run, draftId);
  if (!d) throw new Error("No such draft.");
  if (input.platform && !isPostPlatform(input.platform)) throw new Error(`"${input.platform}" isn't a place a post can go.`);
  if (d.status === "posted") throw new Error("Already posted.");
  await retirePendingCard(run, d, input.actor);
  const scope = d.kind === "blog" ? "website" : "social";
  const allowed = d.project_id ? await authorizedPhotos(run, d.project_id, scope) : [];
  const wanted = [...new Set(input.photoIds)];
  let media = wanted.filter((id) => allowed.includes(id));
  const max = isPostPlatform(input.platform) ? POST_LIMITS[input.platform].maxPhotos : null;
  let autoPicked = 0;
  if (input.autoPick && !wanted.length && max && d.project_id) {
    media = (await shareablePhotosNewestFirst(run, d.project_id, scope)).slice(0, max);
    autoPicked = media.length;
  }
  const trimmed = max && media.length > max ? media.length - max : 0;
  if (trimmed) media = media.slice(0, max!);
  await run(`UPDATE marketing_drafts SET audience = $2 WHERE id = $1`, [d.id, input.platform]);
  await run(`DELETE FROM marketing_draft_media WHERE draft_id = $1`, [d.id]);
  for (const [i, f] of media.entries()) await run(`INSERT INTO marketing_draft_media (draft_id, file_id, sort) VALUES ($1, $2, $3)`, [d.id, f, i]);
  return { draft: (await getDraft(run, d.id))!, rejectedPhotoIds: wanted.filter((id) => !allowed.includes(id)), autoPicked, trimmed };
}

/** The text changed: a pending card for the old text is retired. */
export async function noteDraftEdited(run: Run, draftId: number, actor: string): Promise<void> {
  const d = await getDraft(run, draftId);
  if (d) await retirePendingCard(run, d, actor);
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
  if (d.kind === "social") {
    if (!isPostPlatform(d.audience)) throw new Error(`"${d.audience}" isn't a place a post can go (Facebook page, Instagram or Google Business Profile).`);
    const problem = postProblem(d.audience, d.body, d.media.length);
    if (problem) throw new Error(problem);
  }
  if (d.status === "queued" || d.status === "posting") throw new Error("This post is already on its way.");
  // Every photo must still be authorized at staging time.
  const allowed = d.project_id ? await authorizedPhotos(run, d.project_id, d.kind === "blog" ? "website" : "social") : [];
  const bad = d.media.filter((m) => !allowed.includes(m));
  if (bad.length) throw new Error(`Photo(s) without publication rights: ${bad.join(", ")}`);
  const { revision } = await pinRevision(run, "marketing_draft", d.id, publicationContent(d), "release");
  const staged = await stageDecision(run, {
    kind: "publication",
    action: "publish_marketing",
    title: `Post to ${platformWords(d.audience)}: ${d.title}`,
    summary: {
      recipients: [{ name: platformWords(d.audience), role: "audience" }],
      inclusions: [d.body.slice(0, 600)],
      attachments: d.media.map((m, i) => ({ label: `Photo ${i + 1}`, fileId: m })),
      effect: isPostPlatform(d.audience) ? `The posting agent puts this up on ${platformWords(d.audience)} with ${d.media.length ? `${d.media.length} photo${d.media.length === 1 ? "" : "s"}` : "no photos"}, exactly as written.` : `Publishes to ${d.audience}.`,
    },
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
  // A fresh card starts a fresh send: the earlier (failed) one stays in the log.
  await run(`UPDATE marketing_drafts SET status = 'pending_decision', publication_decision_id = $2, publication_intent_id = NULL, post_error = NULL WHERE id = $1`, [d.id, staged.decision.id]);
  return { decision: staged.decision, created: staged.created, draft: (await getDraft(run, d.id))! };
}

const platformWords = (a: string) => (isPostPlatform(a) ? POST_PLATFORM_LABEL[a] : a);

async function draftProjectName(run: Run, projectId: string | null): Promise<string> {
  if (!projectId) return "";
  const [p] = await run<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [projectId]);
  return p?.name ?? "";
}

/** The intent payload for a post: what the posting agent puts up, plus the
 *  `_auth` block naming the approved content (the dispatcher spends the
 *  decision against it). */
function publicationPayload(d: MarketingDraftRow, contentHash: string, projectName: string) {
  return {
    draft_id: d.id,
    platform: d.audience,
    kind: d.kind,
    title: d.title,
    body: d.body,
    media: d.media,
    project_name: projectName,
    _auth: { action: "publish_marketing", target_kind: "marketing_draft", target_id: String(d.id), content_hash: contentHash },
  };
}

/** Is this draft still exactly what the decision approved, with every photo
 *  still shareable? Returns the reason it isn't, or null. */
async function stillApproved(run: Run, d: MarketingDraftRow, dec: Decision): Promise<string | null> {
  if (dec.content_hash !== hashInput(publicationContent(d))) return "The post or where it goes changed after approval; ask for a fresh approval.";
  const allowed = d.project_id ? await authorizedPhotos(run, d.project_id, d.kind === "blog" ? "website" : "social") : [];
  if (d.media.some((m) => !allowed.includes(m))) return "A photo's publication rights were withdrawn; the release is void.";
  return null;
}

/** After approval: queue the publication intent for exactly this content and
 *  platform. The intent carries the decision; the dispatcher spends it at
 *  dispatch (lib/dispatch/authority.ts), so nothing here consumes it. */
export async function queueApprovedPublication(run: Run, principal: Principal, draftId: number): Promise<{ ok: true; intentId: string } | { ok: false; reason: string }> {
  const d = await getDraft(run, draftId);
  if (!d?.publication_decision_id) return { ok: false, reason: "No release decision on this draft." };
  if (d.publication_intent_id) return { ok: true, intentId: d.publication_intent_id };
  if (d.status === "posted") return { ok: false, reason: "Already posted." };
  const dec = await getDecision(run, d.publication_decision_id);
  if (!dec) return { ok: false, reason: "Decision vanished." };
  if (dec.status !== "approved") return { ok: false, reason: dec.status === "pending" ? "The post isn't approved yet." : `The approval was ${dec.status}.` };
  const why = await stillApproved(run, d, dec);
  if (why) return { ok: false, reason: why };
  const { intent } = await enqueueIntent(run, {
    operationKey: `publication:${d.id}:${dec.id}`,
    kind: "publication",
    targetKind: "marketing_draft",
    targetId: d.id,
    recipient: d.audience,
    projectId: d.project_id,
    payload: publicationPayload(d, dec.content_hash!, await draftProjectName(run, d.project_id)),
    artifactRevision: dec.artifact_revision,
    decisionId: dec.id,
    principal,
  });
  await run(`UPDATE marketing_drafts SET status = 'queued', publication_intent_id = $2, post_error = NULL WHERE id = $1`, [d.id, intent.id]);
  return { ok: true, intentId: intent.id };
}

/** What a posting run may put up, checked again by the run itself right
 *  before it opens the browser (scripts/run-publication.mjs): the send is a
 *  publication whose authority the dispatcher bound and never gave back, the
 *  draft still reads exactly as the approved card, and every photo still has
 *  a live publication right on the job. Returns the photos' stored files. */
export async function checkPublicationRun(
  run: Run,
  intentId: string,
): Promise<{ ok: true; intent: ActionIntent; draft: MarketingDraftRow; photos: { fileId: string; name: string; storagePath: string }[] } | { ok: false; reason: string }> {
  const intent = await getIntent(run, intentId);
  if (!intent || intent.kind !== "publication") return { ok: false, reason: "No such post send." };
  if (!["leased", "accepted"].includes(intent.state)) return { ok: false, reason: `The send is ${intent.state}, not one being posted now.` };
  if (hashPayload(intent.payload) !== intent.payload_hash) return { ok: false, reason: "The send changed after it was queued." };
  const [auth] = await run<{ kind: string; refunded_at: string | null }>(`SELECT kind, refunded_at::text AS refunded_at FROM intent_authority WHERE intent_id = $1`, [intent.id]);
  if (!auth || auth.refunded_at) return { ok: false, reason: "Nothing authorises this send (no approval was spent on it)." };
  const pl = intent.payload as { draft_id?: number; platform?: string; body?: string; media?: string[]; _auth?: { content_hash?: string } };
  const d = await getDraft(run, Number(intent.target_id));
  if (!d || Number(pl.draft_id) !== d.id) return { ok: false, reason: "The draft is gone." };
  if (d.status === "posted") return { ok: false, reason: "It's already marked posted." };
  if (d.publication_intent_id !== intent.id) return { ok: false, reason: "A newer send replaced this one." };
  if (!isPostPlatform(d.audience) || pl.platform !== d.audience) return { ok: false, reason: "Where the post goes changed after approval." };
  const dec = d.publication_decision_id ? await getDecision(run, d.publication_decision_id) : null;
  if (!dec || !["approved", "consumed"].includes(dec.status)) return { ok: false, reason: `The approval is ${dec?.status ?? "missing"}.` };
  if (!pl._auth?.content_hash || pl._auth.content_hash !== dec.content_hash) return { ok: false, reason: "The send doesn't match the approved card." };
  const why = await stillApproved(run, d, dec);
  if (why) return { ok: false, reason: why };
  if (pl.body !== d.body || JSON.stringify(pl.media ?? []) !== JSON.stringify(d.media)) return { ok: false, reason: "The send doesn't match the draft." };
  const files = d.media.length
    ? await run<{ id: string; name: string; storage_path: string | null }>(`SELECT id, name, storage_path FROM files WHERE id = ANY($1::text[]) AND type = 'img'`, [d.media])
    : [];
  const photos: { fileId: string; name: string; storagePath: string }[] = [];
  for (const id of d.media) {
    const f = files.find((x) => x.id === id);
    if (!f?.storage_path) return { ok: false, reason: `Photo ${id} has no stored file.` };
    photos.push({ fileId: f.id, name: f.name, storagePath: f.storage_path });
  }
  return { ok: true, intent, draft: d, photos };
}

/** The post's latest send, if any. */
export async function publicationIntent(run: Run, draftId: number): Promise<ActionIntent | null> {
  const d = await getDraft(run, draftId);
  return d?.publication_intent_id ? getIntent(run, d.publication_intent_id) : null;
}

/** Joe's "Try again" on a post that never went up (the agent stopped before
 *  pressing Post, the browser was signed out, or Joe said it isn't there).
 *  Same approved content only; Joe's own click is the authority for the
 *  retry. Owner only. */
export async function retryPublication(run: Run, principal: Principal, draftId: number): Promise<{ ok: true; intentId: string } | { ok: false; reason: string }> {
  if (!isOwner(principal)) return { ok: false, reason: "Only Joe can send a post again." };
  const d = await getDraft(run, draftId);
  if (!d?.publication_decision_id || !d.publication_intent_id) return { ok: false, reason: "This post hasn't been approved and sent yet." };
  const last = await getIntent(run, d.publication_intent_id);
  if (!last) return { ok: false, reason: "The earlier send is gone; ask for a fresh approval." };
  if (last.state !== "permanent_failure" && last.state !== "cancelled") {
    return { ok: false, reason: last.state === "confirmed" ? "It already went up." : "The earlier try hasn't finished yet; wait for its answer." };
  }
  const dec = await getDecision(run, d.publication_decision_id);
  if (!dec || (dec.status !== "approved" && dec.status !== "consumed")) return { ok: false, reason: `The approval was ${dec?.status ?? "removed"}; ask for a fresh one.` };
  const why = await stillApproved(run, d, dec);
  if (why) return { ok: false, reason: why };
  const [n] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM action_intents WHERE kind = 'publication' AND target_id = $1`, [String(d.id)]);
  const who = principal.kind === "user" ? principal.userId : "owner";
  const { intent } = await enqueueIntent(run, {
    operationKey: `publication:${d.id}:${dec.id}:retry:${n?.n ?? 1}`,
    kind: "publication",
    targetKind: "marketing_draft",
    targetId: d.id,
    recipient: d.audience,
    projectId: d.project_id,
    payload: publicationPayload(d, dec.content_hash!, await draftProjectName(run, d.project_id)),
    artifactRevision: dec.artifact_revision,
    policyRef: `owner:${who}/retry-post`,
    principal,
  });
  await run(`UPDATE marketing_drafts SET status = 'queued', publication_intent_id = $2, post_error = NULL WHERE id = $1`, [d.id, intent.id]);
  return { ok: true, intentId: intent.id };
}

/** Joe looked at the site after an unsure run and says whether it's up. The
 *  open send is settled to match (never resent). Returns the intent to run
 *  the dispatch effect for. Owner only. */
export async function settlePublicationByOwner(
  run: Run,
  principal: Principal,
  draftId: number,
  answer: { posted: true; url: string | null } | { posted: false },
): Promise<{ ok: true; intent: ActionIntent | null } | { ok: false; reason: string }> {
  if (!isOwner(principal)) return { ok: false, reason: "Only Joe can say whether a post went up." };
  const d = await getDraft(run, draftId);
  if (!d) return { ok: false, reason: "No such draft." };
  const intent = d.publication_intent_id ? await getIntent(run, d.publication_intent_id) : null;
  const open = intent && ["accepted", "unknown", "leased", "held"].includes(intent.state) ? intent : null;
  if (open) {
    await reconcileIntent(run, open.id, answer.posted
      ? { state: "confirmed", providerRef: answer.url, providerState: answer.url ? "posted" : "posted:no-link", note: "Joe: it's up" }
      : { state: "permanent_failure", note: "Joe: it isn't up" });
    return { ok: true, intent: await getIntent(run, open.id) };
  }
  if (!answer.posted) return { ok: false, reason: "There's no send waiting on an answer." };
  await run(`UPDATE marketing_drafts SET status = 'posted', posted_url = COALESCE($2, posted_url), posted_at = COALESCE(posted_at, now()), post_error = NULL WHERE id = $1`, [d.id, answer.url]);
  return { ok: true, intent: null };
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
