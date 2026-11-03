"use server";

// Marketing write paths (Phase-6 P6-2). Qwen drafts social + blog posts from
// the job's own record of the work (lib/closeout/marketing.ts loadJobFacts);
// Joe edits, copies, downloads the photos the client OK'd and posts by hand.
// Nothing here posts anywhere (the posting agent was removed 2026-11-03).
// Reads stay in lib/marketing.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { buildDraftPrompt, draftHeadline, draftProblems, fallbackDraft, normalizeMarketingCopy, type JobFacts } from "@/lib/marketing-copy";
import { type DraftKind } from "@/lib/marketing-types";
import { runDirect, userPrincipal } from "@/lib/commands/db";
import { getDraft, grantPublicationRights, loadJobFacts, withdrawPublicationRights } from "@/lib/closeout/marketing";
import { storeUpload } from "@/lib/upload-store";

type Result = { ok: boolean; error?: string };

const KINDS: DraftKind[] = ["social", "blog"];

/** The mock provider (and Ollama falling back to it) answers with an echo of
 *  the prompt: never a post. */
const isEcho = (answer: string) => answer.startsWith('You asked: "');

/** Ask the model for a post about this job and check it against the job's
 *  record: a draft that adds rooms the job didn't have, names the client or
 *  gives a price is sent back once with what was wrong, then replaced by a
 *  plain template from the same facts. */
async function writeDraft(kind: DraftKind, facts: JobFacts): Promise<{ title: string; body: string }> {
  const prompt = buildDraftPrompt(kind, facts);
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const ask = attempt === 0 ? prompt : `${prompt}\n\nYour last draft broke the rules:\n${problems.map((p) => `- ${p}`).join("\n")}\nWrite it again, using only the JOB FACTS.`;
    let answer = "";
    try {
      answer = ((await ai.ask({ prompt: ask })).answer ?? "").trim();
    } catch {
      break;
    }
    if (!answer || isEcho(answer)) break;
    const copy = normalizeMarketingCopy(answer);
    if (!copy.body) continue;
    problems = draftProblems(`${copy.title ?? ""}\n${copy.body}`, facts);
    if (!problems.length) return { title: copy.title || draftHeadline(facts), body: copy.body };
  }
  return fallbackDraft(kind, facts);
}

type ProjectRow = { id: string; name: string };

const projectBySlug = (slug: string) => queryOne<ProjectRow>(`SELECT id, name FROM projects WHERE slug = $1`, [slug]);

/** Draft and store one post about a project. */
async function createDraft(proj: ProjectRow, kind: DraftKind): Promise<number | undefined> {
  const facts = (await loadJobFacts(runDirect, proj.id)) ?? { work: "", city: "", scope: [], lines: [], changes: [], privateWords: [proj.name] };
  const { title, body } = await writeDraft(kind, facts);
  const created = await query<{ id: number }>(
    `INSERT INTO marketing_drafts (project_id, kind, title, body, status)
     VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
    [proj.id, kind, title, body],
  );
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return created.rows[0]?.id;
}

/** Generate (and store) a draft for a project. Returns ok; the draft appears on
 *  /marketing. AI failure falls back to a plain template from the job's record. */
export async function generateDraft(slug: string, kindRaw: string): Promise<Result & {id?: number}> {
  await requireAccess("marketing");
  const kind: DraftKind = KINDS.includes(kindRaw as DraftKind) ? (kindRaw as DraftKind) : "social";
  const proj = await projectBySlug(slug);
  if (!proj) return { ok: false, error: "Project not found." };
  return { ok: true, id: await createDraft(proj, kind) };
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
  const proj = await projectBySlug(slug);
  if (!proj) return;
  const dupe = await queryOne(
    `SELECT 1 FROM marketing_drafts WHERE project_id = $1 AND kind = 'social' LIMIT 1`,
    [proj.id],
  );
  if (dupe) return;
  await createDraft(proj, "social");
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
  const proj = await projectBySlug(slug);
  if (!proj) return;
  const dupe = await queryOne(
    `SELECT 1 FROM marketing_drafts WHERE project_id = $1 AND kind = 'blog' LIMIT 1`,
    [proj.id],
  );
  if (dupe) return;
  await createDraft(proj, "blog");

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
}

/** Save readable copy and its headline together. */
export async function updateDraft(id: number, body: string, title?: string): Promise<Result> {
  await requireAccess("marketing");
  const clean = normalizeMarketingCopy(body);
  if (!clean.body) return {ok:false,error:"Enter the post as readable text before saving."};
  const headline = title?.trim() ?? clean.title;
  if (title !== undefined && !headline) return {ok:false,error:"Enter a headline before saving."};
  await query(`UPDATE marketing_drafts SET body = $2, title = COALESCE($3, title) WHERE id = $1`, [id, clean.body, headline ?? null]);
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** A link to the post, or null; false = not a link. */
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

/** Joe posted it by hand: mark it posted, optionally with the link to it. */
export async function markPosted(id: number, url?: string | null): Promise<Result> {
  await requireAccess("marketing");
  const link = postLink(url);
  if (link === false) return { ok: false, error: "That isn't a link (it should start with https://)." };
  const r = await query(`UPDATE marketing_drafts SET status = 'posted', posted_url = COALESCE($2, posted_url), posted_at = COALESCE(posted_at, now()), post_error = NULL WHERE id = $1`, [id, link]);
  if (!r.rowCount) return { ok: false, error: "No such draft." };
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** Undo a "posted" marker. No external post is changed. */
export async function markDraft(id: number): Promise<Result> {
  await requireAccess("marketing");
  const r = await query(`UPDATE marketing_drafts SET status = 'draft' WHERE id = $1 AND status = 'posted'`, [id]);
  if (!r.rowCount) return { ok: false, error: "This post isn't marked posted." };
  revalidatePath("/marketing"); revalidatePath("/site");
  return {ok:true};
}

const OWN_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Add photos to a post's job: they're saved on the job's files. Joe's own
 *  count as OK to share (he took them or chose them himself), so they're
 *  ready to download with the post; staff photos wait for Joe to tick OK to
 *  share. */
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
  const n = `${added.length} photo${added.length === 1 ? "" : "s"}`;
  if (user.role !== "owner") return { ok: true, message: `Added ${n} to the job. Joe ticks OK to share before they can be downloaded for a post.` };
  await grantPublicationRights(runDirect, { fileIds: added, projectId: proj.id, grantedBy: user.name || "Joe", grantedByUserId: user.id, note: "Joe's own photo (added on /marketing)" });
  return { ok: true, message: `Added ${n}, OK to share and ready to download.` };
}

/** Delete a draft. */
export async function deleteDraft(id: number): Promise<Result> {
  await requireAccess("marketing");
  await query(`DELETE FROM marketing_drafts WHERE id = $1`, [id]);
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** Joe marks a job photo as OK to share publicly (the client agreed) or takes
 *  that back. Only shareable photos are offered for download on /marketing.
 *  Owner only: it records the client's permission. */
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
  }
  revalidatePath("/marketing");
  return { ok: true };
}
