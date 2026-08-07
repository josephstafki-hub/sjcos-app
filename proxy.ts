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
 *  each only mints a session for a valid, unexpired, undismissed token
 *  (app/sub-portal/enter, app/client-portal/enter). */
const PUBLIC_PATHS = ["/login", "/sub-portal/enter", "/client-portal/enter"];

/** Routes a non-owner role is allowed to reach (besides /login). /logout must
 *  stay reachable for every role — it's the escape hatch for a stale session
 *  (valid JWT, deleted user row), which would otherwise loop forever between
 *  /login and the role home. */
function allowedFor(role: Role): string[] {
  if (role === "sub") return ["/sub-portal", "/logout"];
  if (role === "client") return ["/client-portal", "/logout"];
  return []; // owner: everything
}

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const session = await readRole(req);

  // Unauthenticated → only the public paths are reachable.
  if (!session) {
    if (PUBLIC_PATHS.includes(path)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
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
