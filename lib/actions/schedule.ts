"use server";

// Schedule write paths (Phase 8-D). Reads stay in lib/schedule.ts; this file is
// the only place schedule_blocks are mutated. The "Block" modal on /schedule
// posts createScheduleBlock, which inserts a timeblock and revalidates the view.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { askOllamaJson } from "@/lib/ai";
import { getScheduleConflict, weekBounds } from "@/lib/schedule";

import { scheduleFields } from "../schedule-time";

type Result = { ok: true } | { ok: false; error: string };
function refreshSchedule() {
  revalidatePath("/schedule");
  revalidatePath("/today");
  revalidatePath("/projects", "layout");
}

/** Shared validation for owner, project and correction entry points. */
export async function createScheduleBlock(formData: FormData): Promise<Result> {
  await requireAccess("projects");
  try {
    const f = scheduleFields(formData);
    await query(
      `INSERT INTO schedule_blocks (block_date, time_label, sort_min, label, tone, project_id)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [f.date, f.time.label, f.time.minutes, f.label, f.tone, f.projectId],
    );
    refreshSchedule();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't save this block.",
    };
  }
}
export async function createProjectScheduleBlock(
  slug: string,
  formData: FormData,
): Promise<Result> {
  await requireAccess("projects");
  const proj = await queryOne<{ id: string }>(
    `SELECT id FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };
  formData.set("project_id", proj.id);
  return createScheduleBlock(formData);
}
export async function updateScheduleBlock(
  id: string,
  formData: FormData,
): Promise<Result> {
  await requireAccess("projects");
  try {
    const f = scheduleFields(formData);
    const row = await queryOne(
      `UPDATE schedule_blocks SET block_date=$2, time_label=$3, sort_min=$4, label=$5, tone=$6, project_id=$7 WHERE id=$1 RETURNING id`,
      [id, f.date, f.time.label, f.time.minutes, f.label, f.tone, f.projectId],
    );
    if (!row)
      return {
        ok: false,
        error: "This block no longer exists. Refresh the schedule.",
      };
    refreshSchedule();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't save this block.",
    };
  }
}
export type RemovedBlock = {
  id: string;
  date: string;
  time: string;
  label: string;
  tone: string;
  project_id: string | null;
  sort_min: number;
  signature: string;
};
// A signed snapshot permits exact Undo of legacy records without letting an
// untrusted restore request bypass the time grammar for a new record.
const undoKey = process.env.SESSION_SECRET || randomBytes(32);
function undoSignature(b: Omit<RemovedBlock, "signature">) {
  return createHmac("sha256", undoKey)
    .update("schedule-undo:")
    .update(
      JSON.stringify([
        b.id,
        b.date,
        b.time,
        b.label,
        b.tone,
        b.project_id,
        b.sort_min,
      ]),
    )
    .digest("hex");
}
/** Removal returns the original record for immediate Undo; no invented values. */
export async function deleteScheduleBlock(
  id: string,
  _slug?: string,
): Promise<{ ok: true; removed: RemovedBlock | null }> {
  await requireAccess("projects");
  const removed = await queryOne<Omit<RemovedBlock, "signature">>(
    `DELETE FROM schedule_blocks WHERE id=$1 RETURNING id, block_date::text AS date, time_label AS time, label, tone, project_id, sort_min`,
    [id],
  );
  refreshSchedule();
  return {
    ok: true,
    removed: removed ? { ...removed, signature: undoSignature(removed) } : null,
  };
}
export async function restoreScheduleBlock(
  block: RemovedBlock,
): Promise<Result> {
  await requireAccess("projects");
  try {
    const expected = Buffer.from(undoSignature(block), "hex");
    const supplied = Buffer.from(
      typeof block.signature === "string" ? block.signature : "",
      "hex",
    );
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      return {
        ok: false,
        error: "This Undo is no longer available. Add the block again.",
      };
    await query(
      `INSERT INTO schedule_blocks (id, block_date, time_label, sort_min, label, tone, project_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [
        block.id,
        block.date,
        block.time,
        block.sort_min,
        block.label,
        block.tone,
        block.project_id,
      ],
    );
    refreshSchedule();
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't restore that block. Add it again." };
  }
}

/** "Auto-log from photos" on /schedule: for every project with site photos
 *  uploaded today that has no daily log yet, draft a short log entry from the
 *  photo filenames (local model; factual fallback when the model is down) and
 *  upsert it. Internal record only — never client-facing. */
export async function autoLogTodayFromPhotos(): Promise<
  | { ok: true; drafted: number; projects: string[] }
  | { ok: false; error: string }
> {
  await requireAccess("projects");
  const { rows } = await query<{
    id: string;
    slug: string;
    name: string;
    photos: string[];
  }>(
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
    // The mock provider must never start a local model as a side effect.
    const ai = (process.env.AI_PROVIDER ?? "mock") === "mock"
      ? null
      : await askOllamaJson<{ body: string }>(
          `Write a 1–2 sentence construction daily-log entry for the project "${r.name}", ` +
            `based only on today's uploaded site-photo filenames: ${names}. ` +
            `Factual and past tense; do not invent work that the filenames don't show.`,
          {
            type: "object",
            properties: { body: { type: "string" } },
            required: ["body"],
          },
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

/** Recheck the selected week and park a real double-booking in Open Engine.
 *  Deduped on the ISO week, with a fallback for legacy untagged items. */
export async function flagScheduleConflict(
  weekOffset = 0,
): Promise<{ ok: true; queued: boolean } | { ok: false; error: string }> {
  await requireAccess("projects");
  const text = await getScheduleConflict(weekOffset);
  if (!text.startsWith("Double-booked")) {
    return {
      ok: false,
      error: "No double-booking on this week's schedule — nothing to flag.",
    };
  }
  const title = `Resolve schedule conflict (${weekOffset === 0 ? "this week" : `week offset ${weekOffset}`})`;
  // Keyed on the ISO week (A01), not the title; the legacy untagged row of
  // the same title is still found so it isn't duplicated.
  const { monday } = weekBounds(weekOffset);
  const week = await queryOne<{ wk: string }>(`SELECT to_char(${monday}, 'IYYY-"W"IW') AS wk`);
  const sourceId = `week:${week?.wk ?? "unknown"}`;
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM work_items
      WHERE completed_at IS NULL
        AND ((source_kind = 'schedule_conflict' AND source_id = $1) OR (source_kind = 'manual' AND source_id IS NULL AND title = $2))
      LIMIT 1`,
    [sourceId, title],
  );
  if (existing) {
    await query(
      `UPDATE work_items SET body = $2, updated_at = now() WHERE id = $1`,
      [existing.id, text],
    );
    revalidatePath("/engine");
    return { ok: true, queued: false };
  }
  await query(
    `INSERT INTO work_items (title, body, priority, assignee_kind, source_kind, source_id, created_by)
     VALUES ($1, $2, 'high', 'human', 'schedule_conflict', $3, 'user')`,
    [title, text, sourceId],
  );
  revalidatePath("/engine");
  revalidatePath("/today");
  return { ok: true, queued: true };
}
