import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import { getLead, stageLabel, STAGES, stageIndex } from "@/lib/leads";

import { getLeadTasks } from "@/lib/lead-tasks";
import { getLeadActivity } from "@/lib/lead-activity";
import { getLeadScore } from "@/lib/intake";
import { getLeadFirstResponse } from "@/lib/lead-first-response";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";

// GET /api/mobile/leads/[slug] — lead detail for the iOS/iPad app (owner only).
// Returns a read-only, mobile-friendly subset of the heavy LeadDetail: header,
// contact, stage, address/source, intake Q&A, estimate summary, cadence, photo
// count, and any linked project. The lazy AI triage input, raw conversation,
// selections, files, and photo ids are intentionally NOT shipped.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAccess(user, "leads")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await params;
  const lead = await getLead(slug);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [tasks, activity, score, firstResponse, portalMessages] = await Promise.all([getLeadTasks(slug), getLeadActivity(slug), getLeadScore(slug), getLeadFirstResponse(slug), getPortalThread(portalChannel("client", `lead:${slug}`))]);
  const next = lead.stage === "lost" ? undefined : STAGES[stageIndex(lead.stage) + 1];
  const detail = {
    stageStepper: { stages: STAGES, current: lead.stage, next: lead.projectSlug ? null : next ?? null },
    allowedActions: ["leads.contact", "leads.intake", "leads.taskAdd", "leads.taskDone", "leads.taskDelete", ...(lead.projectSlug ? [] : lead.stage === "lost" ? ["leads.reopen"] : ["leads.lost", next ? "leads.advance" : "leads.convert"]), ...(user.role === "owner" && firstResponse?.status === "pending" && lead.email ? ["leads.sendFirstResponse"] : []), ...(hasAccess(user, "projects") ? ["leads.portalMessage"] : [])],
    contact: { name: lead.name, phone: lead.phone, email: lead.email, address: lead.address },
    tasks, activity, score, firstResponse, portalMessages,
    firstResponseSend: { canSend: user.role === "owner" && firstResponse?.status === "pending" && Boolean(lead.email), effect: "Sends this email to the lead. A rough estimate response may move the lead to Rough estimate and add a follow-up task." },
    conversation: lead.conversation,
    photos: lead.photos.map(p => ({ ...p, url: `/api/mobile/files/${encodeURIComponent(p.id)}` })),
    slug: lead.slug,
    name: lead.name,
    initials: lead.initials,
    scope: lead.scope,
    stage: lead.stage,
    stageLabelText: stageLabel(lead.stage),
    hot: lead.hot,
    ageDays: lead.ageDays,
    loggedLabel: lead.loggedLabel,
    address: lead.address,
    source: lead.source,
    email: lead.email,
    phone: lead.phone,
    referrer: lead.referrerName
      ? {
          name: lead.referrerName,
          email: lead.referrerEmail,
          thanked: lead.referrerThanked,
        }
      : null,
    intake: lead.intake.filter((q) => q.value.trim().length > 0),
    intakeAnswers: lead.intake,
    estimate: hasAccess(user, "estimates") && lead.estimate
      ? {
          status: lead.estimate.status,
          sentLabel: lead.estimate.sentLabel,
          lines: lead.estimate.lines,
          total: lead.estimate.total,
          notes: lead.estimate.notes,
        }
      : null,
    cadence: lead.cadence,
    photosCount: lead.photosCount,
    projectSlug: lead.projectSlug,
  };

  return NextResponse.json({ lead: detail });
}
