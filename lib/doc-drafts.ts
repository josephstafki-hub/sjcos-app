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

import { readFile } from "node:fs/promises";
import path from "node:path";
import { query, queryOne } from "./db";
import { storeBuffer } from "./upload-store";
import { UPLOAD_DIR } from "./uploads";
import { sendNewEmail, gmailConfigured, type MailAttachment } from "./gmail";
import { ensureClientInvite, inviteLink } from "./client-invites";
import { getProjectSignerDefaults } from "./esign";
import { insertSentRequest } from "./esign-create";
import { getApprovalGate } from "./approval-gate";
import { getTemplate, listTemplates, templateManifest } from "./doc-templates/registry";
import { renderTemplatePdf, renderTemplateDocx, type SignatureStamp } from "./doc-render";
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
  client_visible: boolean;
  pdf_file_id: string | null;
  docx_file_id: string | null;
  signature_request_id: number | null;
  created_via: string;
  created_at?: Date;
  sig_signer_name?: string | null;
  sig_signed_name?: string | null;
  sig_signed_at?: Date | null;
  sig_sent_at?: Date | null;
  sig_decline_reason?: string | null;
}

export interface DraftView extends DraftRow {
  missing: string[];
  manifest: ReturnType<typeof templateManifest>;
  createdAtLabel: string;
  signerName: string;
  signedName: string | null;
  signedAtLabel: string | null;
  sentAtLabel: string | null;
  declineReason: string | null;
}

// Joined so each draft carries its own signing history — the "signed" label
// shown on the document row now that there's no separate Signatures tab.
const DRAFT_SELECT = `
  d.id, d.project_id, d.lead_slug, d.template_key, d.template_version, d.title,
  d.field_values, d.fill_report, d.status, d.client_visible, d.pdf_file_id, d.docx_file_id,
  d.signature_request_id, d.created_via, d.created_at,
  sr.signer_name AS sig_signer_name, sr.signed_name AS sig_signed_name,
  sr.signed_at AS sig_signed_at, sr.sent_at AS sig_sent_at,
  sr.decline_reason AS sig_decline_reason`;
const DRAFT_JOIN = `LEFT JOIN signature_requests sr ON sr.id = d.signature_request_id`;

function dateLabel(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

async function loadDraft(id: number): Promise<DraftRow | null> {
  const r = await queryOne<DraftRow>(
    `SELECT ${DRAFT_SELECT} FROM document_drafts d ${DRAFT_JOIN} WHERE d.id = $1`,
    [id],
  );
  if (!r) return null;
  return { ...r, id: Number(r.id) };
}

function viewOf(draft: DraftRow): DraftView {
  const template = getTemplate(draft.template_key);
  const missing = template ? validateForRender(template, draft.field_values).missing : [];
  return {
    ...draft,
    missing,
    manifest: template ? templateManifest(template) : ({} as never),
    createdAtLabel: dateLabel(draft.created_at) ?? "",
    signerName: draft.sig_signer_name ?? "",
    signedName: draft.sig_signed_name ?? null,
    signedAtLabel: dateLabel(draft.sig_signed_at),
    sentAtLabel: dateLabel(draft.sig_sent_at),
    declineReason: draft.sig_decline_reason ?? null,
  };
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

/** Render a project estimate to the same house-style Formal Estimate PDF the
 *  `estimate_doc` document generator produces — a live preview for the estimator
 *  (Money → Estimate). Rendered on the fly from the estimate's lines, no draft
 *  row. Returns null if the estimate doesn't exist under `slug`, or it's not yet
 *  renderable (e.g. no lines). Scoped by slug so one project can't preview
 *  another's estimate by id. */
export async function renderProjectEstimatePdf(slug: string, estimateId: number): Promise<Buffer | null> {
  const template = getTemplate("estimate_doc");
  if (!template) return null;
  // Confirm the estimate belongs to this project before rendering.
  const owns = await queryOne<{ id: string }>(
    `SELECT e.id FROM estimates e JOIN projects p ON p.id = e.project_id
      WHERE e.id = $1 AND p.slug = $2`,
    [estimateId, slug],
  );
  if (!owns) return null;
  const { values } = await resolveAutoFields("estimate_doc", { slug, estimateId });
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
      `SELECT ${DRAFT_SELECT} FROM document_drafts d
         JOIN projects p ON p.id = d.project_id ${DRAFT_JOIN}
        WHERE p.slug = $1 ORDER BY d.created_at DESC`,
      [scope.slug],
    );
    rows = r.rows;
  } else if (scope.leadSlug) {
    const r = await query<DraftRow>(
      `SELECT ${DRAFT_SELECT} FROM document_drafts d ${DRAFT_JOIN}
        WHERE d.lead_slug = $1 ORDER BY d.created_at DESC`,
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

/** Produce the EXECUTED copy of a just-signed document: re-render the PDF with
 *  the signature stamped onto the signer's line + a Certificate of Electronic
 *  Signature appended, then point both the signature request and the draft at
 *  it so "View document" and the owner's panel show the signed version.
 *
 *  Called from signSignatureRequest after the DB signature is recorded. Best
 *  effort by design: the signature is already legally recorded in the database
 *  (that's the binding act), so a render hiccup here must never fail the sign —
 *  the caller wraps it and ignores failure. No-op for legacy estimate-generated
 *  requests that have no draft row to re-render from. */
const SIG_EVENT_LABEL: Record<string, string> = {
  created: "Document created",
  sent: "Sent for signature",
  signed: "Signed electronically",
  declined: "Declined",
  voided: "Voided",
};

/** Build the SignatureStamp for a signed request — the data that renders the
 *  executed copy's stamp + certificate. Returns undefined if the request isn't
 *  actually signed. Shared by finalizeSignedDraft (the stored copy) and the
 *  owner preview route, so both show an identical certificate. */
export async function signatureStampFor(signatureRequestId: number): Promise<SignatureStamp | undefined> {
  const req = await queryOne<{
    signed_name: string | null;
    signed_at: Date | null;
    consent: boolean | null;
    signed_ip: string | null;
    signed_user_agent: string | null;
    contract_number: string | null;
  }>(
    `SELECT sr.signed_name, sr.signed_at, sr.consent, sr.signed_ip, sr.signed_user_agent,
            d.field_values->>'contract_number' AS contract_number
       FROM signature_requests sr
       LEFT JOIN document_drafts d ON d.signature_request_id = sr.id
      WHERE sr.id = $1`,
    [signatureRequestId],
  );
  if (!req?.signed_name || !req.signed_at) return undefined;

  const evRows = await query<{ kind: string; actor: string; created_at: Date }>(
    `SELECT kind, actor, created_at FROM signature_events
      WHERE request_id = $1 ORDER BY id`,
    [signatureRequestId],
  );
  return {
    signerName: req.signed_name,
    signedAt: req.signed_at,
    consent: req.consent ?? true,
    ip: req.signed_ip,
    userAgent: req.signed_user_agent,
    documentRef: req.contract_number || `Signature request #${signatureRequestId}`,
    events: evRows.rows.map((e) => ({
      label: SIG_EVENT_LABEL[e.kind] ?? e.kind,
      actor: e.actor,
      at: e.created_at,
    })),
  };
}

export async function finalizeSignedDraft(signatureRequestId: number): Promise<void> {
  const draft = await queryOne<DraftRow>(
    `SELECT ${DRAFT_SELECT} FROM document_drafts d ${DRAFT_JOIN}
      WHERE d.signature_request_id = $1`,
    [signatureRequestId],
  );
  if (!draft) return; // legacy request with no template draft — nothing to re-render
  const template = getTemplate(draft.template_key);
  if (!template) return;

  const stamp = await signatureStampFor(signatureRequestId);
  if (!stamp) return;

  const signed = await renderTemplatePdf(template, draft.field_values, stamp);

  const slug = await projectSlug(draft.project_id);
  const stored = await storeBuffer(signed, {
    filename: `${draft.title} (signed).pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug ?? undefined,
    tag: `${template.title.toUpperCase()} · SIGNED`,
    subtitle: `Executed copy · signed by ${stamp.signerName}`,
  });
  if (!stored.ok) return;

  // Point the request (client's "View document") and the draft at the executed
  // copy. Keep the DOCX untouched — it's the editable working copy, not a record.
  await query(`UPDATE signature_requests SET file_id = $2 WHERE id = $1`, [signatureRequestId, stored.id]);
  await query(`UPDATE document_drafts SET pdf_file_id = $2, updated_at = now() WHERE id = $1`, [draft.id, stored.id]);
}

// ─── Submit for signature (OWNER-ONLY — never reachable from AI/MCP) ─────────

/** What happened to the outbound email, reported alongside a successful send so
 *  the owner is never told "sent" when nothing actually left. */
export interface DeliveryNote {
  sent: boolean;
  note: string;
}

export interface SubmitResult {
  ok: true;
  signatureRequestId: number;
  delivery: DeliveryNote;
}

export async function submitDocDraftForSignature(
  id: number,
  owner: { id: string | null; name: string },
  override = false,
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

  // The contract carries the pre-con approval gate that used to live in the
  // Estimate tab's generate button — design + selections + estimate sign-offs
  // must all be complete before a contract goes out, unless overridden.
  if (draft.template_key === "contract" && slug && !override) {
    const gate = await getApprovalGate(slug);
    // contract_number is stamped "SJC-C-{slug}-{estimateId}" at draft-create
    // time (lib/doc-templates/fill.ts) — the only surviving link back to the
    // specific estimate this contract was built from.
    const m = /-(\d+)$/.exec(String(draft.field_values.contract_number ?? ""));
    const est = m
      ? await queryOne<{ status: string }>(`SELECT status FROM estimates WHERE id = $1`, [Number(m[1])])
      : await queryOne<{ status: string }>(
          `SELECT status FROM estimates WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [draft.project_id],
        );
    const missing: string[] = [];
    if (!gate.design) missing.push("design sign-off");
    if (!gate.selections) missing.push("selections approval");
    if (est?.status !== "approved") missing.push("estimate approval");
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Approval gate — still need: ${missing.join(", ")}. Complete these (or override the gate) before sending the contract.`,
      };
    }
  }
  const signer = slug
    ? await getProjectSignerDefaults(slug)
    : await leadSigner(draft.lead_slug);

  // Fall back to the email printed on the document itself. getProjectSignerDefaults
  // only knows about a linked client *account* (users table); a fresh project
  // usually has none yet, but the draft's own client_email — auto-filled from the
  // originating lead — is exactly who the document names, so it's the right
  // person to send to. Name likewise.
  const fieldEmail = String(draft.field_values.client_email ?? "").trim();
  const fieldName = String(draft.field_values.client_name ?? "").trim();
  if (!signer.email && fieldEmail) signer.email = fieldEmail;
  if (!signer.name && fieldName) signer.name = fieldName;

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

  // Actually deliver it. Until this existed, "sent" only ever meant "a row says
  // sent" — the client had no way to learn a document was waiting. The email
  // carries the PDF to read and a portal link to sign in, no account needed.
  const delivery = await emailDocForSignature({
    draftTitle: draft.title,
    pdfFileId: draft.pdf_file_id,
    signerName: signer.name,
    signerEmail: signer.email,
    projectSlug: slug,
    leadSlug: draft.lead_slug,
  });

  return { ok: true, signatureRequestId: reqId, delivery };
}

/** Email the rendered PDF + a portal link to the signer. Never throws: the
 *  signature request is already recorded, so a mail failure must not roll that
 *  back or hide it — it comes back as a delivery note the UI shows instead. */
async function emailDocForSignature(o: {
  draftTitle: string;
  pdfFileId: string;
  signerName: string;
  signerEmail: string;
  projectSlug: string | null;
  leadSlug: string | null;
}): Promise<DeliveryNote> {
  if (!o.signerEmail.trim()) {
    return { sent: false, note: "No email on file for this client — nothing was sent. Add one, or copy the portal link from the project and send it yourself." };
  }
  if (!gmailConfigured()) {
    return { sent: false, note: "Gmail isn't connected, so no email went out. The document is waiting in their portal." };
  }
  if (!o.projectSlug && !o.leadSlug) {
    return { sent: false, note: "No project or lead behind this document — send it manually." };
  }
  try {
    const invite = await ensureClientInvite(
      o.projectSlug ? { project: o.projectSlug } : { lead: o.leadSlug! },
    );
    const link = inviteLink(invite.token, "documents");
    const first = o.signerName.split(/\s+/)[0] || "there";

    const file = await queryOne<{ storage_path: string | null; name: string }>(
      `SELECT storage_path, name FROM files WHERE id = $1`,
      [o.pdfFileId],
    );
    let attachments: MailAttachment[] | undefined;
    if (file?.storage_path) {
      const bytes = await readFile(path.join(UPLOAD_DIR, path.basename(file.storage_path)));
      attachments = [
        { filename: file.name || `${o.draftTitle}.pdf`, mimeType: "application/pdf", content: bytes },
      ];
    }

    await sendNewEmail({
      to: o.signerEmail.trim(),
      subject: `Please review and sign: ${o.draftTitle}`,
      bodyText:
        `Hi ${first},\n\n` +
        `${o.draftTitle} is ready for your signature. A copy is attached for your records.\n\n` +
        `To sign it, open your project portal here:\n${link}\n\n` +
        `That link signs you in — there's no account to create and no password to remember. ` +
        `It works for 30 days, and from the portal you can also see your selections, schedule, ` +
        `and message me directly. If you'd rather have a password so you can sign in from ` +
        `anywhere, there's a "Create an account" option once you're in.\n\n` +
        `Any questions, just reply to this email.\n\nThanks,\nJoe\nSJ Carpentry`,
      attachments,
    });
    return { sent: true, note: `Emailed to ${o.signerEmail.trim()} with a portal link.` };
  } catch (err) {
    return { sent: false, note: `Recorded as sent, but the email failed: ${(err as Error).message}` };
  }
}

async function leadSigner(leadSlug: string | null): Promise<{ name: string; email: string }> {
  if (!leadSlug) return { name: "", email: "" };
  const l = await queryOne<{ name: string; email: string | null }>(
    `SELECT name, email FROM leads WHERE slug = $1`,
    [leadSlug],
  );
  return { name: l?.name ?? "", email: l?.email ?? "" };
}

// ─── Dashboard visibility ─────────────────────────────────────────────────────

/** Publish/unpublish a draft on the client dashboard. Publishing requires a
 *  rendered PDF — a visible document with nothing to open is a dead link. The
 *  owner-gated action wraps this and sends the publish notification email. */
export async function setDocDraftClientVisible(
  id: number,
  visible: boolean,
): Promise<{ ok: true; draft: DraftRow } | DraftError> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found.` };
  if (visible && !draft.pdf_file_id) {
    return { ok: false, error: "Render the document (Save & preview) before publishing it." };
  }
  if (visible && draft.status === "void") {
    return { ok: false, error: "A voided document can't be published." };
  }
  await query(
    `UPDATE document_drafts SET client_visible = $2, updated_at = now() WHERE id = $1`,
    [id, visible],
  );
  return { ok: true, draft: { ...draft, client_visible: visible } };
}

// ─── Void / clone / delete ───────────────────────────────────────────────────

export async function voidDocDraft(id: number): Promise<{ ok: true } | DraftError> {
  const r = await query(`UPDATE document_drafts SET status = 'void', updated_at = now() WHERE id = $1`, [id]);
  return r.rowCount ? { ok: true } : { ok: false, error: `Draft ${id} not found.` };
}

/** Hard-delete a draft that was never sent — a signed/sent document is voided
 *  instead (below), never deleted, so the audit trail survives. */
export async function deleteDocDraft(id: number): Promise<{ ok: true } | DraftError> {
  const r = await query(
    `DELETE FROM document_drafts WHERE id = $1 AND status IN ('draft','rendered','void')`,
    [id],
  );
  if (r.rowCount) return { ok: true };
  return { ok: false, error: "Sent or signed documents can't be deleted — void it instead." };
}

/** Owner is about to edit a document that's already been sent/signed. Voids the
 *  linked signature_request (even if already 'signed' — a stricter void than the
 *  client-facing one in lib/actions/esign.ts, which refuses to touch a signed
 *  request) and resets the draft to 'draft' so it can be edited and re-rendered.
 *  The UI must confirm with the owner before calling this — it's irreversible. */
export async function unlockDocDraftForEdit(
  id: number,
  ownerName: string,
): Promise<{ ok: true; voided: boolean } | DraftError> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found.` };
  const wasSent = draft.status === "submitted" || draft.status === "signed";
  if (wasSent && draft.signature_request_id) {
    await query(`UPDATE signature_requests SET status = 'void' WHERE id = $1`, [draft.signature_request_id]);
    await query(
      `INSERT INTO signature_events (request_id, kind, actor, detail)
       VALUES ($1, 'voided', $2, 'Voided automatically — document edited after send')`,
      [draft.signature_request_id, ownerName || "Owner"],
    );
  }
  await query(
    `UPDATE document_drafts SET status = 'draft', signature_request_id = NULL, updated_at = now() WHERE id = $1`,
    [id],
  );
  return { ok: true, voided: wasSent };
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
