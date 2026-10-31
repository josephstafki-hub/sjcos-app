"use server";

// Marketing write paths (Phase-6 P6-2). Owner-gated. Qwen drafts social + blog
// posts grounded on a real project; the owner edits/copies/marks-posted. Posting
// itself is manual (no social API). Reads stay in lib/marketing.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { normalizeMarketingCopy } from "@/lib/marketing-copy";
import { type DraftKind } from "@/lib/marketing-types";
import { runDirect, userPrincipal, withTransaction } from "@/lib/commands/db";
import { getDraft, grantPublicationRights, noteDraftEdited, setDraftPost, stagePublication, withdrawPublicationRights } from "@/lib/closeout/marketing";
import { isPostPlatform, POST_LIMITS, postProblem, POST_PLATFORM_LABEL } from "@/lib/marketing-types";
import { storeUpload } from "@/lib/upload-store";
import { retryPost as retryPostNow, savePostingAccounts as saveAccounts, settlePost } from "@/lib/publisher/server";

type Result = { ok: boolean; error?: string };

const KINDS: DraftKind[] = ["social", "blog"];

/** Compose the AI prompt + a deterministic fallback for a project + kind. */
function draftPrompt(kind: DraftKind, name: string, scope: string, city: string) {
  const where = city ? ` in ${city}` : "";
  if (kind === "blog") {
    return {
      prompt:
        `Write a short blog post (3–4 short paragraphs) for a residential carpentry/remodeling company, ` +
        `SJ Carpentry LLC, about a completed project: "${name}"${scope ? ` (${scope})` : ""}${where}. ` +
        `Warm, professional, homeowner-friendly; highlight craftsmanship and the client experience. Do NOT ` +
        `invent specific prices, dates, or names beyond what's given. End with a soft call to action. Return only plain prose, no JSON or code fences.`,
      fallback:
        `${name}\n\nWe recently wrapped up ${scope || "a remodeling project"}${where}, and we couldn't be ` +
        `happier with how it turned out. From the first walkthrough to the final punch list, our team focused ` +
        `on clean lines, solid craftsmanship, and clear communication.\n\nEvery project is a chance to build ` +
        `something that lasts. If you're thinking about a remodel of your own, we'd love to talk it through.\n\n` +
        `— SJ Carpentry LLC`,
    };
  }
  return {
    prompt:
      `Write a short, upbeat social media post (2–3 sentences) for SJ Carpentry LLC celebrating a completed ` +
      `project: "${name}"${scope ? ` (${scope})` : ""}${where}. Friendly and proud, homeowner-friendly. End ` +
      `with 3–5 relevant hashtags. Do NOT invent specific prices, dates, or client names. Return plain prose with hashtags as text, no JSON or arrays.`,
    fallback:
      `Another one in the books! We just finished ${scope || "a great project"}${where} and we're proud of ` +
      `how it came together. Thanks to our client for trusting us with their home. 🛠️\n\n` +
      `#carpentry #remodel #craftsmanship #homeimprovement`,
  };
}

/** Generate (and store) a draft for a project. Returns ok; the draft appears on
 *  /marketing. AI failure falls back to a deterministic template. */
export async function generateDraft(slug: string, kindRaw: string): Promise<Result & {id?: number}> {
  await requireAccess("marketing");
  const kind: DraftKind = KINDS.includes(kindRaw as DraftKind) ? (kindRaw as DraftKind) : "social";
  const proj = await queryOne<{ id: string; name: string; scope: string | null; city: string | null }>(
    `SELECT id, name, sub_label AS scope, address AS city FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };

  const { prompt, fallback } = draftPrompt(kind, proj.name, proj.scope ?? "", proj.city ?? "");
  let body = "";
  let title = proj.name;
  try {
    const res = await ai.ask({ prompt });
    const copy = normalizeMarketingCopy(res.answer ?? "");
    body = copy.body;
    title = copy.title ?? proj.name;
  } catch {
    body = "";
  }
  if (!body) body = fallback;

  const created = await query<{id:number}>(
    `INSERT INTO marketing_drafts (project_id, kind, title, body, status)
     VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
    [proj.id, kind, title, body],
  );
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true, id: created.rows[0]?.id };
}

/** Auto-draft a social post when a project reaches completion (P6-2). Gated by
 *  app_settings marketing.auto_draft_on_completion (default on) + deduped so a
 *  project never gets two auto social drafts. Owner-gated (called from the
 *  owner-only advanceProjectStatus flow). Best-effort — never throws. */
export async function autoDraftSocialOnCompletion(slug: string): Promise<void> {
  await requireAccess("marketing");
  const t = await queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'marketing.auto_draft_on_completion'`,
  );
  if (t && t.value !== "true") return; // toggle off
  const proj = await queryOne<{ id: string; name: string; scope: string | null; city: string | null }>(
    `SELECT id, name, sub_label AS scope, address AS city FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return;
  const dupe = await queryOne(
    `SELECT 1 FROM marketing_drafts WHERE project_id = $1 AND kind = 'social' LIMIT 1`,
    [proj.id],
  );
  if (dupe) return;

  const { prompt, fallback } = draftPrompt("social", proj.name, proj.scope ?? "", proj.city ?? "");
  let body = "";
  let title = proj.name;
  try {
    const res = await ai.ask({ prompt });
    const copy = normalizeMarketingCopy(res.answer ?? "");
    body = copy.body;
    title = copy.title ?? proj.name;
  } catch {
    body = "";
  }
  if (!body) body = fallback;
  await query(
    `INSERT INTO marketing_drafts (project_id, kind, title, body, status)
     VALUES ($1, 'social', $2, $3, 'draft')`,
    [proj.id, title, body],
  );
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
}

/** Auto-draft the website BLOG post when a project completes (P2-4). Same
 *  completion hook + toggle as the social auto-draft; deduped per-kind so a
 *  project gets at most one auto blog draft (manual /site Generate stays
 *  unlimited). GATE: this only writes a parked draft — nothing is published
 *  outward. When the project has no photos on file, it also emits an owner
 *  notification asking Joe to add photos/video before publishing. Owner-gated
 *  (called from advanceProjectStatus). Best-effort — never throws. */
export async function autoDraftBlogOnCompletion(slug: string): Promise<void> {
  await requireAccess("marketing");
  const t = await queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'marketing.auto_draft_on_completion'`,
  );
  if (t && t.value !== "true") return; // one toggle governs both social + blog
  const proj = await queryOne<{ id: string; name: string; scope: string | null; city: string | null }>(
    `SELECT id, name, sub_label AS scope, address AS city FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return;
  const dupe = await queryOne(
    `SELECT 1 FROM marketing_drafts WHERE project_id = $1 AND kind = 'blog' LIMIT 1`,
    [proj.id],
  );
  if (dupe) return;

  const { prompt, fallback } = draftPrompt("blog", proj.name, proj.scope ?? "", proj.city ?? "");
  let body = "";
  let title = proj.name;
  try {
    const res = await ai.ask({ prompt });
    const copy = normalizeMarketingCopy(res.answer ?? "");
    body = copy.body;
    title = copy.title ?? proj.name;
  } catch {
    body = "";
  }
  if (!body) body = fallback;
  await query(
    `INSERT INTO marketing_drafts (project_id, kind, title, body, status)
     VALUES ($1, 'blog', $2, $3, 'draft')`,
    [proj.id, title, body],
  );

  // Ask for photos/video if none are on file — the post can't go live without
  // media. Surface it to Joe (never reaches the client).
  const media = await queryOne<{ n: number }>(
    // Only real uploads count (storage_path NOT NULL) — showcase rows have no blob.
    `SELECT count(*)::int AS n FROM files
      WHERE project_key = $1 AND type = 'img' AND storage_path IS NOT NULL`,
    [slug],
  );
  if (!media || media.n === 0) {
    await emit({
      kind: "job",
      tag: "Website",
      icon: "site",
      accent: "flag",
      title: "Blog draft ready — needs photos",
      subline: `${proj.name}: no project photos uploaded yet — add photos/video before publishing.`,
      href: "/site",
    });
    revalidatePath("/notifications");
  }

  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
}

/** Save readable copy and its headline together. An approval card for the old
 *  text is retired; refused while the post is going up. */
export async function updateDraft(id: number, body: string, title?: string): Promise<Result> {
  const user = await requireAccess("marketing");
  const clean = normalizeMarketingCopy(body);
  if (!clean.body) return {ok:false,error:"Enter the post as readable text before saving."};
  const headline = title?.trim() ?? clean.title;
  if (title !== undefined && !headline) return {ok:false,error:"Enter a headline before saving."};
  try {
    await withTransaction(async (run) => {
      await noteDraftEdited(run, id, `${user.role}:${user.name}`);
      await run(`UPDATE marketing_drafts SET body = $2, title = COALESCE($3, title) WHERE id = $1`, [id, clean.body, headline ?? null]);
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** A link to a post on one of the sites Joe posts to, or null. */
function postLink(raw: string | null | undefined): string | null | false {
  const url = (raw ?? "").trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : false;
  } catch {
    return false;
  }
}

/** Mark a draft as posted (Joe posted it by hand, or checked that the agent's
 *  post is up), optionally with the link to it. A send still waiting on an
 *  answer is settled to match, never resent. */
export async function markPosted(id: number, url?: string | null): Promise<Result> {
  const user = await requireAccess("marketing");
  const link = postLink(url);
  if (link === false) return { ok: false, error: "That isn't a link (it should start with https://)." };
  const d = await getDraft(runDirect, id);
  if (!d) return { ok: false, error: "No such draft." };
  if (d.publication_intent_id && (d.status === "queued" || d.status === "posting")) {
    if (user.role !== "owner") return { ok: false, error: "Only Joe can say whether the agent's post went up." };
    const r = await settlePost(userPrincipal(user), id, { posted: true, url: link });
    if (!r.ok) return { ok: false, error: r.message };
  } else {
    await query(`UPDATE marketing_drafts SET status = 'posted', posted_url = COALESCE($2, posted_url), posted_at = COALESCE(posted_at, now()), post_error = NULL WHERE id = $1`, [id, link]);
  }
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** Undo a manual "posted" marker. No external post is changed. */
export async function markDraft(id: number): Promise<Result> {
  await requireAccess("marketing");
  // Only a post marked posted by hand: one the posting agent put up stays posted
  // (reopening it would let the same post go up twice).
  const r = await query(`UPDATE marketing_drafts SET status = 'draft' WHERE id = $1 AND status = 'posted' AND publication_intent_id IS NULL`, [id]);
  if (!r.rowCount) return { ok: false, error: "The posting agent put this one up, so it stays posted. Delete it from the site itself if it needs to come down." };
  revalidatePath("/marketing"); revalidatePath("/site");
  return {ok:true};
}

/** Joe looked after an unsure run: it isn't up. The send is closed as not
 *  posted, and Try again becomes available. Owner only. */
export async function markNotPosted(id: number): Promise<Result> {
  const user = await requireAccess("marketing");
  if (user.role !== "owner") return { ok: false, error: "Only Joe can say whether the agent's post went up." };
  const r = await settlePost(userPrincipal(user), id, { posted: false });
  revalidatePath("/marketing");
  return r.ok ? { ok: true } : { ok: false, error: r.message };
}

/** Where the post goes and which shareable photos go with it, in order.
 *  Picking a site on a post with no photos picks the newest shareable ones
 *  for him (he changes them after). Retires an approval card for the old
 *  choice. */
export async function setPostTarget(id: number, platform: string, photoIds: string[]): Promise<Result & { message?: string }> {
  const user = await requireAccess("marketing");
  if (platform && !isPostPlatform(platform)) return { ok: false, error: "Pick Facebook, Instagram or Google Business Profile." };
  try {
    const before = await getDraft(runDirect, id);
    const autoPick = !!platform && !photoIds.length && before?.audience !== platform;
    const r = await withTransaction((run) => setDraftPost(run, id, { platform, photoIds: photoIds.slice(0, 20), actor: `${user.role}:${user.name}`, autoPick }));
    revalidatePath("/marketing");
    const notes: string[] = [];
    if (r.autoPicked) notes.push(`Picked ${r.autoPicked} photo${r.autoPicked === 1 ? "" : "s"} the client OK'd. Change them under "In this post".`);
    if (r.trimmed && isPostPlatform(platform)) notes.push(`${POST_PLATFORM_LABEL[platform]} takes ${POST_LIMITS[platform].maxPhotos}; ${r.trimmed} left out.`);
    if (r.rejectedPhotoIds.length) notes.push(`${r.rejectedPhotoIds.length} photo(s) left out: not OK'd to share.`);
    return { ok: true, message: notes.join(" ") || undefined };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const OWN_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Joe adds his own photos to a post: they're saved on the job's files and,
 *  since he took them or chose them himself, count as OK to share and go into
 *  the post (social posts, until it's on its way). Staff can add photos to the
 *  job; Joe ticks OK to share. */
export async function addPostPhotos(formData: FormData): Promise<Result & { message?: string }> {
  const user = await requireAccess("marketing");
  const id = Number(formData.get("draftId"));
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10);
  if (!files.length) return { ok: false, error: "Choose a photo to add." };
  const bad = files.find((f) => !OWN_PHOTO_TYPES.includes(f.type));
  if (bad) return { ok: false, error: `${bad.name}: use a JPG, PNG or WebP photo (on an iPhone, choose it from Photos and it's converted for you).` };
  const d = await getDraft(runDirect, id);
  if (!d) return { ok: false, error: "No such draft." };
  const [proj] = d.project_id ? await runDirect<{ id: string; slug: string }>(`SELECT id, slug FROM projects WHERE id = $1`, [d.project_id]) : [];
  if (!proj) return { ok: false, error: "This post isn't tied to a job, so there's nowhere to keep the photos." };

  const added: string[] = [];
  for (const f of files) {
    const stored = await storeUpload(f, { idPrefix: "mkt", projectKey: proj.slug, imagesOnly: true, tag: "MARKETING", subtitle: "Marketing photo" });
    if (!stored.ok) return { ok: false, error: `${f.name}: ${stored.error}${added.length ? ` (${added.length} added before it)` : ""}` };
    added.push(stored.id);
  }
  revalidatePath("/marketing");
  if (user.role !== "owner") return { ok: true, message: `Added ${added.length} photo${added.length === 1 ? "" : "s"} to the job. Joe ticks OK to share before they can go in a post.` };

  await grantPublicationRights(runDirect, { fileIds: added, projectId: proj.id, grantedBy: user.name || "Joe", grantedByUserId: user.id, note: "Joe's own photo (added on /marketing)" });
  const editable = d.kind === "social" && ["draft", "failed", "pending_decision"].includes(d.status);
  if (!editable) return { ok: true, message: `Added ${added.length} photo${added.length === 1 ? "" : "s"}, OK to share.` };
  try {
    const r = await withTransaction((run) => setDraftPost(run, id, { platform: d.audience, photoIds: [...d.media, ...added], actor: `${user.role}:${user.name}` }));
    const n = added.length - r.trimmed;
    const notes = [`Added ${added.length} photo${added.length === 1 ? "" : "s"}; ${n} in the post.`];
    if (r.trimmed && isPostPlatform(d.audience)) notes.push(`${POST_PLATFORM_LABEL[d.audience]} takes ${POST_LIMITS[d.audience].maxPhotos}; take one out to swap.`);
    revalidatePath("/marketing");
    return { ok: true, message: notes.join(" ") };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Ask Joe to approve this post for the posting agent: stages the
 *  publish_marketing card (approve it here, on /engine/decisions or on
 *  Telegram). Nothing is posted until it's approved. */
export async function askToPost(id: number): Promise<Result & { message?: string }> {
  const user = await requireAccess("marketing");
  const d = await getDraft(runDirect, id);
  if (!d) return { ok: false, error: "No such draft." };
  if (d.kind !== "social") return { ok: false, error: "The posting agent posts social posts only." };
  if (!isPostPlatform(d.audience)) return { ok: false, error: "Pick where it goes first." };
  const problem = postProblem(d.audience, d.body, d.media.length);
  if (problem) return { ok: false, error: problem };
  try {
    const r = await withTransaction((run) => stagePublication(run, userPrincipal(user), id));
    revalidatePath("/marketing");
    revalidatePath("/engine/decisions");
    return { ok: true, message: r.created ? `Approval card ready: approve it to post to ${POST_PLATFORM_LABEL[d.audience]}.` : "It's already waiting for approval." };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Joe's Try again on a post that never went up (same approved post). */
export async function retryPost(id: number): Promise<Result & { message?: string }> {
  const user = await requireAccess("marketing");
  if (user.role !== "owner") return { ok: false, error: "Only Joe can send a post again." };
  const r = await retryPostNow(userPrincipal(user), id);
  revalidatePath("/marketing");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Joe's posting accounts: the Facebook page link, Instagram handle and
 *  Google Business Profile name the agent posts as. Owner only. */
export async function savePostingAccounts(input: { facebookPage: string; instagramHandle: string; googleBusinessName: string }): Promise<Result> {
  const user = await requireAccess("marketing");
  if (user.role !== "owner") return { ok: false, error: "Only Joe sets the posting accounts." };
  const fb = input.facebookPage.trim();
  if (fb && !/^https:\/\/(www\.|m\.)?facebook\.com\/\S+$/i.test(fb)) return { ok: false, error: "The Facebook page should be its link, like https://www.facebook.com/YourPage" };
  await saveAccounts({ facebookPage: fb, instagramHandle: input.instagramHandle.trim().replace(/^@/, ""), googleBusinessName: input.googleBusinessName.trim() });
  revalidatePath("/marketing");
  return { ok: true };
}

/** Delete a draft (not while it's going up). */
export async function deleteDraft(id: number): Promise<Result> {
  await requireAccess("marketing");
  const d = await getDraft(runDirect, id);
  if (d && (d.status === "queued" || d.status === "posting")) return { ok: false, error: "This post is going up right now; delete it after." };
  await query(`DELETE FROM marketing_drafts WHERE id = $1`, [id]);
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** Joe marks a job photo as OK to share publicly (the client agreed) or takes
 *  that back. Only shareable photos are offered for download on /marketing;
 *  taking it back also pulls it from anything queued to publish. Owner only:
 *  it records the client's permission. */
export async function setPhotoShareable(projectSlug: string, fileId: string, shareable: boolean): Promise<Result> {
  const user = await requireAccess("marketing");
  if (user.role !== "owner") return { ok: false, error: "Only Joe records a client's OK to share photos." };
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [projectSlug]);
  if (!proj) return { ok: false, error: "Project not found." };
  const file = await queryOne<{ id: string }>(`SELECT id FROM files WHERE id = $1 AND project_key = $2 AND type = 'img'`, [fileId, projectSlug]);
  if (!file) return { ok: false, error: "That photo isn't on this job." };
  if (shareable) {
    await grantPublicationRights(runDirect, { fileIds: [fileId], projectId: proj.id, grantedBy: user.name || "Joe", grantedByUserId: user.id, note: "client OK'd sharing (marked on /marketing)" });
  } else {
    await withdrawPublicationRights(runDirect, userPrincipal(user), fileId, "taken back on /marketing");
    // …and it comes off any post that hasn't gone out.
    await query(
      `DELETE FROM marketing_draft_media m USING marketing_drafts d WHERE m.draft_id = d.id AND m.file_id = $1 AND d.status IN ('draft','pending_decision','failed')`,
      [fileId],
    );
  }
  revalidatePath("/marketing");
  return { ok: true };
}
