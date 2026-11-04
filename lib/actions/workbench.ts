"use server";

// Operator Console · workbench read action (spec §4.4). Read-only: resolves a
// subject id to its to-do and linked entity. Scoped to the viewer. Zero writes,
// no revalidatePath.

import { requireAccess } from "@/lib/dal";
import { resolveEntityRef, getWorkbenchSnapshot, type WorkbenchSnapshot } from "@/lib/workbench";

import { getEngineWorkItem, type WorkItemView } from "@/lib/engine";
import { query } from "@/lib/db";

export type WorkbenchResult =
  | { ok: true; snapshot: WorkbenchSnapshot | null; item: WorkItemView | null; canEdit: boolean; assignees: WorkItemView["assignedTo"] }
  | { ok: false; error: string };

/** subjectId = a TodayPriority.id or dev_agent_runs.subject_work_item_id. */
export async function getWorkbenchAction(subjectId: string): Promise<WorkbenchResult> {
  const user = await requireAccess("today");
  try {
    const isItem = /^[0-9a-f-]{36}$/i.test(subjectId);
    if (user.role !== "owner") {
      if (!isItem) return { ok: false, error: "Choose a to-do assigned to you." };
      const { rows } = await query(`SELECT 1 FROM work_item_assignees WHERE work_item_id = $1 AND user_id = $2`, [subjectId, user.id]);
      if (!rows.length) return { ok: false, error: "This to-do is not assigned to you." };
    }
    const item = isItem ? await getEngineWorkItem(subjectId) : null;
    const ref = await resolveEntityRef(subjectId);
    const snapshot = ref ? await getWorkbenchSnapshot(ref) : null;
    const assignees = user.role === "owner" && item ? (await query<{userId:string;name:string;initials:string}>(`SELECT id AS "userId", name, initials FROM users WHERE active AND role IN ('owner','staff') ORDER BY (role = 'owner') DESC, name`)).rows : [];
    return { ok: true, snapshot, item, canEdit: user.role === "owner", assignees };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
