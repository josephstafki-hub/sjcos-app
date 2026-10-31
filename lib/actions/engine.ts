"use server";

// Open Engine write paths. Owner-gated. Reads stay in lib/engine.ts.

import { prepareEmailWorkItem } from "@/lib/obligations/email";
import { revalidatePath } from "next/cache";
import { approveWorkItemById, rejectWorkItemById } from "@/lib/approve-work-item";
import type { ApproveResult } from "@/lib/approved-draft-rules";
import { editWorkItem } from "@/lib/work-item-edit";
import { runDirect } from "@/lib/commands/db";
import { query, queryOne } from "@/lib/db";
import { requireAccess, requireRole } from "@/lib/dal";
import { WORK_STATUSES } from "@/lib/engine-constants";
import { getArchivedWorkItems, type WorkItemView } from "@/lib/engine";
import { splitWho, type QueueFilter } from "@/lib/engine-views";
import { completeByPerson, maybeAdvanceRunbook, cancelRunbookInstance, repairRunbookInstance } from "@/lib/runbook-engine";
import { assignNewItem, pickedPeople, setAssignees } from "@/lib/work-item-assign";
import type { WorkItemStatus } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

export async function createWorkItem(formData: FormData): Promise<Result> {
  const me = await requireAccess("engine");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Title is required." };
  const body = String(formData.get("body") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "normal");
  const priority = ["low", "normal", "high", "urgent"].includes(priorityRaw)
    ? priorityRaw
    : "normal";
  const assigneeKey = String(formData.get("assignee_key") ?? "").trim() || null;
  const assigneeKind =
    assigneeKey && assigneeKey !== "human-joe" ? "agent" : "human";
  const dueAt = String(formData.get("due_at") ?? "").trim();
  const expectedSkill =
    String(formData.get("expected_skill_slug") ?? "").trim() || null;
  // Who it's on. Only the owner may put a to-do on someone else (Joe,
  // 2026-09-27), so anyone else's pick is ignored and the row lands with nobody
  // on it (= the owner's, the same as every other writer's default).
  const people =
    me.role === "owner"
      ? await pickedPeople(formData.getAll("assigned_user_ids").map(String))
      : [];
  if (!people)
    return { ok: false, error: "Only an active team login can hold a to-do." };

  if (
    dueAt &&
    (!Number.isFinite(Date.parse(dueAt)) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(dueAt) &&
        new Date(dueAt).toISOString().slice(0, 10) !== dueAt))
  )
    return { ok: false, error: "Choose a valid due date." };
  let email: {
    message_id: string;
    thread_id: string;
    from?: string;
    received_at?: string;
  } | null = null;
  if (formData.get("email")) {
    try {
      const value = JSON.parse(String(formData.get("email")));
      if (
        !value ||
        typeof value.message_id !== "string" ||
        !value.message_id.trim() ||
        typeof value.thread_id !== "string" ||
        !value.thread_id.trim()
      )
        throw Error();
      email = value;
    } catch {
      return {
        ok: false,
        error: "Open the email again before making a to-do.",
      };
    }
  }
  const job = String(formData.get("job") ?? "");
  const [kind, slug] = job.split(":");
  let projectId: string | null = null,
    leadId: string | null = null;
  if (job) {
    if (!slug || !["project", "lead"].includes(kind))
      return { ok: false, error: "Choose a job or lead." };
    const [record] = await runDirect<{ id: string }>(
      `SELECT id FROM ${kind === "project" ? "projects" : "leads"} WHERE slug=$1`,
      [slug],
    );
    if (!record)
      return { ok: false, error: "That job or lead could not be found." };
    if (kind === "project") projectId = record.id;
    else leadId = record.id;
  }
  const prep = email
    ? await prepareEmailWorkItem(runDirect, {
        email: {
          messageId: email.message_id,
          threadId: email.thread_id,
          from: email.from,
          receivedAt: email.received_at,
        },
        title,
        projectId,
        leadId,
        createdBy: "user",
      })
    : null;
  if (prep?.existingId) {
    // Re-reminding the same email schedules its existing to-do; no re-assignment.
    if (formData.get("reminder") === "true" && dueAt) {
      await runDirect(
        `UPDATE work_items SET due_at=CASE WHEN length($2::text)=10 THEN ($2::date::timestamp AT TIME ZONE 'America/Chicago') ELSE $2::timestamptz END,updated_at=now() WHERE id=$1`,
        [prep.existingId, dueAt],
      );
      revalidatePath("/engine");
      revalidatePath("/today");
    }
    return { ok: true };
  }
  const created = await queryOne<{ id: string }>(
    `INSERT INTO work_items
       (title, body, priority, assignee_kind, assignee_key, due_at, expected_skill_slug, source_kind, created_by, project_id, lead_id, source_id, obligation_id)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN length($6::text) = 10 THEN ($6::date::timestamp AT TIME ZONE 'America/Chicago') ELSE NULLIF($6,'')::timestamptz END, $7, $8, 'user', $9, $10, $11, $12)
     RETURNING id`,
    [
      title,
      body,
      priority,
      assigneeKind,
      assigneeKey,
      dueAt,
      expectedSkill,
      email ? "email" : "manual",
      projectId,
      leadId,
      email?.message_id ??
        (String(formData.get("source_id") ?? "").trim() || null),
      prep?.obligationId ?? null,
    ],
  );
  if (created) await assignNewItem(created.id, title, people);
  revalidatePath("/engine");
  revalidatePath("/today");
  return { ok: true };
}

/** Edit existing details; assignment uses the same owner-only service as Today. */
export async function updateWorkItem(id: string, fd: FormData): Promise<Result> {
  const me = await requireAccess("engine");
  const ids = fd.getAll("assigned_user_ids").map(String);
  if (me.role === "owner" && !await pickedPeople(ids)) return {ok:false,error:"Choose an active team member."};
  const job = String(fd.get("job") ?? "");
  const [kind, ...parts] = job.split(":");
  const slug = parts.join(":");
  const result = await editWorkItem(runDirect, id, {
    title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? ""),
    priority: String(fd.get("priority") ?? "normal"), due_at: String(fd.get("due_at") ?? "") || null,
    project_slug: kind === "project" ? slug : null, lead_slug: kind === "lead" ? slug : null,
  });
  if (!result.ok) return result;
  if (me.role === "owner") {
    const assigned = await setAssignees(id, ids);
    if (!assigned.ok) return assigned;
  }
  revalidatePath("/engine"); revalidatePath("/today");
  return {ok:true};
}

export async function getWorkItemJobOptions(): Promise<{value:string;label:string}[]> {
  await requireAccess("engine");
  return runDirect<{value:string;label:string}>(`SELECT 'project:' || slug AS value, name AS label FROM projects
    UNION ALL SELECT 'lead:' || slug, name || ' · Lead' FROM leads ORDER BY label`);
}

/** Put exactly these people on an existing to-do from the /engine board (the
 *  Today card's picker does the same thing — see lib/actions/today.ts
 *  assignTodayItem). Empty = back to the owner's own. Owner-only: holding the
 *  Engine area lets you work the queue, not re-deal it. */
export async function setWorkItemAssignees(id: string, userIds: string[]): Promise<Result> {
  await requireRole("owner");
  const r = await setAssignees(id, userIds);
  if (!r.ok) return r;
  revalidatePath("/engine");
  revalidatePath("/today");
  return { ok: true };
}

export async function setWorkItemStatus(id: string, status: WorkItemStatus, note?: string): Promise<Result> {
  const user = await requireAccess("engine");
  if (!WORK_STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
  if (status === "done") {
    // Done goes through the evidence command (receipt, obligation, runbook).
    const r = await completeByPerson(id, user, note);
    revalidatePath("/engine");
    revalidatePath("/today");
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Take done/cancelled to-dos off the board into the Archived view (Joe,
 *  2026-10-02). Display-only — the rows stay, every MCP read and dedup check
 *  still sees them. Anything still open is skipped (the table refuses it too:
 *  db/apply-work-item-archive.mjs), so "archive these" can't hide live work.
 *  Says how many it moved. */
export async function archiveWorkItems(ids: string[]): Promise<{ ok: true; archived: number } | { ok: false; error: string }> {
  await requireAccess("engine");
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!valid.length) return { ok: false, error: "Nothing to archive." };
  const { rowCount } = await query(
    `UPDATE work_items SET archived_at = now()
      WHERE id = ANY($1::uuid[]) AND status IN ('done','cancelled') AND archived_at IS NULL`,
    [valid],
  );
  revalidatePath("/engine");
  return { ok: true, archived: rowCount ?? 0 };
}

/** Put an archived to-do back on the board, as it was (still done/cancelled).
 *  Reopening one — any status change away from done/cancelled, from anywhere —
 *  also brings it back, by the table trigger. */
export async function restoreWorkItem(id: string): Promise<Result> {
  await requireAccess("engine");
  if (!UUID_RE.test(id)) return { ok: false, error: "Work item not found." };
  await query(`UPDATE work_items SET archived_at = NULL WHERE id = $1`, [id]);
  revalidatePath("/engine");
  return { ok: true };
}

/** A page of the Archived view, narrowed by the board's folder + filters. */
export async function listArchivedWorkItems(
  filter: QueueFilter,
  offset = 0,
): Promise<{ ok: true; items: WorkItemView[]; hasMore: boolean } | { ok: false; error: string }> {
  await requireAccess("engine");
  const [kind, key] = splitWho(filter.who);
  if (kind === "person" && !UUID_RE.test(key)) return { ok: true, items: [], hasMore: false };
  return { ok: true, ...(await getArchivedWorkItems(filter, offset)) };
}

/** Approve a work item awaiting human approval → clears the gate, moves to queued,
 *  and (for agent-owned items) actively pings the owner agent to go complete it.
 *  If the staged draft is an email to the item's lead/project client, the
 *  approval sends it. The result always says which happened: `sent` (to +
 *  subject) or `notice` ("Approved. Nothing was emailed: …") — the UI toasts
 *  it and the notice also lands on the card as blocked_reason. */
export async function approveWorkItem(id: string): Promise<ApproveResult> {
  await requireAccess("engine");
  const result = await approveWorkItemById(id);
  revalidatePath("/engine");
  return result;
}

export async function rejectWorkItem(id: string): Promise<Result> {
  await requireAccess("engine");
  await rejectWorkItemById(id);
  revalidatePath("/engine");
  return { ok: true };
}

/** Repair a stuck runbook instance (A02): recreate its missing step from the
 *  pinned definition and re-check it. Owner-only. */
export async function repairRunbook(instanceId: string): Promise<Result & { notice?: string }> {
  const user = await requireRole("owner");
  const notice = await repairRunbookInstance(instanceId, `owner:${user.name || "Joe"}`);
  revalidatePath("/engine");
  return { ok: true, notice };
}

/** Cancel a live runbook instance (W6). Owner-only — agents get no cancel tool. */
export async function cancelRunbook(instanceId: string): Promise<Result> {
  await requireAccess("engine");
  await cancelRunbookInstance(instanceId);
  revalidatePath("/engine");
  return { ok: true };
}
