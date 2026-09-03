// Internal agent surface for OWNER GRANTS (MCP -> app bridge): express
// permission for the sends agents can't do on their own. Bearer-gated with
// CRON_SECRET (trusted local caller, not a browser session).
//
// Actions:
//   request  — agent asks for permission → 'requested' grant + Decision
//              notification; Joe decides on /engine/permissions.
//   check    — read one grant's status (poll after a request).
//   list     — live grants, so an agent can see what it's already allowed.
//   perform  — spend a grant and run the send (lib/agent-sends.ts). This is
//              the ONLY agent path to a real inbox; the grant decides.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { performGrantedAction } from "@/lib/agent-sends";
import { getGrant, grantLive, listGrants, requestGrant } from "@/lib/owner-grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false; // fail closed if unconfigured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

const pub = (g: NonNullable<Awaited<ReturnType<typeof getGrant>>>) => ({
  id: g.id,
  status: g.status,
  live: grantLive(g),
  actions: g.actions,
  target_kind: g.target_kind,
  target_id: g.target_id,
  scope: g.scope,
  reason: g.reason,
  requested_by: g.requested_by,
  uses: g.uses,
  max_uses: g.max_uses,
  expires_at: g.expires_at,
  decided_at: g.decided_at,
  audit: g.audit,
});

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
      case "request": {
        const r = await requestGrant({
          action: str("gated_action") ?? "",
          targetId: str("target_id") ?? null,
          reason: str("reason") ?? "",
          requestedBy: str("agent") ?? "agent",
          conversationId: str("conversation_id") ?? null,
        });
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        revalidatePath("/notifications");
        revalidatePath("/engine/permissions");
        return NextResponse.json({ ok: true, grant: pub(r.grant) });
      }
      case "check": {
        const g = await getGrant(str("grant_id") ?? "");
        if (!g) return NextResponse.json({ ok: false, error: "No such grant." }, { status: 404 });
        return NextResponse.json({ ok: true, grant: pub(g) });
      }
      case "list": {
        const all = await listGrants(40);
        return NextResponse.json({
          ok: true,
          grants: all.filter((g) => g.status === "requested" || grantLive(g)).map(pub),
        });
      }
      case "perform": {
        const email = body.email && typeof body.email === "object" ? (body.email as Record<string, unknown>) : undefined;
        const sms = body.sms && typeof body.sms === "object" ? (body.sms as Record<string, unknown>) : undefined;
        const call = body.call && typeof body.call === "object" ? (body.call as Record<string, unknown>) : undefined;
        const r = await performGrantedAction({
          action: str("gated_action") ?? "",
          grantId: str("grant_id") ?? "",
          target: str("target_id") ?? null,
          email: email
            ? { to: String(email.to ?? ""), subject: String(email.subject ?? ""), body: String(email.body ?? "") }
            : undefined,
          sms: sms ? { to: String(sms.to ?? ""), body: String(sms.body ?? "") } : undefined,
          call: call ? { to: String(call.to ?? ""), contact_name: call.contact_name == null ? null : String(call.contact_name) } : undefined,
          override: Boolean(body.override),
          agent: str("agent") ?? "agent",
        });
        if (r.ok) {
          revalidatePath("/projects/[slug]", "page");
          revalidatePath("/newsletter");
          revalidatePath("/notifications");
          revalidatePath("/engine/permissions");
          revalidatePath("/messages");
          revalidatePath("/calls");
        }
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}
