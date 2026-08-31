"use server";

// Schedule write paths (Phase 8-D). Reads stay in lib/schedule.ts; this file is
// the only place schedule_blocks are mutated. The "Block" modal on /schedule
// posts createScheduleBlock, which inserts a timeblock and revalidates the view.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { askOllamaJson } from "@/lib/ai";
import { getScheduleConflict } from "@/lib/schedule";

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

/** "Auto-log from photos" on /schedule: for every project with site photos
 *  uploaded today that has no daily log yet, draft a short log entry from the
 *  photo filenames (local model; factual fallback when the model is down) and
 *  upsert it. Internal record only — never client-facing. */
export async function autoLogTodayFromPhotos(): Promise<
  { ok: true; drafted: number; projects: string[] } | { ok: false; error: string }
> {
  await requireRole("owner");
  const { rows } = await query<{ id: string; slug: string; name: string; photos: string[] }>(
    `SELECT p.id, p.slug, p.name, array_agg(f.name ORDER BY f.created_at) AS photos
       FROM files f JOIN projects p ON p.slug = f.project_key
      WHERE f.type = 'img' AND f.created_at::date = CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM daily_logs d
           WHERE d.project_id = p.id AND d.log_date = CURRENT_DATE)
      GROUP BY p.id, p.slug, p.name
      ORDER BY p.name
      LIMIT 5`,
  );
  if (rows.length === 0) return { ok: true, drafted: 0, projects: [] };

  const drafted: string[] = [];
  for (const r of rows) {
    const names = r.photos.slice(0, 8).join(", ");
    const ai = await askOllamaJson<{ body: string }>(
      `Write a 1–2 sentence construction daily-log entry for the project "${r.name}", ` +
        `based only on today's uploaded site-photo filenames: ${names}. ` +
        `Factual and past tense; do not invent work that the filenames don't show.`,
      { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
    );
    const fallback = `${r.photos.length} site photo${r.photos.length === 1 ? "" : "s"} uploaded (${names}).`;
    await query(
      `INSERT INTO daily_logs (project_id, log_date, body, photos)
       VALUES ($1, CURRENT_DATE, $2, $3)
       ON CONFLICT (project_id, log_date) WHERE project_id IS NOT NULL
       DO UPDATE SET body = EXCLUDED.body, photos = EXCLUDED.photos, updated_at = now()`,
      [r.id, ai?.body?.trim() || fallback, r.photos.length],
    );
    revalidatePath(`/projects/${r.slug}`);
    drafted.push(r.name);
  }
  revalidatePath("/schedule");
  return { ok: true, drafted: drafted.length, projects: drafted };
}

/** Apply on the schedule-conflict note: recheck this week's blocks and, if the
 *  double-booking is real, park a work item in Open Engine so it survives the
 *  page. Deduped on the open item's title. */
export async function flagScheduleConflict(): Promise<
  { ok: true; queued: boolean } | { ok: false; error: string }
> {
  await requireRole("owner");
  const text = await getScheduleConflict();
  if (!text.startsWith("Double-booked")) {
    return { ok: false, error: "No double-booking on this week's schedule — nothing to flag." };
  }
  const title = "Resolve schedule conflict (this week)";
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM work_items WHERE title = $1 AND completed_at IS NULL LIMIT 1`,
    [title],
  );
  if (existing) {
    await query(`UPDATE work_items SET body = $2, updated_at = now() WHERE id = $1`, [existing.id, text]);
    revalidatePath("/engine");
    return { ok: true, queued: false };
  }
  await query(
    `INSERT INTO work_items (title, body, priority, assignee_kind, source_kind, created_by)
     VALUES ($1, $2, 'high', 'human', 'manual', 'user')`,
    [title, text],
  );
  revalidatePath("/engine");
  revalidatePath("/today");
  return { ok: true, queued: true };
}
