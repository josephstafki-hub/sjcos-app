// One picture of the posting browser's sign-in window (owner only). The
// /marketing panel polls it while Joe signs in.

import { getCurrentUser } from "@/lib/dal";
import { signinFrame } from "@/lib/publisher/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "owner") return new Response("owner only", { status: 403 });
  const jpg = await signinFrame();
  if (!jpg) return new Response("The sign-in window isn't open.", { status: 404 });
  return new Response(new Uint8Array(jpg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
