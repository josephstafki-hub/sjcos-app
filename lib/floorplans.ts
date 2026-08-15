// Floor-plan viewer builder (Review-round-3 S5E). DB-backed reads of
// project_floorplans — versioned plan files (image or PDF) with text notes.
// Viewer only; writes live in lib/actions/floorplans.ts. The owner streams
// files through /api/files; the client portal streams through the
// client-scoped /api/portal/floorplan route (keyed by version id).
//
// A version reaches the client only once the owner publishes it
// (published_at) — the client read filters here, and the portal serve route
// re-checks via resolveFloorplanFile so an unpublished version's id can't be
// guessed.

import { query, queryOne } from "./db";

export interface FloorplanVersion {
  id: number;
  version: number;
  notes: string;
  fileUrl: string;
  isPdf: boolean;
  uploaded: string;
  /** Owner published this version to the client dashboard. */
  published: boolean;
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
  published_at: Date | null;
  client_approved_name: string;
  approved_label: string | null;
}

async function loadFloorplans(
  slug: string,
  fileUrl: (r: FloorplanRow) => string,
  publishedOnly = false,
): Promise<FloorplanVersion[]> {
  const { rows } = await query<FloorplanRow>(
    `SELECT fp.id, fp.version, fp.notes, fp.file_id,
            f.mime_type,
            to_char(fp.created_at, 'Mon FMDD, YYYY') AS uploaded,
            fp.published_at,
            fp.client_approved_name,
            to_char(fp.client_approved_at, 'Mon FMDD, YYYY') AS approved_label
       FROM project_floorplans fp
       JOIN projects p ON p.id = fp.project_id
       LEFT JOIN files f ON f.id = fp.file_id
      WHERE p.slug = $1${publishedOnly ? " AND fp.published_at IS NOT NULL" : ""}
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
    published: r.published_at !== null,
    approvedName: r.approved_label ? r.client_approved_name || null : null,
    approvedLabel: r.approved_label,
  }));
}

/** A project's floor-plan versions, newest first (owner view — everything). */
export async function getProjectFloorplans(slug: string): Promise<FloorplanVersion[]> {
  return loadFloorplans(slug, (r) => `/api/files/${r.file_id}`);
}

/** Published versions for the client portal — files stream through the
 *  client-authorized route, keyed by the VERSION id (not file id) so the route
 *  can authorize by the parent project's slug vs. the client's linkSlug. */
export async function getClientFloorplans(slug: string): Promise<FloorplanVersion[]> {
  return loadFloorplans(slug, (r) => `/api/portal/floorplan/${r.id}`, true);
}

/** Resolve a version's file + project slug + publish state — used by the portal
 *  serve route to authorize and stream. Null when the version is missing. */
export async function resolveFloorplanFile(
  id: number,
): Promise<{ fileId: string; slug: string; published: boolean } | null> {
  const row = await queryOne<{ file_id: string; slug: string; published_at: Date | null }>(
    `SELECT fp.file_id, p.slug, fp.published_at
       FROM project_floorplans fp
       JOIN projects p ON p.id = fp.project_id
      WHERE fp.id = $1`,
    [id],
  );
  return row ? { fileId: row.file_id, slug: row.slug, published: row.published_at !== null } : null;
}
