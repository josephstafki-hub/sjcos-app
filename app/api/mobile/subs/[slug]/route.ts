import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/api-auth";
import { getSub } from "@/lib/subs";

// GET /api/mobile/subs/[slug] — subcontractor detail for the iOS/iPad app
// (owner only). Returns a read-only, mobile-friendly subset of SubDetail:
// header, COI/compliance, contact strip, reliability metrics, real job history
// (project_subs), paperwork, and rate. The AI reliability blurb (aiSummaryInput,
// which the web page streams via getSubSummary — ~10–20s of CPU inference) is
// intentionally NOT awaited or shipped, and the owner's private editable `notes`
// and the redundant `w9` (already inside `paperwork`) are omitted. No comms
// actions are wired — delivery stays owner-gated in the web app.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { slug } = await params;
  const sub = await getSub(slug);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const detail = {
    slug: sub.slug,
    initials: sub.initials,
    name: sub.name,
    tradeLine: sub.tradeLine,
    working: sub.working,
    coiStatus: sub.coiStatus,
    coiLabel: sub.coiLabel,
    contact: sub.contact,
    phone: sub.phone,
    email: sub.email,
    jobsCount: sub.jobsCount,
    rating: sub.rating,
    reliability: sub.reliability,
    recentJobs: sub.recentJobs,
    paperwork: sub.paperwork,
    rate: sub.rate,
    taxNote: sub.taxNote,
  };

  return NextResponse.json({ sub: detail });
}
