"use server";

// Schedule write paths (Phase 8-D). Reads stay in lib/schedule.ts; this file is
// the only place schedule_blocks are mutated. The "Block" modal on /schedule
// posts createScheduleBlock, which inserts a timeblock and revalidates the view.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

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

  await query(
    `INSERT INTO schedule_blocks (block_date, time_label, sort_min, label, tone)
     VALUES ($1, $2, $3, $4, $5)`,
    [date, timeLabel, sortMinFrom(timeLabel), label, tone],
  );

  revalidatePath("/schedule");
}
