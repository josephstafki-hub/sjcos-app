"use server";

// Compliance write paths (Phase 7-A CRUD). Reads stay in lib/compliance.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

/** Mark a compliance item resolved — drops it from the windows + timeline. */
export async function resolveComplianceItem(id: string) {
  await query(`UPDATE compliance_items SET resolved = true WHERE id = $1`, [id]);
  revalidatePath("/compliance");
}
