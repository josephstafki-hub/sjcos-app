"use server";

// Files attached to a floor-plan design: 3D captures (PNG from the browser
// canvas), underlay images to trace over, and site photos for photo pins.
// Owner/staff (projects area). Blobs go through the shared upload helper and
// are served by the owner-only /api/files/[id] route; the client portal reads
// captures through the published floor-plan version instead.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { storeUpload } from "@/lib/upload-store";

type Result = { ok: boolean; error?: string };

async function designScope(designId: number) {
  return queryOne<{ id: string; project_key: string; lead_slug: string | null; name: string }>(
    `SELECT d.id, COALESCE(p.name, '') AS project_key, d.lead_slug, d.name
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

/** Existing project files (images/PDFs) the designer can use as an underlay. */
export async function listUnderlayCandidates(
  designId: number,
): Promise<{ ok: true; files: { id: string; name: string; type: "img" | "doc"; url: string }[] } | { ok: false; error: string }> {
  await requireAccess("projects");
  const scope = await queryOne<{ project_id: string | null; lead_slug: string | null }>(
    `SELECT project_id, lead_slug FROM plan_designs WHERE id = $1`,
    [designId],
  );
  if (!scope) return { ok: false, error: "Design not found." };
  const { rows } = await query<{ id: string; name: string; type: "img" | "doc"; mime_type: string | null }>(
    scope.project_id
      ? `SELECT f.id, f.name, f.type, f.mime_type FROM files f
          WHERE f.storage_path IS NOT NULL
            AND (f.project_key = (SELECT name FROM projects WHERE id = $1)
                 OR f.id IN (SELECT file_id FROM project_floorplans WHERE project_id = $1))
          ORDER BY f.created_at DESC LIMIT 100`
      : `SELECT f.id, f.name, f.type, f.mime_type FROM files f
          WHERE f.storage_path IS NOT NULL AND f.lead_slug = $1 ORDER BY f.created_at DESC LIMIT 100`,
    [scope.project_id ?? scope.lead_slug],
  );
  return {
    ok: true,
    files: rows
      .filter((r) => r.type === "img" || (r.mime_type ?? "").includes("pdf"))
      .map((r) => ({ id: r.id, name: r.name, type: r.type, url: `/api/files/${r.id}` })),
  };
}
