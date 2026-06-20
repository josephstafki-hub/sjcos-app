"use server";

// Schedule write paths (Phase 8-D). Reads stay in lib/schedule.ts; this file is
// the only place schedule_blocks are mutated. The "Block" modal on /schedule
// posts createScheduleBlock, which inserts a timeblock and revalidates the view.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";

const TONES = ["accent", "ai", "ghost"] as const;
type Tone = (typeof TONES)[number];

/** Parse a "8:00" / "13:30" time label into minutes-from-midnight for ordering.
 *  Non-numeric labels ("AM", "all") sort to the top of their day. */
function sortMinFrom(timeLabel: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeLabel.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Create a schedule block from the "Block" form. Date defaults to today so the
 *  new block lands in the visible (current) week strip. */
export async function createScheduleBlock(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const timeLabel = String(formData.get("time") ?? "").trim() || "all";
  const toneInput = String(formData.get("tone") ?? "accent");
  const tone: Tone = (TONES as readonly string[]).includes(toneInput)
    ? (toneInput as Tone)
    : "accent";

  // Optional project link. Empty → standalone meeting (NULL). Validate it's a
  // UUID; a bad/foreign value just falls back to NULL rather than erroring.
  const projectInput = String(formData.get("project_id") ?? "").trim();
  const projectId = /^[0-9a-f-]{36}$/i.test(projectInput) ? projectInput : null;

  await query(
    `INSERT INTO schedule_blocks (block_date, time_label, sort_min, label, tone, project_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [date, timeLabel, sortMinFrom(timeLabel), label, tone, projectId],
  );

  revalidatePath("/schedule");
}

/** Add a schedule block scoped to a project, from the project Schedule tab.
 *  Owner-gated; resolves the project by slug and revalidates both views. */
export async function createProjectScheduleBlock(slug: string, formData: FormData) {
  await requireRole("owner");
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const timeLabel = String(formData.get("time") ?? "").trim() || "all";
  const toneInput = String(formData.get("tone") ?? "accent");
  const tone: Tone = (TONES as readonly string[]).includes(toneInput)
    ? (toneInput as Tone)
    : "accent";

  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return;

  await query(
    `INSERT INTO schedule_blocks (block_date, time_label, sort_min, label, tone, project_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [date, timeLabel, sortMinFrom(timeLabel), label, tone, proj.id],
  );

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/schedule");
}

/** Remove a schedule block (project Schedule tab). Owner-gated. */
export async function deleteScheduleBlock(id: string, slug: string) {
  await requireRole("owner");
  await query(`DELETE FROM schedule_blocks WHERE id = $1`, [id]);
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/schedule");
}
