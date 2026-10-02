// GET /api/inbox/oauth/start — kick off the Gmail consent flow.
//
// Open to the owner and to any staff account holding the Inbox area: a team
// member connects THEIR OWN mailbox here (Joe, 2026-09-27 — "link able to their
// email otherwise blank"). Which account the resulting token lands under is
// decided by the callback from the session, not by anything in this redirect,
// so there is nothing here a caller could tamper with to link someone else.

import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/dal";
import { consentUrl, gmailOAuthAppConfigured } from "@/lib/gmail";

export async function GET() {
  const user = await getCurrentUser();
  if (!can(user, "inbox")) {
    return NextResponse.json({ error: "no inbox access" }, { status: 403 });
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
