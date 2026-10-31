// The posting browser's sign-in window (/marketing › Posting accounts). Owner
// only: Joe signs in to Facebook, Instagram and Google himself through a live
// picture of the one posting browser on this box (lib/publisher/server.ts).
//
//   GET                         → status (open? which site, which page)
//   POST {action:"open", platform}   open it (or switch site)
//   POST {action:"input", input}     relay one click / key / typed text
//   POST {action:"close"}            close it (cookies are kept)
//
// Typed text passes straight through to the browser: never logged, never stored.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { isPostPlatform } from "@/lib/marketing-types";
import { signinInput, signinStatus, startSignin, stopSignin, type SigninInput } from "@/lib/publisher/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function owner() {
  const user = await getCurrentUser();
  return user?.role === "owner" ? user : null;
}

export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: "owner only" }, { status: 403 });
  return NextResponse.json(await signinStatus());
}

function parseInput(raw: unknown): SigninInput | null {
  const i = raw as Record<string, unknown> | null;
  if (!i || typeof i !== "object") return null;
  if (i.type === "click" && Number.isFinite(i.x) && Number.isFinite(i.y)) return { type: "click", x: Number(i.x), y: Number(i.y) };
  if (i.type === "scroll" && Number.isFinite(i.dy)) return { type: "scroll", dy: Number(i.dy) };
  if (i.type === "key" && typeof i.key === "string" && i.key.length <= 20) return { type: "key", key: i.key };
  if (i.type === "text" && typeof i.text === "string" && i.text.length <= 500) return { type: "text", text: i.text };
  if (i.type === "back") return { type: "back" };
  return null;
}

export async function POST(req: Request) {
  if (!(await owner())) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { action?: string; platform?: string; input?: unknown } | null;
  if (body?.action === "open") {
    if (!isPostPlatform(body.platform)) return NextResponse.json({ ok: false, message: "Pick Facebook, Instagram or Google." }, { status: 400 });
    return NextResponse.json(await startSignin(body.platform));
  }
  if (body?.action === "input") {
    const input = parseInput(body.input);
    if (!input) return NextResponse.json({ ok: false }, { status: 400 });
    return NextResponse.json({ ok: await signinInput(input) });
  }
  if (body?.action === "close") {
    await stopSignin();
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false }, { status: 400 });
}
