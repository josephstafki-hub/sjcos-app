import { getUserFromRequest } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { formatUsPhone } from "@/lib/comms/phone";
import { lineBadgesFor } from "@/lib/phone-lines";

export async function GET(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "owner" && user.role !== "staff") return Response.json({ error: "You don't have access to that." }, { status: 403 });
    const row = await queryOne<{ phone: string | null }>("SELECT phone FROM users WHERE id = $1", [user.id]);
    const callPhone = row?.phone ?? null;
    // The business number(s) clients see: the main line, and this login's own
    // line when it has one (Settings › Phone lines). Additive for older builds.
    const lines = await lineBadgesFor(user);
    return Response.json(
      { user, callPhone, callPhoneFormatted: callPhone ? formatUsPhone(callPhone) : null, businessLine: lines.company, myLine: lines.mine },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[mobile-me] Read failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
