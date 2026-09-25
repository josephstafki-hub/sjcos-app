"use server";

// Files attached to a floor-plan design: 3D captures (PNG from the browser
// canvas), underlay images to trace over, and site photos for photo pins.
// Owner/staff (projects area). Blobs go through the shared upload helper and
// are served by the owner-only /api/files/[id] route; the client portal reads
// captures through the published floor-plan version instead.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { storeBuffer, storeUpload } from "@/lib/upload-store";
import { UPLOAD_DIR } from "@/lib/uploads";
import { isPdf, underlayImage } from "@/lib/plan-underlay";

type Result = { ok: boolean; error?: string };

async function designScope(designId: number) {
  return queryOne<{ id: string; project_key: string; lead_slug: string | null; name: string }>(
    `SELECT d.id, COALESCE(p.slug, '') AS project_key, d.lead_slug, d.name
       FROM plan_designs d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = $1`,
    [designId],
  );
}

/** Store a browser-rendered PNG (or any image) as a capture of this design.
 *  formData: file (Blob), label, camera (JSON string, optional), versionId. */
export async function uploadPlanCapture(
  designId: number,
  formData: FormData,
): Promise<{ ok: true; fileId: string; id: number } | { ok: false; error: string }> {
  await requireAccess("projects");
  const scope = await designScope(designId);
  if (!scope) return { ok: false, error: "Design not found." };

  const file = formData.get("file");
  const label = String(formData.get("label") ?? "").trim().slice(0, 120);
  const cameraRaw = String(formData.get("camera") ?? "");
  const versionId = Number(formData.get("versionId") ?? 0) || null;
  const kind = (String(formData.get("kind") ?? "capture") as "capture" | "underlay" | "photo");
  if (!["capture", "underlay", "photo"].includes(kind)) return { ok: false, error: "Unknown file kind." };

  const stored = await storeUpload(file, {
    idPrefix: kind === "capture" ? "cap" : kind === "underlay" ? "und" : "pho",
    projectKey: scope.project_key || undefined,
    leadSlug: scope.lead_slug ?? undefined,
    tag: kind === "capture" ? "3D VIEW" : kind === "underlay" ? "UNDERLAY" : "SITE PHOTO",
    subtitle: `${scope.name} · ${label || kind}`,
    imagesOnly: kind !== "underlay",
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  let camera: unknown = null;
  if (cameraRaw) {
    try {
      camera = JSON.parse(cameraRaw);
    } catch {
      camera = null;
    }
  }
  const row = await queryOne<{ id: string }>(
    `INSERT INTO plan_design_files (design_id, version_id, file_id, kind, label, camera)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [designId, versionId, stored.id, kind, label, camera == null ? null : JSON.stringify(camera)],
  );
  revalidatePath(`/floor/${designId}`);
  return { ok: true, fileId: stored.id, id: Number(row!.id) };
}

export async function renamePlanFile(id: number, label: string): Promise<Result> {
  await requireAccess("projects");
  const r = await queryOne<{ design_id: string }>(
    `UPDATE plan_design_files SET label = $2 WHERE id = $1 RETURNING design_id`,
    [id, label.trim().slice(0, 120)],
  );
  if (!r) return { ok: false, error: "File not found." };
  revalidatePath(`/floor/${r.design_id}`);
  return { ok: true };
}

/** Detach a capture/underlay/photo from the design (the files row stays so any
 *  published sheet that embedded it keeps working). */
export async function removePlanFile(id: number): Promise<Result> {
  await requireAccess("projects");
  const r = await queryOne<{ design_id: string }>(`DELETE FROM plan_design_files WHERE id = $1 RETURNING design_id`, [id]);
  if (!r) return { ok: false, error: "File not found." };
  revalidatePath(`/floor/${r.design_id}`);
  return { ok: true };
}

/** Existing project / lead files (images and PDFs) the designer can trace over. */
export async function listUnderlayCandidates(
  designId: number,
): Promise<{ ok: true; files: { id: string; name: string; isPdf: boolean; url: string; uploaded: string }[] } | { ok: false; error: string }> {
  await requireAccess("projects");
  const scope = await queryOne<{ project_id: string | null; slug: string | null; lead_slug: string | null }>(
    `SELECT d.project_id, p.slug, d.lead_slug FROM plan_designs d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = $1`,
    [designId],
  );
  if (!scope) return { ok: false, error: "Design not found." };
  // Skip what can't be a plan: designer captures / rendered underlays, bids,
  // generated documents, selection / mood / catalog images, signatures…
  // Plan-looking files sort first.
  const { rows } = await query<{ id: string; name: string; type: "img" | "doc"; mime_type: string | null; uploaded: string }>(
    `SELECT f.id, f.name, f.type, f.mime_type, to_char(f.created_at, 'Mon FMDD') AS uploaded FROM files f
      WHERE f.storage_path IS NOT NULL
        AND split_part(f.id, '-', 1) <> ALL (ARRAY['cap','und','bid','doc','sel','prodsel','mood','cat','nl','sig','subdoc','call','ai'])
        AND (f.type = 'img' OR f.mime_type ILIKE '%pdf%' OR f.name ILIKE '%.pdf')
        AND (($1::text IS NOT NULL AND f.project_key = $1)
             OR ($2::uuid IS NOT NULL AND f.id IN (SELECT file_id FROM project_floorplans WHERE project_id = $2))
             OR ($3::text IS NOT NULL AND f.lead_slug = $3)
             OR ($2::uuid IS NOT NULL AND f.lead_slug IN (SELECT l.slug FROM leads l JOIN projects p ON p.lead_id = l.id WHERE p.id = $2)))
      ORDER BY (f.id LIKE 'plan-%' OR f.id IN (SELECT file_id FROM project_floorplans)
                OR f.name ~* '(plan|floor|layout|drawing|draft|sheet|blueprint|elevation|survey)') DESC,
               f.created_at DESC
      LIMIT 60`,
    [scope.slug, scope.project_id, scope.lead_slug],
  );
  return {
    ok: true,
    files: rows.map((r) => ({ id: r.id, name: r.name, isPdf: isPdf(r.mime_type, r.name), url: `/api/files/${r.id}`, uploaded: r.uploaded })),
  };
}

export type UnderlayUpload =
  | {
      ok: true;
      fileId: string;
      sourceFileId: string;
      name: string;
      widthPx: number;
      heightPx: number;
      dpi: number | null;
      page: number;
      pages: number;
      /** Drawing scale the sheet's text names (0.25 = 1/4" = 1'-0"), if any. */
      sheetInPerFt: number | null;
    }
  | { ok: false; error: string };

/** Render + store the traceable image for a plan and attach it to the design. */
async function attachUnderlay(
  designId: number,
  scope: { project_key: string; lead_slug: string | null; name: string },
  src: { bytes: Buffer; mime: string | null; name: string; sourceFileId: string },
  page: number,
): Promise<UnderlayUpload> {
  let img;
  try {
    img = await underlayImage(src.bytes, src.mime, src.name, page);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read that file." };
  }
  const base = src.name.replace(/\.[a-z0-9]+$/i, "");
  const name = img.pages > 1 ? `${base} (page ${img.page})` : base;
  const stored = await storeBuffer(img.png, {
    // Parentheses don't survive the upload-name sanitiser; a dash does.
    filename: img.pages > 1 ? `${base} - page ${img.page}.png` : `${base}.png`,
    mime: "image/png",
    idPrefix: "und",
    projectKey: scope.project_key || undefined,
    leadSlug: scope.lead_slug ?? undefined,
    tag: "UNDERLAY",
    subtitle: `${scope.name} · traced plan`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };
  await query(`INSERT INTO plan_design_files (design_id, file_id, kind, label) VALUES ($1, $2, 'underlay', $3)`, [
    designId,
    stored.id,
    name.slice(0, 120),
  ]);
  revalidatePath(`/floor/${designId}`);
  return {
    ok: true,
    fileId: stored.id,
    sourceFileId: src.sourceFileId,
    name,
    widthPx: img.widthPx,
    heightPx: img.heightPx,
    dpi: img.dpi,
    page: img.page,
    pages: img.pages,
    sheetInPerFt: img.sheetInPerFt,
  };
}

/** Upload a plan (image or PDF) to trace over. formData: file, page (PDF, 1-based).
 *  The original goes into the project/lead files as a PLAN; the designer gets a
 *  rendered image (a PDF page at a known DPI, or the EXIF-rotated photo). */
export async function uploadPlanUnderlay(designId: number, formData: FormData): Promise<UnderlayUpload> {
  await requireAccess("projects");
  const scope = await designScope(designId);
  if (!scope) return { ok: false, error: "Design not found." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file selected." };
  const pdf = isPdf(file.type, file.name);
  if (!pdf && !(file.type || "").startsWith("image/")) return { ok: false, error: "Use an image (PNG, JPG) or a PDF." };
  const page = Number(formData.get("page") ?? 1) || 1;
  const original = await storeUpload(file, {
    idPrefix: "plan",
    projectKey: scope.project_key || undefined,
    leadSlug: scope.lead_slug ?? undefined,
    tag: "PLAN",
    subtitle: `${scope.name} · plan to trace`,
  });
  if (!original.ok) return { ok: false, error: original.error };
  const bytes = Buffer.from(await file.arrayBuffer());
  return attachUnderlay(designId, scope, { bytes, mime: file.type, name: file.name, sourceFileId: original.id }, page);
}

/** Use a plan already in the project / lead files (or another page of one). */
export async function importPlanUnderlay(designId: number, sourceFileId: string, page = 1): Promise<UnderlayUpload> {
  await requireAccess("projects");
  const scope = await designScope(designId);
  if (!scope) return { ok: false, error: "Design not found." };
  const f = await queryOne<{ storage_path: string | null; mime_type: string | null; name: string }>(
    `SELECT storage_path, mime_type, name FROM files WHERE id = $1`,
    [sourceFileId],
  );
  if (!f?.storage_path) return { ok: false, error: "That file isn't on disk." };
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(UPLOAD_DIR, path.basename(f.storage_path)));
  } catch {
    return { ok: false, error: "That file isn't on disk." };
  }
  return attachUnderlay(designId, scope, { bytes, mime: f.mime_type, name: f.name, sourceFileId }, page);
}
