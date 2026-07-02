"use server";

// Lead task write paths. Owner-gated Server Actions for the Tasks tab. Reads
// stay in lib/lead-tasks.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { logLeadActivity } from "@/lib/lead-activity";
import type { LeadTask } from "@/lib/lead-tasks";

/** Add a task to a lead. Returns the created row for an optimistic append, or
 *  null if the lead is gone / the title is blank. Owner-only. */
export async function addLeadTask(
  slug: string,
  title: string,
  dueDate: string,
): Promise<LeadTask | null> {
  await requireRole("owner");
  const text = title.trim().slice(0, 300);
  if (!text) return null;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim()) ? dueDate.trim() : null;

  const row = await queryOne<{ id: number; title: string; done: boolean; due_date: string | null }>(
    `INSERT INTO lead_tasks (lead_id, title, due_date, sort_order)
     SELECT id, $2, $3::date,
            COALESCE((SELECT MAX(sort_order) + 1 FROM lead_tasks t2
                        JOIN leads l2 ON l2.id = t2.lead_id WHERE l2.slug = $1), 0)
       FROM leads WHERE slug = $1
     RETURNING id, title, done, to_char(due_date, 'YYYY-MM-DD') AS due_date`,
    [slug, text, due],
  );
  if (!row) return null;
  await logLeadActivity(slug, "note", `Task added · ${text}`);
  revalidatePath(`/leads/${slug}`);
  return { id: row.id, title: row.title, done: row.done, dueDate: row.due_date };
}

/** Toggle a task's done state. Owner-only. */
export async function setLeadTaskDone(id: number, done: boolean, slug: string): Promise<{ ok: boolean }> {
  await requireRole("owner");
  const res = await query(`UPDATE lead_tasks SET done = $2 WHERE id = $1`, [id, done]);
  if (res.rowCount === 0) return { ok: false };
  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}

/** Delete a task. Owner-only. */
export async function deleteLeadTask(id: number, slug: string): Promise<{ ok: boolean }> {
  await requireRole("owner");
  const res = await query(`DELETE FROM lead_tasks WHERE id = $1`, [id]);
  if (res.rowCount === 0) return { ok: false };
  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}
