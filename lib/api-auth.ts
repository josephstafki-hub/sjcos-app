import "server-only";
import { queryOne } from "@/lib/db";
import { decrypt, type Role } from "@/lib/session";
import type { CurrentUser } from "@/lib/dal";
import { normalizePermissions, type PermissionKey } from "@/lib/permissions";

// Bearer-token auth for the mobile API (/api/mobile/*). Native clients can't use
// the httpOnly session cookie, so they send the same signed JWT in an
// Authorization header instead. This mirrors lib/dal getCurrentUser but reads
// the token from the request rather than next/headers cookies().

/** Extract + verify the Bearer token from a request, returning the user row. */
export async function getUserFromRequest(req: Request): Promise<CurrentUser | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : null;
  if (!token) return null;

  const session = await decrypt(token);
  if (!session?.userId) return null;

  const row = await queryOne<{
    id: string;
    email: string;
    name: string;
    role: Role;
    initials: string;
    link_slug: string | null;
    active: boolean;
    permissions: string[] | null;
  }>(
    `SELECT id, email, name, role, initials, link_slug, active, permissions
       FROM users WHERE id = $1`,
    [session.userId],
  );
  if (!row || !row.active) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    initials: row.initials,
    linkSlug: row.link_slug,
    permissions: row.role === "staff" ? normalizePermissions(row.permissions) : [],
  };
}

/** Route-handler twin of lib/dal can(): owner always, staff per area. Plain
 *  function (no next/headers) so API routes can use it with either a cookie
 *  user (getCurrentUser) or a bearer user (getUserFromRequest). */
export function hasAccess(user: Pick<CurrentUser, "role" | "permissions"> | null, perm: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === "owner") return true;
  if (user.role === "staff") return user.permissions.includes(perm);
  return false;
}
