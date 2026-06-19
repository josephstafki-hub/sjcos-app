"use server";

// Mood board write paths (Review-round-3 S5D). Owner-gated: add an image (with
// room + optional note) to a project's mood board, or remove one. Reads stay in
// lib/mood.ts. Images go through the shared upload helper.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { storeUpload } from "@/lib/upload-store";

type Result = { ok: boolean; error?: string };

/** Add an image to a project's mood board. Reads room/note + an image file
 *  from the form. The image is required (a mood pin is an image). */
export async function addMoodImage(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await queryOne<{ id: string }>(
    `SELECT id FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!project) return { ok: false, error: "Project not found." };

  const room = String(formData.get("room") ?? "").trim() || "General";
  const note = String(formData.get("note") ?? "").trim();

  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return { ok: false, error: "Choose an image to add." };
  }
  const stored = await storeUpload(image, {
    idPrefix: "mood",
    imagesOnly: true,
    tag: "MOOD",
    subtitle: `Mood · ${room}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  const { next } = (await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next
       FROM project_mood WHERE project_id = $1 AND room = $2`,
    [project.id, room],
  )) ?? { next: 0 };

  await query(
    `INSERT INTO project_mood (project_id, room, image_file_id, note, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [project.id, room, stored.id, note, next],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Remove a mood image (owner only). */
export async function removeMoodImage(id: number): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_mood m JOIN projects p ON p.id = m.project_id WHERE m.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Image not found." };
  await query(`DELETE FROM project_mood WHERE id = $1`, [id]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}
