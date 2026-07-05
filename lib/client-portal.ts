// Client portal data builder. Standalone surface a client sees (no SJC OS
// sidebar). The journal + status + money are built from the client's REAL
// project (daily logs, stage, invoices) — no demo content.

import { query } from "./db";
import type { ChipKind } from "@/components/ui";
import type { ProjectDetail, ProjectLog } from "./projects";

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
