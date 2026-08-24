"use server";

// Open Skills review actions. Owner-gated. A proposed skill (from an agent via
// the MCP create_skill_proposal tool, or by hand) stays OUT of the live library
// until Joe approves it here. Reads stay in lib/skills.ts.

import { revalidatePath } from "next/cache";
import { captureAgentMemory } from "@/lib/agent-memory";
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
  const { rows } = await query<{ change_summary: string; created_by: string }>(
    `UPDATE skill_versions v
        SET status = 'rejected'
       FROM skills s
      WHERE s.slug = $1 AND v.id = s.current_version_id
      RETURNING v.change_summary, v.created_by`,
    [slug],
  );
  const { rows: skillRows } = await query<{ title: string; description: string }>(
    `UPDATE skills SET review_status = 'rejected', active = false WHERE slug = $1
     RETURNING title, description`,
    [slug],
  );
  if (skillRows[0]) {
    // W5 learning layer: a rejection is a signal about what NOT to propose.
    await captureAgentMemory({
      summary: `Rejected: skill proposal "${skillRows[0].title}"`,
      content: [
        `Skill proposal "${skillRows[0].title}" (${slug}) was rejected by Joe on /engine.`,
        skillRows[0].description ? `What it was: ${skillRows[0].description}` : null,
        rows[0]?.change_summary ? `Proposed change: ${rows[0].change_summary}` : null,
        rows[0]?.created_by ? `Proposed by: ${rows[0].created_by}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      memoryType: "observation",
      runtimeName: rows[0]?.created_by && rows[0].created_by !== "user" ? rows[0].created_by : undefined,
      refs: [{ kind: "skill", id: slug, label: skillRows[0].title }],
    });
  }
  revalidatePath("/engine");
  return { ok: true };
}
