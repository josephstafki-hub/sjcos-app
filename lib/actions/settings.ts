"use server";

// Settings write paths (Phase 7-B). Persists the Claude/AI toggles into the
// app_settings key/value table. Reads stay in lib/settings.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/dal";

/** First+last initial of a name, uppercased (e.g. "Joe Stafki" → "JS"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Raw upsert into app_settings (no namespace guard — callers pass fixed keys). */
async function upsertSetting(key: string, value: string) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

/** Upsert a boolean setting under an allowed namespace. */
async function upsertToggle(key: string, on: boolean, prefix: string) {
  // Only allow our namespaced keys through.
  if (!key.startsWith(prefix)) return;
  await upsertSetting(key, on ? "true" : "false");
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

/** Save the Profile form. Name + email are the authoritative login identity, so
 *  they persist to the current user's `users` row (keeping the sidebar/Team list
 *  in sync); company + phone have no column there and live in app_settings. */
export async function updateProfile(formData: FormData) {
  const me = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (name && email) {
    await query(`UPDATE users SET name = $1, email = $2, initials = $3 WHERE id = $4`, [
      name,
      email,
      initialsOf(name),
      me.id,
    ]);
  }
  if (company) await upsertSetting("profile.company", company);
  if (phone) await upsertSetting("profile.phone", phone);

  revalidatePath("/settings");
  revalidatePath("/today"); // sidebar footer shows the current user
}

/** Save the Company & documents form — boilerplate baked into generated
 *  contracts + SOWs (B5). Owner-only. */
export async function updateCompanyDocs(formData: FormData) {
  await requireRole("owner");
  const license = String(formData.get("license") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const depositPct = String(Math.max(0, Math.min(100, Number(formData.get("depositPct")) || 0)));
  const terms = String(formData.get("terms") ?? "").trim();

  await upsertSetting("company.license", license);
  await upsertSetting("company.address", address);
  await upsertSetting("contract.deposit_pct", depositPct);
  await upsertSetting("contract.terms", terms);

  revalidatePath("/settings");
}
