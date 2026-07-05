// Sub portal data builder. Standalone surface a subcontractor sees (no SJC OS
// sidebar). Everything a sub sees is real: their identity + COI from the subs
// row, current assignment scope/dates, daily logs, and submitted invoices.

import { query, queryOne } from "./db";
import { SUB_DOC_LABEL, type SubDocType } from "./sub-doc-types";

export { SUB_DOC_LABEL };
export type { SubDocType };

/** The owner's contact phone (Settings → Profile), for the sub's "Talk to Joe"
 *  card. Null when unset. */
export async function getOwnerPhone(): Promise<string | null> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'profile.phone'`,
  );
  return row?.value?.trim() || null;
}

// ─── Sub compliance documents (6-docs) ───────────────────────────────────────

export interface SubDocEntry {
  id: number;
  docType: SubDocType;
  docLabel: string;
  fileId: string | null;
  expiresLabel: string | null;
  when: string;
}

/** A sub's uploaded compliance documents (newest first). */
export async function getSubDocuments(subSlug: string): Promise<SubDocEntry[]> {
  const { rows } = await query<{
    id: number;
    doc_type: SubDocType;
    file_id: string | null;
    expires_label: string | null;
    when_label: string;
  }>(
    `SELECT id, doc_type, file_id,
            to_char(expires_at, 'Mon FMDD, YYYY') AS expires_label,
            to_char(created_at, 'Mon FMDD') AS when_label
       FROM sub_documents WHERE sub_slug = $1
      ORDER BY created_at DESC LIMIT 30`,
    [subSlug],
  );
  return rows.map((r) => ({
    id: r.id,
    docType: r.doc_type,
    docLabel: SUB_DOC_LABEL[r.doc_type] ?? "Document",
    fileId: r.file_id,
    expiresLabel: r.expires_label,
    when: r.when_label,
  }));
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
