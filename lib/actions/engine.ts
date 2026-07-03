"use server";

// Open Engine write paths. Owner-gated. Reads stay in lib/engine.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { WORK_STATUSES } from "@/lib/engine-constants";
import type { WorkItemStatus } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

export async function createWorkItem(formData: FormData): Promise<Result> {
  await requireRole("owner");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Title is required." };
  const body = String(formData.get("body") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "normal");
  const priority = ["low", "normal", "high", "urgent"].includes(priorityRaw) ? priorityRaw : "normal";
  const assigneeKey = String(formData.get("assignee_key") ?? "").trim() || null;
  const assigneeKind = assigneeKey && assigneeKey !== "human-joe" ? "agent" : "human";
  const dueAt = String(formData.get("due_at") ?? "").trim();
  const expectedSkill = String(formData.get("expected_skill_slug") ?? "").trim() || null;

  await query(
    `INSERT INTO work_items
       (title, body, priority, assignee_kind, assignee_key, due_at, expected_skill_slug, source_kind, created_by)
     VALUES ($1,$2,$3,$4,$5, NULLIF($6,'')::timestamptz, $7, 'manual', 'user')`,
    [title, body, priority, assigneeKind, assigneeKey, dueAt, expectedSkill],
  );
  revalidatePath("/engine");
  return { ok: true };
}

export async function setWorkItemStatus(id: string, status: WorkItemStatus, note?: string): Promise<Result> {
  await requireRole("owner");
  if (!WORK_STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
  await query(
    `UPDATE work_items
        SET status = $2,
            blocked_reason = CASE WHEN $2 IN ('blocked','waiting_on_human','waiting_on_client','waiting_on_sub')
                                  THEN $3 ELSE blocked_reason END,
            completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END
      WHERE id = $1`,
    [id, status, note ?? null],
  );
  revalidatePath("/engine");
  return { ok: true };
}

/** Approve a work item awaiting human approval → clears the gate, moves to queued. */
export async function approveWorkItem(id: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE work_items
        SET approval_status = 'approved',
            status = CASE WHEN status = 'approval_needed' THEN 'queued' ELSE status END
      WHERE id = $1`,
    [id],
  );
  revalidatePath("/engine");
  return { ok: true };
}

export async function rejectWorkItem(id: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE work_items SET approval_status = 'rejected', status = 'cancelled' WHERE id = $1`,
    [id],
  );
  revalidatePath("/engine");
  return { ok: true };
}
