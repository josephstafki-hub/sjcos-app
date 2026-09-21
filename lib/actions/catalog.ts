"use server";

// Catalog write paths. Owner-gated. Reads stay in lib/catalog.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireAccess } from "@/lib/dal";
import { storeUpload } from "@/lib/upload-store";
import { MATERIAL_CATEGORIES } from "@/lib/catalog-categories";
import { PLACE_KINDS } from "@/lib/plan-doc";

/** Optional physical size / placement fields shared by create + update. */
function placementFields(formData: FormData) {
  const num = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
  };
  const kindInput = String(formData.get("place_kind") ?? "").trim();
  const placeKind = (PLACE_KINDS as readonly string[]).includes(kindInput) ? kindInput : "";
  const priceRaw = String(formData.get("price_cents") ?? formData.get("price") ?? "").trim();
  const m = priceRaw.match(/^\s*\$?\s*([0-9]{1,3}(,[0-9]{3})*|[0-9]+)(\.[0-9]{1,2})?\s*$/);
  const priceCents = m ? Math.round(Number(priceRaw.replace(/[^0-9.]/g, "")) * 100) : null;
  const costItem = Number(formData.get("cost_item_id") ?? 0) || null;
  return { widthIn: num("width_in"), depthIn: num("depth_in"), heightIn: num("height_in"), placeKind, priceCents, costItemId: costItem };
}

/** Add a material to the catalog from the "Add material" form. An optional
 *  product image is stored via the shared uploads helper and linked. */
export async function createMaterial(formData: FormData) {
  await requireAccess("catalog");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supplier = String(formData.get("supplier") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  const use = String(formData.get("use") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const msrp = String(formData.get("msrp") ?? "").trim();
  const series = String(formData.get("series") ?? "").trim();
  const categoryInput = String(formData.get("category") ?? "");
  const category = (MATERIAL_CATEGORIES as readonly string[]).includes(categoryInput)
    ? categoryInput
    : "Cabinets";

  const image = formData.get("image");
  let imageFileId: string | null = null;
  if (image instanceof File && image.size > 0) {
    const stored = await storeUpload(image, {
      idPrefix: "cat",
      imagesOnly: true,
      tag: "CATALOG",
      subtitle: `Catalog · ${name}`,
    });
    if (stored.ok) imageFileId = stored.id;
  }

  const pf = placementFields(formData);
  await query(
    `INSERT INTO catalog_items
       (name, supplier, sku, category, use_label, price, description, msrp, series, image_file_id,
        width_in, depth_in, height_in, place_kind, price_cents, cost_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [name, supplier, sku, category, use, price, description, msrp, series, imageFileId,
     pf.widthIn, pf.depthIn, pf.heightIn, pf.placeKind, pf.priceCents, pf.costItemId],
  );

  revalidatePath("/catalog");
}

/** Remove a material from the catalog. */
export async function deleteMaterial(id: number) {
  await requireAccess("catalog");
  await query(`DELETE FROM catalog_items WHERE id = $1`, [id]);
  revalidatePath("/catalog");
}

/** Set the size / placement kind / parsed price / install cost item of a
 *  catalog item so the floor-plan designer can place it (Phase 2 of the
 *  designer plan). Blank size fields clear the value. */
export async function updateMaterialPlacement(id: number, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireAccess("catalog");
  const pf = placementFields(formData);
  const r = await query(
    `UPDATE catalog_items
        SET width_in = $2, depth_in = $3, height_in = $4, place_kind = $5,
            price_cents = COALESCE($6, price_cents), cost_item_id = $7
      WHERE id = $1`,
    [id, pf.widthIn, pf.depthIn, pf.heightIn, pf.placeKind, pf.priceCents, pf.costItemId],
  );
  if (r.rowCount === 0) return { ok: false, error: "Catalog item not found." };
  revalidatePath("/catalog");
  revalidatePath("/floor");
  return { ok: true };
}
