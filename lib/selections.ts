// Selections board reads (Review-round-3 S5C; sections + budgets in
// Functional-audit A4; items + options rework).
//
// The shape mirrors how a selections binder actually works:
//
//   Section (room, budgeted)      "Kitchen"
//     └ sub-section (optional)    "Cabinetry"
//        └ item (a DECISION)      "Perimeter door style"  — carries an allowance
//           └ option ×2-3         "Shaker, white oak — $8,400"
//
// The client is shown each open decision with its options side by side and picks
// exactly one; that pick becomes the item's chosen option and its price is what
// rolls into the room budget. Writes live in lib/actions/selections.ts.

import { query } from "./db";

export type SelectionStatus = "draft" | "pending" | "approved" | "declined";

/** One candidate product under a decision. */
export interface SelectionOption {
  id: number;
  name: string;
  brand: string;
  sku: string;
  productUrl: string;
  price: number;
  note: string;
  /** Image URL appropriate to the audience (owner vs client route). */
  imageUrl: string | null;
}

/** A decision that needs an answer, plus the options offered for it. */
export interface Selection {
  id: number;
  sectionId: number | null;
  /** The decision itself, e.g. "Kitchen faucet". */
  area: string;
  /** Optional spec note, e.g. "wall-mount, 8in spread". */
  choice: string;
  notes: string;
  /** What the budget carries for this decision. */
  allowance: number;
  status: SelectionStatus;
  options: SelectionOption[];
  /** The option the client picked, if any. */
  chosenOptionId: number | null;
  /** Price actually committed: the chosen option's price, else 0. */
  chosenPrice: number;
}

/** A room/sub-section grouping with its budget and live roll-up. */
export interface SelectionGroup {
  /** Section id, or null for the "Ungrouped" bucket. */
  id: number | null;
  name: string;
  budget: number;
  /** Sum of allowances for every decision in this group (and its children). */
  allowance: number;
  /** Committed spend — chosen option prices on approved decisions. */
  spent: number;
  /** Allowances still riding on undecided pushed decisions. */
  proposed: number;
  /** budget − spent (can go negative; UI flags it). */
  remaining: number;
  /** Decisions filed directly under this group. */
  selections: Selection[];
  /** Nested sub-sections (one level deep). */
  children: SelectionGroup[];
  /** How many decisions are still unanswered, counting sub-sections. */
  openCount: number;
  /** Total decisions, counting sub-sections. */
  totalCount: number;
}

export interface SelectionsView {
  groups: SelectionGroup[];
  /** The project-wide selections budget the owner set explicitly (0 = unset). */
  overallBudget: number;
  /** Sum of the top-level room budgets — how much of the overall is parcelled out. */
  allocatedBudget: number;
  /** What the running total is measured against: the overall budget when set,
   *  else the sum of room budgets. */
  totalBudget: number;
  totalAllowance: number;
  totalSpent: number;
  totalProposed: number;
  totalOpen: number;
  totalDecisions: number;
}

/** The "nothing to show" view — used by the client portal when the signed-in
 *  client has no linked project, so callers don't hand-maintain a literal that
 *  drifts every time the view grows a field. */
export const EMPTY_SELECTIONS_VIEW: SelectionsView = {
  groups: [],
  overallBudget: 0,
  allocatedBudget: 0,
  totalBudget: 0,
  totalAllowance: 0,
  totalSpent: 0,
  totalProposed: 0,
  totalOpen: 0,
  totalDecisions: 0,
};

interface SelectionRow {
  id: number;
  section_id: number | null;
  area: string;
  choice: string;
  notes: string;
  allowance: number;
  status: SelectionStatus;
  chosen_option_id: number | null;
}

interface OptionRow {
  id: number;
  selection_id: number;
  name: string;
  brand: string;
  sku: string;
  product_url: string;
  price: number;
  note: string;
  image_file_id: string | null;
  catalog_image: string | null;
}

interface SectionRow {
  id: number;
  parent_id: number | null;
  name: string;
  budget: number;
  sort_order: number;
}

const SELECT_ITEMS = `
  SELECT s.id, s.section_id, s.area, s.choice, s.notes, s.allowance, s.status,
         s.chosen_option_id
    FROM project_selections s
    JOIN projects p ON p.id = s.project_id`;

const SELECT_OPTIONS = `
  SELECT o.id, o.selection_id, o.name, o.brand, o.sku, o.product_url, o.price,
         o.note, o.image_file_id, c.image_file_id AS catalog_image
    FROM project_selection_options o
    JOIN project_selections s ON s.id = o.selection_id
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN catalog_items c ON c.id = o.catalog_id`;

/** An option's image is its own upload if it has one, else the catalog item's. */
function toOption(r: OptionRow, imageBase: (id: number) => string): SelectionOption {
  const fileId = r.image_file_id ?? r.catalog_image;
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    sku: r.sku,
    productUrl: r.product_url,
    price: Number(r.price) || 0,
    note: r.note,
    imageUrl: fileId ? imageBase(r.id) : null,
  };
}

function toSelection(r: SelectionRow, options: SelectionOption[]): Selection {
  const chosenOptionId = r.chosen_option_id;
  const chosen = options.find((o) => o.id === chosenOptionId) ?? null;
  return {
    id: r.id,
    sectionId: r.section_id,
    area: r.area,
    choice: r.choice,
    notes: r.notes ?? "",
    allowance: Number(r.allowance) || 0,
    status: r.status,
    options,
    chosenOptionId: chosen ? chosen.id : null,
    chosenPrice: chosen ? chosen.price : 0,
  };
}

/** Roll a group's own decisions up, then fold in whatever its children rolled
 *  up. Spend is only real once a decision is approved; a pushed-but-undecided
 *  decision contributes its allowance as "proposed" so the client can see what
 *  is still riding on the budget. */
function rollUp(group: SelectionGroup): SelectionGroup {
  let allowance = 0;
  let spent = 0;
  let proposed = 0;
  let open = 0;

  for (const sel of group.selections) {
    allowance += sel.allowance;
    if (sel.status === "approved") {
      // Fall back to the allowance when the picked option has no price yet, so
      // an approved decision never silently reads as free.
      spent += sel.chosenPrice || sel.allowance;
    } else {
      if (sel.status === "pending") proposed += sel.allowance;
      open += 1;
    }
  }

  const children = group.children.map(rollUp);
  for (const c of children) {
    allowance += c.allowance;
    spent += c.spent;
    proposed += c.proposed;
    open += c.openCount;
  }

  const totalCount =
    group.selections.length + children.reduce((n, c) => n + c.totalCount, 0);

  return {
    ...group,
    children,
    allowance,
    spent,
    proposed,
    remaining: group.budget - spent,
    openCount: open,
    totalCount,
  };
}

/** Grand totals over the visible top-level groups. The budget the running total
 *  is measured against is the explicit overall figure when the owner set one,
 *  else whatever the rooms add up to. */
function totals(groups: SelectionGroup[], overallBudget: number): SelectionsView {
  const allocatedBudget = groups.reduce((n, g) => n + g.budget, 0);
  return {
    groups,
    overallBudget,
    allocatedBudget,
    totalBudget: overallBudget > 0 ? overallBudget : allocatedBudget,
    totalAllowance: groups.reduce((n, g) => n + g.allowance, 0),
    totalSpent: groups.reduce((n, g) => n + g.spent, 0),
    totalProposed: groups.reduce((n, g) => n + g.proposed, 0),
    totalOpen: groups.reduce((n, g) => n + g.openCount, 0),
    totalDecisions: groups.reduce((n, g) => n + g.totalCount, 0),
  };
}

/** Assemble sections + decisions into a nested, rolled-up tree. Sections come in
 *  declared order; any decision without a section lands in an "Ungrouped" bucket
 *  appended last (only when it has members). */
function group(
  sections: SectionRow[],
  selections: Selection[],
  overallBudget: number,
): SelectionsView {
  const bySection = new Map<number | null, Selection[]>();
  for (const sel of selections) {
    const key = sel.sectionId ?? null;
    const list = bySection.get(key);
    if (list) list.push(sel);
    else bySection.set(key, [sel]);
  }

  const blank = (s: SectionRow): SelectionGroup => ({
    id: s.id,
    name: s.name,
    budget: s.budget,
    allowance: 0,
    spent: 0,
    proposed: 0,
    remaining: 0,
    selections: bySection.get(s.id) ?? [],
    children: [],
    openCount: 0,
    totalCount: 0,
  });

  // Build every node first, then wire children to parents in declared order so
  // a sub-section keeps its sort position under its room.
  const nodes = new Map<number, SelectionGroup>();
  for (const s of sections) nodes.set(s.id, blank(s));

  const roots: SelectionGroup[] = [];
  for (const s of sections) {
    const node = nodes.get(s.id)!;
    // A parent pointing at a section from another project (or a cycle) is
    // treated as a root rather than dropped, so nothing becomes invisible.
    const parent = s.parent_id !== null ? nodes.get(s.parent_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const groups = roots.map(rollUp);

  const ungrouped = bySection.get(null) ?? [];
  if (ungrouped.length) {
    groups.push(
      rollUp({
        id: null,
        name: "Ungrouped",
        budget: 0,
        allowance: 0,
        spent: 0,
        proposed: 0,
        remaining: 0,
        selections: ungrouped,
        children: [],
        openCount: 0,
        totalCount: 0,
      }),
    );
  }

  return totals(groups, overallBudget);
}

/** The project's explicit overall selections budget (0 when unset / no project). */
async function loadOverallBudget(slug: string): Promise<number> {
  const { rows } = await query<{ selections_budget: number }>(
    `SELECT selections_budget FROM projects WHERE slug = $1`,
    [slug],
  );
  return Number(rows[0]?.selections_budget) || 0;
}

async function loadSections(slug: string): Promise<SectionRow[]> {
  const { rows } = await query<SectionRow>(
    `SELECT s.id, s.parent_id, s.name, s.budget, s.sort_order
       FROM project_sections s JOIN projects p ON p.id = s.project_id
      WHERE p.slug = $1 ORDER BY s.sort_order, s.id`,
    [slug],
  );
  return rows;
}

/** Attach each decision's options, in board order. */
function withOptions(
  items: SelectionRow[],
  optionRows: OptionRow[],
  imageBase: (id: number) => string,
): Selection[] {
  const byItem = new Map<number, SelectionOption[]>();
  for (const r of optionRows) {
    const opt = toOption(r, imageBase);
    const list = byItem.get(r.selection_id);
    if (list) list.push(opt);
    else byItem.set(r.selection_id, [opt]);
  }
  return items.map((r) => toSelection(r, byItem.get(r.id) ?? []));
}

/** Owner board: every decision and every option, grouped by section, images via
 *  the owner-only /api/files route. Includes empty sections so the owner can lay
 *  out rooms and budget ahead of adding decisions. */
export async function getProjectSelections(slug: string): Promise<SelectionsView> {
  const [overallBudget, sections, items, options] = await Promise.all([
    loadOverallBudget(slug),
    loadSections(slug),
    query<SelectionRow>(`${SELECT_ITEMS} WHERE p.slug = $1 ORDER BY s.sort_order, s.id`, [slug]),
    query<OptionRow>(`${SELECT_OPTIONS} WHERE p.slug = $1 ORDER BY o.sort_order, o.id`, [slug]),
  ]);
  return group(
    sections,
    withOptions(items.rows, options.rows, (id) => `/api/portal/selection-image/${id}`),
    overallBudget,
  );
}

/** Client portal: only pushed decisions (pending/approved/declined), grouped by
 *  section with budgets so the client sees the running total + remaining. Images
 *  go through the client-scoped portal route, keyed by option id. */
export async function getClientSelections(slug: string): Promise<SelectionsView> {
  const [overallBudget, sections, items, options] = await Promise.all([
    loadOverallBudget(slug),
    loadSections(slug),
    query<SelectionRow>(
      `${SELECT_ITEMS} WHERE p.slug = $1 AND s.status <> 'draft' ORDER BY s.sort_order, s.id`,
      [slug],
    ),
    query<OptionRow>(
      `${SELECT_OPTIONS} WHERE p.slug = $1 AND s.status <> 'draft' ORDER BY o.sort_order, o.id`,
      [slug],
    ),
  ]);
  const selections = withOptions(items.rows, options.rows, (id) => `/api/portal/selection-image/${id}`);

  // Drop sections that ended up empty for the client (all their decisions still
  // draft) and recompute grand totals over what remains visible.
  const view = group(sections, selections, overallBudget);
  const nonEmpty = (g: SelectionGroup): SelectionGroup | null => {
    const children = g.children.map(nonEmpty).filter((c): c is SelectionGroup => c !== null);
    if (g.selections.length === 0 && children.length === 0) return null;
    return { ...g, children };
  };
  return totals(
    view.groups.map(nonEmpty).filter((g): g is SelectionGroup => g !== null),
    overallBudget,
  );
}

/** Resolve the displayable file id for a selection OPTION (own upload or linked
 *  catalog item), plus its project slug — used by the client-scoped image route
 *  to authorize and stream. Returns null when the option or image is missing. */
export async function resolveOptionImage(
  optionId: number,
): Promise<{ fileId: string; slug: string } | null> {
  const { rows } = await query<{ image_file_id: string | null; catalog_image: string | null; slug: string }>(
    `SELECT o.image_file_id, c.image_file_id AS catalog_image, p.slug
       FROM project_selection_options o
       JOIN project_selections s ON s.id = o.selection_id
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN catalog_items c ON c.id = o.catalog_id
      WHERE o.id = $1`,
    [optionId],
  );
  const r = rows[0];
  if (!r) return null;
  const fileId = r.image_file_id ?? r.catalog_image;
  return fileId ? { fileId, slug: r.slug } : null;
}
