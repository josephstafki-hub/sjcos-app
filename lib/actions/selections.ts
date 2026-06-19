"use server";

// Selections write paths (Review-round-3 S5C). Owner curates a project's
// selections board (add / push to client / remove); the client (or owner) then
// approves or declines a pushed selection from the portal. Reads stay in
// lib/selections.ts. Images are inherited from a linked catalog item or
// uploaded via the shared upload helper.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { storeUpload } from "@/lib/upload-store";

type Result = { ok: boolean; error?: string };

async function projectBySlug(slug: string) {
  return queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE slug = $1`,
    [slug],
  );
}

/** Add a selection to a project's board. Reads area/choice/catalogId from the
 *  form; an optional uploaded image overrides the catalog item's image. */
export async function addSelection(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const area = String(formData.get("area") ?? "").trim();
  const choice = String(formData.get("choice") ?? "").trim();
  if (!area || !choice) return { ok: false, error: "Area and choice are required." };

  const catalogRaw = String(formData.get("catalogId") ?? "").trim();
  const catalogId = catalogRaw ? Number(catalogRaw) : null;

  const image = formData.get("image");
  let imageFileId: string | null = null;
  if (image instanceof File && image.size > 0) {
    const stored = await storeUpload(image, {
      idPrefix: "sel",
      imagesOnly: true,
      tag: "SELECTION",
      subtitle: `Selection · ${area}`,
    });
    if (!stored.ok) return { ok: false, error: stored.error };
    imageFileId = stored.id;
  }

  const { next } = (await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM project_selections WHERE project_id = $1`,
    [project.id],
  )) ?? { next: 0 };

  await query(
    `INSERT INTO project_selections (project_id, area, choice, catalog_id, image_file_id, status, sort_order)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6)`,
    [project.id, area, choice, Number.isFinite(catalogId) ? catalogId : null, imageFileId, next],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

interface SelectionJoin {
  area: string;
  status: string;
  slug: string;
  project_name: string;
}

async function selectionById(id: number) {
  return queryOne<SelectionJoin>(
    `SELECT s.area, s.status, p.slug, p.name AS project_name
       FROM project_selections s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [id],
  );
}

/** Push a draft selection to the client portal for a decision. */
export async function pushSelectionToClient(id: number): Promise<Result> {
  await requireRole("owner");
  const sel = await selectionById(id);
  if (!sel) return { ok: false, error: "Selection not found." };

  await query(
    `UPDATE project_selections SET status = 'pending', pushed_at = now()
      WHERE id = $1 AND status = 'draft'`,
    [id],
  );
  await emit({
    kind: "decision",
    tag: "Decision",
    accent: "accent",
    icon: "project",
    title: `Selection awaiting client approval — ${sel.area}`,
    subline: `${sel.project_name} · sent to the client portal`,
    href: `/projects/${sel.slug}`,
  });
  revalidatePath(`/projects/${sel.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Remove a selection from the board (owner only). */
export async function removeSelection(id: number): Promise<Result> {
  await requireRole("owner");
  const sel = await selectionById(id);
  if (!sel) return { ok: false, error: "Selection not found." };
  await query(`DELETE FROM project_selections WHERE id = $1`, [id]);
  revalidatePath(`/projects/${sel.slug}`);
  return { ok: true };
}

/** Approve or decline a pushed selection. Owner can decide on a client's behalf;
 *  a client may only decide on their own project's selections. Emits a DECISION
 *  notification the owner sees. */
export async function decideSelection(id: number, approve: boolean): Promise<Result> {
  const user = await requireRole("owner", "client");
  const sel = await selectionById(id);
  if (!sel) return { ok: false, error: "Selection not found." };
  if (user.role === "client" && user.linkSlug !== sel.slug) {
    return { ok: false, error: "Not authorized for this project." };
  }

  const status = approve ? "approved" : "declined";
  await query(
    `UPDATE project_selections SET status = $2, decided_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [id, status],
  );
  await emit({
    kind: "decision",
    tag: "Decision",
    accent: approve ? "accent" : "flag",
    icon: "project",
    flagged: !approve,
    title: `Client ${approve ? "approved" : "declined"} — ${sel.area}`,
    subline: `${sel.project_name}`,
    href: `/projects/${sel.slug}`,
  });
  revalidatePath(`/projects/${sel.slug}`);
  revalidatePath("/client-portal");
  revalidatePath("/notifications");
  return { ok: true };
}
