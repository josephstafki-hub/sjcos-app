"use server";

// Open Engine write paths. Owner-gated. Reads stay in lib/engine.ts.

import { revalidatePath } from "next/cache";
import { captureAgentMemory } from "@/lib/agent-memory";
import { reopenApprovalAfterFailedSend, sendApprovedClientDraft } from "@/lib/approved-draft-send";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { WORK_STATUSES } from "@/lib/engine-constants";
import { notifyAgentOwner } from "@/lib/dev-agents";
import { maybeAdvanceRunbook, cancelRunbookInstance } from "@/lib/runbook-engine";
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
            completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END,
            updated_at = now()
      WHERE id = $1`,
    [id, status, note ?? null],
  );
  await maybeAdvanceRunbook(id); // W6: no-op unless this is a runbook step
  revalidatePath("/engine");
  revalidatePath("/today");
  return { ok: true };
}

/** Approve a work item awaiting human approval → clears the gate, moves to queued,
 *  and (for agent-owned items) actively pings the owner agent to go complete it. */
export async function approveWorkItem(id: string): Promise<Result> {
  await requireRole("owner");
  const { rows } = await query<{
    title: string;
    body: string;
    assignee_key: string | null;
    lead_slug: string | null;
    project_slug: string | null;
  }>(
    `UPDATE work_items w
        SET approval_status = 'approved',
            status = CASE WHEN status = 'approval_needed' THEN 'queued' ELSE status END
      WHERE id = $1
      RETURNING title, body, assignee_key,
        (SELECT slug FROM leads WHERE id = w.lead_id) AS lead_slug,
        (SELECT slug FROM projects WHERE id = w.project_id) AS project_slug`,
    [id],
  );
  if (!rows[0]) return { ok: false, error: "Work item not found." };
  const { title, body, assignee_key, lead_slug, project_slug } = rows[0];
  const context = project_slug ? `project ${project_slug}` : lead_slug ? `lead ${lead_slug}` : undefined;
  // If the staged draft is an email to this lead, the approval sends it —
  // otherwise the assignee agent gets pinged to complete the item as before.
  const send = await sendApprovedClientDraft(id);
  if (send.outcome === "failed") {
    await reopenApprovalAfterFailedSend(id, send.error);
    revalidatePath("/engine");
    return { ok: false, error: `Approved, but the email did not send: ${send.error}` };
  }
  if (send.outcome !== "sent") {
    await notifyAgentOwner(id, assignee_key, title, body, context);
  }
  await maybeAdvanceRunbook(id); // W6: a done-but-unapproved step advances on approval
  revalidatePath("/engine");
  return { ok: true };
}

export async function rejectWorkItem(id: string): Promise<Result> {
  await requireRole("owner");
  const { rows } = await query<{ title: string; body: string; assignee_key: string | null }>(
    `UPDATE work_items SET approval_status = 'rejected', status = 'cancelled' WHERE id = $1
     RETURNING title, body, assignee_key`,
    [id],
  );
  if (rows[0]) {
    // W5 learning layer: a rejection is a signal about what NOT to propose.
    await captureAgentMemory({
      summary: `Rejected: ${rows[0].title}`,
      content: [
        `Work item "${rows[0].title}" was rejected by Joe on /engine.`,
        rows[0].body ? `What was proposed:\n${rows[0].body.slice(0, 1000)}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      memoryType: "observation",
      runtimeName: rows[0].assignee_key ?? undefined,
      refs: [{ kind: "work_item", id, label: rows[0].title }],
    });
  }
  await maybeAdvanceRunbook(id); // W6: rejecting a runbook step cancels its instance
  revalidatePath("/engine");
  return { ok: true };
}

/** Cancel a live runbook instance (W6). Owner-only — agents get no cancel tool. */
export async function cancelRunbook(instanceId: string): Promise<Result> {
  await requireRole("owner");
  await cancelRunbookInstance(instanceId);
  revalidatePath("/engine");
  return { ok: true };
}
