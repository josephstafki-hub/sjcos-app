"use server";

// Safety write paths (Phase-4 P4-4 orientations). Owner generates an AI jobsite
// orientation per trade; subs acknowledge it from their portal (writing as
// themselves). Reads stay in lib/safety.ts. Incident reports are P4-5.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";
import { storeBuffer } from "@/lib/upload-store";
import { getCompanyDocInfo, renderIncidentReportPdf } from "@/lib/documents";
import { SEVERITY_LABEL, type IncidentSeverity } from "@/lib/incident-types";

type Result = { ok: boolean; error?: string };

const SEVERITIES: IncidentSeverity[] = ["near_miss", "minor", "recordable", "serious"];

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

/** Owner: create an incident report. Qwen drafts a factual narrative from the
 *  owner's notes → PDF (with disclaimer) stored in Files + a logged record. */
export async function createIncidentReport(slug: string, formData: FormData): Promise<Result> {
  const user = await requireRole("owner");
  const proj = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!proj) return { ok: false, error: "Project not found." };

  const notes = String(formData.get("notes") ?? "").trim();
  if (!notes) return { ok: false, error: "Describe what happened." };
  const occurredAt = String(formData.get("occurredAt") ?? "").trim();
  const reporter = String(formData.get("reporter") ?? "").trim() || user.name || "Owner";
  const sevRaw = String(formData.get("severity") ?? "minor") as IncidentSeverity;
  const severity: IncidentSeverity = SEVERITIES.includes(sevRaw) ? sevRaw : "minor";

  // Qwen turns the notes into a clear, factual incident narrative (no blame, no
  // invented facts). Falls back to the raw notes on failure.
  let narrative = "";
  try {
    const res = await ai.ask({
      prompt:
        `Turn these notes into a clear, factual construction incident report narrative (3–6 sentences). ` +
        `Cover what happened, where, who was involved, any injury/damage, and the immediate response. ` +
        `Neutral and objective — do NOT assign blame or invent details not in the notes.\n\nNotes: ${notes}`,
      context: `Project: ${proj.name}`,
    });
    narrative = (res.answer ?? "").trim();
  } catch {
    narrative = "";
  }
  if (!narrative) narrative = notes;

  const info = await getCompanyDocInfo();
  const occurredLabel = occurredAt
    ? new Date(occurredAt + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";
  const pdf = await renderIncidentReportPdf({
    company: info.company,
    projectName: proj.name,
    occurredLabel,
    reporter,
    severityLabel: SEVERITY_LABEL[severity],
    narrative,
    dateLabel: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  });
  const stored = await storeBuffer(pdf, {
    filename: `${proj.name} — Incident Report.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug,
    tag: "SAFETY · Incident",
    subtitle: `Incident report · ${occurredLabel || "date n/a"}`,
  });

  await query(
    `INSERT INTO incident_reports (project_id, occurred_at, reporter, severity, notes, narrative, file_id)
     VALUES ($1, NULLIF($2,'')::date, $3, $4, $5, $6, $7)`,
    [proj.id, occurredAt, reporter, severity, notes, narrative, stored.ok ? stored.id : null],
  );

  await emit({
    kind: "compliance",
    tag: "Safety",
    accent: severity === "serious" ? "flag" : "accent",
    icon: "shield",
    flagged: severity === "serious",
    title: `Incident reported · ${proj.name}`,
    subline: `${SEVERITY_LABEL[severity]} — report generated`,
    href: `/projects/${slug}`,
  });

  revalidatePath(`/projects/${slug}`);
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
