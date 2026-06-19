"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { query } from "@/lib/db";

/** Mark a warranty claim resolved (owner-gated). */
export async function resolveWarrantyClaim(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("owner");
  try {
    await query(`UPDATE warranty_claims SET resolved = true WHERE id = $1`, [id]);
    revalidatePath("/warranty");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
