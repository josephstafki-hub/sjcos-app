"use server";

// Per-record (lead/project) Open Engine + Brain write paths. Owner-gated. Every
// mutation also drops a proof-of-work receipt (agent_receipts) so the status
// ledger / receipt trail is populated by real business actions, and revalidates
// the record's detail page plus the central /engine board. Reads live in
// lib/record-ops.ts.

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { WORK_STATUSES } from "@/lib/engine-constants";
import type { WorkItemStatus } from "@/lib/types";
import type { RecordKind } from "@/lib/record-ops";

type Result = { ok: true } | { ok: false; error: string };

function recordPath(kind: RecordKind, slug: string) {
  return kind === "project" ? `/projects/${slug}` : `/leads/${slug}`;
}

function revalidateRecord(kind: RecordKind, slug: string) {
  revalidatePath(recordPath(kind, slug));
  revalidatePath("/engine");
}

/** Append a proof-of-work receipt. Safe internal audit only. */
async function writeReceipt(receiptKind: string, label: string, workItemId: string | null, uri?: string | null) {
  await query(
    `INSERT INTO agent_receipts (receipt_kind, label, work_item_id, uri, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [receiptKind, label.slice(0, 300), workItemId, uri ?? null],
  );
}

/** Move a work item's status from its detail page, logging a receipt. */
export async function setRecordWorkItemStatus(
  id: string,
  status: WorkItemStatus,
  kind: RecordKind,
  slug: string,
  note?: string,
): Promise<Result> {
  await requireRole("owner");
  if (!WORK_STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
  const { rows } = await query<{ title: string }>(
    `UPDATE work_items
        SET status = $2,
            blocked_reason = CASE WHEN $2 IN ('blocked','waiting_on_human','waiting_on_client','waiting_on_sub')
                                  THEN $3 ELSE blocked_reason END,
            completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END
      WHERE id = $1
      RETURNING title`,
    [id, status, note ?? null],
  );
  if (!rows[0]) return { ok: false, error: "Work item not found." };
  const receiptKind = status === "done" ? "work_item_completed" : "status_change";
  await writeReceipt(receiptKind, `${rows[0].title} → ${status}`, id);
  revalidateRecord(kind, slug);
  return { ok: true };
}

export async function approveRecordWorkItem(id: string, kind: RecordKind, slug: string): Promise<Result> {
  await requireRole("owner");
  const { rows } = await query<{ title: string }>(
    `UPDATE work_items
        SET approval_status = 'approved',
            status = CASE WHEN status = 'approval_needed' THEN 'queued' ELSE status END
      WHERE id = $1 RETURNING title`,
    [id],
  );
  if (!rows[0]) return { ok: false, error: "Work item not found." };
  await writeReceipt("approval", `Approved: ${rows[0].title}`, id);
  revalidateRecord(kind, slug);
  return { ok: true };
}

export async function rejectRecordWorkItem(id: string, kind: RecordKind, slug: string): Promise<Result> {
  await requireRole("owner");
  const { rows } = await query<{ title: string }>(
    `UPDATE work_items SET approval_status = 'rejected', status = 'cancelled' WHERE id = $1 RETURNING title`,
    [id],
  );
  if (!rows[0]) return { ok: false, error: "Work item not found." };
  await writeReceipt("rejection", `Rejected: ${rows[0].title}`, id);
  revalidateRecord(kind, slug);
  return { ok: true };
}

/** Add a work item attached to this lead/project. */
export async function addRecordWorkItem(formData: FormData): Promise<Result> {
  await requireRole("owner");
  const kind = String(formData.get("kind") ?? "") as RecordKind;
  const slug = String(formData.get("slug") ?? "");
  const recordId = String(formData.get("record_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!recordId || (kind !== "lead" && kind !== "project")) return { ok: false, error: "Missing record." };
  if (!title) return { ok: false, error: "Title is required." };
  const body = String(formData.get("body") ?? "").trim();
  const dueAt = String(formData.get("due_at") ?? "").trim();
  const col = kind === "project" ? "project_id" : "lead_id";
  const { rows } = await query<{ id: string }>(
    `INSERT INTO work_items (title, body, ${col}, due_at, source_kind, created_by)
     VALUES ($1, $2, $3, NULLIF($4,'')::timestamptz, 'manual', 'user') RETURNING id`,
    [title, body, recordId, dueAt],
  );
  await writeReceipt("work_item_created", `New work item: ${title}`, rows[0].id);
  revalidateRecord(kind, slug);
  return { ok: true };
}

/** Capture a durable knowledge item scoped to this lead/project. */
export async function captureRecordKnowledge(formData: FormData): Promise<Result> {
  await requireRole("owner");
  const kind = String(formData.get("kind") ?? "") as RecordKind;
  const slug = String(formData.get("slug") ?? "");
  const recordId = String(formData.get("record_id") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  if (!recordId || (kind !== "lead" && kind !== "project")) return { ok: false, error: "Missing record." };
  if (!content) return { ok: false, error: "Note is required." };
  const knowledgeKind = String(formData.get("knowledge_kind") ?? "note").trim() || "note";
  const col = kind === "project" ? "project_id" : "lead_id";
  // Fingerprint scoped to the record so the same note on two jobs isn't deduped.
  const fp = createHash("md5").update(`${kind}:${recordId}:${content}`).digest("hex");
  await query(
    `INSERT INTO knowledge_items (content, kind, source, ${col}, content_fingerprint, created_by)
     VALUES ($1, $2, 'manual', $3, $4, 'user')
     ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO NOTHING`,
    [content, knowledgeKind, recordId, fp],
  );
  revalidateRecord(kind, slug);
  return { ok: true };
}
