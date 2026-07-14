import "server-only";

// Document-draft lifecycle engine (doc-templates plan, Phase 4). Plain server
// helpers — NOT "use server". The owner-gated server actions
// (lib/actions/doc-drafts.ts) and the token-guarded agent route
// (app/api/internal/doc-drafts) both call these; auth is the CALLER's job. A
// draft is the editable unit: field_values JSON that renders deterministically
// to PDF (signable) + DOCX (owner escape hatch). AI may edit only narrative
// fields (enforced by applyFieldEdits actor 'ai'); NOTHING here sends — only
// submitDocDraftForSignature creates a signature_request, and that is invoked
// solely from the owner-gated action.

import { query, queryOne } from "./db";
import { storeBuffer } from "./upload-store";
import { getProjectSignerDefaults } from "./esign";
import { insertSentRequest } from "./esign-create";
import { getTemplate, listTemplates, templateManifest } from "./doc-templates/registry";
import { renderTemplatePdf, renderTemplateDocx } from "./doc-render";
import {
  resolveAutoFields,
  applyFieldEdits,
  validateForRender,
  type FillScope,
  type Actor,
  type FillReport,
} from "./doc-templates/fill";
import type { DocType } from "./esign-types";
import type { FieldValues } from "./doc-templates/types";

/** templateKey → signature_requests.doc_type (invoices don't sign). */
const DOC_TYPE_BY_TEMPLATE: Record<string, DocType> = {
  contract: "contract",
  precon: "precon",
  lien_release: "lien_waiver",
  completion_cert: "completion",
  change_order: "change_order",
  estimate_doc: "estimate",
};

export interface DraftRow {
  id: number;
  project_id: string | null;
  lead_slug: string | null;
  template_key: string;
  template_version: string;
  title: string;
  field_values: FieldValues;
  fill_report: FillReport;
  status: string;
  pdf_file_id: string | null;
  docx_file_id: string | null;
  signature_request_id: number | null;
  created_via: string;
}

export interface DraftView extends DraftRow {
  missing: string[];
  manifest: ReturnType<typeof templateManifest>;
}

async function loadDraft(id: number): Promise<DraftRow | null> {
  const r = await queryOne<DraftRow>(
    `SELECT id, project_id, lead_slug, template_key, template_version, title,
            field_values, fill_report, status, pdf_file_id, docx_file_id,
            signature_request_id, created_via
       FROM document_drafts WHERE id = $1`,
    [id],
  );
  if (!r) return null;
  return { ...r, id: Number(r.id) };
}

function viewOf(draft: DraftRow): DraftView {
  const template = getTemplate(draft.template_key);
  const missing = template ? validateForRender(template, draft.field_values).missing : [];
  return { ...draft, missing, manifest: template ? templateManifest(template) : ({} as never) };
}

/** Slug used for the project Files browser (null for lead-scoped drafts). */
async function projectSlug(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const p = await queryOne<{ slug: string }>(`SELECT slug FROM projects WHERE id = $1`, [projectId]);
  return p?.slug ?? null;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function listDocTemplates() {
  return listTemplates().map(templateManifest);
}

/** Render a lead's rough estimate to a house-style PDF buffer (for emailing it
 *  to the lead). Returns null if no rough estimate has been drafted yet. Renders
 *  on the fly from lead_estimates — no draft row needed. */
export async function renderRoughEstimatePdf(leadSlug: string): Promise<Buffer | null> {
  const template = getTemplate("rough_estimate");
  if (!template) return null;
  const { values } = await resolveAutoFields("rough_estimate", { leadSlug });
  if (!validateForRender(template, values).ok) return null;
  return renderTemplatePdf(template, values);
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateResult {
  ok: true;
  id: number;
  fillReport: FillReport;
  missing: string[];
  title: string;
}
export type DraftError = { ok: false; error: string };

export async function createDocDraft(
  templateKey: string,
  scope: FillScope,
  opts: { createdVia?: string; createdBy?: string | null } = {},
): Promise<CreateResult | DraftError> {
  const template = getTemplate(templateKey);
  if (!template) return { ok: false, error: `Unknown template '${templateKey}'.` };

  // Resolve the scope to a concrete project_id / lead_slug.
  let projectId: string | null = null;
  let leadSlug: string | null = null;
  if (scope.slug) {
    const p = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [scope.slug]);
    if (!p) return { ok: false, error: `Project '${scope.slug}' not found.` };
    projectId = p.id;
  } else if (scope.leadSlug) {
    const l = await queryOne<{ slug: string }>(`SELECT slug FROM leads WHERE slug = $1`, [scope.leadSlug]);
    if (!l) return { ok: false, error: `Lead '${scope.leadSlug}' not found.` };
    leadSlug = scope.leadSlug;
  } else {
    return { ok: false, error: "Provide a project slug or lead slug." };
  }
  if (template.scope === "project" && !projectId) {
    return { ok: false, error: `Template '${templateKey}' is project-scoped — provide a project slug.` };
  }

  const { values, fillReport, title } = await resolveAutoFields(templateKey, scope);
  const draftTitle = title || template.title;

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO document_drafts
       (project_id, lead_slug, template_key, template_version, title, field_values,
        fill_report, status, created_by, created_via)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'draft',$8,$9)
     RETURNING id`,
    [
      projectId,
      leadSlug,
      templateKey,
      template.version,
      draftTitle,
      JSON.stringify(values),
      JSON.stringify(fillReport),
      opts.createdBy ?? null,
      opts.createdVia ?? "app",
    ],
  );
  const id = Number(ins!.id);
  const missing = validateForRender(template, values).missing;
  return { ok: true, id, fillReport, missing, title: draftTitle };
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getDocDraft(id: number): Promise<DraftView | null> {
  const d = await loadDraft(id);
  return d ? viewOf(d) : null;
}

export async function listDocDrafts(scope: { slug?: string; leadSlug?: string }): Promise<DraftView[]> {
  let rows: DraftRow[];
  if (scope.slug) {
    const r = await query<DraftRow>(
      `SELECT d.id, d.project_id, d.lead_slug, d.template_key, d.template_version, d.title,
              d.field_values, d.fill_report, d.status, d.pdf_file_id, d.docx_file_id,
              d.signature_request_id, d.created_via
         FROM document_drafts d JOIN projects p ON p.id = d.project_id
        WHERE p.slug = $1 ORDER BY d.created_at DESC`,
      [scope.slug],
    );
    rows = r.rows;
  } else if (scope.leadSlug) {
    const r = await query<DraftRow>(
      `SELECT id, project_id, lead_slug, template_key, template_version, title,
              field_values, fill_report, status, pdf_file_id, docx_file_id,
              signature_request_id, created_via
         FROM document_drafts WHERE lead_slug = $1 ORDER BY created_at DESC`,
      [scope.leadSlug],
    );
    rows = r.rows;
  } else {
    return [];
  }
  return rows.map((d) => viewOf({ ...d, id: Number(d.id) }));
}

// ─── Update fields ───────────────────────────────────────────────────────────

export interface UpdateResult {
  ok: true;
  fillReport: FillReport;
  rejected: Record<string, string>;
  missing: string[];
  stale: boolean;
}

export async function updateDocDraftFields(
  id: number,
  edits: Record<string, unknown>,
  actor: Actor,
): Promise<UpdateResult | DraftError> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found.` };
  if (draft.status === "submitted" || draft.status === "signed") {
    return { ok: false, error: "Draft is locked (submitted). Void and clone it to revise." };
  }
  const template = getTemplate(draft.template_key);
  if (!template) return { ok: false, error: `Unknown template '${draft.template_key}'.` };

  const { values, fillReport, rejected } = applyFieldEdits(
    template,
    draft.field_values,
    draft.fill_report,
    edits,
    actor,
  );

  // A rendered draft whose values changed becomes stale (re-render replaces files).
  const stale = draft.status === "rendered";
  await query(
    `UPDATE document_drafts
        SET field_values = $2::jsonb, fill_report = $3::jsonb,
            status = CASE WHEN status = 'rendered' THEN 'draft' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [id, JSON.stringify(values), JSON.stringify(fillReport)],
  );
  const missing = validateForRender(template, values).missing;
  return { ok: true, fillReport, rejected, missing, stale };
}

// ─── Render ──────────────────────────────────────────────────────────────────

export interface RenderResult {
  ok: true;
  pdfFileId: string;
  docxFileId: string;
}

export async function renderDocDraft(id: number): Promise<RenderResult | (DraftError & { missing?: string[] })> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found.` };
  const template = getTemplate(draft.template_key);
  if (!template) return { ok: false, error: `Unknown template '${draft.template_key}'.` };

  const check = validateForRender(template, draft.field_values);
  if (!check.ok) {
    return { ok: false, error: `Still need: ${check.missing.join(", ")}.`, missing: check.missing };
  }

  const slug = await projectSlug(draft.project_id);
  const tagBase = template.title.toUpperCase();
  const pdf = await renderTemplatePdf(template, draft.field_values);
  const pdfStored = await storeBuffer(pdf, {
    filename: `${draft.title}.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug ?? undefined,
    tag: `${tagBase} · PDF`,
    subtitle: `Draft #${id} · ${template.key} v${template.version}`,
  });
  if (!pdfStored.ok) return { ok: false, error: pdfStored.error };

  const docx = await renderTemplateDocx(template, draft.field_values);
  const docxStored = await storeBuffer(docx, {
    filename: `${draft.title}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    idPrefix: "doc",
    projectKey: slug ?? undefined,
    tag: `${tagBase} · DOCX`,
    subtitle: `Editable copy · draft #${id}`,
  });
  const docxId = docxStored.ok ? docxStored.id : null;

  await query(
    `UPDATE document_drafts
        SET pdf_file_id = $2, docx_file_id = $3, template_version = $4,
            status = CASE WHEN status IN ('draft','rendered') THEN 'rendered' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [id, pdfStored.id, docxId, template.version],
  );
  return { ok: true, pdfFileId: pdfStored.id, docxFileId: docxId ?? "" };
}

// ─── Submit for signature (OWNER-ONLY — never reachable from AI/MCP) ─────────

export interface SubmitResult {
  ok: true;
  signatureRequestId: number;
}

export async function submitDocDraftForSignature(
  id: number,
  owner: { id: string | null; name: string },
): Promise<SubmitResult | DraftError> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found.` };
  if (draft.status === "submitted" || draft.status === "signed") {
    return { ok: false, error: "Draft already submitted." };
  }
  if (!draft.pdf_file_id || draft.status !== "rendered") {
    return { ok: false, error: "Render the draft before submitting it for signature." };
  }
  const docType = DOC_TYPE_BY_TEMPLATE[draft.template_key];
  if (!docType) return { ok: false, error: `Template '${draft.template_key}' is not signable.` };

  const slug = await projectSlug(draft.project_id);
  const signer = slug
    ? await getProjectSignerDefaults(slug)
    : await leadSigner(draft.lead_slug);

  const reqId = await insertSentRequest({
    projectId: draft.project_id,
    leadSlug: draft.lead_slug,
    docType,
    title: draft.title,
    body: `${draft.title}\n\nSee the attached PDF for the full document.`,
    fileId: draft.pdf_file_id,
    ownerName: owner.name || "Owner",
    ownerId: owner.id,
    signerName: signer.name,
    signerEmail: signer.email,
    notify: {
      subline: "Awaiting client signature",
      href: slug ? `/projects/${slug}` : draft.lead_slug ? `/leads/${draft.lead_slug}` : "/today",
    },
  });

  await query(
    `UPDATE document_drafts SET signature_request_id = $2, status = 'submitted', updated_at = now()
      WHERE id = $1`,
    [id, reqId],
  );
  return { ok: true, signatureRequestId: reqId };
}

async function leadSigner(leadSlug: string | null): Promise<{ name: string; email: string }> {
  if (!leadSlug) return { name: "", email: "" };
  const l = await queryOne<{ name: string; email: string | null }>(
    `SELECT name, email FROM leads WHERE slug = $1`,
    [leadSlug],
  );
  return { name: l?.name ?? "", email: l?.email ?? "" };
}

// ─── Void / clone ────────────────────────────────────────────────────────────

export async function voidDocDraft(id: number): Promise<{ ok: true } | DraftError> {
  const r = await query(`UPDATE document_drafts SET status = 'void', updated_at = now() WHERE id = $1`, [id]);
  return r.rowCount ? { ok: true } : { ok: false, error: `Draft ${id} not found.` };
}

export async function cloneDocDraft(
  id: number,
  createdBy: string | null,
): Promise<{ ok: true; id: number } | DraftError> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found.` };
  const ins = await queryOne<{ id: string }>(
    `INSERT INTO document_drafts
       (project_id, lead_slug, template_key, template_version, title, field_values,
        fill_report, status, created_by, created_via)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'draft',$8,'app')
     RETURNING id`,
    [
      draft.project_id,
      draft.lead_slug,
      draft.template_key,
      draft.template_version,
      `${draft.title} (copy)`,
      JSON.stringify(draft.field_values),
      JSON.stringify(draft.fill_report),
      createdBy,
    ],
  );
  return { ok: true, id: Number(ins!.id) };
}
