// Client portal data builder. Standalone surface a client sees (no SJC OS
// sidebar). The journal + status + money are built from the client's REAL
// project (daily logs, stage, invoices) — no demo content.

import { query } from "./db";
import { requireRole } from "./dal";
import type { ChipKind } from "@/components/ui";
import type { ProjectDetail, ProjectLog } from "./projects";

/** Gate + scope for every portal page: the signed-in client's project slug, or
 *  null for an owner previewing with no linked project (pages render their
 *  empty states). requireRole redirects anyone else. getCurrentUser is
 *  request-cached, so the layout and page sharing this costs one session read. */
export async function portalSlug(): Promise<string | null> {
  const user = await requireRole("owner", "client");
  return user.role === "client" ? user.linkSlug : null;
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

export async function getPortalBadges(slug: string): Promise<PortalBadges> {
  const row = await query<{ decisions: number; to_sign: number; due: number; confirm: number }>(
    `SELECT
       (SELECT count(*)::int FROM project_selections s
          JOIN projects p ON p.id = s.project_id
         WHERE p.slug = $1 AND s.status = 'pending')       AS decisions,
       (SELECT count(*)::int FROM signature_requests sr
          JOIN projects p ON p.id = sr.project_id
         WHERE p.slug = $1 AND sr.status = 'sent')          AS to_sign,
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
