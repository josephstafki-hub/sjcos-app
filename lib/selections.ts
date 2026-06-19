// Selections board builder (Review-round-3 S5C). DB-backed reads of the
// project_selections table for the project Selections tab (owner) and the
// client portal (approve/decline). The selection image is either its own
// upload or inherited from the linked catalog item. Writes live in
// lib/actions/selections.ts.

import { query } from "./db";

export type SelectionStatus = "draft" | "pending" | "approved" | "declined";

export interface Selection {
  id: number;
  area: string;
  choice: string;
  status: SelectionStatus;
  /** True when an image (own upload or catalog) is resolvable. */
  hasImage: boolean;
  /** Image URL appropriate to the audience (owner vs client route). */
  imageUrl: string | null;
}

interface SelectionRow {
  id: number;
  area: string;
  choice: string;
  status: SelectionStatus;
  image_file_id: string | null;
  catalog_image: string | null;
}

const SELECT = `
  SELECT s.id, s.area, s.choice, s.status, s.image_file_id,
         c.image_file_id AS catalog_image
    FROM project_selections s
    LEFT JOIN catalog_items c ON c.id = s.catalog_id
    JOIN projects p ON p.id = s.project_id`;

/** Resolved file id for a row: its own upload wins, else the catalog image. */
function imageIdOf(r: SelectionRow): string | null {
  return r.image_file_id ?? r.catalog_image;
}

/** Owner board: every selection, images served via the owner-only /api/files. */
export async function getProjectSelections(slug: string): Promise<Selection[]> {
  const { rows } = await query<SelectionRow>(
    `${SELECT} WHERE p.slug = $1 ORDER BY s.sort_order, s.id`,
    [slug],
  );
  return rows.map((r) => {
    const fileId = imageIdOf(r);
    return {
      id: r.id,
      area: r.area,
      choice: r.choice,
      status: r.status,
      hasImage: !!fileId,
      imageUrl: fileId ? `/api/files/${fileId}` : null,
    };
  });
}

/** Client portal: only pushed selections (pending/approved/declined). Images go
 *  through the client-scoped portal route, keyed by selection id. */
export async function getClientSelections(slug: string): Promise<Selection[]> {
  const { rows } = await query<SelectionRow>(
    `${SELECT} WHERE p.slug = $1 AND s.status <> 'draft' ORDER BY s.sort_order, s.id`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    area: r.area,
    choice: r.choice,
    status: r.status,
    hasImage: !!imageIdOf(r),
    imageUrl: imageIdOf(r) ? `/api/portal/selection-image/${r.id}` : null,
  }));
}

/** Resolve the displayable file id for a selection (own upload or catalog),
 *  plus its project slug — used by the client-scoped image route to authorize
 *  and stream. Returns null when the selection or image is missing. */
export async function resolveSelectionImage(
  id: number,
): Promise<{ fileId: string; slug: string } | null> {
  const { rows } = await query<{ image_file_id: string | null; catalog_image: string | null; slug: string }>(
    `SELECT s.image_file_id, c.image_file_id AS catalog_image, p.slug
       FROM project_selections s
       LEFT JOIN catalog_items c ON c.id = s.catalog_id
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const fileId = r.image_file_id ?? r.catalog_image;
  return fileId ? { fileId, slug: r.slug } : null;
}
