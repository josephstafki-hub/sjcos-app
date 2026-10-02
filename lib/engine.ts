import "server-only";

// Open Engine read layer: the work queue, status ledgers, and receipt trail.
// Writes live in lib/actions/engine.ts.

import { query } from "./db";
import type { WorkItemStatus, WorkItemPriority } from "./types";
import { bucketFor, type QueueBucket } from "./engine-constants";
import { toAssigned, type AssignedTo } from "./queue-scope";
import { ASSIGNEES_JOIN_SQL } from "./work-item-assignees.mjs";
import { queueFilterSql, type QueueFilter } from "./engine-views";

export interface WorkItemView {
  id: string;
  title: string;
  body: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeKind: "human" | "agent";
  assigneeKey: string | null;
  /** The PEOPLE on this to-do — the owner included when he's on it alongside
   *  someone. Empty = the owner's own. Separate from assigneeKey, which names a
   *  bot runtime (hermes-telegram, …). */
  assignedTo: AssignedTo[];
  dueAt: string | null;
  projectSlug: string | null;
  projectName: string | null;
  leadSlug: string | null;
  leadName: string | null;
  expectedSkillSlug: string | null;
  expectedRunbookSlug: string | null;
  requiresApproval: boolean;
  approvalRequested: boolean;
  blockedReason: string | null;
  /** Who filed it: "inbox-cron", "claude-in-app", "detector:…", "user", … */
  createdBy: string;
  createdAt: string;
  /** Set = off the board, in the Archived view (done/cancelled only). */
  archivedAt: string | null;
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
  /** Everything on the board — archived items are not loaded (see
   *  getArchivedWorkItems). */
  items: WorkItemView[];
  buckets: Record<QueueBucket, WorkItemView[]>;
  ledgers: StatusLedgerView[];
  receipts: ReceiptView[];
  counts: { total: number; approval: number; waiting: number; active: number; queued: number; archived: number };
  /** Owner (first) + active staff — the people a to-do can be put on. */
  assignees: AssignedTo[];
  /** Whose to-do "nobody on it" means. Null only if there's no active owner. */
  ownerId: string | null;
}

interface WorkRow {
  id: string;
  title: string;
  body: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assignee_kind: "human" | "agent";
  assignee_key: string | null;
  assigned: AssignedTo[] | null;
  due_at: string | null;
  project_slug: string | null;
  project_name: string | null;
  lead_slug: string | null;
  lead_name: string | null;
  expected_skill_slug: string | null;
  expected_runbook_slug: string | null;
  requires_approval: boolean;
  approval_status: string;
  blocked_reason: string | null;
  created_by: string;
  created_at: string;
  archived_at: string | null;
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
    assignedTo: toAssigned(r.assigned),
    dueAt: r.due_at,
    projectSlug: r.project_slug,
    projectName: r.project_name,
    leadSlug: r.lead_slug,
    leadName: r.lead_name,
    expectedSkillSlug: r.expected_skill_slug,
    expectedRunbookSlug: r.expected_runbook_slug,
    requiresApproval: r.requires_approval,
    approvalRequested,
    blockedReason: r.blocked_reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    bucket: bucketFor(r.status, approvalRequested),
  };
}

const WORK_SELECT = `
       SELECT w.id, w.title, w.body, w.status, w.priority, w.assignee_kind, w.assignee_key, w.due_at::text AS due_at,
              p.slug AS project_slug, p.name AS project_name, l.slug AS lead_slug, l.name AS lead_name,
              w.expected_skill_slug, w.expected_runbook_slug,
              w.requires_approval, w.approval_status, w.blocked_reason, w.created_by,
              w.created_at::text AS created_at, w.archived_at::text AS archived_at,
              asg.assigned
         FROM work_items w
         LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN leads l ON l.id = w.lead_id${ASSIGNEES_JOIN_SQL}`;

export async function getEngineData(): Promise<EngineData> {
  const [{ rows: work }, { rows: ledgers }, { rows: receipts }, { rows: people }, { rows: archived }] = await Promise.all([
    query<WorkRow>(
      `${WORK_SELECT}
        WHERE w.archived_at IS NULL
          AND (l.id IS NULL OR l.stage <> 'lost' OR w.status IN ('done','cancelled'))
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
    // Who a to-do can be handed to (same roster as Today's card picker):
    // the owner plus every active staff login. Portal roles never appear.
    query<{ id: string; name: string; initials: string; role: string }>(
      `SELECT id, name, initials, role FROM users
        WHERE active AND role IN ('owner','staff')
        ORDER BY (role = 'owner') DESC, name`,
    ),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM work_items WHERE archived_at IS NOT NULL`),
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
      archived: archived[0]?.n ?? 0,
    },
    assignees: people.map((p) => ({ userId: p.id, name: p.name, initials: p.initials || "?" })),
    ownerId: people.find((p) => p.role === "owner")?.id ?? null,
  };
}

export const ARCHIVE_PAGE = 50;

/** One page of the Archived view, most recently archived first, narrowed by
 *  the same folder + filters as the board (lib/engine-views.ts). */
export async function getArchivedWorkItems(
  filter: QueueFilter,
  offset: number,
): Promise<{ items: WorkItemView[]; hasMore: boolean }> {
  const owner = await query<{ id: string }>(
    `SELECT id FROM users WHERE active AND role = 'owner' ORDER BY created_at LIMIT 1`,
  );
  const params: unknown[] = [];
  const conds = ["w.archived_at IS NOT NULL", ...queueFilterSql(filter, owner.rows[0]?.id ?? null, params)];
  params.push(ARCHIVE_PAGE + 1, Math.max(0, Math.floor(offset)));
  const { rows } = await query<WorkRow>(
    `${WORK_SELECT}
      WHERE ${conds.join("\n        AND ")}
      ORDER BY w.archived_at DESC, w.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.slice(0, ARCHIVE_PAGE).map(rowToItem), hasMore: rows.length > ARCHIVE_PAGE };
}
