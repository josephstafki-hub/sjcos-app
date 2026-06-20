"use server";

// Project write paths (Phase 7-A CRUD). Reads stay in lib/projects.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { PROJECT_STATUSES, projectStageLabel } from "@/lib/projects";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import type { ProjectStatus } from "@/lib/types";

/** Kebab-case a display name into a URL slug. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/** A slug not yet taken in the projects table (appends -2, -3, … on collision). */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await queryOne(`SELECT 1 FROM projects WHERE slug = $1`, [slug]);
    if (!hit) return slug;
    slug = `${base}-${i}`;
  }
}

/** Create a project from the "New project" form, then open its detail page.
 *  New projects start at the first lifecycle stage (lands in the Pre-con group). */
export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const clientName = String(formData.get("client_name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const valueDisplay = String(formData.get("value") ?? "").trim() || null;

  const slug = await uniqueSlug(name);
  await query(
    `INSERT INTO projects (slug, name, status, client_name, address, value_display, sub_label)
     VALUES ($1, $2, 'precon_signed', $3, $4, $5, $6)`,
    [slug, name, clientName, address, valueDisplay, address],
  );

  revalidatePath("/projects");
  revalidatePath("/today"); // active-job count derives from projects
  redirect(`/projects/${slug}`);
}

/** Advance a project to the next lifecycle stage. No-op at the final stage. */
export async function advanceProjectStatus(slug: string) {
  const row = await queryOne<{ status: ProjectStatus; name: string }>(
    `SELECT status, name FROM projects WHERE slug = $1`,
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
  await emit({
    kind: "job",
    tag: "Job",
    accent: "accent",
    icon: "project",
    title: `${row.name} → ${next.label}`,
    subline: `Stage advanced from ${projectStageLabel(row.status)}`,
    href: `/projects/${slug}`,
  });
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/projects");
  revalidatePath("/today"); // active-job count + outstanding A/R derive from projects
  revalidatePath("/notifications");
}

/** Ask Qwen whether the project is ready to move to the next lifecycle stage.
 *  Returns a one-line recommendation (the owner still confirms via "Move to …").
 *  Owner-gated. Never throws — AI failures degrade to a neutral line. */
export async function suggestProjectStage(slug: string): Promise<string> {
  await requireRole("owner");
  const row = await queryOne<{
    name: string;
    status: ProjectStatus;
    progress: number;
    stage_label: string | null;
  }>(
    `SELECT name, status, progress, stage_label FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!row) return "";

  const idx = PROJECT_STATUSES.findIndex((s) => s.key === row.status);
  const next = PROJECT_STATUSES[idx + 1];
  if (!next) return `${row.name} is at the final stage (${projectStageLabel(row.status)}).`;

  const context =
    `Project "${row.name}" is at the "${projectStageLabel(row.status)}" stage ` +
    `(${row.progress}% billed${row.stage_label ? `, "${row.stage_label}"` : ""}). ` +
    `The next stage in the lifecycle is "${next.label}". In one sentence, say whether ` +
    `the project looks ready to advance to "${next.label}" and what (if anything) ` +
    `should be confirmed first.`;

  try {
    const res = await ai.suggest({ kind: "project-stage", context });
    return res.suggestions[0] ?? `Ready to move to ${next.label}?`;
  } catch {
    return `Next stage is ${next.label}. Confirm the current stage's deliverables are signed off, then advance.`;
  }
}

/** Toggle a punch-list item done/open. Owner-gated; `slug` drives revalidation. */
export async function setPunchDone(id: number, done: boolean, slug: string) {
  await requireRole("owner");
  await query(`UPDATE project_punch SET done = $2 WHERE id = $1`, [id, done]);
  revalidatePath(`/projects/${slug}`);
}

/** Add a punch-list item to a project. Owner-gated. Returns the new row so the
 *  client can append it optimistically (null if the project/text is missing). */
export async function addPunchItem(
  slug: string,
  item: string,
  owner: string,
): Promise<{ id: number; item: string; owner: string; done: boolean } | null> {
  await requireRole("owner");
  const text = item.trim();
  if (!text) return null;
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return null;
  const sort = await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM project_punch WHERE project_id = $1`,
    [proj.id],
  );
  const row = await queryOne<{ id: string }>(
    `INSERT INTO project_punch (project_id, item, owner_name, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [proj.id, text, owner.trim(), sort?.next ?? 0],
  );
  revalidatePath(`/projects/${slug}`);
  return row ? { id: Number(row.id), item: text, owner: owner.trim(), done: false } : null;
}

/** Delete a punch-list item. Owner-gated; `slug` drives revalidation. */
export async function deletePunchItem(id: number, slug: string) {
  await requireRole("owner");
  await query(`DELETE FROM project_punch WHERE id = $1`, [id]);
  revalidatePath(`/projects/${slug}`);
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
