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
import { buildStagedSend, getGrant, grantLive, grantWaiting, listGrants, requestGrant, stagedResultOf, stagedSendOf } from "@/lib/owner-grants";
import { principalMaySpendGrant } from "@/lib/authority/mcp-gate";
import { runDirect } from "@/lib/commands/db";

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
  // Send-on-approval: when set, approving performed (or will perform) the
  // send itself — the agent must not call the send tool for it.
  sends_on_approval: Boolean(stagedSendOf(g)),
  sent_on_approval: stagedResultOf(g),
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
        const obj = (k: string) => (body[k] && typeof body[k] === "object" ? (body[k] as Record<string, unknown>) : null);
        const em = obj("email");
        const sm = obj("sms");
        const built = buildStagedSend({
          action: str("gated_action") ?? "",
          targetId: str("target_id") ?? null,
          email: em
            ? {
                to: em.to == null ? undefined : String(em.to),
                subject: em.subject == null ? undefined : String(em.subject),
                body: em.body == null ? undefined : String(em.body),
                attachment_file_ids: Array.isArray(em.attachment_file_ids) ? em.attachment_file_ids.map(String) : undefined,
                work_item_id: em.work_item_id == null ? (str("work_item_id") ?? null) : String(em.work_item_id),
              }
            : null,
          sms: sm ? { to: sm.to == null ? undefined : String(sm.to), body: sm.body == null ? undefined : String(sm.body) } : null,
          override: Boolean(body.override),
          sendOnApproval: body.send_on_approval === false ? false : undefined,
        });
        if (!built.ok) return NextResponse.json(built, { status: 400 });
        const r = await requestGrant({
          action: str("gated_action") ?? "",
          targetId: built.targetId,
          reason: str("reason") ?? "",
          requestedBy: str("agent") ?? "agent",
          conversationId: str("conversation_id") ?? null,
          workItemId: str("work_item_id") ?? null,
          staged: built.staged,
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
          grants: all.filter((g) => grantWaiting(g) || grantLive(g)).map(pub),
        });
      }
      case "perform": {
        // A22: when a person is behind the agent, that person must hold the
        // authority the gated action maps to (project/amount bounds apply).
        // No person → the owner grant alone decides, as before.
        const gate = await principalMaySpendGrant(runDirect, str("principal_user_id") ?? null, str("gated_action") ?? "", {
          projectId: str("project_id") ?? null,
          amountCents: body.amount_cents == null ? null : Number(body.amount_cents),
        });
        if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
        // A request that carries its send is performed by the app on
        // approval; an agent sending it too is the double-send this guards.
        const spending = await getGrant(str("grant_id") ?? "");
        if (spending && stagedSendOf(spending)) {
          const done = stagedResultOf(spending);
          return NextResponse.json(
            {
              ok: false,
              already_handled: true,
              error: done
                ? `This permission sent its own message when Joe approved it (${done.state}${done.summary ? `: ${done.summary}` : done.error ? `: ${done.error}` : ""}). Do not send it again.`
                : "This permission sends its own message the moment Joe approves it — don't call the send tool for it. Check it with check_owner_permission.",
            },
            { status: 409 },
          );
        }
        const email = body.email && typeof body.email === "object" ? (body.email as Record<string, unknown>) : undefined;
        const sms = body.sms && typeof body.sms === "object" ? (body.sms as Record<string, unknown>) : undefined;
        const call = body.call && typeof body.call === "object" ? (body.call as Record<string, unknown>) : undefined;
        const r = await performGrantedAction({
          action: str("gated_action") ?? "",
          grantId: str("grant_id") ?? "",
          target: str("target_id") ?? null,
          email: email
            ? {
                to: String(email.to ?? ""),
                subject: String(email.subject ?? ""),
                body: String(email.body ?? ""),
                attachment_file_ids: Array.isArray(email.attachment_file_ids) ? email.attachment_file_ids.map(String) : undefined,
              }
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
