import "server-only";

// Open Engine read layer: the work queue, status ledgers, and receipt trail.
// Writes live in lib/actions/engine.ts.

import { query } from "./db";
import type { WorkItemStatus, WorkItemPriority } from "./types";
import { bucketFor, type QueueBucket } from "./engine-constants";

export interface WorkItemView {
  id: string;
  title: string;
  body: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeKind: "human" | "agent";
  assigneeKey: string | null;
  dueAt: string | null;
  projectSlug: string | null;
  leadSlug: string | null;
  expectedSkillSlug: string | null;
  expectedRunbookSlug: string | null;
  requiresApproval: boolean;
  approvalRequested: boolean;
  blockedReason: string | null;
  createdAt: string;
  bucket: QueueBucket;
}

export interface StatusLedgerView {
  runtimeName: string;
  state: string;
  note: string;
  blockedReason: string | null;
  currentWorkItemTitle: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface ReceiptView {
  id: string;
  receiptKind: string;
  uri: string | null;
  label: string;
  runtimeName: string | null;
  createdAt: string;
}

export interface EngineData {
  items: WorkItemView[];
  buckets: Record<QueueBucket, WorkItemView[]>;
  ledgers: StatusLedgerView[];
  receipts: ReceiptView[];
  counts: { total: number; approval: number; waiting: number; active: number; queued: number };
}

interface WorkRow {
  id: string;
  title: string;
  body: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assignee_kind: "human" | "agent";
  assignee_key: string | null;
  due_at: string | null;
  project_slug: string | null;
  lead_slug: string | null;
  expected_skill_slug: string | null;
  expected_runbook_slug: string | null;
  requires_approval: boolean;
  approval_status: string;
  blocked_reason: string | null;
  created_at: string;
  lead_stage: string | null;
}

function rowToItem(r: WorkRow): WorkItemView {
  const approvalRequested = r.approval_status === "requested";
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    status: r.status,
    priority: r.priority,
    assigneeKind: r.assignee_kind,
    assigneeKey: r.assignee_key,
    dueAt: r.due_at,
    projectSlug: r.project_slug,
    leadSlug: r.lead_slug,
    expectedSkillSlug: r.expected_skill_slug,
    expectedRunbookSlug: r.expected_runbook_slug,
    requiresApproval: r.requires_approval,
    approvalRequested,
    blockedReason: r.blocked_reason,
    createdAt: r.created_at,
    bucket: bucketFor(r.status, approvalRequested),
  };
}

export async function getEngineData(): Promise<EngineData> {
  const [{ rows: work }, { rows: ledgers }, { rows: receipts }] = await Promise.all([
    query<WorkRow>(
      `SELECT w.id, w.title, w.body, w.status, w.priority, w.assignee_kind, w.assignee_key, w.due_at::text AS due_at,
              p.slug AS project_slug, l.slug AS lead_slug, w.expected_skill_slug, w.expected_runbook_slug,
              w.requires_approval, w.approval_status, w.blocked_reason, w.created_at::text AS created_at,
              l.stage AS lead_stage
         FROM work_items w
         LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN leads l ON l.id = w.lead_id
        WHERE (l.id IS NULL OR l.stage <> 'lost' OR w.status IN ('done','cancelled'))
        ORDER BY array_position(ARRAY['urgent','high','normal','low']::text[], w.priority),
                 w.due_at NULLS LAST, w.created_at DESC`,
    ),
    query<{
      runtime_name: string; state: string; note: string; blocked_reason: string | null;
      current_title: string | null; last_run_at: string | null; next_run_at: string | null;
    }>(
      `SELECT s.runtime_name, s.state, s.note, s.blocked_reason,
              w.title AS current_title, s.last_run_at::text AS last_run_at, s.next_run_at::text AS next_run_at
         FROM status_ledgers s
         LEFT JOIN work_items w ON w.id = s.current_work_item_id
        ORDER BY s.updated_at DESC`,
    ),
    query<{
      id: string; receipt_kind: string; uri: string | null; label: string;
      runtime_name: string | null; created_at: string;
    }>(
      `SELECT r.id, r.receipt_kind, r.uri, r.label, ar.runtime_name, r.created_at::text AS created_at
         FROM agent_receipts r
         LEFT JOIN agent_runs ar ON ar.id = r.agent_run_id
        ORDER BY r.created_at DESC
        LIMIT 20`,
    ),
  ]);

  const items = work.map(rowToItem);
  const buckets: Record<QueueBucket, WorkItemView[]> = { approval: [], active: [], waiting: [], queued: [], done: [] };
  for (const it of items) buckets[it.bucket].push(it);

  return {
    items,
    buckets,
    ledgers: ledgers.map((l) => ({
      runtimeName: l.runtime_name,
      state: l.state,
      note: l.note,
      blockedReason: l.blocked_reason,
      currentWorkItemTitle: l.current_title,
      lastRunAt: l.last_run_at,
      nextRunAt: l.next_run_at,
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      receiptKind: r.receipt_kind,
      uri: r.uri,
      label: r.label,
      runtimeName: r.runtime_name,
      createdAt: r.created_at,
    })),
    counts: {
      total: items.length,
      approval: buckets.approval.length,
      waiting: buckets.waiting.length,
      active: buckets.active.length,
      queued: buckets.queued.length,
    },
  };
}
