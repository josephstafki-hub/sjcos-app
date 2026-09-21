import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, Eyebrow } from "@/components/ui";
import { hasAccess } from "@/lib/api-auth";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { getPublishedDesignForFloorplan, listPlanDesignComments } from "@/lib/plan-designs";
import { PlanViewer3D, type PortalPlanComment } from "@/components/portal/PlanViewer3D";

// Client-portal 3D viewer for one posted floor-plan version
// (docs/floor-plan-designer-plan.md §10, "Portal 3D"). Keyed by the
// project_floorplans id — the same id the plans list and the serve route use —
// and authorized the same way as /api/portal/floorplan/[id]: a client only
// reaches PUBLISHED versions of their own project; owner/staff with the
// projects area reach everything. Nothing here throws on a bad id: the client
// gets a friendly card either way, since the id space is guessable.
export default async function PortalPlan3DPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const floorplanId = Number(id);
  const owner = hasAccess(user, "projects");

  const design = Number.isFinite(floorplanId) ? await getPublishedDesignForFloorplan(floorplanId) : null;

  // A version without a designer snapshot (uploaded PDF/image) or an unknown id.
  if (!design) {
    return (
      <Frame>
        <Card className="p-4">
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            This version doesn&apos;t have a 3D model. Plans drawn in the designer show up
            here in 3D; uploaded sheets are viewable from the Floor plans page.
          </p>
        </Card>
      </Frame>
    );
  }

  const allowed =
    owner || (user.role === "client" && user.linkSlug === design.slug && design.published);
  if (!allowed) {
    return (
      <Frame>
        <Card className="p-4">
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Not available. This plan version isn&apos;t shared with your account.
          </p>
        </Card>
      </Frame>
    );
  }

  const [fp, allComments, proj] = await Promise.all([
    queryOne<{ version: number }>(`SELECT version FROM project_floorplans WHERE id = $1`, [floorplanId]),
    listPlanDesignComments(design.designId),
    queryOne<{ client_name: string | null }>(`SELECT client_name FROM projects WHERE slug = $1`, [design.slug]),
  ]);

  // Comments on this snapshot, plus design-wide ones (no version).
  const comments: PortalPlanComment[] = allComments
    .filter((c) => c.versionId === design.versionId || c.versionId === null)
    .map((c) => ({
      id: c.id,
      authorRole: c.authorRole,
      authorName: c.authorName,
      body: c.body,
      createdLabel: c.createdLabel,
      anchor: c.anchor,
      resolved: !!c.resolvedAt,
    }));

  const signerName = proj?.client_name || user.name || "";
  const versionLabel = fp ? `Version ${fp.version}` : "";

  return (
    <Frame>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        {design.name}
        {versionLabel && (
          <span className="ml-2 font-mono text-[12px] font-normal uppercase tracking-[0.1em] text-ink-3">
            {versionLabel}
          </span>
        )}
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Walk through the plan and leave notes on anything you&apos;d like changed. Joe sees
        every comment pinned right where you left it.
      </p>
      <div className="my-5 border-t border-rule" />
      <PlanViewer3D
        doc={design.doc}
        floorplanId={floorplanId}
        comments={comments}
        signerName={signerName}
        canComment={user.role === "client" || owner}
        viewerRole={user.role === "client" ? "client" : "owner"}
      />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-9 py-7">
      <Link
        href="/client-portal/plans"
        className="mb-3 inline-flex min-h-9 items-center gap-1 rounded-md border border-rule bg-card px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        All floor plans
      </Link>
      <Eyebrow>Floor plan · 3D</Eyebrow>
      {children}
    </main>
  );
}
