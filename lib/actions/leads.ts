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
import { INTAKE_QUESTIONS } from "@/lib/lead-intake-questions";
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

  revalidatePath("/leads");
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
