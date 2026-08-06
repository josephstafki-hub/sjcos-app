// Floor-plan viewer builder (Review-round-3 S5E). DB-backed reads of
// project_floorplans — versioned plan files (image or PDF) with text notes.
// Viewer only; writes live in lib/actions/floorplans.ts. The owner streams
// files through /api/files; the client portal streams through the
// client-scoped /api/portal/floorplan route (keyed by version id).

import { query, queryOne } from "./db";

export interface FloorplanVersion {
  id: number;
  version: number;
  notes: string;
  fileUrl: string;
  isPdf: boolean;
  uploaded: string;
  /** Set when the client approved this version from their portal. */
  approvedName: string | null;
  approvedLabel: string | null;
}

interface FloorplanRow {
  id: number;
  version: number;
  notes: string;
  file_id: string;
  mime_type: string | null;
  uploaded: string;
  client_approved_name: string;
  approved_label: string | null;
}

async function loadFloorplans(
  slug: string,
  fileUrl: (r: FloorplanRow) => string,
): Promise<FloorplanVersion[]> {
  const { rows } = await query<FloorplanRow>(
    `SELECT fp.id, fp.version, fp.notes, fp.file_id,
            f.mime_type,
            to_char(fp.created_at, 'Mon FMDD, YYYY') AS uploaded,
            fp.client_approved_name,
            to_char(fp.client_approved_at, 'Mon FMDD, YYYY') AS approved_label
       FROM project_floorplans fp
       JOIN projects p ON p.id = fp.project_id
       LEFT JOIN files f ON f.id = fp.file_id
      WHERE p.slug = $1
      ORDER BY fp.version DESC`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    notes: r.notes,
    fileUrl: fileUrl(r),
    isPdf: (r.mime_type ?? "").includes("pdf"),
    uploaded: r.uploaded,
    approvedName: r.approved_label ? r.client_approved_name || null : null,
    approvedLabel: r.approved_label,
  }));
}

/** A project's floor-plan versions, newest first (owner view). */
export async function getProjectFloorplans(slug: string): Promise<FloorplanVersion[]> {
  return loadFloorplans(slug, (r) => `/api/files/${r.file_id}`);
}

/** Same versions for the client portal — files stream through the
 *  client-authorized route, keyed by the VERSION id (not file id) so the route
 *  can authorize by the parent project's slug vs. the client's linkSlug. */
export async function getClientFloorplans(slug: string): Promise<FloorplanVersion[]> {
  return loadFloorplans(slug, (r) => `/api/portal/floorplan/${r.id}`);
}

/** Resolve a version's file + project slug — used by the portal serve route to
 *  authorize and stream. Null when the version is missing. */
export async function resolveFloorplanFile(
  id: number,
): Promise<{ fileId: string; slug: string } | null> {
  const row = await queryOne<{ file_id: string; slug: string }>(
    `SELECT fp.file_id, p.slug
       FROM project_floorplans fp
       JOIN projects p ON p.id = fp.project_id
      WHERE fp.id = $1`,
    [id],
  );
  return row ? { fileId: row.file_id, slug: row.slug } : null;
}
