import "server-only";

// Per-record (lead/project) Open Brain + Engine read layer. Powers the "Ops" tab
// on each lead/project detail page: the scoped work queue, linked knowledge,
// proof-of-work receipts, and stage-gate guidance. Writes live in
// lib/actions/record-ops.ts.

import { query } from "./db";
import type { WorkItemStatus, WorkItemPriority, KnowledgeKind } from "./types";
import { detailBucketFor, type DetailBucket } from "./record-ops-buckets";

export type RecordKind = "lead" | "project";

export interface RecordWorkItem {
  id: string;
  title: string;
  body: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  dueAt: string | null;
  requiresApproval: boolean;
  approvalRequested: boolean;
  blockedReason: string | null;
  expectedSkillSlug: string | null;
  expectedRunbookSlug: string | null;
  bucket: DetailBucket;
}

export interface RecordKnowledge {
  id: string;
  content: string;
  kind: KnowledgeKind;
  source: string;
  sourceUri: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RecordReceipt {
  id: string;
  receiptKind: string;
  uri: string | null;
  label: string;
  runtimeName: string | null;
  workItemTitle: string | null;
  createdAt: string;
}

export interface StageGateStep {
  stage: string;
  phase: string | null;
  target: string | null;
  requirement: string;
}

export interface StageGate {
  kind: RecordKind;
  currentStatus: string;
  phase: string | null;
  nextStages: StageGateStep[];
}

export interface RecordOps {
  recordId: string;
  kind: RecordKind;
  slug: string;
  items: RecordWorkItem[];
  buckets: Record<DetailBucket, RecordWorkItem[]>;
  knowledge: RecordKnowledge[];
  receipts: RecordReceipt[];
  stageGate: StageGate;
  counts: { open: number; approval: number; knowledge: number; receipts: number };
}

interface WorkRow {
  id: string;
  title: string;
  body: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  due_at: string | null;
  requires_approval: boolean;
  approval_status: string;
  blocked_reason: string | null;
  expected_skill_slug: string | null;
  expected_runbook_slug: string | null;
}

/** Resolve the record's uuid + current official status from its slug. */
async function resolveRecord(kind: RecordKind, slug: string) {
  if (kind === "project") {
    const { rows } = await query<{ id: string; status: string }>(
      `SELECT id, status FROM projects WHERE slug = $1`,
      [slug],
    );
    return rows[0] ? { id: rows[0].id, status: rows[0].status } : null;
  }
  const { rows } = await query<{ id: string; stage: string }>(
    `SELECT id, stage FROM leads WHERE slug = $1`,
    [slug],
  );
  return rows[0] ? { id: rows[0].id, status: rows[0].stage } : null;
}

/** Compute stage-gate guidance from stage_rules: the requirements for the next
 *  likely business stage(s). Guidance only — the UI never blocks on it. */
async function computeStageGate(kind: RecordKind, currentStatus: string): Promise<StageGate> {
  const { rows } = await query<{
    stage: string; phase: string | null; sort_order: number; gate_requirements: string;
    maps_to_lead_stage: string | null; maps_to_project_status: string | null; is_terminal: boolean;
  }>(
    `SELECT stage, phase, sort_order, gate_requirements, maps_to_lead_stage,
            maps_to_project_status, is_terminal
       FROM stage_rules ORDER BY sort_order`,
  );

  // Current position = furthest business stage that maps to the current official
  // status. If the status isn't represented, start from the beginning.
  const currentRows = rows.filter((r) => (kind === "project" ? r.maps_to_project_status : r.maps_to_lead_stage) === currentStatus);
  const currentSort = currentRows.length ? Math.max(...currentRows.map((r) => r.sort_order)) : -1;
  const phase = currentRows.length ? currentRows[currentRows.length - 1].phase : null;

  const nextStages: StageGateStep[] = rows
    .filter((r) => r.sort_order > currentSort && !r.is_terminal)
    .slice(0, 3)
    .map((r) => ({
      stage: r.stage,
      phase: r.phase,
      target: kind === "project" ? r.maps_to_project_status : (r.maps_to_lead_stage ?? r.maps_to_project_status),
      requirement: r.gate_requirements,
    }));

  return { kind, currentStatus, phase, nextStages };
}

export async function getRecordOps(kind: RecordKind, slug: string): Promise<RecordOps | null> {
  const rec = await resolveRecord(kind, slug);
  if (!rec) return null;
  const col = kind === "project" ? "project_id" : "lead_id";

  const [{ rows: work }, { rows: know }, { rows: rcpt }, stageGate] = await Promise.all([
    query<WorkRow>(
      `SELECT id, title, body, status, priority, due_at::text AS due_at, requires_approval, approval_status,
              blocked_reason, expected_skill_slug, expected_runbook_slug
         FROM work_items
        WHERE ${col} = $1
        ORDER BY array_position(ARRAY['urgent','high','normal','low']::text[], priority),
                 due_at NULLS LAST, created_at DESC`,
      [rec.id],
    ),
    query<{
      id: string; content: string; kind: string; source: string; source_uri: string | null;
      created_by: string; created_at: string;
    }>(
      `SELECT id, content, kind, source, source_uri, created_by, created_at::text AS created_at
         FROM knowledge_items WHERE ${col} = $1 ORDER BY created_at DESC LIMIT 100`,
      [rec.id],
    ),
    query<{
      id: string; receipt_kind: string; uri: string | null; label: string;
      runtime_name: string | null; work_item_title: string | null; created_at: string;
    }>(
      `SELECT r.id, r.receipt_kind, r.uri, r.label, ar.runtime_name,
              w.title AS work_item_title, r.created_at::text AS created_at
         FROM agent_receipts r
         LEFT JOIN agent_runs ar ON ar.id = r.agent_run_id
         JOIN work_items w ON w.id = r.work_item_id
        WHERE w.${col} = $1
        ORDER BY r.created_at DESC LIMIT 20`,
      [rec.id],
    ),
    computeStageGate(kind, rec.status),
  ]);

  const items: RecordWorkItem[] = work.map((r) => {
    const approvalRequested = r.approval_status === "requested";
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      priority: r.priority,
      dueAt: r.due_at,
      requiresApproval: r.requires_approval,
      approvalRequested,
      blockedReason: r.blocked_reason,
      expectedSkillSlug: r.expected_skill_slug,
      expectedRunbookSlug: r.expected_runbook_slug,
      bucket: detailBucketFor(r.status, approvalRequested),
    };
  });

  const buckets = {
    approval: [], active: [], waiting_joe: [], waiting_client: [], waiting_sub: [], queued: [], done: [],
  } as Record<DetailBucket, RecordWorkItem[]>;
  for (const it of items) buckets[it.bucket].push(it);

  const knowledge: RecordKnowledge[] = know.map((k) => ({
    id: k.id, content: k.content, kind: k.kind as KnowledgeKind, source: k.source,
    sourceUri: k.source_uri, createdBy: k.created_by, createdAt: k.created_at,
  }));

  const receipts: RecordReceipt[] = rcpt.map((r) => ({
    id: r.id, receiptKind: r.receipt_kind, uri: r.uri, label: r.label,
    runtimeName: r.runtime_name, workItemTitle: r.work_item_title, createdAt: r.created_at,
  }));

  const open = items.filter((i) => i.bucket !== "done").length;
  return {
    recordId: rec.id,
    kind,
    slug,
    items,
    buckets,
    knowledge,
    receipts,
    stageGate,
    counts: { open, approval: buckets.approval.length, knowledge: knowledge.length, receipts: receipts.length },
  };
}
