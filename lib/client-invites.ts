import "server-only";

// Client portal invites — the homeowner's way in without an account.
//
// Mirrors lib/subs.ts' invite handling and app/sub-portal/enter: one active
// token per project OR lead, traded at /client-portal/enter for a real session
// cookie. The token is stored RAW for the same reason it is on the sub side —
// the link itself is what gets emailed, so hashing the column while the email
// body holds the plaintext would be theatre.
//
// An invite scopes to a project XOR a lead (client_portal_invites CHECK). The
// lead scope is how the dashboard opens during the lead stage — same portal,
// same token trade; the minted user gets link_slug = 'lead:<slug>' and the
// conversion flow rewrites both the invite row and the user when the lead
// becomes a project.
//
// Unlike subs, a client can CLAIM their portal (set a password). After that,
// tokenValid() refuses the link and only password login works.

import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";

/** How long a fresh invite link stays good. Matches the sub-portal window. */
const INVITE_DAYS = 30;

/** Who the invite (and the portal session behind it) is scoped to. */
export type ClientInviteScope = { project: string } | { lead: string };

/** users.link_slug value for a scope — leads carry a 'lead:' prefix so a lead
 *  slug can never collide with a project slug in the shared column. */
export function scopeLinkSlug(scope: ClientInviteScope): string {
  return "project" in scope ? scope.project : `lead:${scope.lead}`;
}

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
  plans: "/client-portal/plans",
  mood: "/client-portal/mood",
  documents: "/client-portal/documents",
  selections: "/client-portal/selections",
  money: "/client-portal/money",
  schedule: "/client-portal/schedule",
  messages: "/client-portal/messages",
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

interface InviteRow {
  token: string;
  to_email: string | null;
  to_name: string;
  expires_at: Date;
  used_at: Date | null;
  status: "active" | "dismissed";
}

function rowToInvite(row: InviteRow): ClientInvite {
  return {
    token: row.token,
    toEmail: row.to_email,
    toName: row.to_name,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    status: row.status,
  };
}

/** The scope's current invite, if any. */
export async function getClientInvite(scope: ClientInviteScope): Promise<ClientInvite | null> {
  const project = "project" in scope;
  const row = await queryOne<InviteRow>(
    `SELECT token, to_email, to_name, expires_at, used_at, status
       FROM client_portal_invites WHERE ${project ? "project_slug" : "lead_slug"} = $1`,
    [project ? scope.project : scope.lead],
  );
  return row ? rowToInvite(row) : null;
}

/** Issue (or re-issue) the scope's invite and return it. Re-issuing rotates
 *  the token — the old link dies, which is what "revoke and resend" should do.
 *  One row per project/lead (partial uniques), so this upserts. */
export async function issueClientInvite(scope: ClientInviteScope): Promise<ClientInvite> {
  let name: string;
  let fallbackEmail: string | null = null;
  if ("project" in scope) {
    const proj = await queryOne<{ client_name: string | null; client_email: string | null }>(
      `SELECT client_name, client_email FROM projects WHERE slug = $1`,
      [scope.project],
    );
    if (!proj) throw new Error(`No project '${scope.project}'.`);
    name = proj.client_name ?? "";
    fallbackEmail = proj.client_email?.trim() || null;
  } else {
    const lead = await queryOne<{ name: string; email: string | null }>(
      `SELECT name, email FROM leads WHERE slug = $1`,
      [scope.lead],
    );
    if (!lead) throw new Error(`No lead '${scope.lead}'.`);
    name = lead.name;
    fallbackEmail = lead.email?.trim() || null;
  }

  // Prefer an explicit client account email; fall back to the project's client
  // email / the lead's email, so a brand-new invite still addresses someone.
  const account = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE role = 'client' AND link_slug = $1 AND email NOT LIKE '%@client-portal.invalid' LIMIT 1`,
    [scopeLinkSlug(scope)],
  );

  const token = randomBytes(24).toString("hex");
  const isProject = "project" in scope;
  const slug = isProject ? scope.project : scope.lead;
  const row = await queryOne<InviteRow>(
    `INSERT INTO client_portal_invites (project_slug, lead_slug, to_email, to_name, token, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval, 'active')
     ON CONFLICT (${isProject ? "project_slug" : "lead_slug"}) ${isProject ? "" : "WHERE lead_slug IS NOT NULL "}DO UPDATE
       SET token = EXCLUDED.token,
           to_email = EXCLUDED.to_email,
           to_name = EXCLUDED.to_name,
           expires_at = EXCLUDED.expires_at,
           status = 'active',
           used_at = NULL
     RETURNING token, to_email, to_name, expires_at, used_at, status`,
    [
      isProject ? slug : null,
      isProject ? null : slug,
      account?.email ?? fallbackEmail,
      name,
      token,
      String(INVITE_DAYS),
    ],
  );
  return rowToInvite(row!);
}

/** Get the active invite, creating one if the scope doesn't have a live link
 *  yet. Used by any send path that needs a URL to put in an email. */
export async function ensureClientInvite(scope: ClientInviteScope): Promise<ClientInvite> {
  const existing = await getClientInvite(scope);
  if (existing && existing.status === "active" && existing.expiresAt > new Date()) {
    return existing;
  }
  return issueClientInvite(scope);
}

/** Kill the link without touching the account behind it. */
export async function revokeClientInvite(scope: ClientInviteScope): Promise<void> {
  const project = "project" in scope;
  await query(
    `UPDATE client_portal_invites SET status = 'dismissed' WHERE ${project ? "project_slug" : "lead_slug"} = $1`,
    [project ? scope.project : scope.lead],
  );
}
