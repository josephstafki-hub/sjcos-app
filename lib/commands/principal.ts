// Trusted principals (A03a / A22). A Principal is ALWAYS derived on the server
// from a session cookie, a bearer token, a service secret or a worker
// identity — never from a request body. An agent principal carries the user
// it acts for (null = a background worker with no person behind it) and can
// never hold more authority than that user.
//
// Pure module: no db, no next/headers. Resolution helpers that touch the
// request live in lib/commands/db.ts (server-only).

import type { PermissionKey } from "../permissions.ts";

export type Role = "owner" | "staff" | "sub" | "client";

export interface UserPrincipal {
  kind: "user";
  userId: string;
  role: Role;
  name: string;
  /** Staff areas (lib/permissions.ts). Empty for owner/portal roles. */
  permissions: PermissionKey[];
  /** Portal roles: the slug they are linked to. */
  linkSlug?: string | null;
}

export interface ServicePrincipal {
  kind: "service";
  /** cron:<job> / worker:<name> / webhook:<provider> */
  name: string;
}

export interface AgentPrincipal {
  kind: "agent";
  /** claude / hermes / qwen / mcp:<client> */
  agent: string;
  runId?: string | null;
  /** The person this agent is acting for. null = unattended background work. */
  onBehalfOf: UserPrincipal | null;
}

export type Principal = UserPrincipal | ServicePrincipal | AgentPrincipal;

/** The human behind a principal, if any. */
export function humanOf(p: Principal): UserPrincipal | null {
  if (p.kind === "user") return p;
  if (p.kind === "agent") return p.onBehalfOf;
  return null;
}

export function isOwner(p: Principal): boolean {
  return humanOf(p)?.role === "owner";
}

/** Area visibility, mirrored from lib/dal can(): owner always; staff per
 *  ticked area; an agent inherits its user's areas; services see nothing
 *  through this check (they use policy authority instead). */
export function hasArea(p: Principal, area: PermissionKey): boolean {
  const h = humanOf(p);
  if (!h) return false;
  if (h.role === "owner") return true;
  if (h.role === "staff") return h.permissions.includes(area);
  return false;
}

export function principalLabel(p: Principal): string {
  if (p.kind === "user") return `${p.role}:${p.name}`;
  if (p.kind === "service") return p.name;
  return `${p.agent}${p.onBehalfOf ? ` for ${p.onBehalfOf.name}` : " (unattended)"}`;
}

export const SYSTEM: ServicePrincipal = { kind: "service", name: "system" };
