import "server-only";
import { queryOne } from "@/lib/db";
import { decrypt, type Role, type SessionPayload } from "@/lib/session";
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
    revoked_before: string | null;
  }>(
    `SELECT u.id, u.email, u.name, u.role, u.initials, u.link_slug, u.active, u.permissions,
            (SELECT max(r.revoked_before) FROM session_revocations r WHERE r.user_id = u.id)::text AS revoked_before
       FROM users u WHERE u.id = $1`,
    [session.userId],
  );
  if (!row || !row.active) return null;
  if (sessionRevoked(row.revoked_before, session)) return null;

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

/** A22 session revocation: the token is dead when it was minted before the
 *  user's newest session_revocations.revoked_before. The mint time is the
 *  `authAt` claim when present (survives proxy renewals once lib/session.ts
 *  and proxy.ts carry it), else the JWT's own iat. A token with neither is
 *  refused whenever any revocation exists — fail closed. Shared by the
 *  cookie path (lib/dal.ts) and the bearer path here. */
export function sessionRevoked(revokedBefore: string | null | undefined, session: Pick<SessionPayload, "iat"> & { authAt?: number }): boolean {
  if (!revokedBefore) return false;
  const mintedS = typeof session.authAt === "number" ? session.authAt : typeof session.iat === "number" ? session.iat : null;
  if (mintedS == null) return true;
  return new Date(revokedBefore).getTime() > mintedS * 1000;
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
