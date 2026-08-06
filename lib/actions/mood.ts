"use server";

// Mood board write paths (P1-B3). Owner-gated: pin catalog items or an uploaded
// image to a room's board, drop a text block or a colour swatch, move/resize/
// rotate items on the canvas, restack them, duplicate one, edit a caption or a
// note, or remove one — plus per-room board settings (title, background) and
// renaming/deleting a whole board. Reads stay in lib/mood.ts. Images go through
// the shared upload helper.

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

/** Layout bounds. An item must keep most of itself on the board, and stay big
 *  enough to see and small enough to leave room for others. */
const MIN_W = 0.08;
const MAX_W = 0.6;
const MIN_H = 0.06;
const MAX_H = 0.9;
const MAX_XY = 0.98;
/** Crop zoom: 1 = the plain cover fit, anything above magnifies inside the frame. */
const MAX_ZOOM = 4;
/** Guard against a pathological batch — a board is curated, not generated. */
const MAX_LAYOUT_ITEMS = 200;
const MAX_NOTE = 500;
const MAX_LABEL = 200;
const MAX_ROOM = 60;
/** A board is a presentation surface, not a dumping ground. */
const MAX_ITEMS_PER_BOARD = 300;

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

/** Make sure the room has a settings row, so it survives as a board even while
 *  it is empty. Every add path calls this. */
async function ensureBoard(projectId: string, room: string): Promise<void> {
  await query(
    `INSERT INTO project_mood_boards (project_id, room) VALUES ($1, $2)
     ON CONFLICT (project_id, room) DO NOTHING`,
    [projectId, room],
  );
}

async function boardFull(projectId: string, room: string): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM project_mood WHERE project_id = $1 AND room = $2`,
    [projectId, room],
  );
  return Number(row?.n ?? 0) >= MAX_ITEMS_PER_BOARD;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Normalize a rotation to -180..180 so it can't grow without bound as the
 *  owner spins a card round and round. */
function normRot(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = ((deg % 360) + 540) % 360 - 180;
  return Math.round(wrapped * 10) / 10;
}

/** Colours land in a `style` attribute on the client, so only a literal hex
 *  triple is stored — never arbitrary CSS. "" clears the colour. */
function cleanColor(raw: unknown): string {
  const c = String(raw ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : "";
}

const cleanRoom = (raw: unknown) => String(raw ?? "").trim().slice(0, MAX_ROOM);

/** Add an uploaded image to a room's board. The image is required (this is the
 *  upload path; catalog pins come in through addCatalogMoodItems). */
export async function addMoodImage(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const room = cleanRoom(formData.get("room")) || "General";
  const note = String(formData.get("note") ?? "").trim().slice(0, MAX_NOTE);

  const image = formData.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return { ok: false, error: "Choose an image to add." };
  }
  if (await boardFull(project.id, room)) return { ok: false, error: "This board is full." };

  const stored = await storeUpload(image, {
    idPrefix: "mood",
    imagesOnly: true,
    tag: "MOOD",
    subtitle: `Mood · ${room}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  await ensureBoard(project.id, room);
  await query(
    `INSERT INTO project_mood (project_id, room, kind, image_file_id, note, sort_order)
     VALUES ($1, $2, 'pin', $3, $4, $5)`,
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

  const boardRoom = cleanRoom(room) || "General";
  const ids = [...new Set(catalogIds.map(toId))].filter(isId);
  if (ids.length === 0) return { ok: false, error: "Pick at least one catalog item." };
  if (await boardFull(project.id, boardRoom)) return { ok: false, error: "This board is full." };

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

  await ensureBoard(project.id, boardRoom);
  let sort = await nextSort(project.id, boardRoom);
  for (const item of picked) {
    await query(
      `INSERT INTO project_mood
         (project_id, room, kind, image_file_id, catalog_id, label, price_label, sort_order)
       VALUES ($1, $2, 'pin', $3, $4, $5, $6, $7)`,
      [project.id, boardRoom, item.image_file_id, item.id, item.name, item.price, sort++],
    );
  }
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Drop a standalone text block on a board — a heading, a client note, a
 *  "warm brass throughout" instruction. The words live in `label`. */
export async function addMoodText(slug: string, room: string, text: string): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const boardRoom = cleanRoom(room) || "General";
  const label = text.trim().slice(0, MAX_LABEL);
  if (!label) return { ok: false, error: "Type some text first." };
  if (await boardFull(project.id, boardRoom)) return { ok: false, error: "This board is full." };

  await ensureBoard(project.id, boardRoom);
  await query(
    `INSERT INTO project_mood (project_id, room, kind, label, sort_order)
     VALUES ($1, $2, 'text', $3, $4)`,
    [project.id, boardRoom, label, await nextSort(project.id, boardRoom)],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Drop a solid colour chip on a board — paint, stain, tile grout. */
export async function addMoodSwatch(
  slug: string,
  room: string,
  color: string,
  label: string,
): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const boardRoom = cleanRoom(room) || "General";
  const hex = cleanColor(color);
  if (!hex) return { ok: false, error: "Pick a colour first." };
  if (await boardFull(project.id, boardRoom)) return { ok: false, error: "This board is full." };

  await ensureBoard(project.id, boardRoom);
  await query(
    `INSERT INTO project_mood (project_id, room, kind, swatch, label, sort_order)
     VALUES ($1, $2, 'swatch', $3, $4, $5)`,
    [project.id, boardRoom, hex, label.trim().slice(0, MAX_LABEL), await nextSort(project.id, boardRoom)],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export interface MoodLayoutPatch {
  id: number;
  x: number;
  y: number;
  w: number;
  /** null = auto height (as tall as the content). */
  h?: number | null;
  rot?: number;
  /** Crop focal point (0..1 across the hidden overflow) and zoom (1..MAX_ZOOM).
   *  0.5/0.5/1 is the untouched centre-cover crop every item starts with. */
  cropX?: number;
  cropY?: number;
  zoom?: number;
}

/** Persist canvas layout after a drag/resize/rotate. Positions are normalized
 *  0..1 and clamped server-side. Only the moved items are written, so two open
 *  tabs can't clobber each other's untouched items. `frontId` is raised to the
 *  top of the room's z-order (the item you just touched stays on top). */
export async function saveMoodLayout(
  slug: string,
  items: MoodLayoutPatch[],
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
    // A finite h sets an explicit height; null/undefined leaves it auto.
    const h =
      item.h === null || item.h === undefined || !Number.isFinite(item.h)
        ? null
        : clamp(item.h, MIN_H, MAX_H);
    // Scoped by project_id so an item id from another project can't be moved.
    await query(
      `UPDATE project_mood
          SET pos_x = $3, pos_y = $4, pos_w = $5, pos_h = $6, pos_rot = $7,
              crop_x = $8, crop_y = $9, crop_zoom = $10
        WHERE id = $1 AND project_id = $2`,
      [
        id,
        project.id,
        clamp(item.x, 0, MAX_XY),
        clamp(item.y, 0, MAX_XY),
        clamp(item.w, MIN_W, MAX_W),
        h,
        normRot(item.rot ?? 0),
        Number.isFinite(item.cropX) ? clamp(item.cropX as number, 0, 1) : 0.5,
        Number.isFinite(item.cropY) ? clamp(item.cropY as number, 0, 1) : 0.5,
        Number.isFinite(item.zoom) ? clamp(item.zoom as number, 1, MAX_ZOOM) : 1,
      ],
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

/** Explicit layering: send an item to the back of its board, or bring it to the
 *  front. Dragging already raises an item; this is the way to push one down. */
export async function reorderMoodItem(id: number, dir: "front" | "back"): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_mood m JOIN projects p ON p.id = m.project_id WHERE m.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Item not found." };

  const agg = dir === "front" ? "MAX(sort_order) + 1" : "MIN(sort_order) - 1";
  await query(
    `UPDATE project_mood m
        SET sort_order = (SELECT COALESCE(${agg}, 0)
                            FROM project_mood x
                           WHERE x.project_id = m.project_id AND x.room = m.room)
      WHERE m.id = $1`,
    [id],
  );
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Copy an item, offset slightly so the duplicate is visibly its own card and
 *  can be dragged off the original. */
export async function duplicateMoodItem(id: number): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string; project_id: string; room: string }>(
    `SELECT p.slug, m.project_id, m.room
       FROM project_mood m JOIN projects p ON p.id = m.project_id
      WHERE m.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Item not found." };
  if (await boardFull(row.project_id, row.room)) return { ok: false, error: "This board is full." };

  await query(
    `INSERT INTO project_mood
       (project_id, room, kind, image_file_id, catalog_id, label, price_label, swatch,
        note, pos_x, pos_y, pos_w, pos_h, pos_rot, crop_x, crop_y, crop_zoom, sort_order)
     SELECT project_id, room, kind, image_file_id, catalog_id, label, price_label, swatch,
            note,
            LEAST(COALESCE(pos_x, 0.04) + 0.03, $2::real),
            LEAST(COALESCE(pos_y, 0.05) + 0.03, $2::real),
            COALESCE(pos_w, 0.21), pos_h, pos_rot, crop_x, crop_y, crop_zoom,
            (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM project_mood x
              WHERE x.project_id = project_mood.project_id AND x.room = project_mood.room)
       FROM project_mood WHERE id = $1`,
    [id, MAX_XY],
  );
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Edit an item's note (owner only). */
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

/** Edit an item's caption — the words on a text block, or the display name over
 *  a swatch or a pin. */
export async function updateMoodLabel(id: number, label: string): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string; kind: string }>(
    `SELECT p.slug, m.kind FROM project_mood m JOIN projects p ON p.id = m.project_id WHERE m.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Item not found." };
  const clean = label.trim().slice(0, MAX_LABEL);
  // A text block IS its label — emptying it would leave an invisible card.
  if (!clean && row.kind === "text") return { ok: false, error: "Text can't be empty." };
  await query(`UPDATE project_mood SET label = $2 WHERE id = $1`, [id, clean]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Recolour a swatch chip. */
export async function updateMoodSwatch(id: number, color: string): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_mood m JOIN projects p ON p.id = m.project_id WHERE m.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Item not found." };
  const hex = cleanColor(color);
  if (!hex) return { ok: false, error: "Pick a colour first." };
  await query(`UPDATE project_mood SET swatch = $2 WHERE id = $1 AND kind = 'swatch'`, [id, hex]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Remove an item from a board (owner only). */
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

/** Create an empty board for a room. Without this a new room only existed in
 *  client state and vanished on reload until something was pinned to it. */
export async function createMoodBoard(slug: string, room: string): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };
  const clean = cleanRoom(room);
  if (!clean) return { ok: false, error: "Name the board first." };
  await ensureBoard(project.id, clean);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Board settings: display title and background colour. An empty bgColor
 *  restores the default dotted paper. */
export async function updateMoodBoard(
  slug: string,
  room: string,
  settings: { title?: string; bgColor?: string },
): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };
  const clean = cleanRoom(room);
  if (!clean) return { ok: false, error: "Board not found." };

  await ensureBoard(project.id, clean);
  await query(
    `UPDATE project_mood_boards
        SET title = COALESCE($3, title), bg_color = COALESCE($4, bg_color)
      WHERE project_id = $1 AND room = $2`,
    [
      project.id,
      clean,
      settings.title === undefined ? null : settings.title.trim().slice(0, MAX_LABEL),
      settings.bgColor === undefined ? null : cleanColor(settings.bgColor),
    ],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Rename a board. If a board already exists under the new name the two are
 *  merged — the pins move across and the now-duplicate settings row is dropped,
 *  which is friendlier than failing on a name the owner clearly wants. */
export async function renameMoodBoard(slug: string, from: string, to: string): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };
  const src = cleanRoom(from);
  const dst = cleanRoom(to);
  if (!src || !dst) return { ok: false, error: "Name the board first." };
  if (src === dst) return { ok: true };

  await ensureBoard(project.id, dst);
  // Move the pins first, then retire the old settings row. Re-sequence the
  // moved pins onto the end of the destination's z-order so two merged boards
  // don't end up with interleaved, colliding sort_order values.
  await query(
    `UPDATE project_mood m
        SET room = $3,
            sort_order = m.sort_order
              + COALESCE((SELECT MAX(x.sort_order) + 1 FROM project_mood x
                           WHERE x.project_id = m.project_id AND x.room = $3), 0)
      WHERE m.project_id = $1 AND m.room = $2`,
    [project.id, src, dst],
  );
  await query(`DELETE FROM project_mood_boards WHERE project_id = $1 AND room = $2`, [project.id, src]);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Delete a whole board and everything pinned to it. */
export async function deleteMoodBoard(slug: string, room: string): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };
  const clean = cleanRoom(room);
  if (!clean) return { ok: false, error: "Board not found." };
  await query(`DELETE FROM project_mood WHERE project_id = $1 AND room = $2`, [project.id, clean]);
  await query(`DELETE FROM project_mood_boards WHERE project_id = $1 AND room = $2`, [project.id, clean]);
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}
