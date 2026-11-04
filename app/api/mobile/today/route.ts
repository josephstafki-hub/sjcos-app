import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { plainNotice } from "@/lib/mobile-rpc/destinations";
import { getTodayData } from "@/lib/today";

export const dynamic = "force-dynamic";

// GET /api/mobile/today — daily dashboard for the iOS app. The bearer user is
// passed through: Today is scoped to one person (owner's full board vs a team
// member's assigned to-dos) and there is no session cookie on a native request.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "today")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getTodayData(user);
  const count=user.role==="owner"?await queryOne<{count:number}>(`SELECT count(*)::int AS count FROM projects WHERE status IN ('construction','closeout')`):null;
  return NextResponse.json({...data,headerChips:data.headerChips.map(c=>({...c,label:c.label.replace(/ · on-site \+ closeout jobs, including unbilled work/,` on ${count?.count??0} job${count?.count===1?"":"s"} under way`)})),priorities:data.priorities.map(p=>({...p,sub:plainNotice(p.sub)}))});
}
