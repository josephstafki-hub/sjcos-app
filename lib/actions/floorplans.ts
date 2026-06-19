"use server";

// Floor-plan write paths (Review-round-3 S5E). Owner-gated: upload a new plan
// version (image or PDF), edit a version's notes, remove a version. Reads stay
// in lib/floorplans.ts. Files go through the shared upload helper.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { storeUpload } from "@/lib/upload-store";

type Result = { ok: boolean; error?: string };

/** Upload a new floor-plan version. version = current max + 1. Accepts an image
 *  or a PDF. Notes optional. */
export async function uploadFloorplan(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await queryOne<{ id: string }>(
    `SELECT id FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!project) return { ok: false, error: "Project not found." };

  const notes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a plan file (image or PDF)." };
  }
  const isImage = (file.type || "").startsWith("image/");
  const isPdf = (file.type || "").includes("pdf");
  if (!isImage && !isPdf) {
    return { ok: false, error: "Upload an image or a PDF." };
  }

  const stored = await storeUpload(file, {
    idPrefix: "fp",
    tag: "FLOOR PLAN",
    subtitle: "Floor plan",
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  const { next } = (await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(version) + 1, 1) AS next FROM project_floorplans WHERE project_id = $1`,
    [project.id],
  )) ?? { next: 1 };

  await query(
    `INSERT INTO project_floorplans (project_id, version, file_id, notes)
     VALUES ($1, $2, $3, $4)`,
    [project.id, next, stored.id, notes],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

async function floorplanSlug(id: number) {
  return queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_floorplans fp JOIN projects p ON p.id = fp.project_id WHERE fp.id = $1`,
    [id],
  );
}

/** Edit a version's notes (owner only). */
export async function updateFloorplanNotes(id: number, notes: string): Promise<Result> {
  await requireRole("owner");
  const row = await floorplanSlug(id);
  if (!row) return { ok: false, error: "Version not found." };
  await query(`UPDATE project_floorplans SET notes = $2 WHERE id = $1`, [id, notes.trim()]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Remove a floor-plan version (owner only). */
export async function removeFloorplan(id: number): Promise<Result> {
  await requireRole("owner");
  const row = await floorplanSlug(id);
  if (!row) return { ok: false, error: "Version not found." };
  await query(`DELETE FROM project_floorplans WHERE id = $1`, [id]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}
