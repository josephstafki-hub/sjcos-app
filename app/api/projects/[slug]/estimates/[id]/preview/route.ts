// Owner-only live preview of a project estimate's Formal Estimate PDF — the same
// house-style document the `estimate_doc` generator produces, rendered on the
// fly from the estimate's current lines (no draft row). Mirrors the lead
// rough-estimate preview (app/api/leads/[slug]/rough-estimate/route.ts); lets
// the Money → Estimate editor show a PDF that refreshes as lines are saved.

import { getCurrentUser } from "@/lib/dal";
import { renderProjectEstimatePdf } from "@/lib/doc-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "owner") return new Response("Forbidden", { status: 403 });

  const { slug, id } = await params;
  const pdf = await renderProjectEstimatePdf(slug, Number(id));
  if (!pdf) return new Response("Add at least one line before previewing.", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Formal Estimate.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
