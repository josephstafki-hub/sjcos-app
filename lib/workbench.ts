import "server-only";

// Operator Console · live entity workbench (spec §4). Read-only. Resolves a
// Today-queue subject id to the lead/project/warranty record the agent is
// working, and builds a header-field + event-timeline snapshot. The timeline is
// a read-time UNION over lead_activity + agent_receipts + agent_runs — zero DDL,
// auto-populated by everything agents already do. NO writes anywhere here.

import { query, queryOne } from "@/lib/db";
import { relativeAge } from "@/lib/lead-activity";
import { stageLabel } from "@/lib/leads";
import { projectStageLabel } from "@/lib/projects";
import type { LeadStage, ProjectStatus } from "@/lib/types";

export type EntityRef =
  | { kind: "lead"; slug: string }
  | { kind: "project"; slug: string }
  | { kind: "warranty"; id: string };

export interface WorkbenchEvent {
  id: string;
  source: "lead_activity" | "agent_receipt" | "agent_run";
  kind: string;
  summary: string;
  actor: string;
  createdAt: string;
  when: string;
}

export interface WorkbenchField {
  label: string;
  value: string;
}

export interface WorkbenchSnapshot {
  ref: EntityRef;
  title: string;
  subtitle: string;
  href: string;
  fields: WorkbenchField[];
  openWorkItems: { id: string; title: string; status: string }[];
  events: WorkbenchEvent[];
  fetchedAt: string;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Map a Today queue id (work_items uuid OR synthetic "lead:slug" /
 *  "warranty:{id}" / "job:slug" / …) to the entity the workbench should show.
 *  Null = nothing to show (compliance:/schedule:/all-clear, or an unlinked
 *  work item). Synthetic-id formats come from lib/today.ts. */
export async function resolveEntityRef(subjectId: string): Promise<EntityRef | null> {
  if (subjectId.startsWith("lead:")) return { kind: "lead", slug: subjectId.slice(5) };
  if (subjectId.startsWith("warranty:")) return { kind: "warranty", id: subjectId.slice(9) };
  if (subjectId.startsWith("job:")) return { kind: "project", slug: subjectId.slice(4) };
  if (subjectId.includes(":")) return null; // compliance:/schedule:/all-clear
  if (!UUID_RE.test(subjectId)) return null;
  const row = await queryOne<{ lead_slug: string | null; project_slug: string | null }>(
    `SELECT l.slug AS lead_slug, p.slug AS project_slug
       FROM work_items w
       LEFT JOIN leads l    ON l.id = w.lead_id
       LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.id = $1`,
    [subjectId],
  );
  if (!row) return null;
  if (row.lead_slug) return { kind: "lead", slug: row.lead_slug };
  if (row.project_slug) return { kind: "project", slug: row.project_slug };
  return null;
}

interface RawEvent {
  id: string;
  source: string;
  kind: string;
  summary: string;
  actor: string;
  created_at: string;
}

function toEvent(r: RawEvent): WorkbenchEvent {
  const secs = Math.max(0, Math.round((Date.now() - new Date(r.created_at).getTime()) / 1000));
  return {
    id: r.id,
    source: r.source as WorkbenchEvent["source"],
    kind: r.kind,
    summary: r.summary,
    actor: r.actor,
    createdAt: r.created_at,
    when: relativeAge(secs),
  };
}

/** Events for a lead: its activity log + receipts/runs on any of its work items. */
async function leadEvents(leadId: string): Promise<WorkbenchEvent[]> {
  const { rows } = await query<RawEvent>(
    `SELECT * FROM (
       SELECT 'lead_activity:' || a.id AS id, 'lead_activity' AS source, a.kind,
              a.summary, a.actor, a.created_at
         FROM lead_activity a
        WHERE a.lead_id = $1
       UNION ALL
       SELECT 'receipt:' || r.id, 'agent_receipt', r.receipt_kind,
              COALESCE(NULLIF(r.label, ''), r.receipt_kind), 'agent', r.created_at
         FROM agent_receipts r
         JOIN work_items w ON w.id = r.work_item_id
        WHERE w.lead_id = $1
       UNION ALL
       SELECT 'run:' || ar.id, 'agent_run', ar.status,
              COALESCE(NULLIF(ar.output_summary, ''), NULLIF(ar.input_summary, ''), ar.runtime_name),
              ar.runtime_name, ar.started_at
         FROM agent_runs ar
         JOIN work_items w ON w.id = ar.work_item_id
        WHERE w.lead_id = $1
     ) ev
     ORDER BY ev.created_at DESC
     LIMIT 30`,
    [leadId],
  );
  return rows.map(toEvent);
}

/** Events for a project: receipts/runs on its work items, plus (if the project
 *  came from a lead) that lead's precon activity. */
async function projectEvents(projectId: string, leadId: string | null): Promise<WorkbenchEvent[]> {
  const { rows } = await query<RawEvent>(
    `SELECT * FROM (
       SELECT 'receipt:' || r.id AS id, 'agent_receipt' AS source, r.receipt_kind AS kind,
              COALESCE(NULLIF(r.label, ''), r.receipt_kind), 'agent' AS actor, r.created_at
         FROM agent_receipts r
         JOIN work_items w ON w.id = r.work_item_id
        WHERE w.project_id = $1
       UNION ALL
       SELECT 'run:' || ar.id, 'agent_run', ar.status,
              COALESCE(NULLIF(ar.output_summary, ''), NULLIF(ar.input_summary, ''), ar.runtime_name),
              ar.runtime_name, ar.started_at
         FROM agent_runs ar
         JOIN work_items w ON w.id = ar.work_item_id
        WHERE w.project_id = $1
       UNION ALL
       SELECT 'lead_activity:' || a.id, 'lead_activity', a.kind, a.summary, a.actor, a.created_at
         FROM lead_activity a
        WHERE $2::uuid IS NOT NULL AND a.lead_id = $2::uuid
     ) ev
     ORDER BY ev.created_at DESC
     LIMIT 30`,
    [projectId, leadId],
  );
  return rows.map(toEvent);
}

async function openWorkItems(
  column: "lead_id" | "project_id",
  id: string,
): Promise<{ id: string; title: string; status: string }[]> {
  const { rows } = await query<{ id: string; title: string; status: string }>(
    `SELECT id, title, status FROM work_items
      WHERE ${column} = $1 AND status NOT IN ('done','cancelled')
      ORDER BY updated_at DESC LIMIT 10`,
    [id],
  );
  return rows;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export async function getWorkbenchSnapshot(ref: EntityRef): Promise<WorkbenchSnapshot | null> {
  const fetchedAt = new Date().toISOString();

  if (ref.kind === "lead") {
    const l = await queryOne<{
      id: string; name: string; stage: LeadStage; flag_label: string | null;
      last_contact_at: string | null; value_display: string | null; scope: string;
      email: string | null; phone: string | null;
    }>(
      `SELECT id, name, stage, flag_label, last_contact_at, value_display, scope, email, phone
         FROM leads WHERE slug = $1`,
      [ref.slug],
    );
    if (!l) return null;
    const lastContact = l.last_contact_at
      ? relativeAge(Math.max(0, Math.round((Date.now() - new Date(l.last_contact_at).getTime()) / 1000)))
      : "—";
    return {
      ref,
      title: l.name,
      subtitle: `${stageLabel(l.stage)} · lead`,
      href: `/leads/${ref.slug}`,
      fields: [
        { label: "Stage", value: stageLabel(l.stage) },
        { label: "Flag", value: l.flag_label ?? "—" },
        { label: "Last contact", value: lastContact },
        { label: "Value", value: l.value_display ?? "—" },
        { label: "Scope", value: l.scope || "—" },
        { label: "Email", value: l.email ?? "—" },
        { label: "Phone", value: l.phone ?? "—" },
      ],
      openWorkItems: await openWorkItems("lead_id", l.id),
      events: await leadEvents(l.id),
      fetchedAt,
    };
  }

  if (ref.kind === "project") {
    const p = await queryOne<{
      id: string; name: string; status: ProjectStatus; client_name: string;
      contract_value: number; value_display: string | null; collected_to_date: number;
      progress: number; stage_label: string | null; target_end_date: string | null; lead_id: string | null;
    }>(
      `SELECT id, name, status, client_name, contract_value, value_display,
              collected_to_date, progress, stage_label, target_end_date, lead_id
         FROM projects WHERE slug = $1`,
      [ref.slug],
    );
    if (!p) return null;
    return {
      ref,
      title: p.name,
      subtitle: `${p.client_name || "—"} · ${projectStageLabel(p.status)}`,
      href: `/projects/${ref.slug}`,
      fields: [
        { label: "Status", value: projectStageLabel(p.status) },
        { label: "Stage label", value: p.stage_label ?? "—" },
        { label: "Progress", value: `${p.progress}%` },
        { label: "Contract", value: p.value_display ?? money(p.contract_value) },
        { label: "Collected", value: money(p.collected_to_date) },
        { label: "Target end", value: p.target_end_date ?? "—" },
      ],
      openWorkItems: await openWorkItems("project_id", p.id),
      events: await projectEvents(p.id, p.lead_id),
      fetchedAt,
    };
  }

  // warranty
  const c = await queryOne<{
    id: string; project: string; client: string; issue: string; step: string | null;
    resolved: boolean; opened_at: string; project_id: string | null;
    ack_deadline_at: string | null; resolve_deadline_at: string | null; acknowledged: boolean;
  }>(
    `SELECT id, project, client, issue, step, resolved, opened_at, project_id,
            ack_deadline_at, resolve_deadline_at, acknowledged
       FROM warranty_claims WHERE id = $1`,
    [ref.id],
  );
  if (!c) return null;
  const projEvents = c.project_id ? await projectEvents(c.project_id, null) : [];
  const claimEvent: WorkbenchEvent = {
    id: `claim:${c.id}`,
    source: "lead_activity",
    kind: "claim",
    summary: c.issue,
    actor: c.client,
    createdAt: c.opened_at,
    when: relativeAge(Math.max(0, Math.round((Date.now() - new Date(c.opened_at).getTime()) / 1000))),
  };
  return {
    ref,
    title: c.issue.length > 60 ? `${c.issue.slice(0, 60)}…` : c.issue,
    subtitle: `${c.client} · warranty claim`,
    href: "/warranty",
    fields: [
      { label: "Project", value: c.project },
      { label: "Client", value: c.client },
      { label: "Acknowledged", value: c.acknowledged ? "yes" : "no" },
      { label: "Ack deadline", value: c.ack_deadline_at ?? "—" },
      { label: "Resolve deadline", value: c.resolve_deadline_at ?? "—" },
      { label: "Step", value: c.step ?? "—" },
      { label: "Resolved", value: c.resolved ? "yes" : "no" },
    ],
    openWorkItems: c.project_id ? await openWorkItems("project_id", c.project_id) : [],
    events: [claimEvent, ...projEvents].slice(0, 30),
    fetchedAt,
  };
}
