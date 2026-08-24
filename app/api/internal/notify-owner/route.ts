// Internal bridge (MCP → app) for OWNER PUSHES. The MCP server runs in its
// own process, so tools that must tell Joe something (a record_agent_run with
// status=failed) report here instead of importing lib/notify-owner directly —
// same shape as the owner-grants bridge. Bearer-gated with CRON_SECRET
// (trusted local caller, not a browser session).
//
// Actions:
//   agent_failure — failed agent run; collapsed to one push per runtime/hour.
//   notify        — generic owner push (any kind); also the test surface the
//                   W3 verification drives (`test_now` shifts the clock so
//                   quiet-hours parking can be exercised).
//
// This route pushes to JOE only. It cannot address anyone else.

import { NextResponse } from "next/server";
import { notifyAgentFailure, notifyOwner, type OwnerPushKind } from "@/lib/notify-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: OwnerPushKind[] = ["grant", "urgent_item", "agent_failure", "stale_approval"];

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const str = (k: string) => (body[k] == null ? undefined : String(body[k]));
  try {
    switch (action) {
      case "agent_failure": {
        const runtime = str("runtime_name");
        if (!runtime) return NextResponse.json({ ok: false, error: "runtime_name required" }, { status: 400 });
        await notifyAgentFailure(runtime, str("error_summary"));
        return NextResponse.json({ ok: true });
      }
      case "notify": {
        const kind = str("kind") as OwnerPushKind | undefined;
        const title = str("title");
        if (!kind || !KINDS.includes(kind)) {
          return NextResponse.json({ ok: false, error: `kind must be one of: ${KINDS.join(", ")}` }, { status: 400 });
        }
        if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
        const testNow = str("test_now");
        await notifyOwner(
          { kind, title, body: str("body"), href: str("href") },
          testNow ? new Date(testNow) : undefined,
        );
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}
