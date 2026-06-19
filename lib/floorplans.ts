// Floor-plan viewer builder (Review-round-3 S5E). DB-backed reads of
// project_floorplans — versioned plan files (image or PDF) with text notes.
// Viewer only; writes live in lib/actions/floorplans.ts. Owner-only; files
// stream through the owner-only /api/files route.

import { query } from "./db";

export interface FloorplanVersion {
  id: number;
  version: number;
  notes: string;
  fileUrl: string;
  isPdf: boolean;
  uploaded: string;
}

interface FloorplanRow {
  id: number;
  version: number;
  notes: string;
  file_id: string;
  mime_type: string | null;
  uploaded: string;
}

/** A project's floor-plan versions, newest first. */
export async function getProjectFloorplans(slug: string): Promise<FloorplanVersion[]> {
  const { rows } = await query<FloorplanRow>(
    `SELECT fp.id, fp.version, fp.notes, fp.file_id,
            f.mime_type,
            to_char(fp.created_at, 'Mon FMDD, YYYY') AS uploaded
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
    fileUrl: `/api/files/${r.file_id}`,
    isPdf: (r.mime_type ?? "").includes("pdf"),
    uploaded: r.uploaded,
  }));
}
