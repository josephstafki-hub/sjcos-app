// GET /api/qbo/oauth/callback: Intuit redirects here after the owner picks
// the company (?code=…&state=…&realmId=…, or ?error=access_denied).
//
// CSRF: the code is exchanged ONLY when `state` matches the httpOnly cookie
// set by ../start, compared in constant time. A mismatch, a missing cookie
// (expired or started in another browser) or a missing state never reaches
// Intuit's token endpoint. The cookie is single-use: cleared on every path.
// Outcomes land back on Settings › Accounting as ?qbo=<result>.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { completeQboConnect } from "@/lib/accounting/server";
import { QBO_OAUTH_PATH, QBO_STATE_COOKIE, qboAppBase, statesMatch } from "@/lib/accounting/qbo/oauth";

export const dynamic = "force-dynamic";

function back(result: string, extra: Record<string, string> = {}): NextResponse {
  // Public address, not request.url: behind nginx that reads localhost:3017.
  const url = new URL("/settings/accounting", qboAppBase());
  url.searchParams.set("qbo", result);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.set(QBO_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: QBO_OAUTH_PATH, maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });

  const q = request.nextUrl.searchParams;
  if (q.get("error")) return back("cancelled");
  if (!statesMatch(request.cookies.get(QBO_STATE_COOKIE)?.value, q.get("state"))) return back("csrf");

  const code = q.get("code");
  const realmId = q.get("realmId");
  if (!code || !realmId) return back("failed", { reason: "Intuit did not send back a code and company id." });

  const r = await completeQboConnect({ code, realmId });
  if (!r.ok) return back("failed", { reason: (r.error ?? "unknown error").slice(0, 200) });
  return back("connected");
}
