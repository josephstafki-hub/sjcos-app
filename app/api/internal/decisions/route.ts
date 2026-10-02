import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { agentPrincipal, runDirect, servicePrincipal } from "@/lib/commands/db";
import { getDecision } from "@/lib/commands/decisions";
import { contentHashOf } from "@/lib/commands/decisions";
import { cardCopyOf, naturalCheck, packageReleaseSummary, type PackagePayload } from "@/lib/decisions/cards";
import { stageAndAnnounce } from "@/lib/decisions/notify";
import { listOpenDecisions } from "@/lib/decisions/resolve";

// Internal bridge (MCP → app) for DECISIONS (A10). Bearer-gated with
// CRON_SECRET like the owner-grants bridge. Agents can STAGE a review card
// and READ/WAIT on it; nothing here resolves a decision — only a signed-in
// person on /engine/decisions or the owner's Telegram button can.
//
// Actions:
//   stage         — stage a decision over an exact payload (package release
//                   cards are built from the payload; the hash is over the
//                   same object). Same dedupe key + same content → the
//                   existing card, no second alert.
//   get           — one decision.
//   list_pending  — open decisions (optionally for a project).
//   wait          — long-poll (≤ 25 s per call) until the decision leaves
//                   'pending'.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pub = (d: NonNullable<Awaited<ReturnType<typeof getDecision>>>) => ({
  id: d.id,
  kind: d.kind,
  action: d.action,
  title: d.title,
  status: d.status,
  target_kind: d.target_kind,
  target_id: d.target_id,
  recipient: d.recipient,
  amount_cents: d.amount_cents,
  content_hash: d.content_hash,
  project_id: d.project_id,
  lead_id: d.lead_id,
  work_item_id: d.work_item_id,
  summary: d.summary,
  href: `/engine/decisions?d=${d.id}`,
  expires_at: d.expires_at,
  decided_via: d.decided_via,
  decided_at: d.decided_at,
  decision_note: d.decision_note,
  uses: d.uses,
  max_uses: d.max_uses,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const svc = servicePrincipal(req, "mcp:decisions");
  if (!svc) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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
      case "stage": {
        const principal = await agentPrincipal(str("agent") ?? "agent", { onBehalfOfUserId: str("on_behalf_of_user_id") ?? null });
        const kind = str("kind") ?? "other";
        const decisionAction = str("decision_action") ?? "";
        if (!decisionAction) return NextResponse.json({ ok: false, error: "decision_action is required (the gated action the consumer will present)." }, { status: 400 });
        const pkg = body.package && typeof body.package === "object" ? (body.package as PackagePayload) : null;
        const content = pkg ?? (body.content && typeof body.content === "object" ? (body.content as Record<string, unknown>) : null);
        if (!content) return NextResponse.json({ ok: false, error: "Provide `package` (a package-release payload) or `content` (the exact object being approved)." }, { status: 400 });
        const summary = pkg ? packageReleaseSummary(pkg) : ((body.summary as Record<string, unknown> | undefined) ?? {});
        const lint = naturalCheck(cardCopyOf(summary) + "\n" + (str("title") ?? ""));
        if (!lint.ok) return NextResponse.json({ ok: false, error: `Card copy must stay factual: ${lint.problems.join("; ")}` }, { status: 400 });
        const staged = await stageAndAnnounce({
          kind,
          action: decisionAction,
          title: (str("title") ?? (pkg ? `${pkg.title} → ${(pkg.recipients ?? []).length} recipient${(pkg.recipients ?? []).length === 1 ? "" : "s"}` : "Decision")).slice(0, 300),
          summary,
          targetKind: str("target_kind") ?? (pkg ? pkg.kind : null),
          targetId: str("target_id") ?? (pkg ? String(pkg.id) : null),
          recipient: str("recipient") ?? null,
          amountCents: body.amount_cents == null ? null : Number(body.amount_cents),
          content,
          contentHash: contentHashOf(content),
          artifactRevision: str("artifact_revision") ?? (pkg ? String(pkg.revision) : null),
          projectId: str("project_id") ?? null,
          leadId: str("lead_id") ?? null,
          href: str("href") ?? null,
          expiresInMinutes: body.expires_in_minutes == null ? undefined : Number(body.expires_in_minutes),
          maxUses: body.max_uses == null ? (pkg ? Math.max(1, (pkg.recipients ?? []).length) : 1) : Number(body.max_uses),
          dedupeKey: str("dedupe_key") ?? (pkg ? `${pkg.kind}:${pkg.id}` : null),
          workItemId: str("work_item_id") ?? null,
          requestedBy: principal,
        });
        revalidatePath("/engine/decisions");
        revalidatePath("/notifications");
        return NextResponse.json({ ok: true, created: staged.created, superseded: staged.superseded, decision: pub(staged.decision) });
      }
      case "get": {
        const d = await getDecision(runDirect, str("decision_id") ?? "");
        if (!d) return NextResponse.json({ ok: false, error: "No such decision." }, { status: 404 });
        return NextResponse.json({ ok: true, decision: pub(d) });
      }
      case "list_pending": {
        const rows = await listOpenDecisions(runDirect, { projectId: str("project_id") ?? null, includeHeld: true, limit: 100 });
        return NextResponse.json({ ok: true, decisions: rows.map(pub) });
      }
      case "wait": {
        const id = str("decision_id") ?? "";
        const deadline = Date.now() + Math.min(25_000, Math.max(1_000, Number(body.timeout_ms ?? 25_000)));
        let d = await getDecision(runDirect, id);
        if (!d) return NextResponse.json({ ok: false, error: "No such decision." }, { status: 404 });
        while (d.status === "pending" && Date.now() < deadline) {
          await sleep(1_500);
          d = (await getDecision(runDirect, id)) ?? d;
        }
        return NextResponse.json({ ok: true, settled: d.status !== "pending", decision: pub(d) });
      }
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Internal error" }, { status: 500 });
  }
}
