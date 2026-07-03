"use server";

// Phase-2 B5 — Generate a contract / SOW from an approved estimate. Owner-gated.
// Renders a deterministic PDF (the signable artifact, attached to a
// signature_request) + an editable .docx record (saved to the project Files
// browser). The SOW's scope narrative is the only AI-authored part (Qwen); all
// figures come straight from the estimate. Reuses the Phase-1 e-sign flow: the
// generated request goes out as 'sent', the client signs it in the portal, and
// because it carries estimate_id, signing flips the estimate to 'approved'.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { storeBuffer } from "@/lib/upload-store";
import { getProjectSignerDefaults } from "@/lib/esign";
import { getApprovalGate } from "@/lib/approval-gate";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";
import { fmtUsd, unitLabel } from "@/lib/cost-book-units";
import {
  gatherDocData,
  renderContractPdf,
  renderContractDocx,
  renderSowPdf,
  renderSowDocx,
  drawAmount,
  type DocData,
} from "@/lib/documents";
import { type DrawLine, parseDrawSchedule, sumPercent } from "@/lib/draw-schedule";

type Result = { ok: true; id?: number } | { ok: false; error: string };

/** Compact text version of a document, stored on the signature_request as a
 *  fallback (shown if the PDF can't be served). */
function contractBody(d: DocData): string {
  const out: string[] = [`CONSTRUCTION CONTRACT — ${d.projectName}`, `${d.company.name} & ${d.clientName || "Client"}`, ""];
  out.push(`Total contract price: ${fmtUsd(d.total)}`, "", "Payment schedule:");
  for (const dl of d.drawSchedule) out.push(`  • ${dl.label} — ${dl.percent}% = ${fmtUsd(drawAmount(d.total, dl.percent))}`);
  if (d.terms) out.push("", "Terms:", d.terms);
  out.push("", "See the attached PDF for the full contract.");
  return out.join("\n");
}
function sowBody(d: DocData, narrative: string): string {
  const out: string[] = [`SCOPE OF WORK — ${d.projectName}`, ""];
  if (narrative.trim()) out.push(narrative.trim(), "");
  for (const g of d.groups) {
    out.push(`== ${g.section} ==`);
    for (const l of g.lines) out.push(`  • ${l.description}: ${l.qty} ${unitLabel(l.unit)} = ${fmtUsd(l.extended)}`);
  }
  out.push("", `TOTAL: ${fmtUsd(d.total)}`, "", "See the attached PDF for the full scope of work.");
  return out.join("\n");
}

/** Insert a 'sent' signature_request + its audit events, and notify the owner.
 *  Returns the new request id. */
async function createSentRequest(opts: {
  projectId: string;
  slug: string;
  estimateId: number;
  docType: "contract" | "sow";
  title: string;
  body: string;
  fileId: string;
  ownerName: string;
  ownerId: string;
  signerName: string;
  signerEmail: string;
  total: number;
}): Promise<number> {
  const ins = await queryOne<{ id: string }>(
    `INSERT INTO signature_requests
       (project_id, estimate_id, doc_type, title, body, file_id, status,
        signer_name, signer_email, created_by, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,$8,$9, now())
     RETURNING id`,
    [opts.projectId, opts.estimateId, opts.docType, opts.title, opts.body, opts.fileId, opts.signerName, opts.signerEmail, opts.ownerId],
  );
  const id = Number(ins!.id);
  await query(
    `INSERT INTO signature_events (request_id, kind, actor, detail)
     VALUES ($1, 'created', $2, $3), ($1, 'sent', $2, $4)`,
    [id, opts.ownerName, opts.title, `Sent to ${opts.signerName || opts.signerEmail || "client"}`],
  );
  await emit({
    kind: "decision",
    tag: "Signature",
    icon: "mail",
    accent: "ai",
    title: `${opts.docType === "contract" ? "Contract" : "Scope of Work"} sent for signature: ${opts.title}`,
    subline: `${fmtUsd(opts.total)} — awaiting client signature`,
    href: `/projects/${opts.slug}`,
  });
  return id;
}

export async function generateContract(slug: string, estimateId: number, force = false): Promise<Result> {
  const user = await requireRole("owner");
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return { ok: false, error: "Project not found." };

  const data = await gatherDocData(estimateId, slug);
  if (!data) return { ok: false, error: "Estimate not found." };
  if (data.groups.length === 0) return { ok: false, error: "Add at least one line to the estimate first." };

  // Pre-con approval gate: design + selections + estimate sign-offs must all be
  // complete before a contract goes out — unless the owner explicitly overrides.
  if (!force) {
    const gate = await getApprovalGate(slug);
    const est = await queryOne<{ status: string }>(`SELECT status FROM estimates WHERE id = $1`, [estimateId]);
    const estimateOk = est?.status === "approved";
    const missing: string[] = [];
    if (!gate.design) missing.push("design sign-off");
    if (!gate.selections) missing.push("selections approval");
    if (!estimateOk) missing.push("estimate approval");
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Approval gate — still need: ${missing.join(", ")}. Complete these (or override the gate) before generating the contract.`,
      };
    }
  }

  const fileBase = `${data.projectName} — Contract`;
  const pdf = await renderContractPdf(data);
  const pdfStored = await storeBuffer(pdf, {
    filename: `${fileBase}.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug,
    tag: "CONTRACT · PDF",
    subtitle: `Generated ${data.dateLabel} · sent for signature`,
  });
  if (!pdfStored.ok) return { ok: false, error: pdfStored.error };

  // Editable .docx record → lands in the project Files browser.
  const docx = await renderContractDocx(data);
  await storeBuffer(docx, {
    filename: `${fileBase}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    idPrefix: "doc",
    projectKey: slug,
    tag: "CONTRACT · DOCX",
    subtitle: `Editable copy · generated ${data.dateLabel}`,
  });

  const signer = await getProjectSignerDefaults(slug);
  const id = await createSentRequest({
    projectId: proj.id,
    slug,
    estimateId,
    docType: "contract",
    title: `${data.projectName} — Contract`,
    body: contractBody(data),
    fileId: pdfStored.id,
    ownerName: user.name || "Owner",
    ownerId: user.id,
    signerName: signer.name,
    signerEmail: signer.email,
    total: data.total,
  });

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  return { ok: true, id };
}

export async function generateSOW(slug: string, estimateId: number): Promise<Result> {
  const user = await requireRole("owner");
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!proj) return { ok: false, error: "Project not found." };

  const data = await gatherDocData(estimateId, slug);
  if (!data) return { ok: false, error: "Estimate not found." };
  if (data.groups.length === 0) return { ok: false, error: "Add at least one line to the estimate first." };

  // Qwen drafts ONLY the scope narrative — grounded on the real sections/lines,
  // never the figures. ai.ask already falls back to a deterministic stand-in.
  const context = data.groups
    .map((g) => `${g.section}: ${g.lines.map((l) => l.description).join(", ")}`)
    .join("\n");
  let narrative = "";
  try {
    const res = await ai.ask({
      prompt:
        `Write a concise, professional scope-of-work narrative (2–4 short paragraphs) for this ` +
        `residential carpentry/remodeling project: "${data.projectName}". Describe the work in clear, ` +
        `client-friendly language grouped by area. Do NOT invent prices, dates, brands, or specifics ` +
        `that aren't in the line items. End with a one-line note that detailed pricing follows.`,
      context,
    });
    narrative = (res.answer ?? "").trim();
  } catch {
    narrative = "";
  }

  const fileBase = `${data.projectName} — Scope of Work`;
  const pdf = await renderSowPdf(data, narrative);
  const pdfStored = await storeBuffer(pdf, {
    filename: `${fileBase}.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug,
    tag: "SOW · PDF",
    subtitle: `Generated ${data.dateLabel} · sent for signature`,
  });
  if (!pdfStored.ok) return { ok: false, error: pdfStored.error };

  const docx = await renderSowDocx(data, narrative);
  await storeBuffer(docx, {
    filename: `${fileBase}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    idPrefix: "doc",
    projectKey: slug,
    tag: "SOW · DOCX",
    subtitle: `Editable copy · generated ${data.dateLabel}`,
  });

  const signer = await getProjectSignerDefaults(slug);
  const id = await createSentRequest({
    projectId: proj.id,
    slug,
    estimateId,
    docType: "sow",
    title: `${data.projectName} — Scope of Work`,
    body: sowBody(data, narrative),
    fileId: pdfStored.id,
    ownerName: user.name || "Owner",
    ownerId: user.id,
    signerName: signer.name,
    signerEmail: signer.email,
    total: data.total,
  });

  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  return { ok: true, id };
}

/** Persist the editable draw schedule on the estimate (owner edits it before
 *  generating the contract). Lines must total 100%. */
export async function updateDrawSchedule(slug: string, estimateId: number, lines: DrawLine[]): Promise<Result> {
  await requireRole("owner");
  const clean = parseDrawSchedule(lines);
  if (!clean) return { ok: false, error: "Add at least one payment milestone." };
  const total = sumPercent(clean);
  if (Math.abs(total - 100) > 0.5) return { ok: false, error: `Percentages must add up to 100% (currently ${total}%).` };

  const row = await queryOne<{ id: string }>(
    `UPDATE estimates e SET draw_schedule = $1::jsonb
       FROM projects p
      WHERE e.id = $2 AND e.project_id = p.id AND p.slug = $3
      RETURNING e.id`,
    [JSON.stringify(clean), estimateId, slug],
  );
  if (!row) return { ok: false, error: "Estimate not found." };
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}
