"use server";

// Settings write paths (Phase 7-B). Persists the Claude/AI toggles into the
// app_settings key/value table. Reads stay in lib/settings.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";

/** Upsert a boolean setting under an allowed namespace. */
async function upsertToggle(key: string, on: boolean, prefix: string) {
  // Only allow our namespaced keys through.
  if (!key.startsWith(prefix)) return;
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, on ? "true" : "false"],
  );
  revalidatePath("/settings");
}

/** Upsert a boolean AI setting by key (namespace "ai."). */
export async function setAiToggle(key: string, on: boolean) {
  await upsertToggle(key, on, "ai.");
}

/** Upsert a boolean notification setting by key (namespace "notify."). */
export async function setNotifyToggle(key: string, on: boolean) {
  await upsertToggle(key, on, "notify.");
}
