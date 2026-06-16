"use server";

// Project write paths (Phase 7-A CRUD). Reads stay in lib/projects.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { PROJECT_STATUSES } from "@/lib/projects";
import type { ProjectStatus } from "@/lib/types";

/** Advance a project to the next lifecycle status. No-op once complete. */
export async function advanceProjectStatus(slug: string) {
  const row = await queryOne<{ status: ProjectStatus }>(
    `SELECT status FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!row) return;
  const idx = PROJECT_STATUSES.findIndex((s) => s.key === row.status);
  const next = PROJECT_STATUSES[idx + 1];
  if (!next) return;

  await query(
    `UPDATE projects SET status = $2, updated_at = now() WHERE slug = $1`,
    [slug, next.key],
  );
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/projects");
  revalidatePath("/today"); // active-job count + outstanding A/R derive from projects
}

/** Set a project's billed/progress percent (0–100). */
export async function setProjectProgress(slug: string, progress: number) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  await query(
    `UPDATE projects SET progress = $2, updated_at = now() WHERE slug = $1`,
    [slug, pct],
  );
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/projects");
  revalidatePath("/today"); // active-job count + outstanding A/R derive from projects
}
