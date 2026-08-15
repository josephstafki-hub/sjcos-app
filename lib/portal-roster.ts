// Owner-side view of a client's portal: what they've uploaded and what's
// currently published to them. Feeds the "Client portal" tab on the lead and
// project detail pages (Uploads + Published sections). Server-only.

import { query } from "./db";
import type { PortalScope } from "./client-portal";
import { getSharedDocs, getSharedFiles, originLeadSlug, type SharedDoc, type SharedFile } from "./client-portal";
import type { ProjectFile } from "./projects";

const ABS = (col: string) => `to_char(${col} AT TIME ZONE 'America/Chicago', 'Mon FMDD, FMHH12:MIam')`;

/** Files the client uploaded through their portal, for a scope. A project
 *  scope includes uploads from its lead stage (whether or not the row has been
 *  re-keyed yet). Same shape as the Files tab rows so ProjectFiles renders it. */
export async function getClientUploadsForOwner(scope: PortalScope): Promise<ProjectFile[]> {
  const originLead = scope.kind === "project" ? await originLeadSlug(scope.slug) : null;
  const where =
    scope.kind === "project"
      ? `(f.project_key = $1 OR ($2::text IS NOT NULL AND f.lead_slug = $2))`
      : `f.lead_slug = $1`;
  const params: unknown[] = scope.kind === "project" ? [scope.slug, originLead] : [scope.slug];
  const { rows } = await query<{
    id: string;
    name: string;
    type: "doc" | "img" | "folder";
    size_label: string;
    modified_label: string;
    client_visible: boolean;
    subtitle: string;
    uploaded_label: string;
    from_lead: boolean;
  }>(
    `SELECT f.id, f.name, f.type, f.size_label, f.modified_label, f.client_visible,
            COALESCE(NULLIF(f.subtitle, ''), f.tag, '') AS subtitle,
            ${ABS("f.created_at")} AS uploaded_label,
            (f.project_key IS DISTINCT FROM $1) AS from_lead
       FROM files f
      WHERE f.storage_path IS NOT NULL AND f.client_slug IS NOT NULL AND ${where}
      ORDER BY f.created_at DESC`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    sizeLabel: r.size_label,
    modifiedLabel: r.modified_label,
    clientVisible: r.client_visible,
    clientUpload: true,
    subtitle: r.subtitle,
    uploadedLabel: r.uploaded_label,
    fromLead: scope.kind === "project" && r.from_lead,
  }));
}

export interface PublishedBoard {
  room: string;
  title: string;
  publishedLabel: string;
  approvedLabel: string | null;
  approvedName: string;
}

export interface PublishedPlan {
  id: number;
  version: number;
  publishedLabel: string;
  approvedLabel: string | null;
  approvedName: string;
}

export interface PushedSelection {
  id: number;
  area: string;
  status: string;
  pushedLabel: string;
  decidedLabel: string | null;
  choice: string;
}

export interface PublishedRoster {
  files: SharedFile[];
  docs: SharedDoc[];
  boards: PublishedBoard[];
  plans: PublishedPlan[];
  selections: PushedSelection[];
  /** Sum of everything above — for the section header. */
  total: number;
}

/** Everything the owner has put in front of the client right now. Lead scopes
 *  only have files + docs (boards/plans/selections are project machinery). */
export async function getPublishedRoster(scope: PortalScope): Promise<PublishedRoster> {
  const [files, docs] = await Promise.all([getSharedFiles(scope), getSharedDocs(scope)]);
  if (scope.kind === "lead") {
    return { files, docs, boards: [], plans: [], selections: [], total: files.length + docs.length };
  }
  const [boards, plans, selections] = await Promise.all([
    query<{ room: string; title: string; published_label: string; approved_label: string | null; approved_name: string }>(
      `SELECT b.room, b.title, ${ABS("b.published_at")} AS published_label,
              ${ABS("b.client_approved_at")} AS approved_label, b.client_approved_name AS approved_name
         FROM project_mood_boards b JOIN projects p ON p.id = b.project_id
        WHERE p.slug = $1 AND b.published_at IS NOT NULL
        ORDER BY b.published_at DESC`,
      [scope.slug],
    ),
    query<{ id: number; version: number; published_label: string; approved_label: string | null; approved_name: string }>(
      `SELECT f.id, f.version, ${ABS("f.published_at")} AS published_label,
              ${ABS("f.client_approved_at")} AS approved_label, f.client_approved_name AS approved_name
         FROM project_floorplans f JOIN projects p ON p.id = f.project_id
        WHERE p.slug = $1 AND f.published_at IS NOT NULL
        ORDER BY f.version DESC`,
      [scope.slug],
    ),
    query<{ id: number; area: string; status: string; pushed_label: string; decided_label: string | null; choice: string }>(
      `SELECT s.id, s.area, s.status, ${ABS("s.pushed_at")} AS pushed_label,
              ${ABS("s.decided_at")} AS decided_label, COALESCE(s.choice, '') AS choice
         FROM project_selections s JOIN projects p ON p.id = s.project_id
        WHERE p.slug = $1 AND s.pushed_at IS NOT NULL
        ORDER BY s.pushed_at DESC`,
      [scope.slug],
    ),
  ]);
  const b = boards.rows.map((r) => ({
    room: r.room,
    title: r.title,
    publishedLabel: r.published_label,
    approvedLabel: r.approved_label,
    approvedName: r.approved_name,
  }));
  const pl = plans.rows.map((r) => ({
    id: Number(r.id),
    version: r.version,
    publishedLabel: r.published_label,
    approvedLabel: r.approved_label,
    approvedName: r.approved_name,
  }));
  const sel = selections.rows.map((r) => ({
    id: Number(r.id),
    area: r.area,
    status: r.status,
    pushedLabel: r.pushed_label,
    decidedLabel: r.decided_label,
    choice: r.choice,
  }));
  return {
    files,
    docs,
    boards: b,
    plans: pl,
    selections: sel,
    total: files.length + docs.length + b.length + pl.length + sel.length,
  };
}
