"use server";

// Sub write paths (Phase 7-A CRUD). Reads stay in lib/subs.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sub"
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await queryOne(`SELECT 1 FROM subs WHERE slug = $1`, [slug]);
    if (!hit) return slug;
    slug = `${base}-${i}`;
  }
}

/** Onboard a sub from the directory's "Onboard a sub" form, then open them. */
export async function createSub(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const trade = String(formData.get("trade") ?? "").trim();
  const rate = String(formData.get("rate") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;

  const slug = await uniqueSlug(name);
  await query(
    `INSERT INTO subs (slug, name, trade, rate, email, phone, coi_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'missing')`,
    [slug, name, trade, rate, email, phone],
  );

  revalidatePath("/subs");
  redirect(`/subs/${slug}`);
}
