import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Next 16 middleware (file name is `proxy.ts`). Optimistic auth: read the
// session JWT straight from the request cookie and redirect. This is the
// pre-filter only — pages/actions still enforce via lib/dal (requireRole).

const COOKIE = "sjcos_session";
const encodedKey = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
);

type Role = "owner" | "sub" | "client";

async function readRole(req: NextRequest): Promise<{ role: Role } | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    return { role: payload.role as Role };
  } catch {
    return null;
  }
}

function homeForRole(role: Role): string {
  if (role === "sub") return "/sub-portal";
  if (role === "client") return "/client-portal";
  return "/today";
}

/** Reachable without a session. The portal invite links are the sub's and the
 *  client's way IN — they have no cookie yet by definition, so bouncing them to
 *  /login would defeat the whole point. The routes themselves are the gate:
 *  each only mints a session for a valid, undismissed token
 *  (app/sub-portal/enter, app/client-portal/enter). */
const PUBLIC_PATHS = ["/login", "/sub-portal/enter", "/client-portal/enter"];

/** Portal surfaces whose visitors may have no password at all — a sub never
 *  does, and a client only does once they claim the portal. When their session
 *  lapses (7 days) a bookmark or a stale tab lands here with no cookie, and a
 *  bare sign-in form is a dead end for them: the emailed link is their whole
 *  credential. Tagging the bounce lets /login say "open the link Joe sent you",
 *  which now always works — those links don't expire. */
const LINK_CREDENTIAL_PATHS = ["/client-portal", "/sub-portal"];

/** Routes a non-owner role is allowed to reach (besides /login). /logout must
 *  stay reachable for every role — it's the escape hatch for a stale session
 *  (valid JWT, deleted user row), which would otherwise loop forever between
 *  /login and the role home. */
function allowedFor(role: Role): string[] {
  if (role === "sub") return ["/sub-portal", "/logout"];
  if (role === "client") return ["/client-portal", "/logout"];
  return []; // owner: everything
}

/** OAuth/OIDC discovery probes. MCP clients (claude.ai, ChatGPT connectors)
 *  hit these before connecting to /mcp*; a 307 to /login reads as "this host
 *  is an OAuth server" and the connector then fails dynamic client
 *  registration instead of falling back to no-auth. nginx 404s them first
 *  (deploy/nginx-sjcos.conf) — this is the backstop for a drifted nginx. */
function isOauthDiscoveryProbe(path: string): boolean {
  return path.startsWith("/.well-known/oauth") || path === "/.well-known/openid-configuration";
}

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (isOauthDiscoveryProbe(path)) return new NextResponse(null, { status: 404 });
  const session = await readRole(req);

  // Unauthenticated → only the public paths are reachable.
  if (!session) {
    if (PUBLIC_PATHS.includes(path)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Drop whatever query the old URL carried; the only param /login reads is
    // the notice below, and forwarding a stale one would show the wrong copy.
    url.search = "";
    if (LINK_CREDENTIAL_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
      url.searchParams.set("invite", "signedout");
    }
    return NextResponse.redirect(url);
  }

  // Authenticated hitting /login → straight to their home.
  if (path === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = homeForRole(session.role);
    return NextResponse.redirect(url);
  }

  // Role gating: non-owners are confined to their portal.
  const allowed = allowedFor(session.role);
  if (allowed.length > 0 && !allowed.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = req.nextUrl.clone();
    url.pathname = homeForRole(session.role);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except API routes, Next internals, and static assets.
  // `manifest.webmanifest` must stay public: browsers fetch the PWA manifest
  // with credentials omitted, so gating it would 307 the install to /login and
  // silently break "Add to Home Screen".
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};
