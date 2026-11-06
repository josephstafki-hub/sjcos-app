import type {PermissionKey} from "./permissions";

/** Route-handler twin of lib/dal can(): owner always, staff per area. Plain
 *  function (no next/headers) so API routes can use it with either a cookie
 *  user (getCurrentUser) or a bearer user (getUserFromRequest). */
export function hasAccess(user: {role:string;permissions:readonly string[]} | null, perm: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === "owner") return true;
  if (user.role === "staff") return user.permissions.includes(perm);
  return false;
}
