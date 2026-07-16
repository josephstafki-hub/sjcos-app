// GET /sub-portal/enter?token=… — the sub's way in.
//
// A subcontractor should never have to create an account or remember a password
// to see their scope. The invite link carries an opaque token; this route trades
// it for the normal sjcos_session cookie (role=sub, link_slug=<their slug>), so
// every existing requireRole("owner","sub") check just works from then on.
//
// SECURITY — this is a BEARER LINK, deliberately. Anyone holding the email can
// enter that one sub's portal: their scope/dates, their own logs, invoices and
// documents, and the message thread with Joe. It cannot reach owner surfaces or
// another sub's data. That's the trade we're making for trade-partner UX (no
// passwords for guys on a roof). The levers, if a link leaks: the invite's
// 30-day expiry, Dismiss on the project Subs tab (revokes the token), and
// users.active = false (hard stop, beats any link).

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/session";

/** Initials from a sub's name — same first-two-words rule as lib/subs.ts. */
function subInitials(name: string): string {
  const w = name.split(/\s+/).filter((x) => /^[A-Za-z]/.test(x));
  if (w.length === 0) return name.slice(0, 2).toUpperCase();
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const bounce = (why: string) =>
    NextResponse.redirect(new URL(`/login?invite=${why}`, url.origin));

  if (!token) return bounce("missing");

  // Reusable until it expires, NOT single-use: this link is the sub's only
  // credential, and the session cookie lasts 7 days. Burning the token on first
  // click would lock them out on day 8 and mean a new invite for every phone.
  const invite = await queryOne<{ id: string; sub_slug: string; sub_name: string }>(
    `SELECT i.id, i.sub_slug, s.name AS sub_name
       FROM sub_portal_invites i
       JOIN subs s ON s.slug = i.sub_slug
      WHERE i.token = $1 AND i.status <> 'dismissed' AND i.expires_at > now()`,
    [token],
  );
  if (!invite) return bounce("expired");

  // Find their account, or make one they'll never have to think about.
  const existing = await queryOne<{ id: string; active: boolean }>(
    `SELECT id, active FROM users WHERE role = 'sub' AND link_slug = $1`,
    [invite.sub_slug],
  );
  // A deactivated account outranks the link.
  if (existing && !existing.active) return bounce("inactive");

  let userId = existing?.id;
  if (!userId) {
    // A real scrypt hash of an unguessable throwaway: password login stays
    // impossible without leaving a malformed hash for verifyPassword to meet.
    const unusable = await hashPassword(randomBytes(32).toString("hex"));
    const sub = await queryOne<{ email: string | null }>(`SELECT email FROM subs WHERE slug = $1`, [
      invite.sub_slug,
    ]);
    const synthetic = `${invite.sub_slug}@sub-portal.invalid`;
    try {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO users (email, password_hash, name, role, initials, link_slug)
         VALUES ($1, $2, $3, 'sub', $4, $5) RETURNING id`,
        [
          sub?.email ?? synthetic,
          unusable,
          invite.sub_name,
          subInitials(invite.sub_name),
          invite.sub_slug,
        ],
      );
      userId = row?.id;
    } catch {
      // That email already belongs to someone else — never hijack their account;
      // give the sub their own row on the synthetic address instead.
      const row = await queryOne<{ id: string }>(
        `INSERT INTO users (email, password_hash, name, role, initials, link_slug)
         VALUES ($1, $2, $3, 'sub', $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [synthetic, unusable, invite.sub_name, subInitials(invite.sub_name), invite.sub_slug],
      );
      userId = row?.id;
    }
  }
  if (!userId) return bounce("failed");

  await query(`UPDATE sub_portal_invites SET used_at = COALESCE(used_at, now()) WHERE id = $1`, [
    invite.id,
  ]);
  await createSession(userId, "sub");
  return NextResponse.redirect(new URL("/sub-portal", url.origin));
}
