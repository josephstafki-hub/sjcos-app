"use server";

// Open Skills review actions. Owner-gated. A proposed skill (from an agent via
// the MCP create_skill_proposal tool, or by hand) stays OUT of the live library
// until Joe approves it here. Reads stay in lib/skills.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";

type Result = { ok: true } | { ok: false; error: string };

/** Approve a proposed skill → it joins the active library; its version is approved. */
export async function approveSkill(slug: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE skill_versions v
        SET status = 'approved'
       FROM skills s
      WHERE s.slug = $1 AND v.id = s.current_version_id`,
    [slug],
  );
  await query(
    `UPDATE skills SET review_status = 'approved', active = true WHERE slug = $1`,
    [slug],
  );
  revalidatePath("/engine");
  return { ok: true };
}

export async function rejectSkill(slug: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE skill_versions v
        SET status = 'rejected'
       FROM skills s
      WHERE s.slug = $1 AND v.id = s.current_version_id`,
    [slug],
  );
  await query(
    `UPDATE skills SET review_status = 'rejected', active = false WHERE slug = $1`,
    [slug],
  );
  revalidatePath("/engine");
  return { ok: true };
}
