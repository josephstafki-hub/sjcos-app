"use server";

// Lead write paths (Phase 7-A CRUD). Server Actions — invoked from <form action>
// in server/client components. Each mutation writes via lib/db then revalidates
// the affected paths so the server-rendered views refresh. Reads stay in
// lib/leads.ts; this file is the only place leads are mutated.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { STAGES, stageLabel } from "@/lib/leads";
import { logLeadActivity } from "@/lib/lead-activity";
import { emit } from "@/lib/notify";
import { INTAKE_QUESTIONS } from "@/lib/lead-intake-questions";
import { ai, type EstimateLine } from "@/lib/ai";
import { AI_NAME } from "@/lib/ai-name";
import { sendNewEmailAction } from "@/lib/actions/inbox";
import type { LeadStage } from "@/lib/types";

/** Kebab-case a display name into a URL slug. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "lead"
  );
}

/** A slug not yet taken in the leads table (appends -2, -3, … on collision). */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await queryOne(`SELECT 1 FROM leads WHERE slug = $1`, [slug]);
    if (!hit) return slug;
    slug = `${base}-${i}`;
  }
}

/** Create a lead from the "New lead" form, then open its detail page. */
export async function createLead(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const scope = String(formData.get("scope") ?? "").trim();
  const valueDisplay = String(formData.get("value") ?? "").trim() || null;
  const source = String(formData.get("source") ?? "").trim() || "Manual entry";

  const slug = await uniqueSlug(name);
  await query(
    `INSERT INTO leads (slug, name, scope, value_display, source, stage, last_contact_at)
     VALUES ($1, $2, $3, $4, $5, 'intake', now())`,
    [slug, name, scope, valueDisplay, source],
  );
  await logLeadActivity(slug, "created", `Lead created · ${source}`);
  await emit({
    kind: "job",
    tag: "Intake",
    accent: "accent",
    icon: "site",
    title: `New lead · ${name}`,
    subline: scope || source,
    href: `/leads/${slug}`,
  });

  revalidatePath("/leads");
  revalidatePath("/notifications");
  redirect(`/leads/${slug}`);
}

/** Advance a lead to the next pipeline stage. No-op at the final stage. */
export async function advanceLeadStage(slug: string) {
  const row = await queryOne<{ stage: LeadStage }>(
    `SELECT stage FROM leads WHERE slug = $1`,
    [slug],
  );
  if (!row) return;
  const idx = STAGES.findIndex((s) => s.key === row.stage);
  const next = STAGES[idx + 1];
  if (!next) return;

  await query(
    `UPDATE leads SET stage = $2, updated_at = now() WHERE slug = $1`,
    [slug, next.key],
  );
  await logLeadActivity(slug, "stage", `Moved to ${stageLabel(next.key)}`);
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
}

/** Delete a lead, then return to the list. Any project linked via lead_id is
 *  detached automatically (FK is ON DELETE SET NULL). Owner-only. */
export async function deleteLead(slug: string) {
  await requireRole("owner");
  await query(`DELETE FROM leads WHERE slug = $1`, [slug]);
  revalidatePath("/leads");
  revalidatePath("/today");
  redirect("/leads");
}

/** Upsert a single intake answer. Owner-gated. Returns {ok} for the inline
 *  editor's optimistic save. */
export async function saveIntakeAnswer(
  slug: string,
  question: string,
  answer: string,
): Promise<{ ok: boolean }> {
  await requireRole("owner");
  const q = question.trim();
  if (!q) return { ok: false };
  const canonical = INTAKE_QUESTIONS.indexOf(q as (typeof INTAKE_QUESTIONS)[number]);
  const sortOrder = canonical >= 0 ? canonical + 1 : 99;
  const res = await query(
    `INSERT INTO lead_intake (lead_id, sort_order, question, answer)
     SELECT id, $2, $3, $4 FROM leads WHERE slug = $1
     ON CONFLICT (lead_id, question) DO UPDATE SET answer = EXCLUDED.answer`,
    [slug, sortOrder, q, answer.trim()],
  );
  if (res.rowCount === 0) return { ok: false };
  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}

/** Update a lead's contact email/phone. Owner-gated; logs a contact-edit
 *  activity row. Empty strings clear the field. */
export async function updateLeadContact(
  slug: string,
  email: string,
  phone: string,
): Promise<{ ok: boolean }> {
  await requireRole("owner");
  const res = await query(
    `UPDATE leads SET email = NULLIF($2, ''), phone = NULLIF($3, ''), updated_at = now()
      WHERE slug = $1`,
    [slug, email.trim(), phone.trim()],
  );
  if (res.rowCount === 0) return { ok: false };
  await logLeadActivity(slug, "contact", "Contact info updated");
  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}

/** Have the AI draft a Phase 1 rough estimate for a lead from its scope +
 *  intake answers, saving it as a draft (overwrites any prior draft). Owner-gated. */
export async function draftEstimate(slug: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const lead = await queryOne<{ id: string; name: string; scope: string }>(
    `SELECT id, name, scope FROM leads WHERE slug = $1`,
    [slug],
  );
  if (!lead) return { ok: false, error: "Lead not found." };

  const { rows: intake } = await query<{ question: string; answer: string }>(
    `SELECT question, answer FROM lead_intake WHERE lead_id = $1 ORDER BY sort_order, id`,
    [lead.id],
  );
  const prior = await queryOne<{ notes: string }>(
    `SELECT notes FROM lead_estimates WHERE lead_id = $1`,
    [lead.id],
  );

  const est = await ai.estimate({
    name: lead.name,
    scope: lead.scope,
    intake,
    notes: prior?.notes || undefined,
  });

  await query(
    `INSERT INTO lead_estimates (lead_id, line_items, total, status, updated_at)
     VALUES ($1, $2, $3, 'draft', now())
     ON CONFLICT (lead_id) DO UPDATE
       SET line_items = EXCLUDED.line_items, total = EXCLUDED.total,
           status = 'draft', sent_at = NULL, updated_at = now()`,
    [lead.id, JSON.stringify(est.lines), est.total],
  );
  await logLeadActivity(slug, "estimate", `Rough estimate drafted by ${AI_NAME} (${est.total})`, AI_NAME);
  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}

/** Persist the owner's notes that steer the rough estimate. Owner-gated. */
export async function saveEstimateNotes(slug: string, notes: string): Promise<{ ok: boolean }> {
  await requireRole("owner");
  const res = await query(
    `INSERT INTO lead_estimates (lead_id, notes)
     SELECT id, $2 FROM leads WHERE slug = $1
     ON CONFLICT (lead_id) DO UPDATE SET notes = EXCLUDED.notes, updated_at = now()`,
    [slug, notes.trim()],
  );
  if (res.rowCount === 0) return { ok: false };
  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}

/** Email the rough estimate to the lead via Gmail and mark it sent. Owner-gated. */
export async function sendEstimate(slug: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const lead = await queryOne<{ id: string; name: string; email: string | null }>(
    `SELECT id, name, email FROM leads WHERE slug = $1`,
    [slug],
  );
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!lead.email) return { ok: false, error: "No email on file — add one first." };

  const est = await queryOne<{ line_items: EstimateLine[]; total: string }>(
    `SELECT line_items, total FROM lead_estimates WHERE lead_id = $1`,
    [lead.id],
  );
  if (!est) return { ok: false, error: "Draft an estimate first." };

  const first = lead.name.split(/\s+/)[0];
  const lines = (est.line_items ?? []).map((l) => `  • ${l.label}: ${l.value}`).join("\n");
  const body =
    `Hi ${first},\n\nThanks for the opportunity. Here's a Phase 1 rough estimate based on ` +
    `what we've discussed — these are ballpark ranges to confirm we're in the right neighborhood ` +
    `before we firm up scope and selections.\n\n${lines}\n\nRough total: ${est.total}\n\n` +
    `Happy to walk through any of this. Once you're comfortable with the range, the next step is a ` +
    `pre-construction agreement and detailed scope.\n\nBest,\nJoe\nSJ Carpentry`;

  const res = await sendNewEmailAction({
    to: lead.email,
    subject: "Phase 1 rough estimate — SJ Carpentry",
    body,
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Could not send." };

  await query(
    `UPDATE lead_estimates SET status = 'sent', sent_at = now(), updated_at = now() WHERE lead_id = $1`,
    [lead.id],
  );
  await logLeadActivity(slug, "email", `Rough estimate emailed to ${lead.name}`);
  revalidatePath(`/leads/${slug}`);
  return { ok: true };
}

/** Convert a (signed) lead into a project: create a pre-construction project
 *  linked back to the lead, then open it. Idempotent — re-running opens the
 *  existing project. Owner-gated. */
export async function convertLeadToProject(slug: string) {
  await requireRole("owner");
  const lead = await queryOne<{
    id: string;
    name: string;
    scope: string;
    scope_city: string | null;
    value_display: string | null;
  }>(
    `SELECT id, name, scope, scope_city, value_display FROM leads WHERE slug = $1`,
    [slug],
  );
  if (!lead) return;

  // Already converted → just open the existing project.
  const existing = await queryOne<{ slug: string }>(
    `SELECT slug FROM projects WHERE lead_id = $1`,
    [lead.id],
  );
  if (existing) redirect(`/projects/${existing.slug}`);

  // Prefer the intake "Address" answer for the job site; fall back to scope_city.
  const addr = await queryOne<{ answer: string }>(
    `SELECT answer FROM lead_intake WHERE lead_id = $1 AND question = 'Address'`,
    [lead.id],
  );
  const address = addr?.answer?.trim() || lead.scope_city || null;

  // Name the project "<LastName> · <scope head>", e.g. "Chen · Full kitchen reno".
  const words = lead.name.replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(Boolean);
  const lastName = words[words.length - 1] ?? lead.name;
  const scopeHead = lead.scope.split("·")[0].trim() || lead.scope;
  const projectName = `${lastName} · ${scopeHead}`.slice(0, 80);

  // Unique project slug.
  const base = slugify(projectName);
  let pslug = base;
  for (let i = 2; ; i++) {
    const hit = await queryOne(`SELECT 1 FROM projects WHERE slug = $1`, [pslug]);
    if (!hit) break;
    pslug = `${base}-${i}`;
  }

  await query(
    `INSERT INTO projects (slug, name, status, client_name, address, value_display, sub_label, lead_id)
     VALUES ($1, $2, 'floor_plan', $3, $4, $5, $6, $7)`,
    [pslug, projectName, lead.name, address, lead.value_display, address, lead.id],
  );
  await logLeadActivity(slug, "note", `Converted to project "${projectName}"`);
  await emit({
    kind: "job",
    tag: "Job",
    accent: "accent",
    icon: "project",
    title: `New project · ${projectName}`,
    subline: `Converted from lead · ${lead.name}`,
    href: `/projects/${pslug}`,
  });

  revalidatePath("/leads");
  revalidatePath("/projects");
  revalidatePath("/today");
  revalidatePath("/notifications");
  redirect(`/projects/${pslug}`);
}

/** Set a lead to an explicit stage (used by a stage picker). */
export async function setLeadStage(slug: string, stage: LeadStage) {
  if (!STAGES.some((s) => s.key === stage)) return;
  await query(
    `UPDATE leads SET stage = $2, updated_at = now() WHERE slug = $1`,
    [slug, stage],
  );
  await logLeadActivity(slug, "stage", `Moved to ${stageLabel(stage)}`);
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
}
