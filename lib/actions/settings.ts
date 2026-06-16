"use server";

// Settings write paths (Phase 7-B). Persists the Claude/AI toggles into the
// app_settings key/value table. Reads stay in lib/settings.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

/** Upsert a boolean AI setting by key. */
export async function setAiToggle(key: string, on: boolean) {
  // Only allow our namespaced AI keys through.
  if (!key.startsWith("ai.")) return;
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, on ? "true" : "false"],
  );
  revalidatePath("/settings");
}
