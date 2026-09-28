// GET /api/inbox/oauth/callback — Google redirects here after consent.
//
// Two outcomes, decided by WHO is signed in — never by anything in the URL:
//
//   staff → the refresh token is stored in user_email_accounts under their own
//           id, and /inbox starts reading their mailbox on the next request. No
//           env edit, no restart, and no staff account ever touches the
//           company token.
//
//   owner → unchanged from before: the token is rendered once to paste into
//           .env.local as GMAIL_REFRESH_TOKEN. The owner's mailbox is
//           deliberately still the env one, because that same token is what
//           every background path uses (detectors, the lead thread sync, MCP
//           send_email). Storing a second copy in the DB would leave the UI on
//           one token and the automation on another, which is exactly the kind
//           of split that goes unnoticed until a send fails.

import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/dal";
import { exchangeCodeForMailbox } from "@/lib/gmail";
import { linkMailbox } from "@/lib/mailbox";

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
     <style>body{font:15px/1.6 system-ui;max-width:640px;margin:64px auto;padding:0 20px;color:#283021}
     code,pre{background:#F1ECE1;border-radius:8px;padding:2px 6px;font-family:ui-monospace,monospace}
     pre{padding:14px;white-space:pre-wrap;word-break:break-all}h1{font-size:20px}</style></head>
     <body><h1>${title}</h1>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Don't paste an OAuth error string into HTML unescaped. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user, "inbox")) {
    return NextResponse.json({ error: "no inbox access" }, { status: 403 });
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error) return page("Authorization cancelled", `<p>Google returned: <code>${esc(error)}</code></p>`);
  if (!code) return page("Missing code", "<p>No authorization code in the callback.</p>");

  try {
    const { refreshToken, email } = await exchangeCodeForMailbox(code);
    if (!refreshToken) {
      return page(
        "No refresh token returned",
        "<p>Google didn't return a refresh token. Revoke the app's access at " +
          "<a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a> " +
          "and try <a href='/api/inbox/oauth/start'>connecting again</a> (this forces a fresh consent).</p>",
      );
    }

    if (user.role !== "owner") {
      await linkMailbox(user.id, email, refreshToken);
      return page(
        "Email connected ✓",
        `<p>${esc(email) || "Your mailbox"} is now linked to your SJC OS account.</p>` +
          "<p><a href='/inbox'>Open the inbox</a> — it reads your mail, and only yours. " +
          "Joe can't read it from his account, and disconnecting it is in the Email rail.</p>",
      );
    }

    return page(
      "Gmail connected ✓",
      `<p>Authorized ${esc(email) || "the account"}. Add this line to <code>.env.local</code>, then restart the service:</p>` +
        `<pre>GMAIL_REFRESH_TOKEN=${esc(refreshToken)}</pre>` +
        "<p>The owner mailbox stays in the environment on purpose — it's the same token the " +
        "background jobs and MCP sends use, so there's only ever one of it. " +
        "This is shown only once; copy it now.</p>",
    );
  } catch (err) {
    return page("Token exchange failed", `<pre>${esc((err as Error).message)}</pre>`);
  }
}
