import "server-only";

// Browser-extension catalog clipper (Phase 2 A). The clip token authenticates
// the cross-origin extension against POST /api/catalog/clip — it is NOT the
// session cookie (the extension has no login). One per-owner token lives in
// app_settings under `clip.token`; the owner reveals/rotates it in Settings.

import { timingSafeEqual } from "node:crypto";
import { query } from "./db";

export const CLIP_TOKEN_KEY = "clip.token";

/** The current clip token, or null if the owner has not generated one yet. */
export async function getClipToken(): Promise<string | null> {
  const { rows } = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [CLIP_TOKEN_KEY],
  );
  const value = rows[0]?.value?.trim();
  return value ? value : null;
}

/** Constant-time comparison of a presented token against the stored one.
 *  Returns false when no token is configured (fail-closed). */
export async function clipTokenMatches(presented: string | null | undefined): Promise<boolean> {
  const stored = await getClipToken();
  if (!stored || !presented) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
