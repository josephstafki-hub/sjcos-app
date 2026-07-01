"use server";

// Clip-token management (Phase 2 A). Owner-gated generate/rotate of the token
// the browser extension uses to authenticate against POST /api/catalog/clip.
// Reads stay in lib/clip.ts.

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { CLIP_TOKEN_KEY } from "@/lib/clip";

/** Generate a fresh clip token and persist it, invalidating any previous one.
 *  Returns the new token so the UI can show it immediately. Owner-only. */
export async function regenerateClipToken(): Promise<string> {
  await requireRole("owner");
  const token = randomBytes(24).toString("base64url"); // ~32 url-safe chars
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [CLIP_TOKEN_KEY, token],
  );
  revalidatePath("/settings");
  return token;
}
