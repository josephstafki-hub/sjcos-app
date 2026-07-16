"use server";

// Mood board write paths (P1-B3). Owner-gated: pin catalog items or an uploaded
// image to a room's board, move/resize pins on the canvas, edit a pin's note, or
// remove one. Reads stay in lib/mood.ts. Images go through the shared upload
// helper.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { storeUpload } from "@/lib/upload-store";

type Result = { ok: boolean; error?: string };

/** Coerce a row/client id to a real number.
 *
 *  `catalog_items.id` and `project_mood.id` are `bigserial`, and node-postgres
 *  hands int8 back as a STRING (no setTypeParser anywhere in this app) — so an
 *  id typed `number` is a string at runtime and reaches a server action as one.
 *  Validating it with a bare `Number.isInteger` therefore rejects every real id.
 *  Coerce first, then validate. Ids are well under 2^53, so this is lossless. */
const toId = (v: unknown): number => Number(v);
const isId = (n: number) => Number.isInteger(n) && n > 0;

/** Layout bounds. A pin must keep most of itself on the board, and stay big
 *  enough to see and small enough to leave room for others. */
const MIN_W = 0.08;
const MAX_W = 0.6;
const MAX_XY = 0.98;
/** Guard against a pathological batch — a board is curated, not generated. */
const MAX_LAYOUT_ITEMS = 200;
const MAX_NOTE = 500;

async function projectBySlug(slug: string) {
  return queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
}

/** Next sort_order (= z-order) on a room's board. */
async function nextSort(projectId: string, room: string): Promise<number> {
  const row = await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next
       FROM project_mood WHERE project_id = $1 AND room = $2`,
    [projectId, room],
  );
  return row?.next ?? 0;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Add an uploaded image to a room's board. The image is required (this is the
 *  upload path; catalog pins come in through addCatalogMoodItems). */
export async function addMoodImage(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const room = String(formData.get("room") ?? "").trim() || "General";
  const note = String(formData.get("note") ?? "").trim().slice(0, MAX_NOTE);

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

  await query(
    `INSERT INTO project_mood (project_id, room, image_file_id, note, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [project.id, room, stored.id, note, await nextSort(project.id, room)],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Pin catalog items to a room's board. Name/price/image are snapshotted onto
 *  the row so the board survives the catalog item being edited or deleted;
 *  catalog_id is kept as provenance (the link back to the product page).
 *  Items that vanished between render and pin are skipped. */
export async function addCatalogMoodItems(
  slug: string,
  room: string,
  catalogIds: number[],
): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const boardRoom = room.trim() || "General";
  const ids = [...new Set(catalogIds.map(toId))].filter(isId);
  if (ids.length === 0) return { ok: false, error: "Pick at least one catalog item." };

  const { rows } = await query<{
    id: number;
    name: string;
    price: string;
    image_file_id: string | null;
  }>(
    `SELECT id, name, price, image_file_id FROM catalog_items WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  if (rows.length === 0) return { ok: false, error: "Those catalog items are no longer in the catalog." };

  // Keep the order the picker showed them in, not whatever the DB returned.
  // Key by the coerced id so the lookup can't miss on number-vs-string.
  const byId = new Map(rows.map((r) => [toId(r.id), r]));
  const picked = ids.map((id) => byId.get(id)).filter((r) => r !== undefined);

  let sort = await nextSort(project.id, boardRoom);
  for (const item of picked) {
    await query(
      `INSERT INTO project_mood
         (project_id, room, image_file_id, catalog_id, label, price_label, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [project.id, boardRoom, item.image_file_id, item.id, item.name, item.price, sort++],
    );
  }
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Persist canvas layout after a drag/resize. Positions are normalized 0..1 and
 *  clamped server-side. Only the moved pins are written, so two open tabs can't
 *  clobber each other's untouched pins. `frontId` is raised to the top of the
 *  room's z-order (the pin you just touched stays on top). */
export async function saveMoodLayout(
  slug: string,
  items: { id: number; x: number; y: number; w: number }[],
  frontId?: number,
): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };
  if (items.length === 0) return { ok: true };
  if (items.length > MAX_LAYOUT_ITEMS) return { ok: false, error: "Too many items to save at once." };

  for (const item of items) {
    const id = toId(item.id);
    if (!isId(id)) continue;
    if (![item.x, item.y, item.w].every(Number.isFinite)) continue;
    // Scoped by project_id so a pin id from another project can't be moved.
    await query(
      `UPDATE project_mood SET pos_x = $3, pos_y = $4, pos_w = $5
        WHERE id = $1 AND project_id = $2`,
      [id, project.id, clamp(item.x, 0, MAX_XY), clamp(item.y, 0, MAX_XY), clamp(item.w, MIN_W, MAX_W)],
    );
  }

  const front = toId(frontId);
  if (frontId !== undefined && isId(front)) {
    await query(
      `UPDATE project_mood m
          SET sort_order = (SELECT COALESCE(MAX(sort_order) + 1, 0)
                              FROM project_mood x
                             WHERE x.project_id = m.project_id AND x.room = m.room)
        WHERE m.id = $1 AND m.project_id = $2`,
      [front, project.id],
    );
  }
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Edit a pin's note (owner only). */
export async function updateMoodNote(id: number, note: string): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_mood m JOIN projects p ON p.id = m.project_id WHERE m.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Item not found." };
  await query(`UPDATE project_mood SET note = $2 WHERE id = $1`, [id, note.trim().slice(0, MAX_NOTE)]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Remove a pin from a board (owner only). */
export async function removeMoodImage(id: number): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_mood m JOIN projects p ON p.id = m.project_id WHERE m.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Item not found." };
  await query(`DELETE FROM project_mood WHERE id = $1`, [id]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}
