"use server";

// Intake-token management. Owner-gated generate/rotate of the token the website
// lead form uses to authenticate against POST /api/leads/intake. Reads stay in
// lib/lead-intake-token.ts. Mirrors lib/actions/clip.ts.

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { INTAKE_TOKEN_KEY } from "@/lib/lead-intake-token";

/** Generate a fresh intake token and persist it, invalidating any previous one.
 *  Returns the new token so the UI can show it immediately. Owner-only. */
export async function regenerateIntakeToken(): Promise<string> {
  await requireRole("owner");
  const token = randomBytes(24).toString("base64url"); // ~32 url-safe chars
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [INTAKE_TOKEN_KEY, token],
  );
  revalidatePath("/settings");
  return token;
}
