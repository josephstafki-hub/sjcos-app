// GET /api/inbox/oauth/start — kick off the one-time Gmail consent flow.
// Owner-only. Redirects to Google's consent screen; Google sends the user back
// to /api/inbox/oauth/callback with a code we exchange for a refresh token.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { consentUrl, gmailOAuthAppConfigured } from "@/lib/gmail";

export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }
  if (!gmailOAuthAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env.local first, then restart the dev server.",
      },
      { status: 412 },
    );
  }
  return NextResponse.redirect(consentUrl());
}
