"use server";

// Catalog write paths. Owner-gated. Reads stay in lib/catalog.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { MATERIAL_CATEGORIES } from "@/lib/catalog-categories";

/** Add a material to the catalog from the "Add material" form. */
export async function createMaterial(formData: FormData) {
  await requireRole("owner");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supplier = String(formData.get("supplier") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  const use = String(formData.get("use") ?? "").trim();
  const categoryInput = String(formData.get("category") ?? "");
  const category = (MATERIAL_CATEGORIES as readonly string[]).includes(categoryInput)
    ? categoryInput
    : "Cabinets";

  await query(
    `INSERT INTO catalog_items (name, supplier, sku, category, use_label, price)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [name, supplier, sku, category, use, price],
  );

  revalidatePath("/catalog");
}

/** Remove a material from the catalog. */
export async function deleteMaterial(id: number) {
  await requireRole("owner");
  await query(`DELETE FROM catalog_items WHERE id = $1`, [id]);
  revalidatePath("/catalog");
}
