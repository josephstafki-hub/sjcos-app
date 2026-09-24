// POST /api/mobile/time/timer — one clock action: start / stop / confirm a
// prompt / propose a clock-in / clock out / correct. Replay-safe on
// clientEventId (send the same id on retry). Owner-only.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { timerAction, type TimerActionBody } from "@/lib/owner-time/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner time capture is owner-only." }, { status: 403 });
  let body: TimerActionBody;
  try {
    body = (await req.json()) as TimerActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "action is required." }, { status: 400 });
  const r = await timerAction({ id: user.id, name: user.name }, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r);
}
