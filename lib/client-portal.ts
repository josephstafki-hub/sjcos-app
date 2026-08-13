// Client portal data builder. Standalone surface a client sees (no SJC OS
// sidebar). The journal + status + money are built from the client's REAL
// project (daily logs, stage, invoices) — no demo content.

import { query, queryOne } from "./db";
import { requireRole } from "./dal";
import type { ChipKind } from "@/components/ui";
import type { ProjectDetail, ProjectLog } from "./projects";

/** What a portal session is scoped to: a project, or — during the lead stage —
 *  a lead. users.link_slug carries 'lead:<slug>' for the latter. */
export interface PortalScope {
  kind: "project" | "lead";
  slug: string;
}

/** Parse a client's link_slug into its scope. Null for no link at all. */
export function parseLinkSlug(linkSlug: string | null): PortalScope | null {
  if (!linkSlug) return null;
  return linkSlug.startsWith("lead:")
    ? { kind: "lead", slug: linkSlug.slice("lead:".length) }
    : { kind: "project", slug: linkSlug };
}

/** Gate + scope for every portal page: the signed-in client's project or lead,
 *  or null for an owner previewing with no linked scope (pages render their
 *  empty states). requireRole redirects anyone else. getCurrentUser is
 *  request-cached, so the layout and page sharing this costs one session read. */
export async function portalScope(): Promise<PortalScope | null> {
  const user = await requireRole("owner", "client");
  return user.role === "client" ? parseLinkSlug(user.linkSlug) : null;
}

/** The client's PROJECT slug, or null (owner preview, or a lead-stage session).
 *  Project-only portal pages (plans, mood, selections, money, schedule) key off
 *  this and show their empty states during the lead stage. */
export async function portalSlug(): Promise<string | null> {
  const scope = await portalScope();
  return scope?.kind === "project" ? scope.slug : null;
}

/** A file the client uploaded through their portal. */
export interface ClientUpload {
  id: string;
  name: string;
  isImage: boolean;
  when: string;
}

/** Files the client uploaded (client_slug scoped), newest first. Served to the
 *  client via /api/portal/project-file/[id]. */
export async function getClientUploads(slug: string): Promise<ClientUpload[]> {
  const { rows } = await query<{ id: string; name: string; type: string; when_label: string }>(
    `SELECT id, name, type, to_char(created_at, 'Mon FMDD') AS when_label
       FROM files WHERE client_slug = $1
      ORDER BY created_at DESC LIMIT 30`,
    [slug],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, isImage: r.type === "img", when: r.when_label }));
}

/** Per-section attention counts for the portal nav badges. One round trip —
 *  the layout renders on every portal page, so this stays a single cheap read. */
export interface PortalBadges {
  /** Selections awaiting the client's decision. */
  decisions: number;
  /** Signature requests sitting at 'sent'. */
  toSign: number;
  /** Invoices sent and unpaid. */
  due: number;
  /** Punch items marked done, awaiting the client's confirmation. */
  confirm: number;
}

export const EMPTY_PORTAL_BADGES: PortalBadges = { decisions: 0, toSign: 0, due: 0, confirm: 0 };

/** Badges for either scope. Lead-stage sessions only have documents to sign —
 *  everything else (selections, invoices, punch) is project machinery. */
export async function getPortalBadgesForScope(scope: PortalScope): Promise<PortalBadges> {
  if (scope.kind === "project") return getPortalBadges(scope.slug);
  const row = await query<{ to_sign: number }>(
    `SELECT count(*)::int AS to_sign FROM signature_requests
      WHERE lead_slug = $1 AND status = 'sent'`,
    [scope.slug],
  );
  return { ...EMPTY_PORTAL_BADGES, toSign: row.rows[0]?.to_sign ?? 0 };
}

export async function getPortalBadges(slug: string): Promise<PortalBadges> {
  const row = await query<{ decisions: number; to_sign: number; due: number; confirm: number }>(
    `SELECT
       (SELECT count(*)::int FROM project_selections s
          JOIN projects p ON p.id = s.project_id
         WHERE p.slug = $1 AND s.status = 'pending')       AS decisions,
       (SELECT count(*)::int FROM signature_requests sr
         WHERE sr.status = 'sent'
           AND (sr.project_id = (SELECT id FROM projects WHERE slug = $1)
                OR sr.lead_slug = (SELECT l.slug FROM leads l
                                     JOIN projects p2 ON p2.lead_id = l.id
                                    WHERE p2.slug = $1)))   AS to_sign,
       (SELECT count(*)::int FROM invoices i
          JOIN projects p ON p.id = i.project_id
         WHERE p.slug = $1 AND i.status = 'sent')           AS due,
       (SELECT count(*)::int FROM project_punch pp
          JOIN projects p ON p.id = pp.project_id
         WHERE p.slug = $1 AND pp.done = true
           AND pp.client_confirmed_at IS NULL)              AS confirm`,
    [slug],
  );
  const r = row.rows[0];
  return {
    decisions: r?.decisions ?? 0,
    toSign: r?.to_sign ?? 0,
    due: r?.due ?? 0,
    confirm: r?.confirm ?? 0,
  };
}

/** A document draft the owner published to the dashboard. */
export interface SharedDoc {
  id: number;
  title: string;
  /** files.id of the rendered PDF, served via /api/portal/project-file. */
  pdfFileId: string | null;
  when: string;
}

/** The slug of the lead a project was converted from, or null. Used so
 *  everything shared during the lead stage stays on the dashboard after
 *  conversion — the scope changes, the history shouldn't. */
export async function originLeadSlug(projectSlug: string): Promise<string | null> {
  const row = await queryOne<{ slug: string }>(
    `SELECT l.slug FROM leads l JOIN projects p ON p.lead_id = l.id WHERE p.slug = $1`,
    [projectSlug],
  );
  return row?.slug ?? null;
}

/** Published document drafts for a scope (newest first). Only drafts with a
 *  rendered PDF are listed — a publish without a file would be a dead link.
 *  A project scope includes drafts from its originating lead. */
export async function getSharedDocs(scope: PortalScope): Promise<SharedDoc[]> {
  const originLead = scope.kind === "project" ? await originLeadSlug(scope.slug) : null;
  const where =
    scope.kind === "project"
      ? `(d.project_id = (SELECT id FROM projects WHERE slug = $1)
          OR ($2::text IS NOT NULL AND d.lead_slug = $2))`
      : `d.lead_slug = $1`;
  const params: unknown[] = scope.kind === "project" ? [scope.slug, originLead] : [scope.slug];
  const { rows } = await query<{ id: string; title: string; pdf_file_id: string | null; when_label: string }>(
    `SELECT d.id, d.title, d.pdf_file_id,
            to_char(d.created_at, 'Mon FMDD, YYYY') AS when_label
       FROM document_drafts d
      WHERE ${where} AND d.client_visible = true AND d.status <> 'void'
        AND d.pdf_file_id IS NOT NULL
      ORDER BY d.created_at DESC`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    pdfFileId: r.pdf_file_id,
    when: r.when_label,
  }));
}

/** A file the owner published to the dashboard. */
export interface SharedFile {
  id: string;
  name: string;
  isImage: boolean;
  sizeLabel: string;
  when: string;
}

/** Owner-published files for a scope (files.client_visible), newest first.
 *  A project scope includes files from its originating lead. */
export async function getSharedFiles(scope: PortalScope): Promise<SharedFile[]> {
  const originLead = scope.kind === "project" ? await originLeadSlug(scope.slug) : null;
  const where =
    scope.kind === "project"
      ? `(project_key = $1 OR ($2::text IS NOT NULL AND lead_slug = $2))`
      : `lead_slug = $1`;
  const params: unknown[] = scope.kind === "project" ? [scope.slug, originLead] : [scope.slug];
  const { rows } = await query<{
    id: string;
    name: string;
    type: string;
    size_label: string;
    when_label: string;
  }>(
    `SELECT id, name, type, size_label, to_char(created_at, 'Mon FMDD, YYYY') AS when_label
       FROM files
      WHERE ${where} AND client_visible = true AND storage_path IS NOT NULL
      ORDER BY created_at DESC`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isImage: r.type === "img",
    sizeLabel: r.size_label,
    when: r.when_label,
  }));
}

export interface JournalEntry {
  date: string;
  title: string;
  body: string;
  /** Number of photo tiles to show. */
  photos: number;
}

export interface ClientPortalData {
  project: string;
  clientInitials: string;
  greeting: string;
  statusChips: { label: string; kind: ChipKind; dot?: boolean }[];
  entries: JournalEntry[];
}

/** Build the client journal + header from the client's REAL project and daily
 *  logs. Pure (no DB) — the page fetches the project + logs and passes them in. */
export function buildClientPortalData(
  project: ProjectDetail | null,
  logs: ProjectLog[],
): ClientPortalData {
  const entries: JournalEntry[] = logs.slice(0, 12).map((l, i) => ({
    date: (i === 0 ? "LATEST · " : "") + l.dateLabel.toUpperCase(),
    title: "",
    body: l.body,
    photos: 0, // photo blobs aren't served to the portal yet — no placeholder tiles
  }));

  return {
    project: project?.name ?? "Your project",
    clientInitials: "—",
    greeting: project
      ? "Here's where your project stands."
      : "Welcome to your project portal.",
    statusChips: project?.statusChips ?? [],
    entries,
  };
}
