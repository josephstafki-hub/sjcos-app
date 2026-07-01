"use server";

// Safety write paths (Phase-4 P4-4 orientations). Owner generates an AI jobsite
// orientation per trade; subs acknowledge it from their portal (writing as
// themselves). Reads stay in lib/safety.ts. Incident reports are P4-5.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";

type Result = { ok: boolean; error?: string };

/** Owner: generate a jobsite safety orientation for a project + trade (Qwen). */
export async function generateSafetyOrientation(slug: string, trade: string): Promise<Result> {
  await requireRole("owner");
  const proj = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };
  const tradeLabel = trade.trim() || "General";

  let body = "";
  try {
    const res = await ai.ask({
      prompt:
        `Write a concise jobsite safety orientation for a residential remodeling project, for the ` +
        `"${tradeLabel}" trade. Use short bullet points covering: site hazards, required PPE, ` +
        `housekeeping, tool/equipment safety, and the emergency/incident reporting procedure ` +
        `(call 911 first, then notify the GC). Practical and specific to the trade; no legalese.`,
      context: `Project: ${proj.name}`,
    });
    body = (res.answer ?? "").trim();
  } catch {
    body = "";
  }
  if (!body) {
    body =
      `Safety orientation — ${tradeLabel}\n\n• Wear required PPE at all times (eye, hearing, and foot ` +
      `protection; dust protection when cutting).\n• Keep walkways and stairs clear; clean up debris daily.\n` +
      `• Inspect tools and cords before use; report damaged equipment.\n• Know the location of the first-aid ` +
      `kit and fire extinguisher.\n• In an emergency, call 911 first, then notify the general contractor.`;
  }

  await query(
    `INSERT INTO safety_orientations (project_id, trade, body) VALUES ($1, $2, $3)`,
    [proj.id, tradeLabel, body],
  );
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/sub-portal");
  return { ok: true };
}

/** Owner: delete an orientation. */
export async function deleteSafetyOrientation(slug: string, id: number): Promise<Result> {
  await requireRole("owner");
  await query(
    `DELETE FROM safety_orientations o USING projects p
      WHERE o.id = $1 AND o.project_id = p.id AND p.slug = $2`,
    [id, slug],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Sub (or owner previewing): acknowledge a safety orientation. Writes as the
 *  session's sub; idempotent. Notifies the owner. */
export async function acknowledgeOrientation(id: number): Promise<Result> {
  const user = await requireRole("owner", "sub");
  const subSlug = user.role === "sub" ? user.linkSlug : "marco";
  if (!subSlug) return { ok: false, error: "No sub identity on this account." };

  const r = await query(
    `INSERT INTO safety_acknowledgments (orientation_id, sub_slug)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, subSlug],
  );
  if ((r.rowCount ?? 0) === 1) {
    const o = await queryOne<{ trade: string; name: string }>(
      `SELECT o.trade, s.name FROM safety_orientations o, subs s WHERE o.id = $1 AND s.slug = $2`,
      [id, subSlug],
    );
    await emit({
      kind: "compliance",
      tag: "Safety",
      accent: "money",
      icon: "shield",
      title: `${o?.name ?? subSlug} acknowledged the ${o?.trade ?? "safety"} orientation`,
      subline: "Safety orientation signed off",
      href: `/subs/${subSlug}`,
    });
  }
  revalidatePath("/sub-portal");
  return { ok: true };
}
