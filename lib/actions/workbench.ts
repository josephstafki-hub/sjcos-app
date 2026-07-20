"use server";

// Operator Console · workbench read action (spec §4.4). Read-only: resolves a
// subject id to its entity and returns a snapshot. Owner-gated. Zero writes,
// no revalidatePath.

import { requireRole } from "@/lib/dal";
import { resolveEntityRef, getWorkbenchSnapshot, type WorkbenchSnapshot } from "@/lib/workbench";

export type WorkbenchResult =
  | { ok: true; snapshot: WorkbenchSnapshot }
  | { ok: true; snapshot: null } // subject has no workbench entity
  | { ok: false; error: string };

/** subjectId = a TodayPriority.id or dev_agent_runs.subject_work_item_id. */
export async function getWorkbenchAction(subjectId: string): Promise<WorkbenchResult> {
  await requireRole("owner");
  try {
    const ref = await resolveEntityRef(subjectId);
    if (!ref) return { ok: true, snapshot: null };
    const snapshot = await getWorkbenchSnapshot(ref);
    return { ok: true, snapshot };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
