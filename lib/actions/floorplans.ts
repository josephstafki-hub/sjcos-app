"use server";

// Floor-plan write paths (Review-round-3 S5E). Owner-gated: upload a new plan
// version (image or PDF), edit a version's notes, remove a version. Reads stay
// in lib/floorplans.ts. Files go through the shared upload helper.
// Client-callable: approveFloorplan — the portal's per-version sign-off.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { storeUpload } from "@/lib/upload-store";
import { emit } from "@/lib/notify";
import { logClientActivity, ownerHref } from "@/lib/client-activity";
import { notifyDashboardPublish, type DeliveryNote } from "@/lib/portal-publish";

type Result = { ok: boolean; error?: string };

/** Upload a new floor-plan version. version = current max + 1. Accepts an image
 *  or a PDF. Notes optional. */
export async function uploadFloorplan(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await queryOne<{ id: string }>(
    `SELECT id FROM projects WHERE slug = $1`,
    [slug],
  );
  if (!project) return { ok: false, error: "Project not found." };

  const notes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a plan file (image or PDF)." };
  }
  const isImage = (file.type || "").startsWith("image/");
  const isPdf = (file.type || "").includes("pdf");
  if (!isImage && !isPdf) {
    return { ok: false, error: "Upload an image or a PDF." };
  }

  const stored = await storeUpload(file, {
    idPrefix: "fp",
    tag: "FLOOR PLAN",
    subtitle: "Floor plan",
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  const { next } = (await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(version) + 1, 1) AS next FROM project_floorplans WHERE project_id = $1`,
    [project.id],
  )) ?? { next: 1 };

  await query(
    `INSERT INTO project_floorplans (project_id, version, file_id, notes)
     VALUES ($1, $2, $3, $4)`,
    [project.id, next, stored.id, notes],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

async function floorplanSlug(id: number) {
  return queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_floorplans fp JOIN projects p ON p.id = fp.project_id WHERE fp.id = $1`,
    [id],
  );
}

/** Edit a version's notes (owner only). */
export async function updateFloorplanNotes(id: number, notes: string): Promise<Result> {
  await requireRole("owner");
  const row = await floorplanSlug(id);
  if (!row) return { ok: false, error: "Version not found." };
  await query(`UPDATE project_floorplans SET notes = $2 WHERE id = $1`, [id, notes.trim()]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Publish/unpublish a plan version on the client dashboard. Publishing emails
 *  the client a portal link (best-effort; the delivery note says what
 *  happened). Unpublishing just hides the version again. Owner only. */
export async function setFloorplanPublished(
  id: number,
  publish: boolean,
): Promise<{ ok: true; delivery: DeliveryNote | null } | { ok: false; error: string }> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string; version: number }>(
    `SELECT p.slug, fp.version
       FROM project_floorplans fp JOIN projects p ON p.id = fp.project_id
      WHERE fp.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Version not found." };

  await query(
    `UPDATE project_floorplans SET published_at = ${publish ? "now()" : "NULL"} WHERE id = $1`,
    [id],
  );
  revalidatePath(`/projects/${row.slug}`);
  revalidatePath("/client-portal/plans");

  const delivery = publish
    ? await notifyDashboardPublish(
        { project: row.slug },
        { what: `floor plan v${row.version}`, section: "plans" },
      )
    : null;
  return { ok: true, delivery };
}

/** Client approves a plan version from their portal. A lightweight typed-name
 *  acknowledgment (contracts and money docs go through the e-sign engine
 *  instead). Scoped to the client's own project; idempotent — the first
 *  approval sticks. */
export async function approveFloorplan(id: number, formData: FormData): Promise<Result> {
  const user = await requireRole("owner", "client");
  const name = String(formData.get("approvedName") ?? "").trim();
  if (!name) return { ok: false, error: "Type your name to approve." };

  const row = await floorplanSlug(id);
  if (!row) return { ok: false, error: "Version not found." };
  if (user.role === "client" && user.linkSlug !== row.slug) {
    return { ok: false, error: "This plan is not on your project." };
  }
  // A client can only approve what's actually on their dashboard.
  if (user.role === "client") {
    const pub = await queryOne<{ published_at: Date | null }>(
      `SELECT published_at FROM project_floorplans WHERE id = $1`,
      [id],
    );
    if (!pub?.published_at) return { ok: false, error: "This version isn't shared with you." };
  }

  const updated = await query(
    `UPDATE project_floorplans
        SET client_approved_at = now(), client_approved_name = $2
      WHERE id = $1 AND client_approved_at IS NULL`,
    [id, name.slice(0, 120)],
  );
  if (updated.rowCount === 0) return { ok: false, error: "Already approved." };

  // Notify Joe only for a real client approval — an owner previewing their own
  // portal shouldn't hear about their own click.
  if (user.role === "client") {
    await emit({
      kind: "job",
      tag: "Plan approved",
      accent: "accent",
      icon: "project",
      title: `${name} approved a floor plan`,
      subline: `Project ${row.slug}`,
      href: ownerHref({ kind: "project", slug: row.slug }, { tab: "Floor", focus: `floorplan-${id}` }),
    });
    await logClientActivity({
      scope: { kind: "project", slug: row.slug },
      kind: "plan_approve",
      summary: "Approved a floor plan version",
      detail: `Signed as ${name}`,
      entityKind: "floorplan",
      entityId: id,
      actorName: user.name || name,
      href: ownerHref({ kind: "project", slug: row.slug }, { tab: "Floor", focus: `floorplan-${id}` }),
    });
  }

  revalidatePath("/client-portal/plans");
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Remove a floor-plan version (owner only). */
export async function removeFloorplan(id: number): Promise<Result> {
  await requireRole("owner");
  const row = await floorplanSlug(id);
  if (!row) return { ok: false, error: "Version not found." };
  await query(`DELETE FROM project_floorplans WHERE id = $1`, [id]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}
