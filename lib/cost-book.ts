import "server-only";

// Cost book read layer (Phase-2 B1). DB-backed: reads cost_items + the
// company-wide default markup from app_settings. Writes live in
// lib/actions/cost-book.ts.

import { query } from "./db";
import {
  COST_UNIT_VALUES,
  COST_CATEGORIES,
  type CostUnit,
} from "./cost-book-units";

export { COST_UNITS, COST_CATEGORIES, unitLabel, fmtUsd } from "./cost-book-units";
export type { CostUnit } from "./cost-book-units";

export const DEFAULT_MARKUP_FALLBACK = 20; // % used when the setting is unset

export interface CostItem {
  id: number;
  name: string;
  category: string;
  unit: CostUnit;
  /** cents */
  unitCost: number;
  /** per-item markup % override, or null to use the company default */
  markup: number | null;
  notes: string;
  archived: boolean;
}

export interface CostBookData {
  items: CostItem[];
  defaultMarkup: number;
  categories: string[];
}

interface CostRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  unit_cost: number;
  default_markup: string | null;
  notes: string;
  archived: boolean;
}

function rowToItem(r: CostRow): CostItem {
  return {
    id: Number(r.id),
    name: r.name,
    category: r.category,
    unit: (COST_UNIT_VALUES as string[]).includes(r.unit) ? (r.unit as CostUnit) : "ea",
    unitCost: r.unit_cost,
    markup: r.default_markup == null ? null : Number(r.default_markup),
    notes: r.notes,
    archived: r.archived,
  };
}

/** The company-wide default markup % (app_settings 'estimate.default_markup'). */
export async function getDefaultMarkup(): Promise<number> {
  const { rows } = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'estimate.default_markup'`,
  );
  const n = rows[0] ? Number(rows[0].value) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_MARKUP_FALLBACK;
}

/** Full cost book (all items incl. archived — the client filters) + default markup. */
export async function getCostBook(): Promise<CostBookData> {
  const [{ rows }, defaultMarkup] = await Promise.all([
    query<CostRow>(
      `SELECT id, name, category, unit, unit_cost, default_markup, notes, archived
         FROM cost_items ORDER BY archived, category, name`,
    ),
    getDefaultMarkup(),
  ]);
  return {
    items: rows.map(rowToItem),
    defaultMarkup,
    categories: [...COST_CATEGORIES],
  };
}
