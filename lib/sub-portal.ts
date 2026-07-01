// Sub portal data builder. Standalone surface a subcontractor sees (no SJC OS
// sidebar). The job/scope header stays curated showcase; the sub's daily logs +
// submitted invoices (Functional-audit item 6) are real, DB-backed.

import { query, queryOne } from "./db";

export interface SubPortalData {
  subName: string;
  subInitials: string;
  trade: string;
  job: string;
  jobChips: { label: string; kind: "accent" | "ghost"; dot?: boolean }[];
  scope: string[];
  materials: { label: string; verified: boolean }[];
  watchout: { title: string; detail: string };
  money: { label: string; value: string; good?: boolean }[];
  paperwork: string[];
  joePhone: string;
}

export async function getSubPortalData(): Promise<SubPortalData> {
  return {
    subName: "Marco Rivas",
    subInitials: "MR",
    trade: "Tile",
    job: "Henderson kitchen",
    jobChips: [
      { label: "1:00 – EOD · tile install", kind: "accent", dot: true },
      { label: "2317 Sheridan Ave S · Edina", kind: "ghost" },
      { label: "code 4429", kind: "ghost" },
    ],
    scope: [
      "Lay cement board across kitchen floor — full area 178 sq ft",
      "Set Calacatta floor pattern per plan (random length)",
      "Install backsplash 2×8 zellige · cut around outlet boxes",
      "Watch threshold transition at pantry — see Friday QC note",
    ],
    materials: [
      { label: "Calacatta floor · 5 boxes", verified: true },
      { label: "Zellige backsplash · 4 boxes", verified: true },
      { label: "Thinset + cement board", verified: true },
    ],
    watchout: {
      title: "Watch-out · soft spot at pantry threshold",
      detail: "Joe flagged Friday. Bring self-leveler just in case.",
    },
    money: [
      { label: "Total scope", value: "$8,400" },
      { label: "Paid (50%)", value: "$4,200", good: true },
      { label: "Pay on completion", value: "$4,200" },
    ],
    paperwork: ["COI · expires Aug 14", "W-9 on file", "Sub agreement signed"],
    joePhone: "(612) 555-0117",
  };
}

// ─── Real sub-portal records (logs + submitted invoices) ─────────────────────

export type SubInvoiceStatus = "submitted" | "approved" | "paid";

export interface SubLogEntry {
  id: number;
  body: string;
  hasPhoto: boolean;
  projectName: string | null;
  when: string;
}

export interface SubInvoiceEntry {
  id: number;
  amount: number;
  note: string;
  status: SubInvoiceStatus;
  projectName: string | null;
  when: string;
}

/** The sub's real scope + scheduled dates on their current assignment (6-scope),
 *  or null when unassigned. Read-only on the sub portal. */
export interface SubAssignment {
  projectName: string;
  role: string;
  scope: string;
  dateLabel: string; // "" when no dates set
}

export async function getSubAssignment(subSlug: string): Promise<SubAssignment | null> {
  const row = await queryOne<{
    project_name: string;
    role_label: string;
    scope_text: string;
    date_label: string | null;
  }>(
    `SELECT p.name AS project_name, ps.role_label, ps.scope_text,
            CASE
              WHEN ps.start_date IS NOT NULL AND ps.end_date IS NOT NULL
                THEN to_char(ps.start_date, 'Mon FMDD') || ' – ' || to_char(ps.end_date, 'Mon FMDD')
              WHEN ps.start_date IS NOT NULL THEN 'Starts ' || to_char(ps.start_date, 'Mon FMDD')
              WHEN ps.end_date   IS NOT NULL THEN 'Due ' || to_char(ps.end_date, 'Mon FMDD')
              ELSE NULL
            END AS date_label
       FROM project_subs ps JOIN projects p ON p.id = ps.project_id
      WHERE ps.sub_slug = $1
      ORDER BY ps.assigned_at DESC LIMIT 1`,
    [subSlug],
  );
  if (!row) return null;
  return {
    projectName: row.project_name,
    role: row.role_label,
    scope: row.scope_text,
    dateLabel: row.date_label ?? "",
  };
}

/** The sub's current project (most recently assigned), or null when unassigned. */
export async function getSubCurrentProject(
  subSlug: string,
): Promise<{ id: string; name: string } | null> {
  return queryOne<{ id: string; name: string }>(
    `SELECT p.id, p.name
       FROM project_subs ps JOIN projects p ON p.id = ps.project_id
      WHERE ps.sub_slug = $1
      ORDER BY ps.assigned_at DESC LIMIT 1`,
    [subSlug],
  );
}

/** A sub's recent daily logs (newest first). */
export async function getSubLogs(subSlug: string): Promise<SubLogEntry[]> {
  const { rows } = await query<{
    id: number;
    body: string;
    photo_file_id: string | null;
    project_name: string | null;
    when_label: string;
  }>(
    `SELECT l.id, l.body, l.photo_file_id, p.name AS project_name,
            to_char(l.created_at, 'Mon FMDD · FMHH12:MI AM') AS when_label
       FROM sub_logs l LEFT JOIN projects p ON p.id = l.project_id
      WHERE l.sub_slug = $1
      ORDER BY l.created_at DESC LIMIT 20`,
    [subSlug],
  );
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    hasPhoto: !!r.photo_file_id,
    projectName: r.project_name,
    when: r.when_label,
  }));
}

/** A sub's submitted invoices (newest first). */
export async function getSubInvoices(subSlug: string): Promise<SubInvoiceEntry[]> {
  const { rows } = await query<{
    id: number;
    amount: number;
    note: string;
    status: SubInvoiceStatus;
    project_name: string | null;
    when_label: string;
  }>(
    `SELECT i.id, i.amount, i.note, i.status, p.name AS project_name,
            to_char(i.created_at, 'Mon FMDD') AS when_label
       FROM sub_invoices i LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.sub_slug = $1
      ORDER BY i.created_at DESC LIMIT 20`,
    [subSlug],
  );
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    note: r.note,
    status: r.status,
    projectName: r.project_name,
    when: r.when_label,
  }));
}
