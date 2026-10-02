// GET /api/mobile/time/review?from=ISO&to=ISO — the owner's intervals in the
// range with flags (overlap / long / missing exit / inferred / review /
// no project), site-vs-office totals (union, never double-counted) and the
// running timer. Defaults to the last 7 days.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { timeReview } from "@/lib/owner-time/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner time capture is owner-only." }, { status: 403 });
  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? new Date().toISOString();
  const from = url.searchParams.get("from") ?? new Date(Date.parse(to) - 7 * 86400_000).toISOString();
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return NextResponse.json({ error: "from/to must be ISO timestamps." }, { status: 400 });
  return NextResponse.json(await timeReview(user.id, from, to));
}
