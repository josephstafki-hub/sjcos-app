import "server-only";

// Safety reads (Phase-4 P4-4 orientations, P4-5 incidents). The owner Safety tab
// lists AI-generated orientations (with who's acknowledged) + logged incidents;
// the sub portal shows orientations for the sub's current project. Writes live in
// lib/actions/safety.ts.

import { query } from "./db";
import { getSubCurrentProject } from "./sub-portal";
import { SEVERITY_LABEL, type IncidentSeverity } from "./incident-types";

export interface SafetyOrientation {
  id: number;
  trade: string;
  body: string;
  createdLabel: string;
  ackCount: number;
  ackNames: string[];
}

/** Orientations for a project, with acknowledgment counts + who acknowledged. */
export async function getProjectOrientations(slug: string): Promise<SafetyOrientation[]> {
  const { rows } = await query<{
    id: number;
    trade: string;
    body: string;
    created_label: string;
    ack_count: number;
    ack_names: string[] | null;
  }>(
    `SELECT o.id, o.trade, o.body,
            to_char(o.created_at, 'Mon FMDD, YYYY') AS created_label,
            count(a.sub_slug)::int AS ack_count,
            array_remove(array_agg(s.name), NULL) AS ack_names
       FROM safety_orientations o
       JOIN projects p ON p.id = o.project_id
       LEFT JOIN safety_acknowledgments a ON a.orientation_id = o.id
       LEFT JOIN subs s ON s.slug = a.sub_slug
      WHERE p.slug = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    trade: r.trade,
    body: r.body,
    createdLabel: r.created_label,
    ackCount: r.ack_count,
    ackNames: r.ack_names ?? [],
  }));
}

export interface IncidentReport {
  id: number;
  occurredLabel: string | null;
  reporter: string;
  severity: IncidentSeverity;
  severityLabel: string;
  narrative: string;
  fileId: string | null;
  createdLabel: string;
}

/** Incident reports for a project (newest first). */
export async function getProjectIncidents(slug: string): Promise<IncidentReport[]> {
  const { rows } = await query<{
    id: number;
    occurred_label: string | null;
    reporter: string;
    severity: IncidentSeverity;
    narrative: string;
    file_id: string | null;
    created_label: string;
  }>(
    `SELECT i.id, to_char(i.occurred_at, 'Mon FMDD, YYYY') AS occurred_label,
            i.reporter, i.severity, i.narrative, i.file_id,
            to_char(i.created_at, 'Mon FMDD, YYYY') AS created_label
       FROM incident_reports i JOIN projects p ON p.id = i.project_id
      WHERE p.slug = $1
      ORDER BY i.created_at DESC`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    occurredLabel: r.occurred_label,
    reporter: r.reporter,
    severity: r.severity,
    severityLabel: SEVERITY_LABEL[r.severity] ?? r.severity,
    narrative: r.narrative,
    fileId: r.file_id,
    createdLabel: r.created_label,
  }));
}

export interface SubOrientation {
  id: number;
  trade: string;
  body: string;
  acknowledged: boolean;
  projectName: string;
}

/** Orientations for the sub's current project + whether this sub acknowledged
 *  each. Empty when the sub is unassigned. */
export async function getSubOrientations(subSlug: string): Promise<SubOrientation[]> {
  const project = await getSubCurrentProject(subSlug);
  if (!project) return [];
  const { rows } = await query<{ id: number; trade: string; body: string; acked: boolean }>(
    `SELECT o.id, o.trade, o.body,
            (a.sub_slug IS NOT NULL) AS acked
       FROM safety_orientations o
       LEFT JOIN safety_acknowledgments a
         ON a.orientation_id = o.id AND a.sub_slug = $2
      WHERE o.project_id = $1
      ORDER BY o.created_at DESC`,
    [project.id, subSlug],
  );
  return rows.map((r) => ({
    id: r.id,
    trade: r.trade,
    body: r.body,
    acknowledged: r.acked,
    projectName: project.name,
  }));
}
