"use server";

// User-account write paths. Owner-only: provision a login (staff member with
// per-area access, or a portal login for a sub/client), edit a staff
// member's areas, reset a password, disable/re-enable an account. Reads of
// the team list stay in lib/settings.ts (from the users table). The access
// catalog is lib/permissions.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireRole } from "@/lib/dal";
import { normalizePermissions, type PermissionKey } from "@/lib/permissions";

/** First+last initial of a name, uppercased (e.g. "Marco Rivas" → "MR"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const ROLES = new Set(["owner", "staff", "sub", "client"]);
const MIN_PASSWORD = 8;

export type UserActionResult = { ok: true } | { ok: false; error: string };
export type CreateUserResult = UserActionResult;

/** Ticked area checkboxes → validated keys. The form posts one `perm` entry per box. */
function permsFromForm(formData: FormData): PermissionKey[] {
  return normalizePermissions(formData.getAll("perm").map(String));
}

/** Provision a login account from Settings → Team & roles. Owner-only.
 *  Returns a result so the modal can show validation errors and only close on success. */
export async function createUser(formData: FormData): Promise<CreateUserResult> {
  await requireRole("owner");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "staff").trim();
  const linkSlug = String(formData.get("link_slug") ?? "").trim() || null;
  const perms = role === "staff" ? permsFromForm(formData) : [];

  if (!name || !email || !password) return { ok: false, error: "Name, email, and a temp password are required." };
  if (password.length < MIN_PASSWORD) return { ok: false, error: `Temp password needs at least ${MIN_PASSWORD} characters.` };
  if (!ROLES.has(role)) return { ok: false, error: "Pick a valid role." };
  if (role === "staff" && perms.length === 0) return { ok: false, error: "Tick at least one area the team member can open." };
  if ((role === "sub" || role === "client") && !linkSlug) {
    return { ok: false, error: "Portal logins need the link slug (the sub's slug or the project slug)." };
  }

  // Same email twice would violate the UNIQUE constraint — guard for a clean message.
  const exists = await queryOne(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [email]);
  if (exists) return { ok: false, error: "A user with that email already exists." };

  const passwordHash = await hashPassword(password);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role, initials, link_slug, active, permissions)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     RETURNING id`,
    [email, passwordHash, name, role, initialsOf(name), role === "staff" ? null : linkSlug, perms],
  );
  if (role === "staff") await linkChatIdentity(rows[0].id, name);

  revalidatePath("/settings");
  revalidatePath("/chat");
  return { ok: true };
}

/** Give a new staff account its chat identity — a team_members row linked to the
 *  login. Without one they have no DM address: team chat keys conversations on
 *  roster slugs, so they could read channels but nobody could message them.
 *  Adopts an existing roster row with the same name (Joe added "Marco" by hand,
 *  then gave Marco a login) rather than creating a second one. Best-effort: a
 *  hiccup here must not cost them their account. */
async function linkChatIdentity(userId: string, name: string): Promise<void> {
  const base =
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "teammate";
  try {
    const adopted = await query(
      `UPDATE team_members SET user_id = $1, active = true
        WHERE user_id IS NULL AND lower(name) = lower($2)`,
      [userId, name.trim()],
    );
    if (adopted.rowCount && adopted.rowCount > 0) return;
    // Slug collision with an unrelated roster row: suffix until it's free. The
    // slug is only ever an address, so -2 is fine.
    for (let n = 0; n < 20; n++) {
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      const taken = await queryOne(`SELECT 1 FROM team_members WHERE slug = $1`, [slug]);
      if (taken) continue;
      await query(
        `INSERT INTO team_members (slug, name, role_label, active, user_id)
         VALUES ($1, $2, 'Team', true, $3)`,
        [slug, name.trim(), userId],
      );
      return;
    }
  } catch (err) {
    console.error("[users] could not link a chat identity", err);
  }
}

/** Replace a staff member's areas. Owner-only; only staff rows carry areas.
 *  Takes effect on their next request (requireAccess re-reads the row) —
 *  their session cookie's copy only drives the cheap proxy prefilter. */
export async function updateUserAccess(id: string, formData: FormData): Promise<UserActionResult> {
  await requireRole("owner");
  const perms = permsFromForm(formData);
  if (perms.length === 0) return { ok: false, error: "Tick at least one area — or disable the account instead." };
  const row = await queryOne<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
  if (!row) return { ok: false, error: "That user no longer exists." };
  if (row.role !== "staff") return { ok: false, error: "Only team-member accounts have areas." };
  await query(`UPDATE users SET permissions = $2 WHERE id = $1`, [id, perms]);
  revalidatePath("/settings");
  return { ok: true };
}

/** Set a new password for a non-owner login (there is no self-serve reset;
 *  Joe hands them the temp password). Owner-only. */
export async function resetUserPassword(id: string, formData: FormData): Promise<UserActionResult> {
  await requireRole("owner");
  const password = String(formData.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { ok: false, error: `Password needs at least ${MIN_PASSWORD} characters.` };
  const hash = await hashPassword(password);
  const res = await query(`UPDATE users SET password_hash = $2 WHERE id = $1 AND role <> 'owner'`, [id, hash]);
  if (res.rowCount === 0) return { ok: false, error: "That account can't be reset here." };
  revalidatePath("/settings");
  return { ok: true };
}

/** Enable/disable a login. Owner-only; owner rows are protected (no lock-out).
 *  The chat roster row is left alone on purpose — deactivating it too would
 *  break attribution on everything they ever posted (that's why team_members
 *  deactivates rather than deletes). lib/chat.ts already stops treating a
 *  disabled account as a DM target. */
export async function setUserActive(id: string, active: boolean) {
  await requireRole("owner");
  await query(`UPDATE users SET active = $2 WHERE id = $1 AND role <> 'owner'`, [id, active]);
  revalidatePath("/settings");
  revalidatePath("/chat");
}
