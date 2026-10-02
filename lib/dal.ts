import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { queryOne } from "@/lib/db";
import { readSession, type Role } from "@/lib/session";
import { normalizePermissions, staffHome, staffMayOpen, type PermissionKey } from "@/lib/permissions";
import { sessionRevoked } from "@/lib/api-auth";

// Data Access Layer — the single place the app resolves "who is logged in".
// verifySession() does the optimistic cookie check; getCurrentUser() loads the
// row. Both are React-cached so they run once per render pass.

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  initials: string;
  linkSlug: string | null;
  /** Staff: access areas (lib/permissions.ts). Empty for every other role —
   *  owner is implicitly everything, portal roles use none of them. */
  permissions: PermissionKey[];
}

/** Verify a session exists; redirect to /login if not. Returns id + role. */
export const verifySession = cache(async () => {
  const session = await readSession();
  if (!session?.userId) redirect("/login");
  return { userId: session.userId, role: session.role };
});

/** The logged-in user's row, or null if no/invalid session. Never redirects. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
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
  // A22: a session minted before the user's latest revocation is dead even
  // though the JWT still verifies — no re-login needed for a revoke to bite.
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
});

/** Does this user hold an area? Owner: always. Staff: if ticked. Portal
 *  roles: never. Use this for VISIBILITY decisions in pages/components (hide
 *  the Money tab); use requireAccess() for ENFORCEMENT in actions/pages. */
export function can(user: Pick<CurrentUser, "role" | "permissions"> | null, perm: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === "owner") return true;
  if (user.role === "staff") return user.permissions.includes(perm);
  return false;
}

/** May this user open this internal path? Owner: yes. Staff: per areas. */
export function canOpen(user: Pick<CurrentUser, "role" | "permissions">, path: string): boolean {
  if (user.role === "owner") return true;
  if (user.role === "staff") return staffMayOpen(user.permissions, path);
  return false;
}

/** Require an area: owner passes, staff must hold it, everyone else is sent
 *  home. This is the replacement for requireRole("owner") in any server action
 *  or page that a staff member could legitimately reach — the DB row is read
 *  fresh (React-cached per request), so revoking an area takes effect on the
 *  next request regardless of what the session cookie says. */
export async function requireAccess(perm: PermissionKey): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, perm)) redirect(homeFor(user));
  return user;
}

/** Require an authenticated user (redirects to /login otherwise). A STALE
 *  session — valid JWT but the users row is gone or deactivated — goes to
 *  /logout instead: proxy.ts trusts the JWT and bounces /login back to the
 *  role home, so redirecting to /login here would loop; /logout clears the
 *  cookie and breaks out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const session = await readSession();
    redirect(session?.userId ? "/logout" : "/login");
  }
  return user;
}

/** Require one of the given roles. Wrong role → bounced to their own home. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

/** The landing route for a role after login / when access is denied. Staff
 *  need their areas too — prefer homeFor(user) when a row is in hand. */
export function homeForRole(role: Role, permissions: readonly string[] = []): string {
  if (role === "sub") return "/sub-portal";
  if (role === "client") return "/client-portal";
  if (role === "staff") return staffHome(permissions);
  return "/today";
}

export function homeFor(user: Pick<CurrentUser, "role" | "permissions">): string {
  return homeForRole(user.role, user.permissions);
}
