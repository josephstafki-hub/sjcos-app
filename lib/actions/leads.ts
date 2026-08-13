"use server";

// Lead write paths (Phase 7-A CRUD). Server Actions — invoked from <form action>
// in server/client components. Each mutation writes via lib/db then revalidates
// the affected paths so the server-rendered views refresh. Reads stay in
// lib/leads.ts; this file is the only place leads are mutated.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import {
  STAGES,
  ALL_STAGES,
  stageLabel,
  suggestedProjectName,
  formatMoneyish,
  compactEstimateValue,
} from "@/lib/leads";
import { logLeadActivity } from "@/lib/lead-activity";
import { openEntityRoom, closeEntityRoom, carryRoomMembership } from "@/lib/rooms";
import { leadRoomKey, roomKey } from "@/lib/chat";
import { scoreLead } from "@/lib/intake";
import { emit } from "@/lib/notify";
import { INTAKE_QUESTIONS } from "@/lib/lead-intake-questions";
import { ai, type EstimateLine } from "@/lib/ai";
import { AI_NAME } from "@/lib/ai-name";
import { sendNewEmailAction } from "@/lib/actions/inbox";
import { renderRoughEstimatePdf } from "@/lib/doc-drafts";
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

/** Looks like a referral source, e.g. "Referral", "referred by Dana". */
function isReferralSource(source: string): boolean {
  return /referr/i.test(source);
}

/** Send a thank-you email to a lead's referrer, stamp referrer_thanked_at once,
 *  and log it. Best-effort + idempotent (guarded on referrer_thanked_at IS NULL).
 *  The narrative is Qwen-drafted with a deterministic fallback. Returns true if
 *  a thank-you was actually sent. */
async function deliverReferralThanks(lead: {
  slug: string;
  name: string;
  scope: string;
  referrerName: string | null;
  referrerEmail: string | null;
}): Promise<boolean> {
  const email = (lead.referrerEmail ?? "").trim();
  if (!email) return false;
  // Only thank once.
  const claim = await query(
    `UPDATE leads SET referrer_thanked_at = now() WHERE slug = $1 AND referrer_thanked_at IS NULL`,
    [lead.slug],
  );
  if ((claim.rowCount ?? 0) === 0) return false;

  const first = (lead.referrerName ?? "").trim().split(/\s+/)[0] || "there";
  let body = "";
  try {
    const res = await ai.ask({
      prompt:
        `Write a short, warm thank-you email (3–4 sentences) to ${lead.referrerName || "a friend"} who ` +
        `referred a potential client${lead.scope ? ` (${lead.scope})` : ""} to SJ Carpentry LLC. Grateful and ` +
        `professional, not salesy. Sign off from Joe.`,
    });
    body = (res.answer ?? "").trim();
  } catch {
    body = "";
  }
  if (!body) {
    body =
      `Hi ${first},\n\nThank you so much for referring ${lead.name} to SJ Carpentry — it means a lot that ` +
      `you thought of us. We'll take great care of them.\n\nGratefully,\nJoe\nSJ Carpentry LLC`;
  }

  const res = await sendNewEmailAction({ to: email, subject: "Thank you for the referral", body });
  if (!res.ok) {
    // Roll back the stamp so a later retry can send.
    await query(`UPDATE leads SET referrer_thanked_at = NULL WHERE slug = $1`, [lead.slug]);
    return false;
  }
  await logLeadActivity(lead.slug, "email", `Thank-you sent to referrer ${lead.referrerName || email}`);
  return true;
}

/** Create a lead from the "New lead" form, then open its detail page. */
export async function createLead(formData: FormData) {
  await requireRole("owner");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const scope = String(formData.get("scope") ?? "").trim();
  const valueDisplay = String(formData.get("value") ?? "").trim() || null;
  const source = String(formData.get("source") ?? "").trim() || "Manual entry";
  const referrerName = String(formData.get("referrer_name") ?? "").trim() || null;
  const referrerEmail = String(formData.get("referrer_email") ?? "").trim() || null;

  const slug = await uniqueSlug(name);
  await query(
    `INSERT INTO leads (slug, name, scope, value_display, source, referrer_name, referrer_email, stage, last_contact_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'intake', now())`,
    [slug, name, scope, valueDisplay, source, referrerName, referrerEmail],
  );
  await logLeadActivity(slug, "created", `Lead created · ${source}`);

  // Auto-create the lead's chat room (P1-D2). Best-effort — never block create.
  try {
    await openEntityRoom("lead", slug, name);
  } catch {
    /* room bookkeeping must never block lead creation */
  }

  // Auto-score on creation, same as the inbound funnel. Best-effort — never
  // block lead creation on the model (scoreLead falls back to mock internally).
  let verdict: "go" | "hold" | "pass" | null = null;
  try {
    const score = await scoreLead(slug);
    verdict = score?.verdict ?? null;
    if (score) {
      await logLeadActivity(slug, "note", `Scored ${score.verdict.toUpperCase()} — ${score.rationale}`, AI_NAME);
    }
  } catch {
    /* leave unscored; the owner can re-score from the detail page */
  }

  await emit({
    kind: "job",
    tag: "Intake",
    accent: verdict === "go" ? "money" : "accent",
    icon: "site",
    flagged: verdict === "go",
    title: `New lead · ${name}${verdict ? ` · ${verdict.toUpperCase()}` : ""}`,
    subline: scope || source,
    href: `/leads/${slug}`,
  });

  // Auto-thank the referrer on a genuine referral with an email on file.
  if (referrerEmail && isReferralSource(source)) {
    try {
      await deliverReferralThanks({ slug, name, scope, referrerName, referrerEmail });
    } catch {
      /* never block lead creation on the thank-you */
    }
  }

  revalidatePath("/leads");
  revalidatePath("/notifications");
  redirect(`/leads/${slug}`);
}

/** Owner: manually (re)send a referral thank-you for a lead. */
export async function sendReferralThankYou(slug: string): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const lead = await queryOne<{
    slug: string;
    name: string;
    scope: string;
    referrer_name: string | null;
    referrer_email: string | null;
  }>(
    `SELECT slug, name, scope, referrer_name, referrer_email FROM leads WHERE slug = $1`,
    [slug],
  );
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!lead.referrer_email) return { ok: false, error: "No referrer email on file." };
  const sent = await deliverReferralThanks({
    slug: lead.slug,
    name: lead.name,
    scope: lead.scope,
    referrerName: lead.referrer_name,
    referrerEmail: lead.referrer_email,
  });
  revalidatePath(`/leads/${slug}`);
  return sent ? { ok: true } : { ok: false, error: "Already thanked, or the email couldn't be sent." };
}

/** Advance a lead to the next pipeline stage. No-op at the final stage. */
export async function advanceLeadStage(slug: string) {
  await requireRole("owner");
  const row = await queryOne<{ stage: LeadStage }>(
    `SELECT stage FROM leads WHERE slug = $1`,
    [slug],
  );
  if (!row) return;
  const idx = STAGES.findIndex((s) => s.key === row.stage);
  if (idx < 0) return; // terminal (lost) leads are off-pipeline — can't advance
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

/** Mark a lead lost / archived (terminal). Owner-gated. */
export async function markLeadLost(slug: string) {
  await requireRole("owner");
  await query(`UPDATE leads SET stage = 'lost', updated_at = now() WHERE slug = $1`, [slug]);
  await logLeadActivity(slug, "stage", "Marked lost / archived");
  try {
    await closeEntityRoom(leadRoomKey(slug)); // lost → close the room (P1-D2)
  } catch {
    /* room bookkeeping must never block the stage change */
  }
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
  revalidatePath("/chat");
}

/** Reopen a lost/archived lead back into the pipeline at intake. Owner-gated. */
export async function reopenLead(slug: string) {
  await requireRole("owner");
  const row = await queryOne<{ name: string; converted: boolean }>(
    `SELECT l.name, EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id) AS converted
       FROM leads l WHERE l.slug = $1`,
    [slug],
  );
  await query(`UPDATE leads SET stage = 'intake', updated_at = now() WHERE slug = $1`, [slug]);
  await logLeadActivity(slug, "stage", "Reopened to Intake");
  // Reopen the lead's room — but not for a converted lead, whose conversation
  // lives in the project room (its lead room was deliberately closed at convert).
  if (row && !row.converted) {
    try {
      await openEntityRoom("lead", slug, row.name); // reopen the room (P1-D2)
    } catch {
      /* room bookkeeping must never block the reopen */
    }
  }
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
  revalidatePath("/chat");
}

/** Delete a lead, then return to the list. Any project linked via lead_id is
 *  detached automatically (FK is ON DELETE SET NULL). Owner-only. */
export async function deleteLead(slug: string) {
  await requireRole("owner");
  await query(`DELETE FROM leads WHERE slug = $1`, [slug]);
  try {
    await closeEntityRoom(leadRoomKey(slug)); // close (keep transcript), don't delete
  } catch {
    /* room bookkeeping must never block the delete */
  }
  revalidatePath("/leads");
  revalidatePath("/today");
  revalidatePath("/chat");
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

/** Have the AI draft a Phase 1 rough estimate for a lead from its scope,
 *  intake answers, and captured Open Brain knowledge (site-visit notes,
 *  measurements, material picks, prior assumptions), saving it as a draft
 *  (overwrites any prior draft). Owner-gated. */
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
  const { rows: knowledge } = await query<{ kind: string; content: string }>(
    `SELECT kind, content FROM knowledge_items WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [lead.id],
  );

  const est = await ai.estimate({
    name: lead.name,
    scope: lead.scope,
    intake,
    notes: prior?.notes || undefined,
    knowledge,
  });

  await query(
    `INSERT INTO lead_estimates (lead_id, line_items, total, status, updated_at)
     VALUES ($1, $2, $3, 'draft', now())
     ON CONFLICT (lead_id) DO UPDATE
       SET line_items = EXCLUDED.line_items, total = EXCLUDED.total,
           status = 'draft', sent_at = NULL, updated_at = now()`,
    [lead.id, JSON.stringify(est.lines), est.total],
  );
  await syncLeadValueFromEstimate(lead.id, est.total);
  await logLeadActivity(slug, "estimate", `Rough estimate drafted by ${AI_NAME} (${est.total})`, AI_NAME);
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
  return { ok: true };
}

/** Mirror a rough estimate's total onto leads.value_display/estimate_value so
 *  the /leads overview list (which reads those columns, not lead_estimates)
 *  shows the current estimate instead of "?". */
async function syncLeadValueFromEstimate(leadId: string, total: string): Promise<void> {
  const compact = compactEstimateValue(total);
  if (!compact) return;
  await query(`UPDATE leads SET value_display = $2, estimate_value = $3 WHERE id = $1`, [
    leadId,
    compact.display,
    compact.value,
  ]);
}

/** Persist owner-edited rough-estimate line items + total. Owner-gated. The
 *  edited items feed both the on-page preview and the emailed template PDF. */
export async function saveEstimateLines(
  slug: string,
  lines: EstimateLine[],
  total: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  const clean = (Array.isArray(lines) ? lines : [])
    .map((l) => ({ label: String(l?.label ?? "").trim(), value: String(l?.value ?? "").trim() }))
    .filter((l) => l.label || l.value);
  const cleanTotal = String(total ?? "").trim();
  const res = await query(
    `INSERT INTO lead_estimates (lead_id, line_items, total)
     SELECT id, $2::jsonb, $3 FROM leads WHERE slug = $1
     ON CONFLICT (lead_id) DO UPDATE
       SET line_items = EXCLUDED.line_items, total = EXCLUDED.total, updated_at = now()`,
    [slug, JSON.stringify(clean), cleanTotal],
  );
  if (res.rowCount === 0) return { ok: false, error: "Lead not found." };
  const compact = compactEstimateValue(cleanTotal);
  if (compact) {
    await query(`UPDATE leads SET value_display = $2, estimate_value = $3 WHERE slug = $1`, [
      slug,
      compact.display,
      compact.value,
    ]);
  }
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
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
  const lines = (est.line_items ?? [])
    .map((l) => `  • ${l.label}: ${formatMoneyish(l.value)}`)
    .join("\n");
  const body =
    `Hi ${first},\n\nThanks for the opportunity. Here's a Phase 1 rough estimate based on ` +
    `what we've discussed — these are ballpark ranges to confirm we're in the right neighborhood ` +
    `before we firm up scope and selections.\n\n${lines}\n\nRough total: ${formatMoneyish(est.total)}\n\n` +
    `Happy to walk through any of this. Once you're comfortable with the range, the next step is a ` +
    `pre-construction agreement and detailed scope.\n\nBest,\nJoe\nSJ Carpentry`;

  // Attach the house-style rough-estimate PDF so the client gets a polished
  // document, not just the plain-text ranges. Best-effort: if rendering fails,
  // the email still goes out with the text body.
  let attachments;
  try {
    const pdf = await renderRoughEstimatePdf(slug);
    if (pdf) {
      attachments = [
        { filename: "Phase 1 Rough Estimate — SJ Carpentry.pdf", mimeType: "application/pdf", content: pdf },
      ];
    }
  } catch {
    attachments = undefined;
  }

  const res = await sendNewEmailAction({
    to: lead.email,
    subject: "Phase 1 rough estimate — SJ Carpentry",
    body,
    attachments,
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
 *  existing project. Owner-gated. `nameInput` is the owner-confirmed project
 *  name from the convert dialog; falls back to the suggested-name heuristic. */
export async function convertLeadToProject(slug: string, nameInput?: string) {
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

  const projectName =
    (nameInput ?? "").trim().slice(0, 80) || suggestedProjectName(lead.name, lead.scope);

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

  // Carry any lead-stage client-portal access onto the new project: the minted
  // users row (link_slug 'lead:<slug>' → project slug; synthetic email
  // likewise) and the invite row move across, so a client who already has the
  // dashboard keeps it — same link, more tabs. Their portal chat thread also
  // follows (portal:lead:<slug> → portal:<pslug>). Best-effort — portal
  // bookkeeping must never block the conversion.
  try {
    await query(
      `UPDATE users
          SET link_slug = $2,
              email = CASE WHEN email = $3 THEN $4 ELSE email END
        WHERE role = 'client' AND link_slug = $1`,
      [`lead:${slug}`, pslug, `lead-${slug}@client-portal.invalid`, `${pslug}@client-portal.invalid`],
    );
    await query(
      `UPDATE client_portal_invites SET project_slug = $2, lead_slug = NULL
        WHERE lead_slug = $1`,
      [slug, pslug],
    );
    await query(
      `UPDATE chat_messages SET channel_key = $2 WHERE channel_key = $1`,
      [`portal:lead:${slug}`, `portal:${pslug}`],
    );
  } catch {
    /* portal carry-over must never block the conversion */
  }

  // The conversation moves from the lead to the new project room (P1-D2): open
  // the project room, carry any participants added during the lead stage over,
  // then close the lead's. Best-effort — never block the convert.
  try {
    await openEntityRoom("project", pslug, projectName);
    await carryRoomMembership(leadRoomKey(slug), roomKey(pslug));
    await closeEntityRoom(leadRoomKey(slug));
  } catch {
    /* room bookkeeping must never block the conversion */
  }

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
  revalidatePath("/chat");
  redirect(`/projects/${pslug}`);
}

/** Re-run the AI lead score on everything currently on file, persisting the
 *  fresh verdict/rationale. Owner-gated. Returns the new score for the UI. */
export async function rescoreLead(
  slug: string,
): Promise<{ ok: boolean; verdict?: "go" | "hold" | "pass"; rationale?: string; error?: string }> {
  await requireRole("owner");
  const score = await scoreLead(slug);
  if (!score) return { ok: false, error: "Lead not found." };
  await logLeadActivity(slug, "note", `Re-scored ${score.verdict.toUpperCase()} — ${score.rationale}`, AI_NAME);
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
  return { ok: true, verdict: score.verdict, rationale: score.rationale };
}

/** Set a lead to an explicit stage (used by a stage picker). */
export async function setLeadStage(slug: string, stage: LeadStage) {
  await requireRole("owner");
  if (!ALL_STAGES.some((s) => s.key === stage)) return;
  await query(
    `UPDATE leads SET stage = $2, updated_at = now() WHERE slug = $1`,
    [slug, stage],
  );
  await logLeadActivity(slug, "stage", `Moved to ${stageLabel(stage)}`);
  // Keep the lead's room in sync (P1-D2): 'lost' closes it; any live stage
  // reopens it — but only for an unconverted lead (a converted lead's room was
  // deliberately closed at convert, its conversation moved to the project).
  try {
    if (stage === "lost") {
      await closeEntityRoom(leadRoomKey(slug));
    } else {
      const lead = await queryOne<{ name: string; converted: boolean }>(
        `SELECT l.name, EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id) AS converted
           FROM leads l WHERE l.slug = $1`,
        [slug],
      );
      if (lead && !lead.converted) await openEntityRoom("lead", slug, lead.name);
    }
  } catch {
    /* room bookkeeping must never block the stage change */
  }
  revalidatePath(`/leads/${slug}`);
  revalidatePath("/leads");
  revalidatePath("/chat");
}
