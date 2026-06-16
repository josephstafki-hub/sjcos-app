import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { queryOne } from "@/lib/db";
import { readSession, type Role } from "@/lib/session";

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
  }>(
    `SELECT id, email, name, role, initials, link_slug, active
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
  };
});

/** Require an authenticated user (redirects to /login otherwise). */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Require one of the given roles. Wrong role → bounced to their own home. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

/** The landing route for a role after login / when access is denied. */
export function homeForRole(role: Role): string {
  if (role === "sub") return "/sub-portal";
  if (role === "client") return "/client-portal";
  return "/today";
}
