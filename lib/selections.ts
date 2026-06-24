// Selections board builder (Review-round-3 S5C; sections + budgets in
// Functional-audit A4). DB-backed reads of project_selections / project_sections
// for the project Selections tab (owner) and the client portal (approve/decline).
// Selections are grouped into sections (rooms) that each carry a budget; approved
// picks roll up a running total + remaining the client sees. The selection image
// is either its own upload or inherited from the linked catalog item. Writes
// live in lib/actions/selections.ts.

import { query } from "./db";

export type SelectionStatus = "draft" | "pending" | "approved" | "declined";

export interface Selection {
  id: number;
  sectionId: number | null;
  area: string;
  choice: string;
  price: number;
  status: SelectionStatus;
  /** True when an image (own upload or catalog) is resolvable. */
  hasImage: boolean;
  /** Image URL appropriate to the audience (owner vs client route). */
  imageUrl: string | null;
}

/** A room/section grouping with its budget and live roll-up. */
export interface SelectionGroup {
  /** Section id, or null for the "Ungrouped" bucket. */
  id: number | null;
  name: string;
  budget: number;
  /** Sum of approved picks — committed spend. */
  spent: number;
  /** Sum of pending picks — proposed, not yet decided. */
  proposed: number;
  /** budget − spent (can go negative; UI flags it). */
  remaining: number;
  selections: Selection[];
}

export interface SelectionsView {
  groups: SelectionGroup[];
  totalBudget: number;
  totalSpent: number;
  totalProposed: number;
}

interface SelectionRow {
  id: number;
  section_id: number | null;
  area: string;
  choice: string;
  price: number;
  status: SelectionStatus;
  image_file_id: string | null;
  catalog_image: string | null;
}

interface SectionRow {
  id: number;
  name: string;
  budget: number;
  sort_order: number;
}

const SELECT = `
  SELECT s.id, s.section_id, s.area, s.choice, s.price, s.status, s.image_file_id,
         c.image_file_id AS catalog_image
    FROM project_selections s
    LEFT JOIN catalog_items c ON c.id = s.catalog_id
    JOIN projects p ON p.id = s.project_id`;

/** Resolved file id for a row: its own upload wins, else the catalog image. */
function imageIdOf(r: SelectionRow): string | null {
  return r.image_file_id ?? r.catalog_image;
}

function toSelection(r: SelectionRow, imageBase: (fileId: string, id: number) => string): Selection {
  const fileId = imageIdOf(r);
  return {
    id: r.id,
    sectionId: r.section_id,
    area: r.area,
    choice: r.choice,
    price: Number(r.price) || 0,
    status: r.status,
    hasImage: !!fileId,
    imageUrl: fileId ? imageBase(fileId, r.id) : null,
  };
}

/** Assemble selections + sections into grouped budget roll-ups. Sections come
 *  in declared order; any selection without a section lands in an "Ungrouped"
 *  bucket appended last (only when it has members). */
function group(sections: SectionRow[], selections: Selection[]): SelectionsView {
  const bySection = new Map<number | null, Selection[]>();
  for (const sel of selections) {
    const key = sel.sectionId ?? null;
    (bySection.get(key) ?? bySection.set(key, []).get(key)!).push(sel);
  }

  const roll = (members: Selection[]) => {
    const spent = members
      .filter((m) => m.status === "approved")
      .reduce((n, m) => n + m.price, 0);
    const proposed = members
      .filter((m) => m.status === "pending")
      .reduce((n, m) => n + m.price, 0);
    return { spent, proposed };
  };

  const groups: SelectionGroup[] = sections.map((sec) => {
    const members = bySection.get(sec.id) ?? [];
    const { spent, proposed } = roll(members);
    return {
      id: sec.id,
      name: sec.name,
      budget: sec.budget,
      spent,
      proposed,
      remaining: sec.budget - spent,
      selections: members,
    };
  });

  const ungrouped = bySection.get(null) ?? [];
  if (ungrouped.length) {
    const { spent, proposed } = roll(ungrouped);
    groups.push({
      id: null,
      name: "Ungrouped",
      budget: 0,
      spent,
      proposed,
      remaining: -spent,
      selections: ungrouped,
    });
  }

  return {
    groups,
    totalBudget: groups.reduce((n, g) => n + g.budget, 0),
    totalSpent: groups.reduce((n, g) => n + g.spent, 0),
    totalProposed: groups.reduce((n, g) => n + g.proposed, 0),
  };
}

async function loadSections(slug: string): Promise<SectionRow[]> {
  const { rows } = await query<SectionRow>(
    `SELECT s.id, s.name, s.budget, s.sort_order
       FROM project_sections s JOIN projects p ON p.id = s.project_id
      WHERE p.slug = $1 ORDER BY s.sort_order, s.id`,
    [slug],
  );
  return rows;
}

/** Owner board: every selection, grouped by section, images via the owner-only
 *  /api/files route. Includes empty sections so the owner can budget ahead. */
export async function getProjectSelections(slug: string): Promise<SelectionsView> {
  const [sections, rows] = await Promise.all([
    loadSections(slug),
    query<SelectionRow>(`${SELECT} WHERE p.slug = $1 ORDER BY s.sort_order, s.id`, [slug]),
  ]);
  const selections = rows.rows.map((r) => toSelection(r, (fileId) => `/api/files/${fileId}`));
  return group(sections, selections);
}

/** Client portal: only pushed selections (pending/approved/declined), grouped by
 *  section with budgets so the client sees the running total + remaining. Images
 *  go through the client-scoped portal route, keyed by selection id. */
export async function getClientSelections(slug: string): Promise<SelectionsView> {
  const [sections, rows] = await Promise.all([
    loadSections(slug),
    query<SelectionRow>(
      `${SELECT} WHERE p.slug = $1 AND s.status <> 'draft' ORDER BY s.sort_order, s.id`,
      [slug],
    ),
  ]);
  const selections = rows.rows.map((r) =>
    toSelection(r, (_fileId, id) => `/api/portal/selection-image/${id}`),
  );
  // Drop sections that ended up empty for the client (all their picks still
  // draft) and recompute grand totals over what remains visible.
  const view = group(sections, selections);
  view.groups = view.groups.filter((g) => g.selections.length > 0);
  view.totalBudget = view.groups.reduce((n, g) => n + g.budget, 0);
  view.totalSpent = view.groups.reduce((n, g) => n + g.spent, 0);
  view.totalProposed = view.groups.reduce((n, g) => n + g.proposed, 0);
  return view;
}

/** Resolve the displayable file id for a selection (own upload or catalog),
 *  plus its project slug — used by the client-scoped image route to authorize
 *  and stream. Returns null when the selection or image is missing. */
export async function resolveSelectionImage(
  id: number,
): Promise<{ fileId: string; slug: string } | null> {
  const { rows } = await query<{ image_file_id: string | null; catalog_image: string | null; slug: string }>(
    `SELECT s.image_file_id, c.image_file_id AS catalog_image, p.slug
       FROM project_selections s
       LEFT JOIN catalog_items c ON c.id = s.catalog_id
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const fileId = r.image_file_id ?? r.catalog_image;
  return fileId ? { fileId, slug: r.slug } : null;
}
