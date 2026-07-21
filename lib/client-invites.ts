import "server-only";

// Client portal invites — the homeowner's way in without an account.
//
// Mirrors lib/subs.ts' invite handling and app/sub-portal/enter: one active
// token per project, traded at /client-portal/enter for a real session cookie.
// The token is stored RAW for the same reason it is on the sub side — the link
// itself is what gets emailed, so hashing the column while the email body holds
// the plaintext would be theatre.
//
// Unlike subs, a client can CLAIM their portal (set a password). After that,
// tokenValid() refuses the link and only password login works.

import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";

/** How long a fresh invite link stays good. Matches the sub-portal window. */
const INVITE_DAYS = 30;

export interface ClientInvite {
  token: string;
  toEmail: string | null;
  toName: string;
  expiresAt: Date;
  usedAt: Date | null;
  status: "active" | "dismissed";
}

/** Portal sections a link may deep-link into. Anything else falls back to the
 *  portal root — this is an allowlist so a token URL can never be used to bounce
 *  a client somewhere arbitrary (open-redirect). */
export const PORTAL_TARGETS = {
  home: "/client-portal",
  documents: "/client-portal#documents",
  selections: "/client-portal#selections",
  schedule: "/client-portal#schedule",
  messages: "/client-portal#messages",
  files: "/client-portal#files",
  warranty: "/client-portal#warranty",
} as const;

export type PortalTargetKey = keyof typeof PORTAL_TARGETS;

export function portalTargetPath(key: string | null | undefined): string {
  if (key && key in PORTAL_TARGETS) return PORTAL_TARGETS[key as PortalTargetKey];
  return PORTAL_TARGETS.home;
}

/** The app's public base URL, for links that must work from an email client. */
export function portalBaseUrl(): string {
  return (
    process.env.SJC_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://os.sjcarpentryllc.com"
  ).replace(/\/+$/, "");
}

/** Build the full clickable link for a token, optionally deep-linked. */
export function inviteLink(token: string, to?: PortalTargetKey): string {
  const q = to && to !== "home" ? `&to=${to}` : "";
  return `${portalBaseUrl()}/client-portal/enter?token=${token}${q}`;
}

/** The project's current active invite, if any. */
export async function getClientInvite(projectSlug: string): Promise<ClientInvite | null> {
  const row = await queryOne<{
    token: string;
    to_email: string | null;
    to_name: string;
    expires_at: Date;
    used_at: Date | null;
    status: "active" | "dismissed";
  }>(
    `SELECT token, to_email, to_name, expires_at, used_at, status
       FROM client_portal_invites WHERE project_slug = $1`,
    [projectSlug],
  );
  if (!row) return null;
  return {
    token: row.token,
    toEmail: row.to_email,
    toName: row.to_name,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    status: row.status,
  };
}

/** Issue (or re-issue) the project's invite and return it. Re-issuing rotates
 *  the token — the old link dies, which is what "revoke and resend" should do.
 *  One row per project (UNIQUE project_slug), so this upserts. */
export async function issueClientInvite(projectSlug: string): Promise<ClientInvite> {
  const proj = await queryOne<{ client_name: string | null }>(
    `SELECT client_name FROM projects WHERE slug = $1`,
    [projectSlug],
  );
  if (!proj) throw new Error(`No project '${projectSlug}'.`);

  // Prefer an explicit client account email; fall back to the lead the project
  // came from, so a brand-new project still addresses someone.
  const email = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE role = 'client' AND link_slug = $1 AND email NOT LIKE '%@client-portal.invalid' LIMIT 1`,
    [projectSlug],
  );

  const token = randomBytes(24).toString("hex");
  const row = await queryOne<{
    token: string;
    to_email: string | null;
    to_name: string;
    expires_at: Date;
    used_at: Date | null;
    status: "active" | "dismissed";
  }>(
    `INSERT INTO client_portal_invites (project_slug, to_email, to_name, token, expires_at, status)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, 'active')
     ON CONFLICT (project_slug) DO UPDATE
       SET token = EXCLUDED.token,
           to_email = EXCLUDED.to_email,
           to_name = EXCLUDED.to_name,
           expires_at = EXCLUDED.expires_at,
           status = 'active',
           used_at = NULL
     RETURNING token, to_email, to_name, expires_at, used_at, status`,
    [projectSlug, email?.email ?? null, proj.client_name ?? "", token, String(INVITE_DAYS)],
  );
  return {
    token: row!.token,
    toEmail: row!.to_email,
    toName: row!.to_name,
    expiresAt: row!.expires_at,
    usedAt: row!.used_at,
    status: row!.status,
  };
}

/** Get the active invite, creating one if the project doesn't have a live link
 *  yet. Used by any send path that needs a URL to put in an email. */
export async function ensureClientInvite(projectSlug: string): Promise<ClientInvite> {
  const existing = await getClientInvite(projectSlug);
  if (existing && existing.status === "active" && existing.expiresAt > new Date()) {
    return existing;
  }
  return issueClientInvite(projectSlug);
}

/** Kill the link without touching the account behind it. */
export async function revokeClientInvite(projectSlug: string): Promise<void> {
  await query(
    `UPDATE client_portal_invites SET status = 'dismissed' WHERE project_slug = $1`,
    [projectSlug],
  );
}
