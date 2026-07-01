"use server";

// Schedule auto-generation from a template (Phase-3 execution, 7-sched). Owner-
// gated. Expands a template's phases into project schedule_blocks starting from a
// chosen date; offset_days/duration_days count WEEKDAYS. Idempotent: a phase that
// already has a block on its computed date + label is skipped, so re-running
// won't duplicate. Reads stay in lib/schedule.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";

type Result = { ok: true; created: number } | { ok: false; error: string };

/** Local YYYY-MM-DD (no UTC shift). */
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Advance `n` weekdays (Mon–Fri) from a start date; offset 0 = the start date. */
function addWeekdays(start: Date, n: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

export async function generateScheduleFromTemplate(
  slug: string,
  templateId: number,
  startDate: string,
): Promise<Result> {
  await requireRole("owner");

  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return { ok: false, error: "Project not found." };

  const start = startDate ? new Date(startDate + "T00:00:00") : null;
  if (!start || Number.isNaN(start.getTime())) return { ok: false, error: "Pick a valid start date." };

  const { rows: phases } = await query<{
    label: string;
    tone: string;
    offset_days: number;
    duration_days: number;
  }>(
    `SELECT label, tone, offset_days, duration_days
       FROM schedule_template_phases WHERE template_id = $1 ORDER BY sort_order, id`,
    [templateId],
  );
  if (phases.length === 0) return { ok: false, error: "That template has no phases." };

  let created = 0;
  for (const ph of phases) {
    const iso = toISO(addWeekdays(start, ph.offset_days));
    const label = ph.duration_days > 1 ? `${ph.label} · ~${ph.duration_days}d` : ph.label;
    const ins = await query(
      `INSERT INTO schedule_blocks (project_id, block_date, time_label, sort_min, label, tone)
       SELECT $1, $2::date, 'all', 0, $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM schedule_blocks
           WHERE project_id = $1 AND block_date = $2::date AND label = $3
        )`,
      [proj.id, iso, label, ph.tone],
    );
    created += ins.rowCount ?? 0;
  }

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/schedule");
  return { ok: true, created };
}
