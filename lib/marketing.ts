import "server-only";

// Marketing reads (Phase-6 P6-2). The /marketing screen lists AI-drafted social +
// blog posts; the owner edits, copies, and marks them posted (manual posting —
// no social API). Writes stay in lib/actions/marketing.ts.

import { normalizeMarketingCopy } from "./marketing-copy";
import { query } from "./db";
import { DRAFT_KIND_LABEL, type DraftKind } from "./marketing-types";

export interface MarketingDraft {
  id: number;
  kind: DraftKind;
  kindLabel: string;
  title: string;
  body: string;
  copyError?: string;
  status: "draft" | "posted";
  projectName: string | null;
  projectSlug: string | null;
  createdLabel: string;
  /** The job's photos; `shareable` = the client OK'd sharing it (publication_rights). */
  photos: { id: string; name: string; shareable: boolean }[];
}

export async function getMarketingDrafts(): Promise<MarketingDraft[]> {
  const { rows } = await query<{
    id: number;
    kind: DraftKind;
    title: string;
    body: string;
    status: "draft" | "posted";
    project_name: string | null;
    project_slug: string | null;
    project_id: string | null;
    created_label: string;
  }>(
    `SELECT d.id, d.kind, d.title, d.body, d.status, p.name AS project_name, p.slug AS project_slug, p.id AS project_id,
            to_char(d.created_at, 'Mon FMDD, YYYY') AS created_label
       FROM marketing_drafts d
       LEFT JOIN projects p ON p.id = d.project_id
      ORDER BY d.created_at DESC`,
  );
  // Each job's photos and whether the client OK'd sharing them: Joe posts by
  // hand, so the card gives him the shareable photos to download with the text.
  const slugs = [...new Set(rows.map((r) => r.project_slug).filter((x): x is string => Boolean(x)))];
  const photosBySlug = new Map<string, { id: string; name: string; shareable: boolean }[]>();
  if (slugs.length) {
    const { rows: pics } = await query<{ id: string; name: string; project_key: string; shareable: boolean }>(
      `SELECT f.id, f.name, f.project_key,
              EXISTS (SELECT 1 FROM publication_rights r WHERE r.file_id = f.id AND r.withdrawn_at IS NULL) AS shareable
         FROM files f WHERE f.type = 'img' AND f.storage_path IS NOT NULL AND f.project_key = ANY($1::text[])
        ORDER BY f.created_at DESC`,
      [slugs],
    );
    for (const p of pics) {
      const list = photosBySlug.get(p.project_key) ?? [];
      if (list.length < 24) list.push({ id: p.id, name: p.name, shareable: p.shareable });
      photosBySlug.set(p.project_key, list);
    }
  }
  return rows.map((r) => {
    const copy = normalizeMarketingCopy(r.body);
    return {
      id: r.id,
      kind: r.kind,
      kindLabel: DRAFT_KIND_LABEL[r.kind] ?? "Post",
      title: copy.title ?? r.title,
      body: copy.body,
      ...(!copy.body ? {copyError: "This draft could not be read. Replace it with your copy or generate a new draft."} : {}),
      status: r.status,
      projectName: r.project_name,
      projectSlug: r.project_slug,
      createdLabel: r.created_label,
      photos: r.project_slug ? (photosBySlug.get(r.project_slug) ?? []) : [],
    };
  });
}

/** Projects the owner can draft a post about (for the /marketing picker). */
export async function getMarketingProjectOptions(): Promise<{ slug: string; name: string }[]> {
  const { rows } = await query<{ slug: string; name: string }>(
    `SELECT slug, name FROM projects ORDER BY (status IN ('closeout','warranty')) DESC, updated_at DESC`,
  );
  return rows;
}
