import "server-only";
import { z } from "zod";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getCurrentUser, type CurrentUser } from "@/lib/dal";
import * as chat from "@/lib/actions/ai-chat";
import { pollAgentRun, listRunApprovals } from "@/lib/actions/dev-agents";
import { loadRunReview } from "@/lib/actions/panel-review";
import { getProject } from "@/lib/projects";
import { getLead } from "@/lib/leads";
import { projectContext, leadContext } from "@/lib/page-context";
import { AGENT_ORDER, AGENT_META, CLAUDE_DEFAULTS, CLAUDE_MODEL_OPTIONS, CLAUDE_CONTEXT_OPTIONS, CLAUDE_MODE_OPTIONS, CLAUDE_EFFORT_OPTIONS } from "@/lib/dev-agents-meta";
import { resolveThreadStatus, STATUS_META, isThreadBusy, ms, type RailThread } from "@/lib/thread-rail";
import { startersForRoute } from "@/components/panel/panelStarters";
import { MobileInputError } from "./dispatch";

export interface OperatorContext { type: "project" | "lead" | "vendor" | "sub"; slug: string }
export async function operatorPageContext(context: OperatorContext | undefined, user: CurrentUser): Promise<string | undefined> {
  if (!context) return undefined;
  const area = ({ project: "projects", lead: "leads", vendor: "vendors", sub: "subs" } as const)[context.type];
  if (!hasAccess(user, area)) throw new MobileInputError("You don't have access to that record.");
  const route = `/${area}/${encodeURIComponent(context.slug)}`;
  // Same serializers as PageAiContext. Sub/vendor pages have no serializer;
  // PageAiContext uses this route-only fallback on the web too.
  if (context.type === "project") {
    const record = await getProject(context.slug);
    if (!record) throw new MobileInputError("That job no longer exists.");
    return projectContext(record);
  }
  if (context.type === "lead") {
    const record = await getLead(context.slug);
    if (!record) throw new MobileInputError("That lead no longer exists.");
    return leadContext(record);
  }
  return `The owner is currently viewing the app page ${route}.`;
}

/** Actions use cookie-first DAL auth; never mix a bearer user with a cookie user. */
export async function mobileOperatorRead(req: Request, ownerOnly: boolean, read: (user: CurrentUser) => Promise<unknown>): Promise<Response> {
  try {
    const user = await getUserFromRequest(req);
    if (!user || (await getCurrentUser())?.id !== user.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasAccess(user, "ai") || (ownerOnly && user.role !== "owner")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
    const result = await read(user);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof MobileInputError) return Response.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : error.message }, { status: 400 });
    // Match the RPC route's treatment of DAL authentication redirects.
    if (typeof error === "object" && error && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT;")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
    console.error("[mobile-operator] Request failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
const iso = (value: string | null) => value == null ? null : new Date(ms(value)).toISOString();
export const threadActions = ["operator.send", "operator.rename", "operator.pin", "operator.move", "operator.fileUnder", "operator.resetSession", "operator.delete", "operator.unsettle"];
export function operatorThread(t: RailThread, req: Request, user: CurrentUser) {
  const query = new URL(req.url).searchParams;
  const seen = new Set((query.get("seenRunIds") ?? "").split(",").slice(0, 500));
  const since = query.get("since");
  if (since && !Number.isFinite(Date.parse(since))) throw new MobileInputError("Invalid since date.");
  const status = resolveThreadStatus(t, { seen: id => seen.has(id), currentId: query.get("currentId"), sinceMs: since ? Date.parse(since) : undefined });
  return { ...t, createdAt: iso(t.createdAt)!, updatedAt: iso(t.updatedAt)!, lastActivityAt: iso(t.lastActivityAt), unsettledAt: iso(t.unsettledAt), settledAt: iso(t.settledAt), archivedAt: iso(t.archivedAt), pinnedAt: iso(t.pinnedAt), workingSince: iso(t.workingSince), lastRunEndedAt: iso(t.lastRunEndedAt),
    status, label: STATUS_META[status].label || "Ready", unread: status === "completed" || status === "failed", pendingRunId: t.working ? t.lastRunId : null,
    allowedActions: [...threadActions.filter(action => action !== "operator.send" || user.role === "owner" || t.agent === "auto" || t.agent === "claude"), ...(!isThreadBusy(t) ? ["operator.settle"] : []), ...(!t.working ? ["operator.archive"] : [])] };
}
export async function operatorRail(req: Request, user: CurrentUser) {
  const rail = await chat.listThreadRailAction();
  return { folders: rail.folders.map(f => ({ ...f, archivedAt: iso(f.archivedAt), allowedActions: ["operator.renameFolder", "operator.collapseFolder", "operator.archiveFolder"] })), threads: rail.threads.map(t => operatorThread(t, req, user)), allowedActions: ["operator.new", "operator.createFolder", ...(user.role === "owner" ? ["searchJobs", "operator.approveGrant", "operator.denyGrant"] : [])] };
}
export async function operatorConversation(id: string) {
  z.uuid().parse(id);
  const conversation = await chat.loadConversationAction(id);
  if (!conversation) return Response.json({ error: "That conversation no longer exists." }, { status: 404 });
  return { ...conversation, messages: conversation.messages.map(m => ({ ...m, createdAt: iso(m.createdAt)! })), allowedActions: threadActions };
}
export async function operatorArchived(req: Request, user: CurrentUser) { return { threads: (await chat.listArchivedThreadsAction()).map(t => operatorThread(t, req, user)) }; }
export async function operatorRun(id: string) { z.uuid().parse(id); return pollAgentRun(id); }
export async function operatorRunReview(id: string) { z.uuid().parse(id); return { review: await loadRunReview(id), grants: await listRunApprovals(id) }; }
export async function operatorJobs(req: Request) { const q = z.string().max(200).parse(new URL(req.url).searchParams.get("q") ?? ""); return { jobs: await chat.searchJobsAction(q) }; }
export async function operatorConfig(req: Request, user: CurrentUser) {
  const query = new URL(req.url).searchParams;
  const agent = z.enum(["auto", "claude", "qwen", "hermes"]).parse(query.get("agent") ?? "auto");
  return { agents: AGENT_ORDER.filter(a => user.role === "owner" || a === "auto" || a === "claude").map(a => AGENT_META[a]), defaults: CLAUDE_DEFAULTS, models: CLAUDE_MODEL_OPTIONS, contexts: CLAUDE_CONTEXT_OPTIONS, modes: CLAUDE_MODE_OPTIONS, efforts: CLAUDE_EFFORT_OPTIONS, starters: startersForRoute(query.get("route"), agent), allowedActions: ["operator.new", "operator.send", "upload", ...(user.role === "owner" ? ["operator.approveGrant", "operator.denyGrant", "expressPermission"] : [])] };
}
