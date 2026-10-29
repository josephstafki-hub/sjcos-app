// GET /api/qbo/oauth/start: "Connect to QuickBooks" on Settings › Accounting.
//
// Owner only. Mints a random CSRF `state`, keeps it in an httpOnly cookie
// scoped to /api/qbo/oauth (10 minutes), and sends the browser to Intuit's
// consent screen, where the owner signs in and picks the company. Intuit
// returns to ../callback, which refuses any code whose state doesn't match.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { qboOAuthConfigured } from "@/lib/accounting/qbo/index";
import { authorizeUrl, newOAuthState, QBO_OAUTH_PATH, QBO_STATE_COOKIE, QBO_STATE_MAX_AGE_S, qboRedirectUri } from "@/lib/accounting/qbo/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  if (!qboOAuthConfigured()) {
    return NextResponse.redirect(new URL("/settings/accounting?qbo=not_configured", request.url));
  }
  const state = newOAuthState();
  const res = NextResponse.redirect(authorizeUrl({ clientId: process.env.INTUIT_CLIENT_ID!.trim(), redirectUri: qboRedirectUri(), state }));
  res.cookies.set(QBO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Intuit returns with a top-level GET from another site: "lax" still
    // sends the cookie on that navigation, "strict" would not.
    sameSite: "lax",
    path: QBO_OAUTH_PATH,
    maxAge: QBO_STATE_MAX_AGE_S,
  });
  return res;
}
