import "server-only";

// Closeout reads (Phase-4). The Closeout project tab lists generated closeout
// documents (completion certificate + lien waiver PDFs, stored as files tagged
// CLOSEOUT) and the lien-waiver signature status. Writes live in
// lib/actions/closeout.ts.

import { query, queryOne } from "./db";

export interface CloseoutDoc {
  id: string;
  name: string;
  kind: string; // "Completion certificate" / "Lien waiver"
  when: string;
}

export interface CloseoutView {
  docs: CloseoutDoc[];
  lienWaiverStatus: string | null; // signature_request status, if one exists
  outreachSent: boolean;
}

export async function getCloseoutView(slug: string): Promise<CloseoutView> {
  const { rows } = await query<{ id: string; name: string; tag: string; when_label: string }>(
    `SELECT id, name, tag, to_char(created_at, 'Mon FMDD, YYYY') AS when_label
       FROM files
      WHERE project_key = $1 AND tag LIKE 'CLOSEOUT%' AND storage_path IS NOT NULL
      ORDER BY created_at DESC`,
    [slug],
  );
  const docs = rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.tag.includes("Lien") ? "Lien waiver" : "Completion certificate",
    when: r.when_label,
  }));

  const waiver = await queryOne<{ status: string }>(
    `SELECT sr.status FROM signature_requests sr
       JOIN projects p ON p.id = sr.project_id
      WHERE p.slug = $1 AND sr.doc_type = 'lien_waiver'
      ORDER BY sr.created_at DESC LIMIT 1`,
    [slug],
  );

  const outreach = await queryOne<{ v: boolean }>(
    `SELECT (closeout_outreach_at IS NOT NULL) AS v FROM projects WHERE slug = $1`,
    [slug],
  );

  return {
    docs,
    lienWaiverStatus: waiver?.status ?? null,
    outreachSent: outreach?.v ?? false,
  };
}
