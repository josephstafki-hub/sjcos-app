"use server";

// Vendor write paths. Mirrors lib/actions/subs.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "vendor"
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await queryOne(`SELECT 1 FROM vendors WHERE slug = $1`, [slug]);
    if (!hit) return slug;
    slug = `${base}-${i}`;
  }
}

/** Onboard a vendor from the directory's "Add vendor" form, then open them. */
export async function createVendor(formData: FormData) {
  await requireRole("owner");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const trade = String(formData.get("trade") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;

  const slug = await uniqueSlug(name);
  await query(
    `INSERT INTO vendors (slug, name, trade, email, phone) VALUES ($1, $2, $3, $4, $5)`,
    [slug, name, trade, email, phone],
  );

  revalidatePath("/vendors");
  redirect(`/vendors/${slug}`);
}

type Result = { ok: true; id?: string; slug?: string } | { ok: false; error: string };

/** Save a vendor inline from the PO vendor picker's "add new supplier" form —
 *  same insert as createVendor, but returns the row instead of redirecting so
 *  the PO form can select it immediately. */
export async function createVendorInline(input: { name: string; trade?: string; email?: string; phone?: string }): Promise<Result> {
  await requireRole("owner");
  const name = input.name.trim();
  if (!name) return { ok: false, error: "A vendor name is required." };
  const slug = await uniqueSlug(name);
  const ins = await queryOne<{ id: string }>(
    `INSERT INTO vendors (slug, name, trade, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [slug, name, input.trade?.trim() ?? "", input.email?.trim() || null, input.phone?.trim() || null],
  );
  revalidatePath("/vendors");
  return { ok: true, id: ins!.id, slug };
}

export async function updateVendor(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "A vendor name is required." };
  const trade = String(formData.get("trade") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  await query(
    `UPDATE vendors SET name = $2, trade = $3, email = $4, phone = $5, updated_at = now() WHERE slug = $1`,
    [slug, name, trade, email, phone],
  );
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${slug}`);
  return { ok: true };
}

export async function toggleVendorFav(slug: string): Promise<Result> {
  await requireRole("owner");
  await query(`UPDATE vendors SET fav = NOT fav, updated_at = now() WHERE slug = $1`, [slug]);
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${slug}`);
  return { ok: true };
}

/** Save the owner's private notes on a vendor. Owner-gated. */
export async function setVendorNotes(slug: string, notes: string) {
  await requireRole("owner");
  await query(`UPDATE vendors SET notes = $2, updated_at = now() WHERE slug = $1`, [
    slug,
    notes.slice(0, 4000),
  ]);
  revalidatePath(`/vendors/${slug}`);
}
