import "server-only";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import type { CurrentUser } from "@/lib/dal";
import { getQueueSnapshot, type TodayPriority } from "@/lib/today";
import { listPendingApprovals } from "@/lib/approvals";
import { listGrants, grantWaiting } from "@/lib/owner-grants";
import { describeGrants } from "@/lib/grant-detail";
import { describeStagedSend, stagedSendOf } from "@/lib/owner-grant-types";

export async function mobileRead(req: Request, ownerOnly: boolean, read: (user: CurrentUser) => Promise<unknown>): Promise<Response> {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasAccess(user, "today") || (ownerOnly && user.role !== "owner")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
    return Response.json(await read(user));
  } catch (error) {
    console.error("[mobile-read] Read failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export interface MobileRecordLink {
  type: "project" | "lead" | "sub" | "vendor" | "thread" | "none";
  id: string | null;
  label: string;
  href: string | null;
}
export function recordLink(href: string | undefined, label: string): MobileRecordLink {
  const match = /^\/(projects|leads|subs|vendors|inbox)\/([^/?#]+)/.exec(href ?? "");
  const types = { projects: "project", leads: "lead", subs: "sub", vendors: "vendor", inbox: "thread" } as const;
  return { type: match ? types[match[1] as keyof typeof types] : "none", id: match?.[2] ?? null, label, href: href ?? null };
}
export type MobileQueueAction = "open" | "today.complete" | "today.snooze" | "today.assign" | "today.promote" | "today.sendBack" | "today.handoff";
export interface MobileQueueItem {
  id: string;
  title: string;
  summary: string;
  kind: string;
  source: string;
  dueDate: string | null;
  assignees: { userId: string; name: string; initials: string }[];
  record: MobileRecordLink;
  allowedActions: MobileQueueAction[];
  aiHandoff: ("do" | "prep")[];
}
export async function mobileQueue(user: CurrentUser) {
  const queue = await getQueueSnapshot(user);
  function card(p: Omit<TodayPriority, "rank">, place: "upNext" | "list"): MobileQueueItem {
    const allowedActions: MobileQueueAction[] = p.href ? ["open"] : [];
    if (p.checkable) {
      if (p.lane === "chat" || p.lane === "quick") allowedActions.push("today.complete");
      if (p.lane === "quick" || p.lane === "deep") allowedActions.push("today.snooze");
      if (user.role === "owner") {
        allowedActions.push("today.assign");
        if (place === "upNext") allowedActions.push("today.sendBack");
        else if (!p.waitingOnSub) allowedActions.push("today.promote");
      }
    }
    const aiHandoff: ("do" | "prep")[] = user.role === "owner"
      ? p.checkable && p.lane === "chat" ? ["do"] : p.lane === "deep" ? ["prep"] : []
      : [];
    if (aiHandoff.length) allowedActions.push("today.handoff");
    return {
      id: p.id, title: p.title, summary: p.sub,
      kind: p.checkable ? "To-do" : p.tag.toLowerCase().replaceAll("_", " "),
      source: p.group.name, dueDate: p.dueDay ?? null, assignees: p.assignedTo ?? [],
      record: recordLink(p.group.href ?? p.href, p.group.name), allowedActions, aiHandoff,
    };
  }
  return {
    upNext: queue.priorities.filter(p => p.id !== "all-clear").map(p => card(p, "upNext")),
    waiting: { items: queue.waiting.items.map(p => card(p, "list")), total: queue.waiting.total },
  };
}

export async function mobileApprovals() {
  const [pending, grants] = await Promise.all([listPendingApprovals({ limit: 1000 }), listGrants(1000)]);
  const waiting = grants.filter(g => grantWaiting(g));
  const details = await describeGrants(waiting);
  const approvals = pending.map(p => ({
    id: p.id, key: p.key, kind: p.tag === "Permission" ? "permission" as const : p.kind,
    grantId: waiting.find(g => g.decision_id === p.id)?.id ?? null,
    title: p.title, effect: p.effect, sends: p.sends, record: recordLink(p.href, p.title),
    createdAt: p.createdAt, body: p.body, subject: p.subject, to: p.to, contentHash: p.contentHash,
  }));
  // Include legacy requests not bridged to a decision (the permissions page
  // can still approve these through approveGrant/denyGrant).
  for (const g of waiting) {
    if (approvals.some(p => p.grantId === g.id)) continue;
    const d = details[g.id];
    const staged = stagedSendOf(g);
    approvals.push({
      id: g.id, key: `grant:${g.id}`, kind: "permission", grantId: g.id,
      title: d?.headline ?? g.reason, effect: staged ? describeStagedSend(staged) : "Grants permission for the agent to act.",
      sends: Boolean(staged), record: recordLink("/engine/permissions", d?.headline ?? g.reason),
      createdAt: new Date(g.created_at).toISOString(), body: staged?.email?.body ?? staged?.sms?.body ?? d?.draft?.body ?? null,
      subject: staged?.email?.subject ?? d?.draft?.subject ?? null,
      to: staged?.email?.to ?? staged?.sms?.to ?? d?.draft?.to ?? null, contentHash: null,
    });
  }
  return { approvals: approvals.sort((a,b) => b.createdAt.localeCompare(a.createdAt)) };
}
