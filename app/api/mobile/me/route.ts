import { getUserFromRequest } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { formatUsPhone } from "@/lib/comms/phone";

export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "owner" && user.role !== "staff") return Response.json({ error: "You don't have access to that." }, { status: 403 });
    const row = await queryOne<{ phone: string | null }>("SELECT phone FROM users WHERE id = $1", [user.id]);
    const callPhone = row?.phone ?? null;
    return Response.json({ user, callPhone, callPhoneFormatted: callPhone ? formatUsPhone(callPhone) : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[mobile-me] Read failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
