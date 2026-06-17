// GET /api/inbox/oauth/callback — Google redirects here after consent.
// Owner-only. Exchanges the `code` for a refresh token and renders it once so
// the owner can paste it into .env.local as GMAIL_REFRESH_TOKEN. We never write
// it to disk — keeping secrets out of the repo and off the filesystem.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { exchangeCodeForRefreshToken } from "@/lib/gmail";

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

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (user?.role !== "owner") {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error) return page("Authorization cancelled", `<p>Google returned: <code>${error}</code></p>`);
  if (!code) return page("Missing code", "<p>No authorization code in the callback.</p>");

  try {
    const refreshToken = await exchangeCodeForRefreshToken(code);
    if (!refreshToken) {
      return page(
        "No refresh token returned",
        "<p>Google didn't return a refresh token. Revoke the app's access at " +
          "<a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a> " +
          "and try <a href='/api/inbox/oauth/start'>connecting again</a> (this forces a fresh consent).</p>",
      );
    }
    return page(
      "Gmail connected ✓",
      "<p>Add this line to <code>.env.local</code>, then restart the dev server:</p>" +
        `<pre>GMAIL_REFRESH_TOKEN=${refreshToken}</pre>` +
        "<p>Once it restarts, <code>/inbox</code> reads live Gmail. This token is " +
        "shown only once — copy it now.</p>",
    );
  } catch (err) {
    return page("Token exchange failed", `<pre>${(err as Error).message}</pre>`);
  }
}
