// GET /client-portal/enter?token=…&to=documents — the homeowner's way in.
//
// A client should never have to create an account to read their contract or
// approve a selection. The link Joe sends carries an opaque token; this route
// trades it for the normal sjcos_session cookie (role=client,
// link_slug=<project slug>), so every existing requireRole("owner","client")
// check just works from then on. `to` deep-links into a portal section.
//
// SECURITY — this is a BEARER LINK, deliberately, the same trade already made
// for subs in app/sub-portal/enter. Anyone holding the email reaches that one
// project's portal: its documents, selections, schedule, files and the message
// thread with Joe. It cannot reach owner surfaces or another project's data.
// The levers, if a link leaks: the 30-day expiry, Revoke on the project (which
// rotates/kills the token), users.active = false, and — unique to clients —
// the client CLAIMING the portal with a password, after which this route
// refuses the link entirely and only password login works.

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { portalTargetPath } from "@/lib/client-invites";

/** Initials from a client's name — same first-two-words rule used elsewhere. */
function clientInitials(name: string): string {
  const w = name.split(/\s+/).filter((x) => /^[A-Za-z]/.test(x));
  if (w.length === 0) return name.slice(0, 2).toUpperCase() || "C";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const to = url.searchParams.get("to");

  // Redirect back to the host the client actually reached us on, not the raw
  // request origin. Behind a proxy (cloudflared tunnel, or any reverse proxy in
  // production) the request URL's host is the internal one (localhost:3018), so
  // redirecting there would bounce an off-network client to an address their
  // browser can't resolve. X-Forwarded-Host/Proto carry the public host.
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : url.origin;
  const bounce = (why: string) =>
    NextResponse.redirect(new URL(`/login?invite=${why}`, origin));

  if (!token) return bounce("missing");

  // Reusable until it expires, NOT single-use: this link is the client's only
  // credential and the session cookie lasts 7 days. Burning it on first click
  // would lock them out on day 8 and mean a new link for every device.
  const invite = await queryOne<{
    id: string;
    project_slug: string;
    client_name: string | null;
  }>(
    `SELECT i.id, i.project_slug, p.client_name
       FROM client_portal_invites i
       JOIN projects p ON p.slug = i.project_slug
      WHERE i.token = $1 AND i.status <> 'dismissed' AND i.expires_at > now()`,
    [token],
  );
  if (!invite) return bounce("expired");

  const name = invite.client_name || "Client";

  const existing = await queryOne<{
    id: string;
    active: boolean;
    portal_claimed_at: Date | null;
  }>(
    `SELECT id, active, portal_claimed_at FROM users
      WHERE role = 'client' AND link_slug = $1`,
    [invite.project_slug],
  );
  // A deactivated account outranks the link.
  if (existing && !existing.active) return bounce("inactive");
  // So does a claimed one — once they've set a password, the emailed link is no
  // longer a way in for whoever else might be holding it.
  if (existing?.portal_claimed_at) return bounce("claimed");

  let userId = existing?.id;
  if (!userId) {
    // A real scrypt hash of an unguessable throwaway: password login stays
    // impossible without leaving a malformed hash for verifyPassword to meet.
    // Claiming the portal replaces this with a hash of their chosen password.
    const unusable = await hashPassword(randomBytes(32).toString("hex"));
    const synthetic = `${invite.project_slug}@client-portal.invalid`;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, initials, link_slug)
       VALUES ($1, $2, $3, 'client', $4, $5)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [synthetic, unusable, name, clientInitials(name), invite.project_slug],
    );
    userId = row?.id;
    // Synthetic address collided (a prior portal for this slug) — reuse it
    // rather than minting a second account for the same project.
    if (!userId) {
      const prior = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE email = $1`,
        [synthetic],
      );
      userId = prior?.id;
    }
  }
  if (!userId) return bounce("failed");

  await query(
    `UPDATE client_portal_invites SET used_at = COALESCE(used_at, now()) WHERE id = $1`,
    [invite.id],
  );
  await createSession(userId, "client");
  return NextResponse.redirect(new URL(portalTargetPath(to), origin));
}
