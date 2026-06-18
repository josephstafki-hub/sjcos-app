// Pure catalog category constants + types — NO db import, so client components
// (the Add-material modal) can import these values without dragging pg into the
// browser bundle. lib/catalog.ts re-exports them for server-side convenience.

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
export type MaterialCategory = Exclude<CatalogCategory, "All">;

/** Selectable categories for the add-material form (everything but "All"). */
export const MATERIAL_CATEGORIES = CATEGORIES.filter(
  (c): c is MaterialCategory => c !== "All",
);
