"use server";

// Floor-plan designer: drawing-set output paths (docs/floor-plan-designer-
// plan.md §8, §10). Owner/staff (projects area) gated:
//   renderPlanSheetsPdf   — render the chosen sheets to a PDF file on the design
//   publishPlanVersion    — cut/choose a version, render it, and stage a
//                           project_floorplans row (the owner flips the existing
//                           publish switch on the Floor tab — that path emails)
//   sendDesignForSignature — STAGE a signature_requests draft on the sheet PDF;
//                           sending stays behind the owner grant elsewhere.
// Nothing here emails a client.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { getCompanyDocInfo } from "@/lib/documents";
import { migrateDoc, type PlanDoc } from "@/lib/plan-doc";
import { getPlanDesign, getPlanDesignVersion, type PlanDesign } from "@/lib/plan-designs";
import { renderPlanSheets, type PrintCapture } from "@/lib/plan-print";
import { SHEET_KEYS, type SheetKey, type SheetRequest } from "@/lib/plan-print-types";
import { storeBuffer } from "@/lib/upload-store";
import { UPLOAD_DIR } from "@/lib/uploads";

const PAPERS = new Set(["letter", "tabloid", "arch-d"]);
const ORIENTATIONS = new Set(["portrait", "landscape"]);
const MAX_NOTES = 4000;
const WATERMARK = "NOT FOR CONSTRUCTION";

type Fail = { ok: false; error: string };

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date());
}

function cleanRequest(req: SheetRequest): { ok: true; req: SheetRequest } | Fail {
  const sheets = (Array.isArray(req?.sheets) ? req.sheets : []).filter(
    (s, i, arr): s is SheetKey => (SHEET_KEYS as readonly string[]).includes(s) && arr.indexOf(s) === i,
  );
  if (!sheets.length) return { ok: false, error: "Pick at least one sheet." };
  const paper = PAPERS.has(req.paper) ? req.paper : "letter";
  const orientation = ORIENTATIONS.has(req.orientation) ? req.orientation : "landscape";
  const versionId = req.versionId == null ? null : Number(req.versionId);
  if (versionId !== null && !Number.isInteger(versionId)) return { ok: false, error: "Bad version id." };
  const captureFileIds = (Array.isArray(req.captureFileIds) ? req.captureFileIds : [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, 24);
  return {
    ok: true,
    req: { versionId, sheets, paper, orientation, captureFileIds, notes: String(req.notes ?? "").trim().slice(0, MAX_NOTES) },
  };
}

interface Resolved {
  design: PlanDesign;
  doc: PlanDoc;
  /** Snapshot the doc came from (null = live doc). */
  version: { id: number; number: number; label: string } | null;
  /** Number shown on the set: the snapshot's, else the next one. */
  number: number;
  versionLabel: string;
  project: { name: string; clientName: string; address: string } | null;
}

/** Load the design plus the doc to print (a snapshot when versionId is set). */
async function resolveDesign(designId: number, versionId: number | null): Promise<Resolved | Fail> {
  const design = await getPlanDesign(designId);
  if (!design) return { ok: false, error: "Design not found." };
  let doc = design.doc;
  let version: Resolved["version"] = null;
  let number = (design.latestVersion?.number ?? 0) + 1;
  let versionLabel = `v${number} · working draft`;
  if (versionId !== null) {
    const v = await getPlanDesignVersion(versionId);
    if (!v || v.designId !== design.id) return { ok: false, error: "That version is not on this design." };
    doc = v.doc;
    version = { id: v.id, number: v.number, label: v.label };
    number = v.number;
    versionLabel = v.label ? `v${v.number} · ${v.label}` : `v${v.number}`;
  }
  let project: Resolved["project"] = null;
  if (design.projectId) {
    const p = await queryOne<{ name: string; client_name: string | null; address: string | null }>(
      `SELECT name, client_name, address FROM projects WHERE id = $1`,
      [design.projectId],
    );
    if (p) project = { name: p.name, clientName: p.client_name ?? "", address: p.address ?? "" };
  } else if (design.leadSlug) {
    const l = await queryOne<{ name: string | null; address: string | null }>(
      `SELECT name, address FROM leads WHERE slug = $1`,
      [design.leadSlug],
    );
    project = { name: design.name, clientName: l?.name ?? design.leadName ?? "", address: l?.address ?? "" };
  }
  return { design, doc: migrateDoc(doc), version, number, versionLabel, project };
}

/** Captures must belong to this design; missing blobs are skipped, not fatal. */
async function loadCaptures(designId: number, fileIds: string[]): Promise<PrintCapture[]> {
  if (!fileIds.length) return [];
  const { rows } = await query<{ file_id: string; label: string; storage_path: string | null }>(
    `SELECT pf.file_id, pf.label, f.storage_path
       FROM plan_design_files pf JOIN files f ON f.id = pf.file_id
      WHERE pf.design_id = $1 AND pf.kind = 'capture' AND pf.file_id = ANY($2::text[])`,
    [designId, fileIds],
  );
  const byId = new Map(rows.map((r) => [r.file_id, r]));
  const out: PrintCapture[] = [];
  for (const id of fileIds) {
    const r = byId.get(id);
    if (!r?.storage_path) continue;
    try {
      const png = await readFile(path.join(UPLOAD_DIR, path.basename(r.storage_path)));
      out.push({ fileId: id, label: r.label || "3D view", png });
    } catch {
      // Blob gone from disk — leave it out of the set.
    }
  }
  return out;
}

/** Render + store the sheet PDF and index it on the design. Shared by both
 *  render-only and publish. */
async function renderAndStore(
  r: Resolved,
  req: SheetRequest,
  captures: PrintCapture[],
): Promise<{ ok: true; fileId: string } | Fail> {
  const { company } = await getCompanyDocInfo();
  let pdf: Buffer;
  try {
    pdf = await renderPlanSheets({
      doc: r.doc,
      designName: r.design.name,
      versionLabel: r.versionLabel,
      dateLabel: todayLabel(),
      project: r.project,
      company,
      sheets: req.sheets,
      paper: req.paper,
      orientation: req.orientation,
      captures,
      notes: req.notes,
      watermark: WATERMARK,
    });
  } catch (e) {
    return { ok: false, error: `Could not render the plan set: ${e instanceof Error ? e.message : String(e)}` };
  }
  const stored = await storeBuffer(pdf, {
    filename: `${r.design.name} v${r.number} plan set.pdf`,
    mime: "application/pdf",
    idPrefix: "sheet",
    projectKey: r.design.projectName ?? "",
    tag: "PLAN SET",
    subtitle: `${r.design.name} · ${r.versionLabel} · ${req.sheets.length} sheet${req.sheets.length === 1 ? "" : "s"}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };
  if (!r.design.projectId && r.design.leadSlug) {
    await query(`UPDATE files SET lead_slug = $1 WHERE id = $2`, [r.design.leadSlug, stored.id]);
  }
  await query(
    `INSERT INTO plan_design_files (design_id, version_id, file_id, kind, label)
     VALUES ($1, $2, $3, 'sheet_pdf', $4)`,
    [r.design.id, r.version?.id ?? null, stored.id, `Plan set ${r.versionLabel} · ${req.paper} ${req.orientation}`],
  );
  return { ok: true, fileId: stored.id };
}

function revalidateDesign(design: PlanDesign) {
  revalidatePath(`/floor/${design.id}`);
  revalidatePath("/floor");
  if (design.projectSlug) revalidatePath(`/projects/${design.projectSlug}`);
  if (design.leadSlug) revalidatePath(`/leads/${design.leadSlug}`);
}

/** Render the chosen sheets (live doc, or a saved version) to a PDF stored on
 *  the design. Returns the file id + its owner-only download URL. */
export async function renderPlanSheetsPdf(
  designId: number,
  req: SheetRequest,
): Promise<{ ok: true; fileId: string; url: string } | { ok: false; error: string }> {
  await requireAccess("projects");
  const c = cleanRequest(req);
  if (!c.ok) return c;
  const r = await resolveDesign(Number(designId), c.req.versionId);
  if ("ok" in r) return r;
  const captures = await loadCaptures(r.design.id, c.req.captureFileIds);
  const stored = await renderAndStore(r, c.req, captures);
  if (!stored.ok) return stored;
  revalidateDesign(r.design);
  return { ok: true, fileId: stored.fileId, url: `/api/files/${stored.fileId}` };
}

/** Publish a plan version: snapshot (unless one is chosen), render the set,
 *  and stage a project_floorplans row pointing at the design + snapshot. Does
 *  NOT set published_at — the owner flips the existing publish switch on the
 *  Floor tab, which is the path that notifies the client. Lead-scoped designs
 *  just get the PDF filed on the lead (floorplanId 0). */
export async function publishPlanVersion(
  designId: number,
  req: SheetRequest,
): Promise<{ ok: true; floorplanId: number; versionId: number; fileId: string } | { ok: false; error: string }> {
  const user = await requireAccess("projects");
  const c = cleanRequest(req);
  if (!c.ok) return c;
  const id = Number(designId);

  let versionId = c.req.versionId;
  if (versionId === null) {
    const src = await queryOne<{ doc: unknown }>(`SELECT doc FROM plan_designs WHERE id = $1`, [id]);
    if (!src) return { ok: false, error: "Design not found." };
    const row = await queryOne<{ id: string }>(
      `INSERT INTO plan_design_versions (design_id, number, label, doc, created_by)
       VALUES ($1, (SELECT COALESCE(MAX(number), 0) + 1 FROM plan_design_versions WHERE design_id = $1), 'Published', $2::jsonb, $3)
       RETURNING id`,
      [id, JSON.stringify(migrateDoc(src.doc)), user.id],
    );
    versionId = Number(row!.id);
  }

  const r = await resolveDesign(id, versionId);
  if ("ok" in r) return r;
  const captures = await loadCaptures(r.design.id, c.req.captureFileIds);
  const stored = await renderAndStore(r, c.req, captures);
  if (!stored.ok) return stored;

  let floorplanId = 0;
  if (r.design.projectId) {
    const notes = `${r.design.name} · plan set v${r.number}${c.req.notes ? ` — ${c.req.notes}` : ""}`;
    const fp = await queryOne<{ id: string }>(
      `INSERT INTO project_floorplans
         (project_id, version, file_id, notes, design_id, design_version_id, preview_file_id)
       VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM project_floorplans WHERE project_id = $1), $2, $3, $4, $5, $6)
       RETURNING id`,
      [r.design.projectId, stored.fileId, notes, r.design.id, versionId, captures[0]?.fileId ?? null],
    );
    floorplanId = Number(fp!.id);
  }
  revalidateDesign(r.design);
  return { ok: true, floorplanId, versionId, fileId: stored.fileId };
}

/** Stage (never send) a signature request on a published plan version's sheet
 *  PDF: a signature_requests draft with doc_type 'design'. Sending stays on
 *  the project's Documents tab behind the owner grant. */
export async function sendDesignForSignature(
  designId: number,
  floorplanId: number,
  input: { signerName: string; signerEmail: string; title: string },
): Promise<{ ok: boolean; error?: string; note?: string }> {
  const user = await requireAccess("projects");
  const fp = await queryOne<{ id: string; project_id: string; version: number; file_id: string | null; slug: string; design_name: string }>(
    `SELECT fp.id, fp.project_id, fp.version, fp.file_id, p.slug, d.name AS design_name
       FROM project_floorplans fp
       JOIN projects p ON p.id = fp.project_id
       JOIN plan_designs d ON d.id = fp.design_id
      WHERE fp.id = $1 AND fp.design_id = $2`,
    [Number(floorplanId), Number(designId)],
  );
  if (!fp) return { ok: false, error: "That plan version is not on this design." };
  if (!fp.file_id) return { ok: false, error: "This plan version has no sheet PDF to sign." };
  const signerName = String(input?.signerName ?? "").trim().slice(0, 120);
  const signerEmail = String(input?.signerEmail ?? "").trim().slice(0, 200);
  const title = String(input?.title ?? "").trim().slice(0, 200) || `${fp.design_name} — plan set v${fp.version}`;
  if (!signerName) return { ok: false, error: "Who signs? Add the signer's name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signerEmail)) return { ok: false, error: "Enter a valid signer email." };

  const ins = await queryOne<{ id: string }>(
    `INSERT INTO signature_requests
       (project_id, doc_type, title, body, file_id, status, signer_name, signer_email, created_by)
     VALUES ($1, 'design', $2, '', $3, 'draft', $4, $5, $6)
     RETURNING id`,
    [fp.project_id, title, fp.file_id, signerName, signerEmail, user.id],
  );
  const requestId = Number(ins!.id);
  await query(
    `INSERT INTO signature_events (request_id, kind, actor, detail) VALUES ($1, 'created', $2, $3)`,
    [requestId, user.name || "Owner", `Staged from the floor-plan designer (plan version ${fp.version})`],
  );
  revalidatePath(`/projects/${fp.slug}`);
  revalidatePath(`/floor/${Number(designId)}`);
  return {
    ok: true,
    note: "Staged for signature as a draft — send it from the project's Documents tab (owner approval).",
  };
}
