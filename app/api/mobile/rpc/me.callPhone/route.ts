import { getUserFromRequest } from "@/lib/api-auth";
import { getCurrentUser } from "@/lib/dal";
import { query } from "@/lib/db";
import { callPhoneInput } from "@/lib/mobile-rpc/me";

// A profile setting needs no area permission. Keep the shared RPC dispatcher
// unchanged: its actions intentionally require an area.
export async function POST(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user || (await getCurrentUser())?.id !== user.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "owner" && user.role !== "staff") return Response.json({ error: "You don't have access to that." }, { status: 403 });
    let body: unknown;
    try { body = await req.json(); } catch { return Response.json({ error: "Expected a JSON body." }, { status: 400 }); }
    const parsed = callPhoneInput.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    // Uses the website login. Narrow database roles have no users write grant.
    await query("UPDATE users SET phone = $1 WHERE id = $2", [parsed.data.phone, user.id]);
    return Response.json({ ok: true, result: { phone: parsed.data.phone } });
  } catch (error) {
    console.error("[mobile-me] Update failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
