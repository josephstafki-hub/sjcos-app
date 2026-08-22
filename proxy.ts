import { NextResponse, type NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import {
  SESSION_COOKIE as COOKIE,
  SESSION_RENEW_AFTER_S,
  sessionMaxAgeS,
  type Role,
} from "@/lib/session-window";

// Next 16 middleware (file name is `proxy.ts`). Optimistic auth: read the
// session JWT straight from the request cookie and redirect. This is the
// pre-filter only — pages/actions still enforce via lib/dal (requireRole).
//
// It is also where sessions SLIDE. Renewal has to happen here because a Server
// Component can't write a cookie during render, and middleware is the one place
// every request passes through. lib/session-window.ts holds the shared cookie
// name and lifetimes — it imports nothing, so it's safe on the Edge runtime
// (lib/session.ts is not: "server-only" + next/headers).

const encodedKey = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me",
);

interface Session {
  userId: string;
  role: Role;
  /** Seconds-since-epoch the token was minted; drives the renewal check. */
  issuedAt: number;
}

async function readSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    return {
      userId: payload.userId as string,
      role: payload.role as Role,
      issuedAt: payload.iat ?? 0,
    };
  } catch {
    return null;
  }
}

/** A re-signed cookie for a session that's been alive a while, or null if it's
 *  too fresh to bother. Keeping it to once a day means a busy tab doesn't
 *  re-sign a JWT on every prefetch. */
async function renewal(session: Session): Promise<{ token: string; maxAge: number } | null> {
  const ageS = Math.floor(Date.now() / 1000) - session.issuedAt;
  if (ageS < SESSION_RENEW_AFTER_S) return null;
  const maxAge = sessionMaxAgeS(session.role);
  const token = await new SignJWT({ userId: session.userId, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .sign(encodedKey);
  return { token, maxAge };
}

/** Attach a renewed cookie to whatever response we were going to send. Applied
 *  on EVERY authenticated exit path — a redirect is as good a moment to slide
 *  the session as a page view, and missing one would mean a user who only ever
 *  gets redirected never renews. Attributes must match createSession()'s. */
function slide(res: NextResponse, fresh: { token: string; maxAge: number } | null): NextResponse {
  if (!fresh) return res;
  res.cookies.set(COOKIE, fresh.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: fresh.maxAge,
  });
  return res;
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
 *  finally lapses a bookmark or a stale tab lands here with no cookie, and a
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
  const session = await readSession(req);
  // One re-sign per request at most, reused across whichever exit path we take.
  // Never on /logout: that route answers with its own Set-Cookie clearing the
  // session, and a renewal riding the same response is a coin-flip over which
  // header the browser applies last — i.e. a Sign out that doesn't.
  const fresh = session && path !== "/logout" ? await renewal(session) : null;

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
    return slide(NextResponse.redirect(url), fresh);
  }

  // Role gating: non-owners are confined to their portal.
  const allowed = allowedFor(session.role);
  if (allowed.length > 0 && !allowed.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = req.nextUrl.clone();
    url.pathname = homeForRole(session.role);
    return slide(NextResponse.redirect(url), fresh);
  }

  return slide(NextResponse.next(), fresh);
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
