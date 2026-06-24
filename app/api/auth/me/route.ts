import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";

// GET /api/auth/me — validate a token and return the current user.
// The mobile app calls this on launch to decide whether the stored token is
// still good before showing the authed UI.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ user });
}
