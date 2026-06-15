// Catalog (material library) data builder. Mock-backed today; in Phase 7 it
// reads the materials table + supplier links. The grid shape stays stable.

export const CATEGORIES = [
  "All",
  "Cabinets",
  "Counters",
  "Tile",
  "Flooring",
  "Hardware",
  "Plumbing",
  "Lighting",
  "Trim",
] as const;

export type CatalogCategory = (typeof CATEGORIES)[number];

export interface Material {
  name: string;
  supplier: string;
  sku: string;
  /** Canonical category for the filter chips. */
  category: Exclude<CatalogCategory, "All">;
  /** Usage count display, e.g. "4 projects". */
  use: string;
  /** Price display, e.g. "$185 / sq ft". */
  price: string;
}

const MATERIALS: Material[] = [
  { name: "Calacatta marble · slab", supplier: "Cambria stoneyards", sku: "CAL-SLB-3CM", category: "Counters", use: "4 projects", price: "$185 / sq ft" },
  { name: "Cambria Brittanicca · quartz", supplier: "Cambria stoneyards", sku: "CAM-BRI-3CM", category: "Counters", use: "6 projects", price: "$95 / sq ft" },
  { name: 'Shaker maple base · 36"', supplier: "Twin Cities Cab Co", sku: "SHK-MAP-B36", category: "Cabinets", use: "12 projects", price: "$420" },
  { name: "Zellige · honey · 2×8", supplier: "Cle Tile", sku: "CLE-ZEL-H28", category: "Tile", use: "3 projects", price: "$24 / sq ft" },
  { name: 'White oak LVP · 7"', supplier: "Falk Floors", sku: "FLK-WO7", category: "Flooring", use: "8 projects", price: "$5.20 / sq ft" },
  { name: 'Brass bar pull · 4"', supplier: "Schoolhouse", sku: "SCH-BBP-4", category: "Hardware", use: "6 projects", price: "$22" },
  { name: 'Kohler farmhouse 30"', supplier: "Ferguson", sku: "KOH-FH30", category: "Plumbing", use: "4 projects", price: "$780" },
  { name: "Sconce · brass · linen shade", supplier: "Schoolhouse", sku: "SCH-SC-L", category: "Lighting", use: "5 projects", price: "$220" },
];

export interface CatalogData {
  eyebrow: string;
  categories: CatalogCategory[];
  materials: Material[];
}

export async function getCatalogData(): Promise<CatalogData> {
  const suppliers = new Set(MATERIALS.map((m) => m.supplier)).size;
  return {
    eyebrow: `1,084 materials · used across 38 projects · ${suppliers} suppliers`,
    categories: [...CATEGORIES],
    materials: MATERIALS,
  };
}
