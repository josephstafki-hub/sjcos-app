import "server-only";

// Lead ingestion token. Authenticates the cross-origin website lead form (and
// any other external source) against POST /api/leads/intake — it is NOT the
// session cookie (the website has no login). One per-owner token lives in
// app_settings under `intake.token`; the owner reveals/rotates it in Settings.
// Mirrors the catalog-clipper token pattern (lib/clip.ts).

import { timingSafeEqual } from "node:crypto";
import { query } from "./db";

export const INTAKE_TOKEN_KEY = "intake.token";

/** The current intake token, or null if the owner has not generated one yet. */
export async function getIntakeToken(): Promise<string | null> {
  const { rows } = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [INTAKE_TOKEN_KEY],
  );
  const value = rows[0]?.value?.trim();
  return value ? value : null;
}

/** Constant-time comparison of a presented token against the stored one.
 *  Returns false when no token is configured (fail-closed). */
export async function intakeTokenMatches(
  presented: string | null | undefined,
): Promise<boolean> {
  const stored = await getIntakeToken();
  if (!stored || !presented) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
