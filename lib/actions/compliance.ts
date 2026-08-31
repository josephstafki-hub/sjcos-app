"use server";

// Compliance write paths (Phase 7-A CRUD). Reads stay in lib/compliance.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";

/** Mark a compliance item resolved — drops it from the windows + timeline. */
export async function resolveComplianceItem(id: string) {
  await requireRole("owner");
  await query(`UPDATE compliance_items SET resolved = true WHERE id = $1`, [id]);
  revalidatePath("/compliance");
}

/** "Collect renewals" on /compliance: park one Open Engine work item per
 *  unresolved item due in the next 45 days (deduped against open items by
 *  title). Internal only — nothing is sent to a sub or carrier from here. */
export async function queueRenewalRequests(): Promise<
  { ok: true; queued: number; alreadyQueued: number } | { ok: false; error: string }
> {
  await requireRole("owner");
  const { rows } = await query<{ id: string; title: string; due: string }>(
    `SELECT id, title, to_char(due_date, 'FMMon FMDD') AS due
       FROM compliance_items
      WHERE NOT resolved AND due_date <= CURRENT_DATE + 45
      ORDER BY due_date`,
  );
  let queued = 0;
  let alreadyQueued = 0;
  for (const r of rows) {
    const title = `Collect renewal — ${r.title}`;
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM work_items WHERE title = $1 AND completed_at IS NULL LIMIT 1`,
      [title],
    );
    if (existing) {
      alreadyQueued++;
      continue;
    }
    await query(
      `INSERT INTO work_items (title, body, priority, assignee_kind, source_kind, source_id, created_by)
       VALUES ($1, $2, 'normal', 'human', 'manual', $3, 'user')`,
      [title, `Due ${r.due}. Chase the renewal document, then mark the compliance item resolved.`, r.id],
    );
    queued++;
  }
  if (queued > 0) {
    revalidatePath("/engine");
    revalidatePath("/today");
  }
  return { ok: true, queued, alreadyQueued };
}
