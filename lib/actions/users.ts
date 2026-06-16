"use server";

// User-account write paths (Phase 8-B). Owner-only: provision a portal login for
// a sub/client, or disable/re-enable an account. Mirrors lib/actions/subs.ts.
// Reads of the team list stay in lib/settings.ts (from the users table).

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireRole } from "@/lib/dal";

/** First+last initial of a name, uppercased (e.g. "Marco Rivas" → "MR"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const ROLES = new Set(["owner", "sub", "client"]);

/** Provision a login account from Settings → Team & roles. Owner-only. */
export async function createUser(formData: FormData) {
  await requireRole("owner");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "sub").trim();
  const linkSlug = String(formData.get("link_slug") ?? "").trim() || null;

  if (!name || !email || !password || !ROLES.has(role)) return;

  // Same email twice would violate the UNIQUE constraint — guard for a clean no-op.
  const exists = await queryOne(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [email]);
  if (exists) return;

  const passwordHash = await hashPassword(password);
  await query(
    `INSERT INTO users (email, password_hash, name, role, initials, link_slug, active)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [email, passwordHash, name, role, initialsOf(name), linkSlug],
  );

  revalidatePath("/settings");
}

/** Enable/disable a login. Owner-only; owner rows are protected (no lock-out). */
export async function setUserActive(id: string, active: boolean) {
  await requireRole("owner");
  await query(`UPDATE users SET active = $2 WHERE id = $1 AND role <> 'owner'`, [id, active]);
  revalidatePath("/settings");
}
