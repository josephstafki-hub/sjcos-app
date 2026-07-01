"use server";

// Closeout write paths (Phase-4). Owner-gated. Generates a substantial-completion
// certificate (AI narrative + PDF record) and a final lien waiver (PDF issued as
// a lien_waiver signature_request the client counter-signs). Reuses the Phase-2
// document/e-sign infrastructure. Reads stay in lib/closeout.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { storeBuffer } from "@/lib/upload-store";
import { getProjectSignerDefaults } from "@/lib/esign";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";
import {
  gatherCloseoutData,
  renderCompletionCertificatePdf,
  renderLienWaiverPdf,
} from "@/lib/documents";

type Result = { ok: true; id?: string } | { ok: false; error: string };

/** Owner: generate a Certificate of Substantial Completion (AI summary of work
 *  + code-generated figures) → PDF stored in the project Files. */
export async function generateCompletionCertificate(slug: string): Promise<Result> {
  await requireRole("owner");
  const d = await gatherCloseoutData(slug);
  if (!d) return { ok: false, error: "Project not found." };

  // Qwen drafts ONLY a brief summary of the work — never figures or dates.
  let narrative = "";
  try {
    const res = await ai.ask({
      prompt:
        `Write a brief, professional 2–3 sentence summary of the completed work for a residential ` +
        `carpentry/remodeling project titled "${d.projectName}", for a certificate of substantial ` +
        `completion. Client-friendly, factual. Do NOT invent prices, dates, or specifics.`,
      context: d.address ? `Project address: ${d.address}` : undefined,
    });
    narrative = (res.answer ?? "").trim();
  } catch {
    narrative = "";
  }

  const pdf = await renderCompletionCertificatePdf(d, narrative);
  const stored = await storeBuffer(pdf, {
    filename: `${d.projectName} — Certificate of Completion.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug,
    tag: "CLOSEOUT · Completion",
    subtitle: `Generated ${d.dateLabel}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  await emit({
    kind: "job",
    tag: "Closeout",
    accent: "accent",
    icon: "project",
    title: `Completion certificate generated · ${d.projectName}`,
    subline: "Substantial completion documented",
    href: `/projects/${slug}`,
  });

  revalidatePath(`/projects/${slug}`);
  return { ok: true, id: stored.id };
}

/** Owner: generate the final lien waiver → PDF + a lien_waiver signature request
 *  the client counter-signs in their portal. */
export async function generateLienWaiver(slug: string): Promise<Result> {
  const user = await requireRole("owner");
  const d = await gatherCloseoutData(slug);
  if (!d) return { ok: false, error: "Project not found." };

  const pdf = await renderLienWaiverPdf(d);
  const stored = await storeBuffer(pdf, {
    filename: `${d.projectName} — Final Lien Waiver.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug,
    tag: "CLOSEOUT · Lien waiver",
    subtitle: `Generated ${d.dateLabel}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  const signer = await getProjectSignerDefaults(slug);
  const body =
    `FINAL WAIVER AND RELEASE OF LIEN — ${d.projectName}\n\n` +
    `Upon final payment, ${d.company.name} waives and releases all mechanic's lien rights for the ` +
    `property at ${d.address || "[address]"}. See the attached PDF for the full waiver.`;

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO signature_requests
       (project_id, doc_type, title, body, file_id, status, signer_name, signer_email, created_by, sent_at)
     VALUES ($1, 'lien_waiver', $2, $3, $4, 'sent', $5, $6, $7, now())
     RETURNING id`,
    [d.projectId, `${d.projectName} — Final Lien Waiver`, body, stored.id, signer.name, signer.email, user.id],
  );
  const reqId = Number(ins!.id);
  await query(
    `INSERT INTO signature_events (request_id, kind, actor, detail)
     VALUES ($1, 'created', $2, $3), ($1, 'sent', $2, $4)`,
    [reqId, user.name || "Owner", "Final Lien Waiver", `Sent to ${signer.name || signer.email || "client"}`],
  );

  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "mail",
    accent: "ai",
    title: `Lien waiver sent for signature · ${d.projectName}`,
    subline: "Final waiver and release of lien",
    href: `/projects/${slug}`,
  });

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  return { ok: true, id: stored.id };
}
