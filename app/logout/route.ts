import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/session";

// GET /logout — clear the session cookie and land on /login. Exists as a GET
// route (not just the Server Action in lib/actions/auth.ts) so a browser stuck
// with a STALE session can be sent somewhere that breaks the loop: a valid JWT
// whose users row is gone (deleted account, demo reseed) passes proxy.ts's
// optimistic check, so /login bounces to the role home, whose requireUser()
// bounces back to /login — forever. requireUser() redirects here instead.
export async function GET(req: Request) {
  await deleteSession();
  return NextResponse.redirect(new URL("/login", req.url));
}
