"use server";

// Selections write paths (Review-round-3 S5C; items + options rework).
//
// The owner lays out rooms and sub-sections, files a DECISION under one
// ("Kitchen faucet") with an allowance, hangs two or three OPTIONS off it, and
// pushes the decision to the client portal. The client picks exactly one option;
// that pick is what rolls into the room budget. Reads stay in lib/selections.ts.
//
// Option details come either from pasting a product URL (lib/product-fetch.ts
// pulls name/brand/price/image) or from typing them in — the fetch is
// best-effort by design and the form always stays editable.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { logClientActivity, ownerHref } from "@/lib/client-activity";
import { storeUpload } from "@/lib/upload-store";
import { fetchProductDraft } from "@/lib/product-fetch";
import { notifyDashboardPublish } from "@/lib/portal-publish";

type Result = { ok: boolean; error?: string };

async function projectBySlug(slug: string) {
  return queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM projects WHERE slug = $1`,
    [slug],
  );
}

/** Parse a dollar amount from a form field — strips $ and commas, floors to a
 *  whole dollar, never negative. Empty / non-numeric → 0. */
function parseDollars(value: FormDataEntryValue | null): number {
  const n = Math.floor(Number(String(value ?? "").replace(/[$,\s]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function text(value: FormDataEntryValue | null, max = 300): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Resolve a section id form field to a number scoped to this project, or null
 *  for "Ungrouped" / an unknown value. */
async function resolveSectionId(
  projectId: string,
  raw: FormDataEntryValue | null,
): Promise<number | null> {
  const id = Number(String(raw ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM project_sections WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );
  return row ? row.id : null;
}

/** Next sort_order in a scope, so new rows land at the end of the list. */
async function nextSort(table: string, column: string, id: string | number): Promise<number> {
  const row = await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM ${table} WHERE ${column} = $1`,
    [id],
  );
  return row?.next ?? 0;
}

// ─── Overall budget ──────────────────────────────────────────────────────────

/** Set (or clear, with 0 / blank) the project-wide selections budget the client's
 *  running total is measured against. Room and sub-section budgets stay as they
 *  are; when this is unset the board falls back to their sum. */
export async function setSelectionsBudget(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  await query(`UPDATE projects SET selections_budget = $2 WHERE id = $1`, [
    project.id,
    parseDollars(formData.get("budget")),
  ]);
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal/selections");
  return { ok: true };
}

// ─── Sections (rooms, sub-sections, budgets) ─────────────────────────────────

/** Add a budgeted section to a project's board. Pass parentId to nest it as a
 *  sub-section of a room. Nesting is one level deep: a sub-section's parent is
 *  normalised up to its own room, so the tree can't grow arbitrarily deep. */
export async function addSection(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const name = text(formData.get("name"), 120);
  if (!name) return { ok: false, error: "A section name is required." };
  const budget = parseDollars(formData.get("budget"));
  const parentId = await resolveParent(project.id, formData.get("parentId"));

  await query(
    `INSERT INTO project_sections (project_id, name, budget, parent_id, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [project.id, name, budget, parentId, await nextSort("project_sections", "project_id", project.id)],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Resolve a parent-section field, flattening any deeper nesting to one level. */
async function resolveParent(
  projectId: string,
  raw: FormDataEntryValue | null,
): Promise<number | null> {
  const id = await resolveSectionId(projectId, raw);
  if (id === null) return null;
  const row = await queryOne<{ parent_id: number | null }>(
    `SELECT parent_id FROM project_sections WHERE id = $1`,
    [id],
  );
  return row?.parent_id ?? id;
}

/** Rename / re-budget / re-parent a section (owner only). */
export async function updateSection(id: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const sec = await queryOne<{ slug: string; project_id: string }>(
    `SELECT p.slug, p.id AS project_id
       FROM project_sections s JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
    [id],
  );
  if (!sec) return { ok: false, error: "Section not found." };

  const name = text(formData.get("name"), 120);
  if (!name) return { ok: false, error: "A section name is required." };
  const budget = parseDollars(formData.get("budget"));

  let parentId = await resolveParent(sec.project_id, formData.get("parentId"));
  // A section can't be its own parent, and can't adopt one of its own children.
  if (parentId === id) parentId = null;
  if (parentId !== null) {
    const child = await queryOne<{ id: number }>(
      `SELECT id FROM project_sections WHERE id = $1 AND parent_id = $2`,
      [parentId, id],
    );
    if (child) parentId = null;
  }

  await query(
    `UPDATE project_sections SET name = $2, budget = $3, parent_id = $4 WHERE id = $1`,
    [id, name, budget, parentId],
  );
  revalidatePath(`/projects/${sec.slug}`);
  return { ok: true };
}

/** Remove a section. Its decisions survive — section_id is ON DELETE SET NULL,
 *  so they fall back into the "Ungrouped" bucket. Its sub-sections do NOT: the
 *  parent_id FK cascades, and their decisions land in Ungrouped too. */
export async function removeSection(id: number): Promise<Result> {
  await requireRole("owner");
  const sec = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_sections s JOIN projects p ON p.id = s.project_id WHERE s.id = $1`,
    [id],
  );
  if (!sec) return { ok: false, error: "Section not found." };
  await query(`DELETE FROM project_sections WHERE id = $1`, [id]);
  revalidatePath(`/projects/${sec.slug}`);
  return { ok: true };
}

// ─── Decisions (the items that need answering) ───────────────────────────────

/** Add a decision to a project's board. `area` names what has to be decided;
 *  `allowance` is what the budget carries for it. Options are added separately. */
export async function addSelection(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const area = text(formData.get("area"), 200);
  if (!area) return { ok: false, error: "Name the decision that needs to be made." };

  const sectionId = await resolveSectionId(project.id, formData.get("sectionId"));

  await query(
    `INSERT INTO project_selections
       (project_id, section_id, area, choice, notes, allowance, status, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)`,
    [
      project.id,
      sectionId,
      area,
      text(formData.get("choice")),
      text(formData.get("notes"), 2000),
      parseDollars(formData.get("allowance")),
      await nextSort("project_selections", "project_id", project.id),
    ],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

/** Edit a decision's name / spec / notes / allowance / section (owner only).
 *  Status, options and the client's pick are left untouched. */
export async function updateSelection(id: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string; project_id: string }>(
    `SELECT p.slug, p.id AS project_id
       FROM project_selections s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Selection not found." };

  const area = text(formData.get("area"), 200);
  if (!area) return { ok: false, error: "Name the decision that needs to be made." };

  await query(
    `UPDATE project_selections
        SET area = $2, choice = $3, notes = $4, allowance = $5, section_id = $6
      WHERE id = $1`,
    [
      id,
      area,
      text(formData.get("choice")),
      text(formData.get("notes"), 2000),
      parseDollars(formData.get("allowance")),
      await resolveSectionId(row.project_id, formData.get("sectionId")),
    ],
  );
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

interface SelectionJoin {
  area: string;
  status: string;
  slug: string;
  project_name: string;
}

async function selectionById(id: number) {
  return queryOne<SelectionJoin>(
    `SELECT s.area, s.status, p.slug, p.name AS project_name
       FROM project_selections s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [id],
  );
}

/** Push a draft decision to the client portal. Refused with no options attached
 *  — a decision with nothing to choose between is a dead end for the client. */
export async function pushSelectionToClient(id: number): Promise<Result> {
  await requireRole("owner");
  const sel = await selectionById(id);
  if (!sel) return { ok: false, error: "Selection not found." };

  const count = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM project_selection_options WHERE selection_id = $1`,
    [id],
  );
  if (!count || count.n === 0) {
    return { ok: false, error: "Add at least one option before sending this to the client." };
  }

  await query(
    `UPDATE project_selections SET status = 'pending', pushed_at = now()
      WHERE id = $1 AND status = 'draft'`,
    [id],
  );
  await emit({
    kind: "decision",
    tag: "Decision",
    accent: "accent",
    icon: "project",
    title: `Selection awaiting client approval — ${sel.area}`,
    subline: `${sel.project_name} · ${count.n} option${count.n === 1 ? "" : "s"} sent to the client portal`,
    href: `/projects/${sel.slug}`,
  });
  // Publishing to the dashboard notifies the client (best-effort).
  await notifyDashboardPublish(
    { project: sel.slug },
    { what: `a selection to decide: ${sel.area}`, section: "selections" },
  );
  revalidatePath(`/projects/${sel.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Aggregate push behind the room- and board-level send buttons: everything
 *  draft in scope that has at least one option goes to 'pending'. Decisions
 *  with no options stay draft — sending the client a choice with nothing to
 *  choose is a dead end, so those keep showing as unsent on the board. */
async function pushScope(where: string, params: unknown[]): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `UPDATE project_selections s
        SET status = 'pending', pushed_at = now()
      WHERE s.status = 'draft'
        AND EXISTS (SELECT 1 FROM project_selection_options o WHERE o.selection_id = s.id)
        AND ${where}
      RETURNING s.id`,
    params,
  );
  return rows.length;
}

async function emitPushed(count: number, subline: string, slug: string) {
  await emit({
    kind: "decision",
    tag: "Decision",
    accent: "accent",
    icon: "project",
    title: `${count} selection${count === 1 ? "" : "s"} sent for client approval`,
    subline,
    href: `/projects/${slug}`,
  });
  // Publishing to the dashboard notifies the client (best-effort).
  await notifyDashboardPublish(
    { project: slug },
    {
      what: count === 1 ? "a selection to decide" : `${count} selections to decide`,
      section: "selections",
    },
  );
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/client-portal");
  revalidatePath("/notifications");
}

/** Push a whole room (and its sub-sections) to the client portal. */
export async function pushSectionToClient(sectionId: number): Promise<Result> {
  await requireRole("owner");
  const sec = await queryOne<{ name: string; slug: string; project_name: string }>(
    `SELECT s.name, p.slug, p.name AS project_name
       FROM project_sections s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [sectionId],
  );
  if (!sec) return { ok: false, error: "Section not found." };

  const pushed = await pushScope(
    `(s.section_id = $1 OR s.section_id IN (SELECT id FROM project_sections WHERE parent_id = $1))`,
    [sectionId],
  );
  if (pushed === 0) {
    return {
      ok: false,
      error: "Nothing to send — every decision here is already with the client or has no options yet.",
    };
  }
  await emitPushed(pushed, `${sec.project_name} · ${sec.name}`, sec.slug);
  return { ok: true };
}

/** Push the whole board — every room plus ungrouped decisions. */
export async function pushBoardToClient(slug: string): Promise<Result> {
  await requireRole("owner");
  const project = await projectBySlug(slug);
  if (!project) return { ok: false, error: "Project not found." };

  const pushed = await pushScope(`s.project_id = $1`, [project.id]);
  if (pushed === 0) {
    return {
      ok: false,
      error: "Nothing to send — every decision is already with the client or has no options yet.",
    };
  }
  await emitPushed(pushed, project.name, slug);
  return { ok: true };
}

/** Pull a pushed decision back to draft — for reworking the options after the
 *  client asked for something different. Clears any pick along with it. */
export async function unpushSelection(id: number): Promise<Result> {
  await requireRole("owner");
  const sel = await selectionById(id);
  if (!sel) return { ok: false, error: "Selection not found." };
  await query(
    `UPDATE project_selections
        SET status = 'draft', pushed_at = NULL, decided_at = NULL, chosen_option_id = NULL
      WHERE id = $1`,
    [id],
  );
  revalidatePath(`/projects/${sel.slug}`);
  revalidatePath("/client-portal");
  return { ok: true };
}

/** Remove a decision from the board (owner only). Its options cascade. */
export async function removeSelection(id: number): Promise<Result> {
  await requireRole("owner");
  const sel = await selectionById(id);
  if (!sel) return { ok: false, error: "Selection not found." };
  await query(`DELETE FROM project_selections WHERE id = $1`, [id]);
  revalidatePath(`/projects/${sel.slug}`);
  return { ok: true };
}

// ─── Options (what the client chooses between) ───────────────────────────────

async function optionOwner(selectionId: number) {
  return queryOne<{ slug: string }>(
    `SELECT p.slug FROM project_selections s JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [selectionId],
  );
}

/** Best-effort prefill from a product URL. Returns whatever we could read so the
 *  add-option form can populate itself; on failure the caller keeps the form
 *  open and the owner types the details in. Never throws. */
export async function prefillOptionFromUrl(url: string): Promise<
  | { ok: true; name: string; brand: string; sku: string; price: number; imageFileId: string | null; imageFailed: boolean }
  | { ok: false; error: string }
> {
  await requireRole("owner");
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return { ok: false, error: "Paste a product link first." };
  const result = await fetchProductDraft(trimmed);
  if (!result.ok) return result;
  return { ok: true, ...result.draft };
}

/** Add an option to a decision. Image precedence: an uploaded file wins, else a
 *  file already pulled down by the URL prefill, else the linked catalog item's
 *  image at render time. */
export async function addOption(selectionId: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const owner = await optionOwner(selectionId);
  if (!owner) return { ok: false, error: "Selection not found." };

  const name = text(formData.get("name"), 200);
  if (!name) return { ok: false, error: "Give the option a name." };

  const catalogRaw = text(formData.get("catalogId"), 20);
  const catalogId = catalogRaw ? Number(catalogRaw) : null;

  let imageFileId: string | null = text(formData.get("imageFileId"), 80) || null;
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    const stored = await storeUpload(image, {
      idPrefix: "sel",
      imagesOnly: true,
      tag: "SELECTION",
      subtitle: `Selection option · ${name}`,
    });
    if (!stored.ok) return { ok: false, error: stored.error };
    imageFileId = stored.id;
  }

  await query(
    `INSERT INTO project_selection_options
       (selection_id, name, brand, sku, product_url, price, note, image_file_id, catalog_id, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      selectionId,
      name,
      text(formData.get("brand"), 120),
      text(formData.get("sku"), 80),
      text(formData.get("productUrl"), 1000),
      parseDollars(formData.get("price")),
      text(formData.get("note"), 1000),
      imageFileId,
      Number.isFinite(catalogId) && catalogId ? catalogId : null,
      await nextSort("project_selection_options", "selection_id", selectionId),
    ],
  );
  revalidatePath(`/projects/${owner.slug}`);
  return { ok: true };
}

/** Edit an option in place. A new upload replaces the image; leaving the file
 *  field empty keeps whatever is already there. */
export async function updateOption(optionId: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug
       FROM project_selection_options o
       JOIN project_selections s ON s.id = o.selection_id
       JOIN projects p ON p.id = s.project_id
      WHERE o.id = $1`,
    [optionId],
  );
  if (!row) return { ok: false, error: "Option not found." };

  const name = text(formData.get("name"), 200);
  if (!name) return { ok: false, error: "Give the option a name." };

  let newImageId: string | null = text(formData.get("imageFileId"), 80) || null;
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    const stored = await storeUpload(image, {
      idPrefix: "sel",
      imagesOnly: true,
      tag: "SELECTION",
      subtitle: `Selection option · ${name}`,
    });
    if (!stored.ok) return { ok: false, error: stored.error };
    newImageId = stored.id;
  }

  await query(
    `UPDATE project_selection_options
        SET name = $2, brand = $3, sku = $4, product_url = $5, price = $6, note = $7,
            image_file_id = COALESCE($8, image_file_id)
      WHERE id = $1`,
    [
      optionId,
      name,
      text(formData.get("brand"), 120),
      text(formData.get("sku"), 80),
      text(formData.get("productUrl"), 1000),
      parseDollars(formData.get("price")),
      text(formData.get("note"), 1000),
      newImageId,
    ],
  );
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Remove an option. If it was the client's pick, the chosen_option_id FK sets
 *  itself to NULL — so also walk the decision back to pending, otherwise it
 *  would read "approved" with nothing actually chosen. */
export async function removeOption(optionId: number): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string; selection_id: number; was_chosen: boolean }>(
    `SELECT p.slug, o.selection_id, (s.chosen_option_id = o.id) AS was_chosen
       FROM project_selection_options o
       JOIN project_selections s ON s.id = o.selection_id
       JOIN projects p ON p.id = s.project_id
      WHERE o.id = $1`,
    [optionId],
  );
  if (!row) return { ok: false, error: "Option not found." };

  await query(`DELETE FROM project_selection_options WHERE id = $1`, [optionId]);
  if (row.was_chosen) {
    await query(
      `UPDATE project_selections
          SET status = CASE WHEN status = 'approved' THEN 'pending' ELSE status END,
              decided_at = NULL
        WHERE id = $1`,
      [row.selection_id],
    );
  }
  revalidatePath(`/projects/${row.slug}`);
  revalidatePath("/client-portal");
  return { ok: true };
}

// ─── The client's answer ─────────────────────────────────────────────────────

/** Client picks one option (or declines them all). The owner can decide on a
 *  client's behalf; a client may only decide on their own project. Emits a
 *  DECISION notification the owner sees.
 *
 *  optionId is required to approve — approving without naming which option is
 *  what made the old flat board ambiguous. */
export async function decideSelection(
  id: number,
  approve: boolean,
  optionId?: number,
): Promise<Result> {
  const user = await requireRole("owner", "client");
  const sel = await selectionById(id);
  if (!sel) return { ok: false, error: "Selection not found." };
  if (user.role === "client" && user.linkSlug !== sel.slug) {
    return { ok: false, error: "Not authorized for this project." };
  }

  let chosenLabel = "";
  if (approve) {
    if (!optionId) return { ok: false, error: "Pick one of the options first." };
    // Scope the option to this decision so a stray id can't attach an option
    // from someone else's project.
    const opt = await queryOne<{ id: number; name: string; price: number }>(
      `SELECT id, name, price FROM project_selection_options
        WHERE id = $1 AND selection_id = $2`,
      [optionId, id],
    );
    if (!opt) return { ok: false, error: "That option isn't part of this decision." };
    chosenLabel = opt.name;

    await query(
      `UPDATE project_selections
          SET status = 'approved', decided_at = now(), chosen_option_id = $2,
              choice = $3, price = $4
        WHERE id = $1 AND status IN ('pending','approved')`,
      [id, opt.id, opt.name, opt.price],
    );
  } else {
    await query(
      `UPDATE project_selections
          SET status = 'declined', decided_at = now(), chosen_option_id = NULL
        WHERE id = $1 AND status = 'pending'`,
      [id],
    );
  }

  // A real client decision notifies Joe; an owner deciding from the preview
  // (or the board) shouldn't read back as "Client chose…".
  if (user.role === "client") {
    await emit({
      kind: "decision",
      tag: "Decision",
      accent: approve ? "accent" : "flag",
      icon: "project",
      flagged: !approve,
      title: approve
        ? `Client chose ${chosenLabel} — ${sel.area}`
        : `Client declined the options — ${sel.area}`,
      subline: approve ? sel.project_name : `${sel.project_name} · needs different options`,
      href: ownerHref({ kind: "project", slug: sel.slug }, { tab: "Selections", focus: `selection-${id}` }),
    });
    await logClientActivity({
      scope: { kind: "project", slug: sel.slug },
      kind: "selection",
      summary: approve ? `Chose ${chosenLabel} — ${sel.area}` : `Declined the options — ${sel.area}`,
      entityKind: "selection",
      entityId: id,
      actorName: user.name,
      href: ownerHref({ kind: "project", slug: sel.slug }, { tab: "Selections", focus: `selection-${id}` }),
    });
  }
  revalidatePath(`/projects/${sel.slug}`);
  revalidatePath("/client-portal");
  revalidatePath("/notifications");
  return { ok: true };
}
