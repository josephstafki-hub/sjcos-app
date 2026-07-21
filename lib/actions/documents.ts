"use server";

// Draw-schedule persistence for an estimate (owner-gated). The schedule set
// here is the auto-sourced payment-schedule field on the Contract template
// (lib/doc-templates/contract.ts, via lib/doc-templates/fill.ts) — actually
// generating/editing/sending the contract itself lives in the project's
// Documents tab (components/projects/DocTypePanel.tsx), not here.

import { revalidatePath } from "next/cache";
import { queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { type DrawLine, parseDrawSchedule, sumPercent } from "@/lib/draw-schedule";

type Result = { ok: true } | { ok: false; error: string };

/** Persist the editable draw schedule on the estimate (owner edits it before
 *  generating the contract). Lines must total 100%. */
export async function updateDrawSchedule(slug: string, estimateId: number, lines: DrawLine[]): Promise<Result> {
  await requireRole("owner");
  const clean = parseDrawSchedule(lines);
  if (!clean) return { ok: false, error: "Add at least one payment milestone." };
  const total = sumPercent(clean);
  if (Math.abs(total - 100) > 0.5) return { ok: false, error: `Percentages must add up to 100% (currently ${total}%).` };

  const row = await queryOne<{ id: string }>(
    `UPDATE estimates e SET draw_schedule = $1::jsonb
       FROM projects p
      WHERE e.id = $2 AND e.project_id = p.id AND p.slug = $3
      RETURNING e.id`,
    [JSON.stringify(clean), estimateId, slug],
  );
  if (!row) return { ok: false, error: "Estimate not found." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}
