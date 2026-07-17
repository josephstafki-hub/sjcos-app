"use server";

// Marketing write paths (Phase-6 P6-2). Owner-gated. Qwen drafts social + blog
// posts grounded on a real project; the owner edits/copies/marks-posted. Posting
// itself is manual (no social API). Reads stay in lib/marketing.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { type DraftKind } from "@/lib/marketing-types";

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
        `invent specific prices, dates, or names beyond what's given. End with a soft call to action.`,
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
      `with 3–5 relevant hashtags. Do NOT invent specific prices, dates, or client names.`,
    fallback:
      `Another one in the books! We just finished ${scope || "a great project"}${where} and we're proud of ` +
      `how it came together. Thanks to our client for trusting us with their home. 🛠️\n\n` +
      `#carpentry #remodel #craftsmanship #homeimprovement`,
  };
}

/** Generate (and store) a draft for a project. Returns ok; the draft appears on
 *  /marketing. AI failure falls back to a deterministic template. */
export async function generateDraft(slug: string, kindRaw: string): Promise<Result> {
  await requireRole("owner");
  const kind: DraftKind = KINDS.includes(kindRaw as DraftKind) ? (kindRaw as DraftKind) : "social";
  const proj = await queryOne<{ id: string; name: string; scope: string | null; city: string | null }>(
    `SELECT id, name, sub_label AS scope, address AS city FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };

  const { prompt, fallback } = draftPrompt(kind, proj.name, proj.scope ?? "", proj.city ?? "");
  let body = "";
  try {
    const res = await ai.ask({ prompt });
    body = (res.answer ?? "").trim();
  } catch {
    body = "";
  }
  if (!body) body = fallback;

  await query(
    `INSERT INTO marketing_drafts (project_id, kind, title, body, status)
     VALUES ($1, $2, $3, $4, 'draft')`,
    [proj.id, kind, proj.name, body],
  );
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** Auto-draft a social post when a project reaches completion (P6-2). Gated by
 *  app_settings marketing.auto_draft_on_completion (default on) + deduped so a
 *  project never gets two auto social drafts. Owner-gated (called from the
 *  owner-only advanceProjectStatus flow). Best-effort — never throws. */
export async function autoDraftSocialOnCompletion(slug: string): Promise<void> {
  await requireRole("owner");
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
  try {
    const res = await ai.ask({ prompt });
    body = (res.answer ?? "").trim();
  } catch {
    body = "";
  }
  if (!body) body = fallback;
  await query(
    `INSERT INTO marketing_drafts (project_id, kind, title, body, status)
     VALUES ($1, 'social', $2, $3, 'draft')`,
    [proj.id, proj.name, body],
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
  await requireRole("owner");
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
  try {
    const res = await ai.ask({ prompt });
    body = (res.answer ?? "").trim();
  } catch {
    body = "";
  }
  if (!body) body = fallback;
  await query(
    `INSERT INTO marketing_drafts (project_id, kind, title, body, status)
     VALUES ($1, 'blog', $2, $3, 'draft')`,
    [proj.id, proj.name, body],
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

/** Edit a draft's body. */
export async function updateDraft(id: number, body: string): Promise<Result> {
  await requireRole("owner");
  await query(`UPDATE marketing_drafts SET body = $2 WHERE id = $1`, [id, body.trim()]);
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** Mark a draft as posted (owner posts it manually elsewhere). */
export async function markPosted(id: number): Promise<Result> {
  await requireRole("owner");
  await query(`UPDATE marketing_drafts SET status = 'posted' WHERE id = $1`, [id]);
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}

/** Delete a draft. */
export async function deleteDraft(id: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM marketing_drafts WHERE id = $1`, [id]);
  revalidatePath("/marketing");
  revalidatePath("/site"); // blog drafts also surface in the Website composer
  return { ok: true };
}
