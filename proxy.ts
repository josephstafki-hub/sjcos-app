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

/** Reachable without a session. The sub-portal invite link is the sub's way IN —
 *  they have no cookie yet by definition, so bouncing it to /login would defeat
 *  the whole point. The route itself is the gate: it only mints a session for a
 *  valid, unexpired, undismissed token (app/sub-portal/enter/route.ts). */
const PUBLIC_PATHS = ["/login", "/sub-portal/enter"];

/** Routes a non-owner role is allowed to reach (besides /login). */
function allowedFor(role: Role): string[] {
  if (role === "sub") return ["/sub-portal"];
  if (role === "client") return ["/client-portal"];
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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
