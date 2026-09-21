"use server";

// Comments pinned to a floor-plan design (docs/floor-plan-designer-plan.md
// §10). The owner/staff comment from the designer; a client comments from the
// portal 3D viewer on a PUBLISHED version of their own project. Client
// comments notify Joe and land in the client-activity log like mood feedback.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { getCurrentUser, requireAccess, requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { logClientActivity, ownerHref } from "@/lib/client-activity";

type Result = { ok: boolean; error?: string };

export interface CommentAnchor {
  levelId: string;
  x: number;
  y: number;
  itemId?: string | null;
}

const MAX_BODY = 2000;

function cleanAnchor(a: CommentAnchor): CommentAnchor | null {
  if (!a || typeof a !== "object") return null;
  const x = Number(a.x);
  const y = Number(a.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !a.levelId) return null;
  return { levelId: String(a.levelId).slice(0, 64), x, y, itemId: a.itemId ? String(a.itemId).slice(0, 64) : null };
}

/** Owner/staff comment from the designer. */
export async function addPlanComment(
  designId: number,
  anchor: CommentAnchor,
  body: string,
  versionId?: number | null,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const user = await requireAccess("projects");
  const a = cleanAnchor(anchor);
  const text = body.trim().slice(0, MAX_BODY);
  if (!a) return { ok: false, error: "Pin the comment somewhere on the plan." };
  if (!text) return { ok: false, error: "Write the comment first." };
  const row = await queryOne<{ id: string }>(
    `INSERT INTO plan_design_comments (design_id, version_id, anchor, author_role, author_name, body)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING id`,
    [designId, versionId ?? null, JSON.stringify(a), user.role === "owner" ? "owner" : "staff", user.name, text],
  );
  revalidatePath(`/floor/${designId}`);
  return { ok: true, id: Number(row!.id) };
}

/** Client comment from the portal viewer of a published floor-plan version. */
export async function addClientPlanComment(
  floorplanId: number,
  anchor: CommentAnchor,
  formData: FormData,
): Promise<Result> {
  const user = await requireRole("owner", "client", "staff");
  const a = cleanAnchor(anchor);
  const text = String(formData.get("body") ?? "").trim().slice(0, MAX_BODY);
  const name = String(formData.get("name") ?? user.name ?? "").trim().slice(0, 120);
  if (!a) return { ok: false, error: "Tap the plan where the comment belongs." };
  if (!text) return { ok: false, error: "Write the comment first." };

  const fp = await queryOne<{ slug: string; design_id: string | null; design_version_id: string | null; published_at: Date | null; version: number }>(
    `SELECT p.slug, f.design_id, f.design_version_id, f.published_at, f.version
       FROM project_floorplans f JOIN projects p ON p.id = f.project_id WHERE f.id = $1`,
    [floorplanId],
  );
  if (!fp || !fp.design_id) return { ok: false, error: "This plan isn't a designer plan." };
  if (user.role === "client") {
    if (user.linkSlug !== fp.slug) return { ok: false, error: "This plan is not on your project." };
    if (!fp.published_at) return { ok: false, error: "This version isn't shared with you." };
  }
  await query(
    `INSERT INTO plan_design_comments (design_id, version_id, anchor, author_role, author_name, body)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    [fp.design_id, fp.design_version_id, JSON.stringify(a), user.role === "client" ? "client" : user.role === "staff" ? "staff" : "owner", name || user.name, text],
  );
  if (user.role === "client") {
    await emit({
      kind: "job",
      tag: "Plan comment",
      accent: "accent",
      icon: "project",
      title: `${name || "Your client"} commented on floor plan v${fp.version}`,
      subline: text.slice(0, 120),
      href: `/floor/${fp.design_id}?comments=1`,
    });
    await logClientActivity({
      scope: { kind: "project", slug: fp.slug },
      kind: "plan_comment",
      summary: `Commented on floor plan v${fp.version}`,
      detail: text.slice(0, 500),
      entityKind: "floorplan",
      entityId: floorplanId,
      actorName: name || user.name,
      href: ownerHref({ kind: "project", slug: fp.slug }, { tab: "Floor", focus: `floorplan-${floorplanId}` }),
    });
  }
  revalidatePath(`/floor/${fp.design_id}`);
  revalidatePath("/client-portal/plans");
  return { ok: true };
}

export async function resolvePlanComment(id: number, resolved: boolean): Promise<Result> {
  await requireAccess("projects");
  const r = await queryOne<{ design_id: string }>(
    `UPDATE plan_design_comments SET resolved_at = ${resolved ? "now()" : "NULL"} WHERE id = $1 RETURNING design_id`,
    [id],
  );
  if (!r) return { ok: false, error: "Comment not found." };
  revalidatePath(`/floor/${r.design_id}`);
  return { ok: true };
}

export async function deletePlanComment(id: number): Promise<Result> {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return { ok: false, error: "Only the owner can delete comments." };
  const r = await queryOne<{ design_id: string }>(`DELETE FROM plan_design_comments WHERE id = $1 RETURNING design_id`, [id]);
  if (!r) return { ok: false, error: "Comment not found." };
  revalidatePath(`/floor/${r.design_id}`);
  return { ok: true };
}
