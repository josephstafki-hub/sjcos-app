import "server-only";

// Permit packets (Phase-7 deferred epic). Read side: the generated permit
// packets on file for a project (PERMIT-tagged rows in `files`, served via
// /api/files/[id]). Generation lives in lib/actions/permit.ts.

import { query } from "./db";

export interface PermitFile {
  id: string;
  name: string;
  subtitle: string | null;
  createdLabel: string;
}

/** Generated permit packets for a project, newest first. */
export async function getProjectPermits(slug: string): Promise<PermitFile[]> {
  const { rows } = await query<{ id: string; name: string; subtitle: string | null; created_label: string }>(
    `SELECT id, name, subtitle,
            to_char(created_at, 'FMMon FMDD, YYYY') AS created_label
       FROM files
      WHERE project_key = $1 AND tag LIKE 'PERMIT%' AND storage_path IS NOT NULL
      ORDER BY created_at DESC`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    subtitle: r.subtitle,
    createdLabel: r.created_label,
  }));
}
