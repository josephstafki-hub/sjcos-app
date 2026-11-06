import "server-only";
import type { Run } from "@/lib/commands/db";

export const CHANGED_DRAFT = "This draft has changed. Open the current card and approve it again. Nothing was sent.";
export const WEB_CHANGED_DRAFT = "This draft changed since you opened it. Nothing was sent. Read the new version and approve again.";

/** Caller holds the work-item lock. The binding and all send inputs are read
 * in ONE statement/MVCC snapshot; neither dispatch nor validation rereads the
 * mutable source. The frozen row is committed with the approval gate. */
export async function freezeApprovedDraft(run: Run, workItemId: string, expectedBinding?: string | null): Promise<string | null> {
  // Never infer what was viewed from the latest alert (or from live content).
  if (typeof expectedBinding !== "string" || !expectedBinding) return null;
  const [source] = await run<{ snapshot: { binding: string } }>(
    `SELECT phone_push_draft_source($1) AS snapshot`, [workItemId],
  );
  if (!source?.snapshot || source.snapshot.binding !== expectedBinding) return null;
  const [frozen] = await run<{ id: string }>(
    `INSERT INTO approved_work_item_drafts(work_item_id,binding,snapshot) VALUES($1,$2,$3::jsonb) RETURNING id`,
    [workItemId, source.snapshot.binding, JSON.stringify(source.snapshot)],
  );
  await run(`INSERT INTO approved_draft_dispatches(approved_draft_id) VALUES($1)`, [frozen.id]);
  return frozen.id;
}
