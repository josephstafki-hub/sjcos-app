import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { getLead, stageLabel } from "@/lib/leads";

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
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await params;
  const lead = await getLead(slug);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const detail = {
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
    estimate: lead.estimate
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
