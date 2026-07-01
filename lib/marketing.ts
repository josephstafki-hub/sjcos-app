import "server-only";

// Marketing reads (Phase-6 P6-2). The /marketing screen lists AI-drafted social +
// blog posts; the owner edits, copies, and marks them posted (manual posting —
// no social API). Writes stay in lib/actions/marketing.ts.

import { query } from "./db";
import { DRAFT_KIND_LABEL, type DraftKind } from "./marketing-types";

export interface MarketingDraft {
  id: number;
  kind: DraftKind;
  kindLabel: string;
  title: string;
  body: string;
  status: "draft" | "posted";
  projectName: string | null;
  createdLabel: string;
}

export async function getMarketingDrafts(): Promise<MarketingDraft[]> {
  const { rows } = await query<{
    id: number;
    kind: DraftKind;
    title: string;
    body: string;
    status: "draft" | "posted";
    project_name: string | null;
    created_label: string;
  }>(
    `SELECT d.id, d.kind, d.title, d.body, d.status, p.name AS project_name,
            to_char(d.created_at, 'Mon FMDD, YYYY') AS created_label
       FROM marketing_drafts d
       LEFT JOIN projects p ON p.id = d.project_id
      ORDER BY d.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    kindLabel: DRAFT_KIND_LABEL[r.kind] ?? "Post",
    title: r.title,
    body: r.body,
    status: r.status,
    projectName: r.project_name,
    createdLabel: r.created_label,
  }));
}

/** Projects the owner can draft a post about (for the /marketing picker). */
export async function getMarketingProjectOptions(): Promise<{ slug: string; name: string }[]> {
  const { rows } = await query<{ slug: string; name: string }>(
    `SELECT slug, name FROM projects ORDER BY (status IN ('closeout','warranty')) DESC, updated_at DESC`,
  );
  return rows;
}
