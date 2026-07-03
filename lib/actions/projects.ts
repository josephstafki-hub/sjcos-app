"use server";

// Project write paths (Phase 7-A CRUD). Reads stay in lib/projects.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { PROJECT_STATUSES, projectStageLabel, getProjectWeeklyStatus } from "@/lib/projects";
import { ai } from "@/lib/ai";
import { emit } from "@/lib/notify";
import { sendNewEmailAction } from "@/lib/actions/inbox";
import { createMilestoneInvoice } from "@/lib/actions/money";
import { sendCompletionOutreach } from "@/lib/actions/closeout";
import { autoDraftSocialOnCompletion } from "@/lib/actions/marketing";
import { parseDrawSchedule } from "@/lib/draw-schedule";
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
  await requireRole("owner");
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

/** Whether milestone invoices should auto-send (vs. draft-only) when a project
 *  reaches a billing stage. Persisted in app_settings; defaults ON. */
async function autoSendMilestone(): Promise<boolean> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'invoice.auto_send_on_milestone'`,
  );
  return row ? row.value === "true" : true;
}

/** Whether completion outreach (warranty + review emails) auto-sends when a job
 *  reaches the warranty stage. Persisted in app_settings; defaults ON. */
async function autoOutreachEnabled(): Promise<boolean> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'outreach.auto_on_completion'`,
  );
  return row ? row.value === "true" : true;
}

/** Auto-bill any draw whose triggerStatus matches the project's new stage (7-inv).
 *  Reads the most recent approved estimate's draw schedule, generates (and, per
 *  the setting, sends) an invoice for each due, unbilled draw, then marks it
 *  billed so re-flipping the stage never double-bills. */
async function billMilestonesForStatus(slug: string, newStatus: string) {
  const est = await queryOne<{ id: string; total: number; draw_schedule: unknown }>(
    `SELECT e.id, e.total, e.draw_schedule
       FROM estimates e JOIN projects p ON p.id = e.project_id
      WHERE p.slug = $1 AND e.status = 'approved' AND e.draw_schedule IS NOT NULL
      ORDER BY e.approved_at DESC NULLS LAST, e.id DESC LIMIT 1`,
    [slug],
  );
  if (!est) return;
  const lines = parseDrawSchedule(est.draw_schedule);
  if (!lines) return;
  const due = lines.filter((l) => l.triggerStatus === newStatus && !l.billed);
  if (due.length === 0) return;

  const autoSend = await autoSendMilestone();
  const totalDollars = (est.total ?? 0) / 100;
  let billed = 0;
  for (const l of due) {
    const amount = Math.round((totalDollars * l.percent) / 100);
    const res = await createMilestoneInvoice(slug, { milestone: l.label, amount, autoSend });
    if (res.ok) {
      l.billed = true;
      billed++;
    }
  }
  if (billed === 0) return;

  await query(`UPDATE estimates SET draw_schedule = $1::jsonb WHERE id = $2`, [
    JSON.stringify(lines),
    est.id,
  ]);
  await emit({
    kind: "money",
    tag: "Money",
    accent: "money",
    icon: "money",
    title: `${billed} milestone invoice${billed > 1 ? "s" : ""} ${autoSend ? "sent" : "drafted"}`,
    subline: `Triggered by reaching ${projectStageLabel(newStatus as ProjectStatus)}`,
    href: `/projects/${slug}`,
  });
}

/** Advance a project to the next lifecycle stage. No-op at the final stage. */
export async function advanceProjectStatus(slug: string) {
  await requireRole("owner");
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

  // Auto-bill any draw scheduled to invoice on reaching this stage (7-inv).
  await billMilestonesForStatus(slug, next.key);

  // On reaching the warranty stage, fire completion outreach once (P4-2) and
  // auto-draft a social post (P6-2).
  if (next.key === "warranty") {
    if (await autoOutreachEnabled()) await sendCompletionOutreach(slug);
    try {
      await autoDraftSocialOnCompletion(slug);
    } catch {
      /* never block the status change on a marketing draft */
    }
  }

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

/** Client (or owner previewing) confirms a resolved punch item is actually
 *  fixed. Only items the PM has already marked `done` can be confirmed. A client
 *  may only confirm items on their own project (linkSlug scope); the owner can
 *  confirm any. Returns Result so the portal component can surface failures. */
export async function confirmPunchItem(
  id: number,
  confirmed: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireRole("owner", "client");
  const row = await queryOne<{ slug: string; done: boolean }>(
    `SELECT p.slug, pp.done
       FROM project_punch pp JOIN projects p ON p.id = pp.project_id
      WHERE pp.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Punch item not found." };
  if (user.role === "client" && user.linkSlug !== row.slug) {
    return { ok: false, error: "Not authorized." };
  }
  if (!row.done) return { ok: false, error: "This item isn't marked done yet." };
  await query(
    `UPDATE project_punch
        SET client_confirmed_at = ${confirmed ? "now()" : "NULL"}
      WHERE id = $1 AND done = true`,
    [id],
  );
  revalidatePath("/client-portal");
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Assign a sub to a project (project Subs tab). Owner-gated; idempotent. */
export async function assignSubToProject(slug: string, subSlug: string, role: string) {
  await requireRole("owner");
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return;
  await query(
    `INSERT INTO project_subs (project_id, sub_slug, role_label)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [proj.id, subSlug, role.trim()],
  );
  revalidatePath(`/projects/${slug}`);
}

/** Update a sub's scope of work + scheduled dates on a project (6-scope).
 *  Owner-gated. Empty date strings clear the date. */
export async function updateSubAssignment(
  slug: string,
  subSlug: string,
  input: { scope: string; start: string; end: string },
) {
  await requireRole("owner");
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return;
  await query(
    `UPDATE project_subs
        SET scope_text = $3,
            start_date = NULLIF($4, '')::date,
            end_date   = NULLIF($5, '')::date
      WHERE project_id = $1 AND sub_slug = $2`,
    [proj.id, subSlug, input.scope.trim(), input.start.trim(), input.end.trim()],
  );
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/sub-portal");
}

/** Remove a sub from a project. Owner-gated. */
export async function removeSubFromProject(slug: string, subSlug: string) {
  await requireRole("owner");
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return;
  await query(`DELETE FROM project_subs WHERE project_id = $1 AND sub_slug = $2`, [
    proj.id,
    subSlug,
  ]);
  revalidatePath(`/projects/${slug}`);
}

/** Add (or update) a project daily-log entry for a date. Owner-gated. Upserts
 *  on (project_id, log_date) so re-logging the same day overwrites. */
export async function addProjectDailyLog(slug: string, formData: FormData) {
  await requireRole("owner");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const dateInput = String(formData.get("date") ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : null;
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return;

  await query(
    `INSERT INTO daily_logs (project_id, log_date, body)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3)
     ON CONFLICT (project_id, log_date) WHERE project_id IS NOT NULL
     DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
    [proj.id, date, body],
  );
  revalidatePath(`/projects/${slug}`);
}

/** Email this week's AI-drafted status to the project's client via Gmail, then
 *  emit a notification. Owner-gated. Replaces the old fake "Review" button. */
export async function sendWeeklyStatusEmail(
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const project = await queryOne<{ name: string }>(
    `SELECT name FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!project) return { ok: false, error: "Project not found." };

  const client = await queryOne<{ email: string; name: string }>(
    `SELECT email, name FROM users WHERE link_slug = $1 AND role = 'client' AND active = true LIMIT 1`,
    [slug],
  );
  if (!client?.email) {
    return { ok: false, error: "No client email on file for this project." };
  }

  const status = await getProjectWeeklyStatus(project.name);
  const first = client.name.split(/\s+/)[0] || "there";
  const body =
    `Hi ${first},\n\nHere's this week's update on the ${project.name} project:\n\n` +
    `${status}\n\nReply here with any questions — happy to walk through anything.\n\n` +
    `Best,\nJoe\nSJ Carpentry`;

  const res = await sendNewEmailAction({
    to: client.email,
    subject: `Weekly update — ${project.name}`,
    body,
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Could not send the update." };

  await emit({
    kind: "job",
    tag: "Update",
    accent: "ai",
    icon: "project",
    title: `Weekly update sent · ${project.name}`,
    subline: `Emailed to ${client.name}`,
    href: `/projects/${slug}`,
  });
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Set a project's billed/progress percent (0–100). */
export async function setProjectProgress(slug: string, progress: number) {
  await requireRole("owner");
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  await query(
    `UPDATE projects SET progress = $2, updated_at = now() WHERE slug = $1`,
    [slug, pct],
  );
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/projects");
  revalidatePath("/today"); // active-job count + outstanding A/R derive from projects
}
