// Catalog (material library) data builder. DB-backed: reads the catalog_items
// table; the owner adds/removes items via lib/actions/catalog.ts. Supplier-scrape
// "browser capture" is still deferred. The grid shape is unchanged.

import { query } from "./db";
import { CATEGORIES, MATERIAL_CATEGORIES } from "./catalog-categories";
import type { CatalogCategory, MaterialCategory } from "./catalog-categories";

// Re-export the db-free constants/types so existing server-side imports keep
// working (client components must import from ./catalog-categories directly).
export { CATEGORIES, MATERIAL_CATEGORIES };
export type { CatalogCategory, MaterialCategory };

export interface Material {
  id: number;
  name: string;
  supplier: string;
  sku: string;
  /** Canonical category for the filter chips. */
  category: MaterialCategory;
  /** Usage count display, e.g. "4 projects". */
  use: string;
  /** Price display, e.g. "$185 / sq ft". */
  price: string;
}

export interface CatalogData {
  eyebrow: string;
  categories: CatalogCategory[];
  materials: Material[];
}

interface MaterialRow {
  id: number;
  name: string;
  supplier: string;
  sku: string;
  category: string;
  use_label: string;
  price: string;
}

function rowToMaterial(r: MaterialRow): Material {
  const category = (MATERIAL_CATEGORIES as readonly string[]).includes(r.category)
    ? (r.category as MaterialCategory)
    : "Cabinets";
  return {
    id: r.id,
    name: r.name,
    supplier: r.supplier,
    sku: r.sku,
    category,
    use: r.use_label,
    price: r.price,
  };
}

export async function getCatalogData(): Promise<CatalogData> {
  const { rows } = await query<MaterialRow>(
    `SELECT id, name, supplier, sku, category, use_label, price
       FROM catalog_items
       ORDER BY created_at DESC, id DESC`,
  );
  const materials = rows.map(rowToMaterial);
  const suppliers = new Set(materials.map((m) => m.supplier).filter(Boolean)).size;

  return {
    eyebrow: `${materials.length} materials · ${suppliers} suppliers`,
    categories: [...CATEGORIES],
    materials,
  };
}
